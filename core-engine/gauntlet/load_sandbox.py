"""
load_sandbox.py — Isolation Sandbox & Performance Telemetry Gate

Launches generated application code in a sandboxed subprocess on a dedicated
local port, fires a short high-concurrency traffic burst at it using a native
benchmark CLI (autocannon or k6), samples hardware metrics (CPU %, RSS MB)
during the test window, and parses the results into a clean JSON telemetry
payload for the orchestrator's evaluation gate.

Design constraints
──────────────────
1. Zero external Python dependencies — stdlib only.
2. Safe teardown — the sandboxed process is killed even if the benchmark
   crashes, the port is freed, and temp files are cleaned up.
3. Hardware sampling runs in a dedicated thread so it doesn't block the
   benchmark subprocess.
4. Deterministic output — identical load patterns produce comparable results.
5. All output goes to stdout/stderr for isolated terminal verification.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("load_sandbox")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s",'
        '"component":"LoadSandbox","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


# ── Data Structures ──────────────────────────────────────────────────────────


class SandboxStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    STARTUP_FAILURE = "startup_failure"
    BENCHMARK_FAILURE = "benchmark_failure"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"


class BenchmarkTool(str, Enum):
    AUTOCANNON = "autocannon"
    K6 = "k6"
    BUILTIN = "builtin"


@dataclass
class HardwareSample:
    """Single point-in-time hardware metric snapshot."""

    timestamp: float
    cpu_percent: float
    rss_mb: float


@dataclass
class TelemetryPayload:
    """Clean performance telemetry extracted from a benchmark run."""

    avg_latency_ms: float = 0.0
    p50_latency_ms: float = 0.0
    p99_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    requests_per_second: float = 0.0
    total_requests: int = 0
    error_count: int = 0
    peak_cpu_percent: float = 0.0
    peak_memory_mb: float = 0.0
    avg_cpu_percent: float = 0.0
    avg_memory_mb: float = 0.0

    def to_dict(self) -> dict:
        return {k: round(v, 2) if isinstance(v, float) else v for k, v in asdict(self).items()}


@dataclass
class SandboxResult:
    """Full result from a load sandbox execution."""

    status: SandboxStatus
    tool: str
    target_command: str
    target_port: int
    duration_seconds: float
    concurrency: int
    telemetry: TelemetryPayload = field(default_factory=TelemetryPayload)
    hardware_samples: list[HardwareSample] = field(default_factory=list)
    raw_benchmark_stdout: str = ""
    raw_benchmark_stderr: str = ""
    elapsed_ms: float = 0.0
    error_detail: str = ""

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "tool": self.tool,
            "target_command": self.target_command,
            "target_port": self.target_port,
            "duration_seconds": self.duration_seconds,
            "concurrency": self.concurrency,
            "telemetry": self.telemetry.to_dict(),
            "hardware_sample_count": len(self.hardware_samples),
            "elapsed_ms": round(self.elapsed_ms, 2),
            "error_detail": self.error_detail,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Port Management ──────────────────────────────────────────────────────────


def find_free_port(start: int = 9100, end: int = 9200) -> int:
    """Find an available TCP port in the given range.

    Falls back to OS-assigned ephemeral port if the entire range is occupied.
    """
    for port in range(start, end):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", port))
                s.close()
                return port
        except OSError:
            continue

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 15.0) -> bool:
    """Block until a TCP connection to host:port succeeds, or timeout expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except (ConnectionRefusedError, OSError, socket.timeout):
            time.sleep(0.15)
    return False


# ── Hardware Monitoring ──────────────────────────────────────────────────────


def _read_proc_stat_cpu(pid: int) -> Optional[tuple[float, float]]:
    """Read CPU times from /proc/pid/stat on Linux.

    Returns (utime + stime in seconds, wall clock) or None on failure.
    """
    try:
        stat_path = Path(f"/proc/{pid}/stat")
        if not stat_path.exists():
            return None
        raw = stat_path.read_text()
        # Fields after the closing paren of the comm field
        parts = raw.rsplit(")", 1)[-1].split()
        # utime is field index 11, stime is 12 (0-indexed after comm)
        clk_tck = os.sysconf("SC_CLK_TCK")
        utime = int(parts[11]) / clk_tck
        stime = int(parts[12]) / clk_tck
        return (utime + stime, time.monotonic())
    except (OSError, IndexError, ValueError):
        return None


