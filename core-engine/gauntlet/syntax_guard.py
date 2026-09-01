"""
syntax_guard.py — Deterministic Syntax Verification Gate

Executes local linters and type-checkers (ruff, mypy, eslint, tsc) as native
OS subprocesses in parallel across CPU cores.  Raw CLI output is parsed into
structured JSON diagnostics containing file name, line number, column, severity,
and error message — ready to be injected into the model's correction context card.

Design constraints
──────────────────
1. Zero external Python dependencies — stdlib only (subprocess, json, os, …).
2. Every linter runs in its own subprocess; all subprocesses run concurrently
   via concurrent.futures.ProcessPoolExecutor (one core per tool).
3. Subprocess timeouts prevent any single linter from blocking the pipeline.
4. Deterministic: identical inputs always produce identical structured output.
5. All output goes to stdout/stderr for isolated terminal verification.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("syntax_guard")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s","component":"SyntaxGuard","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


# ── Data Structures ──────────────────────────────────────────────────────────


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class LinterStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIPPED = "skipped"
    TIMEOUT = "timeout"
    CRASH = "crash"


@dataclass(frozen=True)
class Diagnostic:
    """Single linter finding tied to a specific source location."""

    file: str
    line: int
    column: int
    severity: Severity
    code: str
    message: str
    source: str  # which linter produced this


@dataclass
class LinterResult:
    """Aggregate result from one linter execution."""

    linter: str
    status: LinterStatus
    exit_code: int
    diagnostics: list[Diagnostic] = field(default_factory=list)
    raw_stdout: str = ""
    raw_stderr: str = ""
    elapsed_ms: float = 0.0
    error_detail: str = ""

    def to_dict(self) -> dict:
        d = {
            "linter": self.linter,
            "status": self.status.value,
            "exit_code": self.exit_code,
            "diagnostic_count": len(self.diagnostics),
            "diagnostics": [asdict(diag) for diag in self.diagnostics],
            "elapsed_ms": round(self.elapsed_ms, 2),
        }
        if self.error_detail:
            d["error_detail"] = self.error_detail
        return d


@dataclass
class GauntletReport:
    """Full report from the syntax gate across all linters."""

    target_paths: list[str]
    passed: bool
    linter_results: list[LinterResult] = field(default_factory=list)
    total_diagnostics: int = 0
    total_errors: int = 0
    total_warnings: int = 0
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "target_paths": self.target_paths,
            "passed": self.passed,
            "total_diagnostics": self.total_diagnostics,
            "total_errors": self.total_errors,
            "total_warnings": self.total_warnings,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "linter_results": [lr.to_dict() for lr in self.linter_results],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Parsers ──────────────────────────────────────────────────────────────────

def _safe_int(value: str, default: int = 0) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def parse_ruff_output(raw: str) -> list[Diagnostic]:
    """Parse ruff JSON output into Diagnostic objects.

    ruff check --output-format=json produces an array of objects with keys:
      filename, row (1-based), column (1-based), code, message
    """
    diagnostics: list[Diagnostic] = []
    if not raw.strip():
        return diagnostics

    try:
        entries = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: parse line-based output  file:line:col: CODE message
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split(":", 3)
            if len(parts) < 4:
                continue
            file_path = parts[0].strip()
            line_no = _safe_int(parts[1].strip(), 1)
            col_no = _safe_int(parts[2].strip(), 1)
            remainder = parts[3].strip()
            code = ""
            msg = remainder
            if " " in remainder:
                maybe_code, rest = remainder.split(" ", 1)
                if maybe_code.isalnum():
                    code = maybe_code
                    msg = rest
            diagnostics.append(
                Diagnostic(
                    file=file_path,
                    line=line_no,
                    column=col_no,
                    severity=Severity.ERROR,
                    code=code,
                    message=msg,
                    source="ruff",
                )
            )
        return diagnostics

    for entry in entries:
        raw_code = entry.get("code") or ""
        sev = Severity.WARNING
        if (entry.get("type") or "").upper() == "E" or raw_code.startswith("E"):
            sev = Severity.ERROR
        diagnostics.append(
            Diagnostic(
                file=entry.get("filename", "<unknown>"),
                line=entry.get("location", {}).get("row", entry.get("row", 0)),
                column=entry.get("location", {}).get("column", entry.get("column", 0)),
                severity=sev,
                code=raw_code,
                message=entry.get("message", ""),
                source="ruff",
            )
        )
    return diagnostics


def parse_mypy_output(raw: str) -> list[Diagnostic]:
    """Parse mypy human-readable output.

    Mypy formats:
        file.py:LINE: SEVERITY: MESSAGE  [error-code]
        file.py:LINE:COL: SEVERITY: MESSAGE  [error-code]
    """
    diagnostics: list[Diagnostic] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("Found") or line.startswith("Success"):
            continue

        # Split into up to 5 parts to accommodate file:line:col:severity:message
        parts = line.split(":", 4)
        if len(parts) < 3:
            continue

        file_path = parts[0].strip()
        line_no = _safe_int(parts[1].strip(), 0)
        col_no = 0

        # Determine whether parts[2] is a column number or the severity field.
        # Mypy emits either  file:line: severity: msg  or  file:line:col: severity: msg
        sev_field_idx = 2
        if len(parts) >= 4 and parts[2].strip().isdigit():
            col_no = _safe_int(parts[2].strip(), 0)
            sev_field_idx = 3

        # Everything from the severity field onward is rejoined so we don't
        # accidentally split on colons inside the message text.
        remaining_parts = parts[sev_field_idx:]
        rest = ":".join(remaining_parts).strip()

        severity = Severity.ERROR
        message = rest
        code = ""

        for sev_keyword, sev_enum in [
            ("error", Severity.ERROR),
            ("warning", Severity.WARNING),
            ("note", Severity.INFO),
        ]:
            if rest.lower().startswith(sev_keyword):
                severity = sev_enum
                # Strip the keyword and any leading colon/whitespace from the message
                after_keyword = rest[len(sev_keyword):].lstrip(": ")
                message = after_keyword
                break

        # Extract [error-code] suffix
        if message.endswith("]") and "[" in message:
            bracket_start = message.rfind("[")
            code = message[bracket_start + 1 : -1]
            message = message[:bracket_start].strip()

        if line_no == 0 and not file_path:
            continue

        diagnostics.append(
            Diagnostic(
                file=file_path,
                line=line_no,
                column=col_no,
                severity=severity,
                code=code,
                message=message,
                source="mypy",
            )
        )
    return diagnostics


def parse_eslint_output(raw: str) -> list[Diagnostic]:
    """Parse ESLint JSON output (--format=json) into Diagnostic objects."""
    diagnostics: list[Diagnostic] = []
    if not raw.strip():
        return diagnostics

    try:
        results = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: line-based parsing
        current_file = ""
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("/") or (len(line) > 2 and line[1] == ":"):
                current_file = line
                continue
            # line:col  error  message  rule-id
            parts = line.split()
            if len(parts) < 3:
                continue
            loc = parts[0]
            loc_parts = loc.replace(":", " ").split()
            if len(loc_parts) < 2:
                continue
            line_no = _safe_int(loc_parts[0], 0)
            col_no = _safe_int(loc_parts[1], 0)
            sev = Severity.WARNING if parts[1] == "warning" else Severity.ERROR
            code = parts[-1] if len(parts) >= 4 else ""
            msg = " ".join(parts[2:-1]) if len(parts) >= 4 else " ".join(parts[2:])
            diagnostics.append(
                Diagnostic(
                    file=current_file,
                    line=line_no,
                    column=col_no,
                    severity=sev,
                    code=code,
                    message=msg,
                    source="eslint",
                )
            )
        return diagnostics

    for file_result in results:
        file_path = file_result.get("filePath", "<unknown>")
        for msg in file_result.get("messages", []):
            sev = Severity.ERROR if msg.get("severity", 2) == 2 else Severity.WARNING
            diagnostics.append(
                Diagnostic(
                    file=file_path,
                    line=msg.get("line", 0),
                    column=msg.get("column", 0),
                    severity=sev,
                    code=msg.get("ruleId", "") or "",
                    message=msg.get("message", ""),
                    source="eslint",
                )
            )
    return diagnostics


def parse_tsc_output(raw: str) -> list[Diagnostic]:
    """Parse TypeScript compiler (tsc) output.

    Format: file.ts(line,col): error TS1234: message
    """
    diagnostics: list[Diagnostic] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue

        # file.ts(line,col): error TS1234: message
        paren_idx = line.find("(")
        if paren_idx == -1:
            continue
        close_paren_idx = line.find(")", paren_idx)
        if close_paren_idx == -1:
            continue

        file_path = line[:paren_idx]
        loc_str = line[paren_idx + 1 : close_paren_idx]
        loc_parts = loc_str.split(",")
        line_no = _safe_int(loc_parts[0], 0)
        col_no = _safe_int(loc_parts[1], 0) if len(loc_parts) > 1 else 0

        rest = line[close_paren_idx + 1 :].lstrip(": ")
        severity = Severity.ERROR
        code = ""
        message = rest

        if rest.lower().startswith("error"):
            severity = Severity.ERROR
            rest = rest[5:].strip()
        elif rest.lower().startswith("warning"):
            severity = Severity.WARNING
            rest = rest[7:].strip()

        # Extract TS code
        if rest.startswith("TS") or rest.startswith("ts"):
            parts = rest.split(":", 1)
            if len(parts) == 2:
                code = parts[0].strip()
                message = parts[1].strip()
            else:
                message = rest
        else:
            message = rest

        diagnostics.append(
            Diagnostic(
                file=file_path,
                line=line_no,
                column=col_no,
                severity=severity,
                code=code,
                message=message,
                source="tsc",
            )
        )
    return diagnostics


# ── Linter Registry ─────────────────────────────────────────────────────────

PARSER_MAP = {
    "ruff": parse_ruff_output,
    "mypy": parse_mypy_output,
    "eslint": parse_eslint_output,
    "tsc": parse_tsc_output,
}

# Maps linter name → (binary_name, argument builder function)
# Argument builder receives a list of target paths and returns the full argv.

def _ruff_argv(targets: list[str]) -> list[str]:
    return ["ruff", "check", "--output-format=json", "--no-fix", *targets]

def _mypy_argv(targets: list[str]) -> list[str]:
    return ["mypy", "--no-error-summary", "--no-color-output", "--show-column-numbers", *targets]

def _eslint_argv(targets: list[str]) -> list[str]:
    return ["eslint", "--format=json", "--no-color", *targets]

def _tsc_argv(targets: list[str]) -> list[str]:
    return ["tsc", "--noEmit", "--pretty", "false", *targets]


LINTER_REGISTRY: dict[str, dict] = {
    "ruff": {
        "binary": "ruff",
        "argv_builder": _ruff_argv,
        "extensions": {".py"},
        "parser": parse_ruff_output,
        "parse_stream": "stdout",
    },
    "mypy": {
        "binary": "mypy",
        "argv_builder": _mypy_argv,
        "extensions": {".py"},
        "parser": parse_mypy_output,
        "parse_stream": "stdout",
    },
    "eslint": {
        "binary": "eslint",
        "argv_builder": _eslint_argv,
        "extensions": {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"},
        "parser": parse_eslint_output,
        "parse_stream": "stdout",
    },
    "tsc": {
        "binary": "tsc",
        "argv_builder": _tsc_argv,
        "extensions": {".ts", ".tsx"},
        "parser": parse_tsc_output,
        "parse_stream": "stdout",
    },
}


# ── Subprocess Execution ────────────────────────────────────────────────────


def _resolve_binary(name: str) -> Optional[str]:
    """Check if a binary is available on PATH."""
    return shutil.which(name)


def _run_linter(
    linter_name: str,
    target_paths: list[str],
    timeout_seconds: int = 120,
    cwd: Optional[str] = None,
) -> LinterResult:
    """Execute a single linter in a subprocess. Designed to run in a worker process."""
    config = LINTER_REGISTRY.get(linter_name)
    if not config:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.SKIPPED,
            exit_code=-1,
            error_detail=f"Unknown linter: {linter_name}",
        )

    binary_path = _resolve_binary(config["binary"])
    if not binary_path:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.SKIPPED,
            exit_code=-1,
            error_detail=f"Binary '{config['binary']}' not found on PATH",
        )

    # Filter targets to file extensions this linter supports
    relevant = [
        p for p in target_paths if Path(p).suffix in config["extensions"]
    ]
    if not relevant:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.SKIPPED,
            exit_code=0,
            error_detail="No relevant files for this linter",
        )

    argv = config["argv_builder"](relevant)

    start = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=cwd,
            env={**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"},
        )
    except subprocess.TimeoutExpired:
        elapsed = (time.monotonic() - start) * 1000
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.TIMEOUT,
            exit_code=-1,
            elapsed_ms=elapsed,
            error_detail=f"Process exceeded {timeout_seconds}s timeout",
        )
    except FileNotFoundError:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.SKIPPED,
            exit_code=-1,
            error_detail=f"Binary '{config['binary']}' disappeared from PATH during execution",
        )
    except OSError as exc:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.CRASH,
            exit_code=-1,
            error_detail=f"OS error: {exc}",
        )

    elapsed = (time.monotonic() - start) * 1000

    parse_target = proc.stdout if config["parse_stream"] == "stdout" else proc.stderr

    try:
        diagnostics = config["parser"](parse_target)
    except Exception as exc:
        return LinterResult(
            linter=linter_name,
            status=LinterStatus.CRASH,
            exit_code=proc.returncode,
            raw_stdout=proc.stdout[:4000],
            raw_stderr=proc.stderr[:4000],
            elapsed_ms=elapsed,
            error_detail=f"Parser failed: {exc}",
        )

    status = LinterStatus.PASS if proc.returncode == 0 else LinterStatus.FAIL
    # Some linters exit non-zero even for warnings only; refine based on diagnostics
    if status == LinterStatus.FAIL and diagnostics:
        has_errors = any(d.severity == Severity.ERROR for d in diagnostics)
        if not has_errors:
            status = LinterStatus.PASS

    return LinterResult(
        linter=linter_name,
        status=status,
        exit_code=proc.returncode,
        diagnostics=diagnostics,
        raw_stdout=proc.stdout[:4000],
        raw_stderr=proc.stderr[:4000],
        elapsed_ms=elapsed,
    )


# ── Public API ───────────────────────────────────────────────────────────────


def detect_available_linters() -> list[str]:
    """Return names of linters available on the current system PATH."""
    available = []
    for name, config in LINTER_REGISTRY.items():
        if _resolve_binary(config["binary"]):
            available.append(name)
    return available


def run_syntax_gate(
    target_paths: list[str],
    linters: Optional[list[str]] = None,
    timeout_seconds: int = 120,
    max_workers: Optional[int] = None,
    cwd: Optional[str] = None,
) -> GauntletReport:
    """Execute all relevant linters in parallel and return a unified report.

    Parameters
    ----------
    target_paths : list[str]
        Files or directories to lint.
    linters : list[str] | None
        Specific linters to run. If None, auto-detects available linters.
    timeout_seconds : int
        Per-linter subprocess timeout.
    max_workers : int | None
        Max parallel processes. Defaults to min(len(linters), os.cpu_count()).
    cwd : str | None
        Working directory for subprocess execution.

    Returns
    -------
    GauntletReport
        Unified report with structured diagnostics from all linters.
    """
    if not target_paths:
        logger.warning("No target paths provided")
        return GauntletReport(target_paths=[], passed=True)

    # Normalize paths
    normalized = []
    for p in target_paths:
        resolved = Path(p).resolve()
        if not resolved.exists():
            logger.warning("Target path does not exist: %s", p)
            continue
        normalized.append(str(resolved))

    if not normalized:
        logger.warning("No valid target paths after normalization")
        return GauntletReport(target_paths=target_paths, passed=True)

    # Determine which linters to run
    if linters is None:
        linters = detect_available_linters()
        logger.info("Auto-detected linters: %s", ", ".join(linters) or "(none)")

    if not linters:
        logger.warning("No linters available — syntax gate vacuously passes")
        return GauntletReport(target_paths=normalized, passed=True)

    worker_count = max_workers or min(len(linters), os.cpu_count() or 1)

    gate_start = time.monotonic()
    results: list[LinterResult] = []

    # Run linters in parallel across CPU cores
    with ProcessPoolExecutor(max_workers=worker_count) as executor:
        future_to_linter = {
            executor.submit(
                _run_linter, name, normalized, timeout_seconds, cwd
            ): name
            for name in linters
        }

        for future in as_completed(future_to_linter):
            linter_name = future_to_linter[future]
            try:
                result = future.result()
            except Exception as exc:
                result = LinterResult(
                    linter=linter_name,
                    status=LinterStatus.CRASH,
                    exit_code=-1,
                    error_detail=f"Executor exception: {exc}",
                )
            results.append(result)

    gate_elapsed = (time.monotonic() - gate_start) * 1000

    # Sort results by linter name for deterministic output
    results.sort(key=lambda r: r.linter)

    # Aggregate
    total_diag = 0
    total_err = 0
    total_warn = 0
    gate_passed = True

    for r in results:
        total_diag += len(r.diagnostics)
        for d in r.diagnostics:
            if d.severity == Severity.ERROR:
                total_err += 1
            elif d.severity == Severity.WARNING:
                total_warn += 1
        if r.status in (LinterStatus.FAIL, LinterStatus.CRASH):
            gate_passed = False

    report = GauntletReport(
        target_paths=normalized,
        passed=gate_passed,
        linter_results=results,
        total_diagnostics=total_diag,
        total_errors=total_err,
        total_warnings=total_warn,
        elapsed_ms=gate_elapsed,
    )

    # Emit structured report to stdout for terminal verification
    level = "info" if gate_passed else "error"
    logger.log(
        logging.INFO if gate_passed else logging.ERROR,
        "Syntax gate %s — %d errors, %d warnings across %d linters in %.0fms",
        "PASSED" if gate_passed else "FAILED",
        total_err,
        total_warn,
        len(results),
        gate_elapsed,
    )

    return report


def format_context_card(report: GauntletReport, max_tokens: int = 2000) -> str:
    """Compress a GauntletReport into a token-budgeted context card for the model.

    The card is a compact JSON string containing only actionable diagnostics,
    truncated to stay within the token budget (approximated at 4 chars/token).
    """
    char_budget = max_tokens * 4
    card: dict = {
        "gate": "syntax",
        "passed": report.passed,
        "errors": [],
    }

    # Pack errors first (highest priority), then warnings
    all_diags = []
    for lr in report.linter_results:
        for d in lr.diagnostics:
            all_diags.append(d)

    all_diags.sort(key=lambda d: (0 if d.severity == Severity.ERROR else 1, d.file, d.line))

    for diag in all_diags:
        entry = {
            "f": diag.file,
            "l": diag.line,
            "c": diag.column,
            "s": diag.severity.value[0],  # "e" / "w" / "i"
            "code": diag.code,
            "msg": diag.message,
            "src": diag.source,
        }
        card["errors"].append(entry)

        # Check budget
        current = json.dumps(card, separators=(",", ":"))
        if len(current) > char_budget:
            card["errors"].pop()
            card["truncated"] = True
            break

    return json.dumps(card, separators=(",", ":"))


# ── CLI Entry Point ──────────────────────────────────────────────────────────

def main() -> int:
    """Command-line entry point for isolated verification."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Syntax Guard — Deterministic linter gate for the Autonomous IDE",
    )
    parser.add_argument(
        "targets",
        nargs="+",
        help="Files or directories to lint",
    )
    parser.add_argument(
        "--linters",
        nargs="*",
        default=None,
        help="Specific linters to run (default: auto-detect)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Per-linter timeout in seconds (default: 120)",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=None,
        help="Max parallel worker processes (default: auto)",
    )
    parser.add_argument(
        "--context-card",
        action="store_true",
        help="Also emit a model-ready context card to stdout",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Emit full report as JSON to stdout",
    )
    parser.add_argument(
        "--cwd",
        default=None,
        help="Working directory for subprocess execution",
    )

    args = parser.parse_args()

    report = run_syntax_gate(
        target_paths=args.targets,
        linters=args.linters,
        timeout_seconds=args.timeout,
        max_workers=args.max_workers,
        cwd=args.cwd,
    )

    if args.json_output:
        sys.stdout.write(report.to_json() + "\n")

    if args.context_card:
        card = format_context_card(report)
        sys.stdout.write(card + "\n")

    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
