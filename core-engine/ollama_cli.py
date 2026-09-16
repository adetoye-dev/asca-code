#!/usr/bin/env python3
"""ollama_cli.py — local Ollama state, for the workbench UI.

Why this exists: the app used to learn about Ollama only from
`vite-fs-bridge.ts`, which is a Vite dev-server middleware. `configureServer`
never runs in a build, so a packaged app could not see a running Ollama at all —
the dashboard reported "Not installed" and an empty model list while the agent,
which talks to 127.0.0.1:11434 from Python, used it happily. The probe lives here
so the packaged IPC path and the dev bridge can share one implementation.

Usage: python3 ollama_cli.py status
       python3 ollama_cli.py start
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")

# Where the macOS app and the common package managers put the binary.
BINARY_CANDIDATES = (
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/usr/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
)


def _binary() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    for candidate in BINARY_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    return None


def _get(path: str, timeout: float = 2.0) -> dict | None:
    """GET a JSON document, or None when the server is not answering."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}{path}", timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None


def _post(path: str, payload: dict, timeout: float = 2.0) -> dict | None:
    try:
        request = urllib.request.Request(
            f"{OLLAMA_HOST}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None


def _total_ram_gb() -> int:
    try:
        if sys.platform == "darwin":
            out = subprocess.run(
                ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5
            )
            return round(int(out.stdout.strip()) / (1024**3))
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / (1024**2))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return 0


def _recommended_model(total_ram_gb: int) -> str:
    if total_ram_gb >= 16:
        return "qwen2.5-coder:7b"
    if total_ram_gb >= 8:
        return "qwen2.5-coder:3b"
    return "qwen2.5-coder:1.5b"


def _format_size(size_bytes: int) -> str:
    if size_bytes <= 0:
        return ""
    if size_bytes >= 1024**3:
        return f"{size_bytes / (1024 ** 3):.1f} GB"
    return f"{round(size_bytes / (1024 ** 2))} MB"


def _model_detail(entry: dict) -> dict:
    name = entry.get("name") or ""
    size_bytes = entry.get("size") if isinstance(entry.get("size"), int) else 0
    capabilities: list[str] = []
    context_length: int | None = None
    parameter_count: int | None = None

    # `/api/show` is the only place that reports what the model can actually do
    # and the context window it was built with.
    show = _post("/api/show", {"name": name}, timeout=1.5) or {}
    if isinstance(show.get("capabilities"), list):
        capabilities = show["capabilities"]
    info = show.get("model_info")
    if isinstance(info, dict):
        for key, value in info.items():
            if key.endswith(".context_length") and isinstance(value, int):
                context_length = value
                break
        if isinstance(info.get("general.parameter_count"), int):
            parameter_count = info["general.parameter_count"]

    details = entry.get("details") or {}
    return {
        "name": name,
        "tag": name,
        "sizeBytes": size_bytes,
        "sizeFormatted": _format_size(size_bytes),
        "parameterSize": details.get("parameter_size"),
        "family": details.get("family"),
        "quantizationLevel": details.get("quantization_level"),
        "modifiedAt": entry.get("modified_at"),
        "capabilities": capabilities,
        "contextLength": context_length,
        "parameterCount": parameter_count,
    }


def status() -> dict:
    """Install/running state plus the model inventory.

    A server that is not answering is reported as `running: false`, not as an
    error — that is a real answer. `error` is reserved for "detection could not
    be performed", so the UI never presents a failed probe as a finding.
    """
    binary = _binary()
    tags = _get("/api/tags")
    running = tags is not None
    raw_models = (tags or {}).get("models") or []
    total_ram_gb = _total_ram_gb()
    return {
        "installed": bool(binary),
        "running": running,
        "models": [m.get("name") for m in raw_models if m.get("name")],
        "modelsDetails": [_model_detail(m) for m in raw_models if m.get("name")],
        "recommendedModel": _recommended_model(total_ram_gb),
        "totalRamGb": total_ram_gb,
        "binaryPath": binary,
        "error": None,
    }


def start() -> dict:
    """Start the daemon, then wait for it to answer."""
    if _get("/api/tags", timeout=1.0) is not None:
        return {"started": True, "alreadyRunning": True}

    binary = _binary()
    if not binary:
        return {"started": False, "error": "Ollama is not installed."}

    try:
        subprocess.Popen(
            [binary, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return {"started": False, "error": f"Could not start Ollama: {exc}"}

    for _ in range(20):
        time.sleep(0.5)
        if _get("/api/tags", timeout=1.0) is not None:
            return {"started": True, "alreadyRunning": False}
    return {"started": False, "error": "Ollama did not report ready in time."}


COMMANDS = {"status": status, "start": start}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: ollama_cli.py <{'|'.join(COMMANDS)}>"}))
        return 2

    handler = COMMANDS.get(argv[1])
    if handler is None:
        print(json.dumps({"ok": False, "error": f"unknown command: {argv[1]}"}))
        return 2

    try:
        print(json.dumps({"ok": True, "data": handler()}))
        return 0
    except Exception as exc:  # noqa: BLE001 - the CLI reports, it does not raise
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv))