def _read_proc_rss_mb(pid: int) -> float:
    """Read RSS from /proc/pid/status on Linux, or via ps on macOS."""
    system = platform.system()

    if system == "Linux":
        try:
            status_path = Path(f"/proc/{pid}/status")
            if not status_path.exists():
                return 0.0
            for line in status_path.read_text().splitlines():
                if line.startswith("VmRSS:"):
                    kb = int(line.split()[1])
                    return kb / 1024.0
        except (OSError, IndexError, ValueError):
            return 0.0

    # macOS / fallback: use ps
    try:
        result = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            kb = int(result.stdout.strip())
            return kb / 1024.0
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
        pass

    return 0.0


def _estimate_cpu_percent_via_ps(pid: int) -> float:
    """Get CPU % from ps — works on both Linux and macOS."""
    try:
        result = subprocess.run(
            ["ps", "-o", "%cpu=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
        pass
    return 0.0


class HardwareMonitor:
    """Samples CPU and memory metrics for a target PID in a background thread."""

    def __init__(self, pid: int, interval: float = 0.25):
        self._pid = pid
        self._interval = interval
        self._samples: list[HardwareSample] = []
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._prev_cpu: Optional[tuple[float, float]] = None

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="hw-monitor")
        self._thread.start()
        logger.info("Hardware monitor started for PID %d", self._pid)

    def stop(self) -> list[HardwareSample]:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        logger.info(
            "Hardware monitor stopped — collected %d samples", len(self._samples)
        )
        return list(self._samples)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                sample = self._take_sample()
                if sample:
                    self._samples.append(sample)
            except Exception:
                pass
            self._stop_event.wait(self._interval)

    def _take_sample(self) -> Optional[HardwareSample]:
        now = time.monotonic()

        # CPU — try /proc first (Linux), fall back to ps
        cpu_pct = 0.0
        proc_stat = _read_proc_stat_cpu(self._pid)
        if proc_stat and self._prev_cpu:
            cpu_delta = proc_stat[0] - self._prev_cpu[0]
            wall_delta = proc_stat[1] - self._prev_cpu[1]
            if wall_delta > 0:
                cpu_pct = (cpu_delta / wall_delta) * 100.0
        elif proc_stat is None:
            cpu_pct = _estimate_cpu_percent_via_ps(self._pid)

        if proc_stat:
            self._prev_cpu = proc_stat

        rss_mb = _read_proc_rss_mb(self._pid)

        return HardwareSample(timestamp=now, cpu_percent=cpu_pct, rss_mb=rss_mb)


def _load_security_policy() -> dict:
    """Load security policy configuration if present."""
    policy_file = Path(__file__).resolve().parent / "security_policy.json"
    if policy_file.exists():
        try:
            return json.loads(policy_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to parse security_policy.json: %s", exc)
    return {}


def _sanitize_sandbox_environment(base_env: Optional[dict] = None, port: int = 9100) -> dict:
    """Sanitize environment variables according to security_policy.json."""
    policy = _load_security_policy()
    sanitation = policy.get("environment", {}).get("sanitation", {})

    if sanitation.get("inherit_from_host", True):
        env = dict(os.environ)
        for var in sanitation.get("stripped_variables", []):
            env.pop(var, None)
    else:
        # Deny-by-default: only injected_variables reach the sandbox.
        env = {}

    # Inject safe defaults
    chroot_tmp = tempfile.gettempdir()
    for k, v in sanitation.get("injected_variables", {}).items():
        val = (
            str(v)
            .replace("{assigned_port}", str(port))
            .replace("{chroot_dir}", chroot_tmp)
            .replace("{sandbox_id}", str(os.getpid()))
            .replace("{max_runtime}", "120")
        )
        env[k] = val

    # Ensure system PATH exists if stripped
    if "PATH" not in env or not env["PATH"]:
        env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin:/usr/local/bin")

    if base_env:
        env.update(base_env)

    env["PORT"] = str(port)
    return env


def _build_os_isolation_prefix() -> Optional[list[str]]:
    """Return a supported OS-level isolation launcher or None if unavailable."""
    if platform.system() == "Linux":
        firejail = shutil.which("firejail")
        if firejail:
            return [
                firejail,
                "--quiet",
                "--net=none",
                "--private",
                "--private-tmp",
                "--noprofile",
                "--caps.drop=all",
                "--seccomp",
                "--nonewprivs",
                "--",
            ]

        bwrap = shutil.which("bwrap")
        if bwrap:
            return [
                bwrap,
                "--unshare-net",
                "--unshare-user",
                "--die-with-parent",
                "--dev", "/dev",
                "--proc", "/proc",
                "--tmpfs", "/tmp",
                "--",
            ]

    elif platform.system() == "Darwin":
        sandbox_exec = shutil.which("sandbox-exec")
        if sandbox_exec:
            profile = (
                "(version 1)"
                "(deny default)"
                "(allow file-read* (subpath \"/tmp\"))"
                "(allow file-read* (subpath \"/private/tmp\"))"
                "(allow file-write* (subpath \"/tmp\"))"
                "(allow file-write* (subpath \"/private/tmp\"))"
                "(deny network*)"
            )
            return [sandbox_exec, "-p", profile, "--"]

    return None


class SandboxProcess:
    """Manages the lifecycle of a sandboxed application subprocess."""

    def __init__(
        self,
        command: list[str],
        port: int,
        cwd: Optional[str] = None,
        env: Optional[dict] = None,
        startup_timeout: float = 15.0,
    ):
        self._command = command
        self._port = port
        self._cwd = cwd
        self._env = _sanitize_sandbox_environment(env, port=port)
        self._startup_timeout = startup_timeout
        self._isolation_prefix = _build_os_isolation_prefix()
        self._process: Optional[subprocess.Popen] = None
        self._stdout_log = tempfile.NamedTemporaryFile(
            mode="w", suffix="_sandbox_stdout.log", delete=False
        )
        self._stderr_log = tempfile.NamedTemporaryFile(
            mode="w", suffix="_sandbox_stderr.log", delete=False
        )

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid if self._process else None

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> bool:
        """Launch the sandboxed process and wait for the port to become reachable."""
        if self._isolation_prefix is None:
            logger.error(
                "Automatic sandbox execution disabled: no supported OS-level isolation primitive is available (firejail, bwrap, or sandbox-exec)."
            )
            return False

        launch_cmd = [*self._isolation_prefix, *self._command]
        logger.info(
            "Starting sandbox: %s on port %d with OS isolation",
            " ".join(self._command),
            self._port,
        )
        try:
            self._process = subprocess.Popen(
                launch_cmd,
                stdout=self._stdout_log,
                stderr=self._stderr_log,
                cwd=self._cwd,
                env=self._env,
                preexec_fn=os.setsid if platform.system() != "Windows" else None,
            )
        except FileNotFoundError as exc:
            logger.error("Failed to start sandbox — binary not found: %s", exc)
            return False
        except OSError as exc:
            logger.error("Failed to start sandbox — OS error: %s", exc)
            return False

        if not wait_for_port(self._port, timeout=self._startup_timeout):
            # Check if process died during startup
            ret = self._process.poll()
            if ret is not None:
                logger.error(
                    "Sandbox process exited during startup with code %d", ret
                )
            else:
                logger.error(
                    "Sandbox port %d did not become reachable within %.1fs",
                    self._port,
                    self._startup_timeout,
                )
            self.kill()
            return False

        logger.info("Sandbox is live on port %d (PID %d)", self._port, self._process.pid)
        return True

    def kill(self) -> None:
        """Forcefully terminate the sandbox process and its entire process group."""
        if self._process is None:
            return

        pid = self._process.pid
        logger.info("Killing sandbox PID %d", pid)

        try:
            if platform.system() != "Windows":
                # Kill the entire process group to catch child workers
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                try:
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                    self._process.wait(timeout=2)
            else:
                self._process.terminate()
                try:
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=2)
        except (ProcessLookupError, PermissionError, OSError) as exc:
            logger.warning("Sandbox cleanup warning: %s", exc)

        self._flush_logs()
        logger.info("Sandbox PID %d terminated", pid)

    def read_logs(self) -> tuple[str, str]:
        """Read captured stdout and stderr from the sandbox process."""
        self._flush_logs()
        stdout = ""
        stderr = ""
        try:
            with open(self._stdout_log.name, "r") as f:
                stdout = f.read(50_000)
        except OSError:
            pass
        try:
            with open(self._stderr_log.name, "r") as f:
                stderr = f.read(50_000)
        except OSError:
            pass
        return stdout, stderr

    def cleanup_temp_files(self) -> None:
        """Remove temporary log files."""
        for tf in (self._stdout_log, self._stderr_log):
            try:
                Path(tf.name).unlink(missing_ok=True)
            except OSError:
                pass

    def _flush_logs(self) -> None:
        for f in (self._stdout_log, self._stderr_log):
            try:
                f.flush()
            except (OSError, ValueError):
                pass


# ── Benchmark Tool Integration ───────────────────────────────────────────────


def _resolve_benchmark_tool() -> BenchmarkTool:
    """Detect which benchmark CLI is available on the system."""
    if shutil.which("autocannon"):
        return BenchmarkTool.AUTOCANNON
    if shutil.which("k6"):
        return BenchmarkTool.K6
    return BenchmarkTool.BUILTIN


def _run_autocannon(
    url: str,
    duration: int = 3,
    connections: int = 50,
    timeout_seconds: int = 30,
) -> tuple[Optional[dict], str, str]:
    """Run autocannon and parse its JSON output."""
    argv = [
        "autocannon",
        "-d", str(duration),
        "-c", str(connections),
        "-j",  # JSON output
        url,
    ]

    logger.info("Executing: %s", " ".join(argv))
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env={**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"},
        )
    except subprocess.TimeoutExpired:
        return None, "", "autocannon timed out"
    except FileNotFoundError:
        return None, "", "autocannon binary not found"

    try:
        data = json.loads(proc.stdout)
        return data, proc.stdout[:10_000], proc.stderr[:5_000]
    except json.JSONDecodeError:
        return None, proc.stdout[:10_000], proc.stderr[:5_000]


def _parse_autocannon(data: dict) -> TelemetryPayload:
    """Extract telemetry from autocannon JSON output."""
    latency = data.get("latency", {})
    requests = data.get("requests", {})
    errors = data.get("errors", 0)
    non2xx = data.get("non2xx", 0)

    return TelemetryPayload(
        avg_latency_ms=latency.get("average", 0.0),
        p50_latency_ms=latency.get("p50", 0.0),
        p99_latency_ms=latency.get("p99", 0.0),
        max_latency_ms=latency.get("max", 0.0),
        requests_per_second=requests.get("average", 0.0),
        total_requests=requests.get("total", 0),
        error_count=errors + non2xx,
    )


def _run_k6(
    url: str,
    duration: int = 3,
    vus: int = 50,
    timeout_seconds: int = 30,
) -> tuple[Optional[dict], str, str]:
    """Run k6 with an inline script and parse JSON summary output."""
    k6_script = (
        f'import http from "k6/http";\n'
        f'import {{ check }} from "k6";\n'
        f"export const options = {{\n"
        f"  vus: {vus},\n"
        f'  duration: "{duration}s",\n'
        f"}};\n"
        f"export default function () {{\n"
        f'  const res = http.get("{url}");\n'
        f'  check(res, {{ "status 200": (r) => r.status === 200 }});\n'
        f"}}\n"
    )

    script_file = tempfile.NamedTemporaryFile(
        mode="w", suffix=".js", delete=False
    )
    script_file.write(k6_script)
    script_file.close()

    summary_file = tempfile.NamedTemporaryFile(
        mode="w", suffix="_k6_summary.json", delete=False
    )
    summary_file.close()

    argv = [
        "k6", "run",
        "--summary-export", summary_file.name,
        "--no-color",
        "--quiet",
        script_file.name,
    ]

    logger.info("Executing: %s", " ".join(argv))
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except subprocess.TimeoutExpired:
        return None, "", "k6 timed out"
    except FileNotFoundError:
        return None, "", "k6 binary not found"
    finally:
        Path(script_file.name).unlink(missing_ok=True)

    data = None
    try:
        with open(summary_file.name, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        pass
    finally:
        Path(summary_file.name).unlink(missing_ok=True)

    return data, proc.stdout[:10_000], proc.stderr[:5_000]


def _parse_k6(data: dict) -> TelemetryPayload:
    """Extract telemetry from k6 JSON summary export."""
    metrics = data.get("metrics", {})

    http_dur = metrics.get("http_req_duration", {}).get("values", {})
    http_reqs = metrics.get("http_reqs", {}).get("values", {})
    http_fails = metrics.get("http_req_failed", {}).get("values", {})

    total_reqs = int(http_reqs.get("count", 0))
    fail_rate = http_fails.get("rate", 0.0)
    error_count = int(total_reqs * fail_rate) if total_reqs else 0

    return TelemetryPayload(
        avg_latency_ms=http_dur.get("avg", 0.0),
        p50_latency_ms=http_dur.get("med", 0.0),
        p99_latency_ms=http_dur.get("p(99)", 0.0),
        max_latency_ms=http_dur.get("max", 0.0),
        requests_per_second=http_reqs.get("rate", 0.0),
        total_requests=total_reqs,
        error_count=error_count,
    )


def _run_builtin_benchmark(
    url: str,
    duration: int = 3,
    concurrency: int = 50,
) -> TelemetryPayload:
    """Minimal built-in HTTP benchmark using stdlib — no external tools needed.

    Fires concurrent GET requests using threads for the specified duration,
    tracking latency per request.
    """
    import http.client
    from concurrent.futures import ThreadPoolExecutor
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 80
    path = parsed.path or "/"

    latencies: list[float] = []
    errors = 0
    lock = threading.Lock()
    stop_event = threading.Event()

    def worker() -> None:
        nonlocal errors
        while not stop_event.is_set():
            start = time.monotonic()
            try:
                conn = http.client.HTTPConnection(host, port, timeout=5)
                conn.request("GET", path)
                resp = conn.getresponse()
                resp.read()
                elapsed = (time.monotonic() - start) * 1000
                conn.close()
                with lock:
                    if resp.status >= 400:
                        errors += 1
                    latencies.append(elapsed)
            except Exception:
                with lock:
                    errors += 1

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(worker) for _ in range(concurrency)]
        time.sleep(duration)
        stop_event.set()
        for fut in futures:
            try:
                fut.result(timeout=5)
            except Exception:
                pass

    if not latencies:
        return TelemetryPayload(error_count=errors)

    sorted_lat = sorted(latencies)
    total = len(sorted_lat)
    p50_idx = int(total * 0.50)
    p99_idx = min(int(total * 0.99), total - 1)

    return TelemetryPayload(
        avg_latency_ms=sum(sorted_lat) / total,
        p50_latency_ms=sorted_lat[p50_idx],
        p99_latency_ms=sorted_lat[p99_idx],
        max_latency_ms=sorted_lat[-1],
        requests_per_second=total / duration,
        total_requests=total,
        error_count=errors,
    )


# ── Public API ───────────────────────────────────────────────────────────────


def run_load_sandbox(
    target_command: list[str],
    endpoint_path: str = "/",
    port: Optional[int] = None,
    duration_seconds: int = 3,
    concurrency: int = 50,
    startup_timeout: float = 15.0,
    benchmark_timeout: int = 30,
    cwd: Optional[str] = None,
    env: Optional[dict] = None,
    tool_override: Optional[str] = None,
    hw_sample_interval: float = 0.25,
) -> SandboxResult:
    """Execute a full load-test cycle against a sandboxed application.

    1. Finds a free port and launches the target application.
    2. Waits for the port to become reachable.
    3. Starts hardware monitoring on the target PID.
    4. Runs a benchmark tool (autocannon → k6 → builtin fallback).
    5. Parses results into a TelemetryPayload.
    6. Safely tears down the sandbox even on failure.

    Parameters
    ----------
    target_command : list[str]
        The command to launch the target app (e.g. ["python", "-m", "uvicorn", "main:app"]).
        The environment variable PORT will be injected.
    endpoint_path : str
        The HTTP path to benchmark (default: "/").
    port : int | None
        Specific port to use. If None, an available port is auto-selected.
    duration_seconds : int
        Duration of the load burst in seconds (default: 3).
    concurrency : int
        Number of parallel connections / virtual users (default: 50).
    startup_timeout : float
        Max seconds to wait for the target to start listening (default: 15).
    benchmark_timeout : int
        Max seconds for the benchmark subprocess (default: 30).
    cwd : str | None
        Working directory for the target application.
    env : dict | None
        Additional environment variables for the target.
    tool_override : str | None
        Force a specific benchmark tool ("autocannon", "k6", or "builtin").
    hw_sample_interval : float
        Interval in seconds between hardware metric samples (default: 0.25).

    Returns
    -------
    SandboxResult
        Full result with telemetry, hardware samples, and status.
    """
    selected_port = port or find_free_port()
    url = f"http://127.0.0.1:{selected_port}{endpoint_path}"

    sandbox = SandboxProcess(
        command=target_command,
        port=selected_port,
        cwd=cwd,
        env=env,
        startup_timeout=startup_timeout,
    )

    overall_start = time.monotonic()

    # ── Phase 1: Launch sandbox ──
    if not sandbox.start():
        stdout, stderr = sandbox.read_logs()
        sandbox.cleanup_temp_files()
        return SandboxResult(
            status=SandboxStatus.STARTUP_FAILURE,
            tool="none",
            target_command=" ".join(target_command),
            target_port=selected_port,
            duration_seconds=duration_seconds,
            concurrency=concurrency,
            raw_benchmark_stdout=stdout[:4_000],
            raw_benchmark_stderr=stderr[:4_000],
            elapsed_ms=(time.monotonic() - overall_start) * 1000,
            error_detail="Target application failed to start or port did not become reachable",
        )

    monitor = HardwareMonitor(sandbox.pid, interval=hw_sample_interval)
    monitor.start()

    try:
        # ── Phase 2: Determine benchmark tool ──
        if tool_override:
            tool = BenchmarkTool(tool_override)
        else:
            tool = _resolve_benchmark_tool()

        logger.info("Benchmark tool: %s → %s", tool.value, url)

        # ── Phase 3: Execute benchmark ──
        telemetry: Optional[TelemetryPayload] = None
        bench_stdout = ""
        bench_stderr = ""

        if tool == BenchmarkTool.AUTOCANNON:
            data, bench_stdout, bench_stderr = _run_autocannon(
                url, duration_seconds, concurrency, benchmark_timeout
            )
            if data:
                telemetry = _parse_autocannon(data)
            else:
                logger.warning("autocannon produced no parseable output, falling back to builtin")
                tool = BenchmarkTool.BUILTIN

        if tool == BenchmarkTool.K6:
            data, bench_stdout, bench_stderr = _run_k6(
                url, duration_seconds, concurrency, benchmark_timeout
            )
            if data:
                telemetry = _parse_k6(data)
            else:
                logger.warning("k6 produced no parseable output, falling back to builtin")
                tool = BenchmarkTool.BUILTIN

        if tool == BenchmarkTool.BUILTIN:
            telemetry = _run_builtin_benchmark(url, duration_seconds, concurrency)

        if telemetry is None:
            telemetry = TelemetryPayload()

    except Exception as exc:
        samples = monitor.stop()
        sandbox.kill()
        sandbox.cleanup_temp_files()
        return SandboxResult(
            status=SandboxStatus.BENCHMARK_FAILURE,
            tool=tool.value if 'tool' in dir() else "unknown",
            target_command=" ".join(target_command),
            target_port=selected_port,
            duration_seconds=duration_seconds,
            concurrency=concurrency,
            elapsed_ms=(time.monotonic() - overall_start) * 1000,
            error_detail=f"Benchmark exception: {exc}",
        )

    # ── Phase 4: Collect hardware metrics ──
    samples = monitor.stop()

    if samples:
        telemetry.peak_cpu_percent = max(s.cpu_percent for s in samples)
        telemetry.peak_memory_mb = max(s.rss_mb for s in samples)
        telemetry.avg_cpu_percent = sum(s.cpu_percent for s in samples) / len(samples)
        telemetry.avg_memory_mb = sum(s.rss_mb for s in samples) / len(samples)

    # ── Phase 5: Teardown ──
    sandbox.kill()
    sandbox.cleanup_temp_files()

    elapsed = (time.monotonic() - overall_start) * 1000

    # Determine pass/fail — the orchestrator applies its own thresholds,
    # but we mark gross failures here (e.g. >50% error rate)
    error_rate = (
        telemetry.error_count / telemetry.total_requests
        if telemetry.total_requests > 0
        else 0.0
    )
    status = SandboxStatus.PASS if error_rate < 0.5 else SandboxStatus.FAIL

    result = SandboxResult(
        status=status,
        tool=tool.value,
        target_command=" ".join(target_command),
        target_port=selected_port,
        duration_seconds=duration_seconds,
        concurrency=concurrency,
        telemetry=telemetry,
        hardware_samples=samples,
        raw_benchmark_stdout=bench_stdout[:4_000],
        raw_benchmark_stderr=bench_stderr[:4_000],
        elapsed_ms=elapsed,
    )

    logger.info(
        "Load sandbox %s — %.0f req/s, %.1fms avg latency, "
        "%.1f%% peak CPU, %.1f MB peak RSS in %.0fms",
        result.status.value.upper(),
        telemetry.requests_per_second,
        telemetry.avg_latency_ms,
        telemetry.peak_cpu_percent,
        telemetry.peak_memory_mb,
        elapsed,
    )

    return result


def format_performance_context_card(
    result: SandboxResult, max_tokens: int = 2000
) -> str:
    """Compress a SandboxResult into a token-budgeted context card for the model.

    The card focuses on quantitative metrics and any threshold breaches.
    """
    t = result.telemetry
    card = {
        "gate": "performance",
        "passed": result.status == SandboxStatus.PASS,
        "metrics": {
            "avg_latency_ms": round(t.avg_latency_ms, 2),
            "p99_latency_ms": round(t.p99_latency_ms, 2),
            "rps": round(t.requests_per_second, 1),
            "total_reqs": t.total_requests,
            "errors": t.error_count,
            "peak_cpu_pct": round(t.peak_cpu_percent, 1),
            "peak_mem_mb": round(t.peak_memory_mb, 1),
        },
    }

    if result.error_detail:
        card["error"] = result.error_detail[:500]

    serialized = json.dumps(card, separators=(",", ":"))

    char_budget = max_tokens * 4
    if len(serialized) > char_budget:
        card.pop("error", None)
        serialized = json.dumps(card, separators=(",", ":"))

    return serialized


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> int:
    """Command-line entry point for isolated verification."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Load Sandbox — Performance telemetry gate for ACSA Code",
    )
    parser.add_argument(
        "command",
        nargs="+",
        help="Target application command (e.g. python -m uvicorn main:app)",
    )
    parser.add_argument(
        "--endpoint", default="/", help="HTTP path to benchmark (default: /)"
    )
    parser.add_argument(
        "--port", type=int, default=None, help="Specific port (default: auto)"
    )
    parser.add_argument(
        "--duration", type=int, default=3, help="Burst duration in seconds (default: 3)"
    )
    parser.add_argument(
        "--concurrency", type=int, default=50, help="Parallel connections (default: 50)"
    )
    parser.add_argument(
        "--tool",
        choices=["autocannon", "k6", "builtin"],
        default=None,
        help="Force benchmark tool (default: auto-detect)",
    )
    parser.add_argument(
        "--json", action="store_true", dest="json_output", help="Emit JSON report"
    )

    args = parser.parse_args()

    result = run_load_sandbox(
        target_command=args.command,
        endpoint_path=args.endpoint,
        port=args.port,
        duration_seconds=args.duration,
        concurrency=args.concurrency,
        tool_override=args.tool,
    )

    if args.json_output:
        sys.stdout.write(result.to_json() + "\n")

    return 0 if result.status == SandboxStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
