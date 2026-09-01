"""
manager.py — The System Orchestrator

Central orchestration brain of the Autonomous IDE backend. Implements the
single-agent self-healing loop: accepts a user prompt, requests a code patch
from the local sidecar LLM, runs the generated draft through the deterministic
verification gauntlet (syntax gate → performance gate), and recursively
corrects failures until every gate returns 100% green.

Design constraints
──────────────────
1. Zero external Python dependencies — stdlib only.
2. Single-agent model: one LLM, parallel native tooling — no multi-agent chat.
3. Ephemeral correction prompts are capped at < 2,000 tokens.
4. Files are written to disk only after all gates pass.
5. All output goes to stdout/stderr for isolated terminal verification.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

# ── Sibling module imports ───────────────────────────────────────────────────
# Structured so manager.py can be run from the project root or imported as a
# module.

_ENGINE_DIR = Path(__file__).resolve().parent
_GAUNTLET_DIR = _ENGINE_DIR / "gauntlet"
_COMPILER_DIR = _ENGINE_DIR / "compiler"
_DATAMAP_DIR = _ENGINE_DIR / "data-map"

for _p in (_GAUNTLET_DIR, _COMPILER_DIR, _DATAMAP_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from syntax_guard import (  # noqa: E402
    GauntletReport,
    format_context_card as format_syntax_context_card,
    run_syntax_gate,
)
from load_sandbox import (  # noqa: E402
    SandboxResult,
    SandboxStatus,
    format_performance_context_card,
    run_load_sandbox,
)
from oracle_generator import (  # noqa: E402
    OracleReport,
    format_oracle_context_card,
    run_oracle_for_file,
)
from prompt_injector import (  # noqa: E402
    format_unified_prompt,
    inject_constraints,
)
from diff_applier import (  # noqa: E402
    apply_diff_text,
    parse_diff_text,
    validate_patch,
)

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("manager")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s",'
        '"component":"Orchestrator","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


# ── Constants ────────────────────────────────────────────────────────────────

MAX_CORRECTION_ROUNDS = 5
CONTEXT_CARD_MAX_TOKENS = 2000
LLM_DEFAULT_HOST = "127.0.0.1"
LLM_DEFAULT_PORT = 8080
LLM_REQUEST_TIMEOUT = 120


# ── Data Structures ──────────────────────────────────────────────────────────


class SliderPreset(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class LoopOutcome(str, Enum):
    SUCCESS = "success"
    MAX_RETRIES_EXCEEDED = "max_retries_exceeded"
    LLM_UNREACHABLE = "llm_unreachable"
    PARADOX_DETECTED = "paradox_detected"


@dataclass
class SliderConfig:
    """User-facing trade-off slider values mapped to deterministic thresholds."""

    budget_vs_scale: SliderPreset = SliderPreset.MEDIUM
    speed_vs_precision: SliderPreset = SliderPreset.MEDIUM
    simplicity_vs_futureproof: SliderPreset = SliderPreset.MEDIUM

    def to_dict(self) -> dict:
        return {
            "budget_vs_scale": self.budget_vs_scale.value,
            "speed_vs_precision": self.speed_vs_precision.value,
            "simplicity_vs_futureproof": self.simplicity_vs_futureproof.value,
        }


@dataclass
class PerformanceThresholds:
    """Deterministic performance bounds derived from the user's slider config."""

    min_requests_per_second: float = 100.0
    max_avg_latency_ms: float = 500.0
    max_p99_latency_ms: float = 2000.0
    max_error_rate: float = 0.01
    max_peak_cpu_percent: float = 90.0
    max_peak_memory_mb: float = 512.0


@dataclass
class ProjectConfig:
    """Represents the current project state configuration."""

    project_root: str
    target_files: list[str] = field(default_factory=list)
    sliders: SliderConfig = field(default_factory=SliderConfig)
    language: str = "python"
    entry_command: list[str] = field(default_factory=list)
    entry_endpoint: str = "/"
    llm_host: str = LLM_DEFAULT_HOST
    llm_port: int = LLM_DEFAULT_PORT

    def to_dict(self) -> dict:
        return {
            "project_root": self.project_root,
            "target_files": self.target_files,
            "sliders": self.sliders.to_dict(),
            "language": self.language,
            "entry_command": self.entry_command,
            "entry_endpoint": self.entry_endpoint,
        }


@dataclass
class DiffPatch:
    """A unified micro-diff emitted by the LLM."""

    file_path: str
    original_content: str
    patched_content: str
    diff_text: str


@dataclass
class CorrectionRound:
    """Telemetry for a single correction cycle."""

    round_number: int
    syntax_passed: bool
    performance_passed: bool
    syntax_errors: int = 0
    performance_breaches: list[str] = field(default_factory=list)
    context_card_tokens: int = 0
    llm_latency_ms: float = 0.0


@dataclass
class OrchestrationResult:
    """Final result of the orchestration pipeline."""

    outcome: LoopOutcome
    total_rounds: int
    rounds: list[CorrectionRound] = field(default_factory=list)
    final_patches: list[DiffPatch] = field(default_factory=list)
    elapsed_ms: float = 0.0
    error_detail: str = ""

    def to_dict(self) -> dict:
        return {
            "outcome": self.outcome.value,
            "total_rounds": self.total_rounds,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "error_detail": self.error_detail,
            "rounds": [asdict(r) for r in self.rounds],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Threshold Derivation ────────────────────────────────────────────────────


def derive_thresholds(sliders: SliderConfig) -> PerformanceThresholds:
    """Map slider positions to concrete performance bounds.

    Higher budget_vs_scale → stricter throughput requirements.
    Higher speed_vs_precision → stricter latency requirements.
    """
    base = PerformanceThresholds()

    scale_map = {
        SliderPreset.LOW: (50.0, 0.05),
        SliderPreset.MEDIUM: (200.0, 0.01),
        SliderPreset.HIGH: (1000.0, 0.005),
    }
    rps, err_rate = scale_map[sliders.budget_vs_scale]
    base.min_requests_per_second = rps
    base.max_error_rate = err_rate

    speed_map = {
        SliderPreset.LOW: (1000.0, 5000.0),
        SliderPreset.MEDIUM: (500.0, 2000.0),
        SliderPreset.HIGH: (100.0, 500.0),
    }
    avg_lat, p99_lat = speed_map[sliders.speed_vs_precision]
    base.max_avg_latency_ms = avg_lat
    base.max_p99_latency_ms = p99_lat

    return base


# ── LLM Sidecar Client ──────────────────────────────────────────────────────


def _call_llm(
    prompt: str,
    host: str = LLM_DEFAULT_HOST,
    port: int = LLM_DEFAULT_PORT,
    timeout: int = LLM_REQUEST_TIMEOUT,
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> Optional[str]:
    """Send a completion request to the local llama.cpp sidecar HTTP server.

    The sidecar exposes an OpenAI-compatible /v1/chat/completions endpoint.
    Returns the assistant message content, or None on failure.
    """
    payload = json.dumps({
        "model": "local",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a precise code generation engine. "
                    "Emit ONLY unified diff patches. "
                    "Do not emit explanations, markdown fences, or commentary. "
                    "Each patch must be a valid unified diff starting with --- and +++."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    start = time.monotonic()
    try:
        conn = http.client.HTTPConnection(host, port, timeout=timeout)
        conn.request("POST", "/v1/chat/completions", body=payload, headers=headers)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8")
        conn.close()
    except (ConnectionRefusedError, OSError, http.client.HTTPException) as exc:
        logger.error("LLM sidecar unreachable at %s:%d — %s", host, port, exc)
        return None

    elapsed = (time.monotonic() - start) * 1000
    logger.info("LLM response received in %.0fms (status %d)", elapsed, resp.status)

    if resp.status != 200:
        logger.error("LLM returned HTTP %d: %s", resp.status, body[:500])
        return None

    try:
        data = json.loads(body)
        content = data["choices"][0]["message"]["content"]
        return content
    except (json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.error("Failed to parse LLM response: %s", exc)
        return None


# ── Diff Parsing & Application ───────────────────────────────────────────────


def _parse_unified_diffs(raw_response: str, project_root: str) -> list[DiffPatch]:
    """Extract unified diff blocks from the LLM response and resolve file paths.

    Supports both standard unified diff and the simplified format the model
    might emit. Each block starts with --- a/path and +++ b/path.
    """
    patches: list[DiffPatch] = []

    # Split into diff blocks
    diff_blocks = re.split(r"(?=^---\s)", raw_response, flags=re.MULTILINE)

    for block in diff_blocks:
        block = block.strip()
        if not block.startswith("---"):
            continue

        lines = block.splitlines()
        if len(lines) < 3:
            continue

        # Extract file paths
        old_line = lines[0]  # --- a/path/to/file
        new_line = lines[1]  # +++ b/path/to/file

        old_match = re.match(r"^---\s+(?:a/)?(.+?)(?:\s|$)", old_line)
        new_match = re.match(r"^\+\+\+\s+(?:b/)?(.+?)(?:\s|$)", new_line)

        if not new_match:
            continue

        rel_path = new_match.group(1).strip()
        abs_path = str(Path(project_root) / rel_path)

        # Read original content if file exists
        original = ""
        if Path(abs_path).exists():
            try:
                original = Path(abs_path).read_text(encoding="utf-8")
            except OSError:
                pass

        # Apply the diff hunks to produce patched content
        patched = _apply_diff_hunks(original, lines[2:])

        patches.append(
            DiffPatch(
                file_path=abs_path,
                original_content=original,
                patched_content=patched,
                diff_text=block,
            )
        )

    return patches


def _apply_diff_hunks(original: str, hunk_lines: list[str]) -> str:
    """Apply unified diff hunk lines to the original content.

    Handles @@ -start,count +start,count @@ hunk headers and +/- lines.
    Falls back to returning the concatenation of all '+' lines if parsing fails
    (which handles the case where the file is entirely new).
    """
    if not original:
        # New file — collect all '+' lines
        result_lines = []
        for line in hunk_lines:
            if line.startswith("+") and not line.startswith("+++"):
                result_lines.append(line[1:])
            elif line.startswith(" "):
                result_lines.append(line[1:])
            elif not line.startswith("-") and not line.startswith("@@"):
                result_lines.append(line)
        return "\n".join(result_lines) + "\n" if result_lines else ""

    orig_lines = original.splitlines(keepends=True)
    result = list(orig_lines)

    # Parse and apply hunks in reverse order to preserve line numbers
    hunks = []
    current_hunk_header = None
    current_hunk_body: list[str] = []

    for line in hunk_lines:
        if line.startswith("@@"):
            if current_hunk_header is not None:
                hunks.append((current_hunk_header, current_hunk_body))
            current_hunk_header = line
            current_hunk_body = []
        elif current_hunk_header is not None:
            current_hunk_body.append(line)

    if current_hunk_header is not None:
        hunks.append((current_hunk_header, current_hunk_body))

    if not hunks:
        # No parseable hunks — return original
        return original

    # Process hunks in reverse to keep line offsets valid
    for header, body in reversed(hunks):
        match = re.match(r"@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@", header)
        if not match:
            continue

        old_start = int(match.group(1)) - 1  # 0-indexed
        old_count = int(match.group(2)) if match.group(2) else 1

        # Build the replacement lines from the hunk body
        replacement: list[str] = []
        consumed = 0
        for bline in body:
            if bline.startswith("-"):
                consumed += 1
            elif bline.startswith("+"):
                content = bline[1:]
                if not content.endswith("\n"):
                    content += "\n"
                replacement.append(content)
            elif bline.startswith(" "):
                consumed += 1
                content = bline[1:]
                if not content.endswith("\n"):
                    content += "\n"
                replacement.append(content)

        end_idx = min(old_start + max(consumed, old_count), len(result))
        result[old_start:end_idx] = replacement

    return "".join(result)


def _write_patches_to_disk(patches: list[DiffPatch]) -> list[str]:
    """Write finalized patches to disk. Returns list of written file paths."""
    written = []
    for patch in patches:
        target = Path(patch.file_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(patch.patched_content, encoding="utf-8")
        written.append(str(target))
        logger.info("Written: %s (%d bytes)", target, len(patch.patched_content))
    return written


def _write_patches_to_staging(patches: list[DiffPatch], staging_dir: str) -> list[str]:
    """Write patches to a temporary staging directory for gate verification.

    Returns list of staged file paths.
    """
    staged = []
    for patch in patches:
        # Compute relative path from common ancestor
        rel = Path(patch.file_path).name
        staged_path = Path(staging_dir) / rel
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        staged_path.write_text(patch.patched_content, encoding="utf-8")
        staged.append(str(staged_path))
    return staged


# ── Prompt Construction ──────────────────────────────────────────────────────


def build_initial_prompt(
    user_request: str,
    config: ProjectConfig,
    file_contexts: Optional[dict[str, str]] = None,
) -> str:
    """Construct the initial code-generation prompt for the LLM.

    Incorporates the user's request, project configuration, slider values,
    and relevant file context snippets.
    """
    sections = []

    sections.append(f"## Task\n{user_request}")

    sections.append(
        f"## Project Configuration\n"
        f"- Language: {config.language}\n"
        f"- Scale requirement: {config.sliders.budget_vs_scale.value}\n"
        f"- Speed requirement: {config.sliders.speed_vs_precision.value}\n"
        f"- Modularity: {config.sliders.simplicity_vs_futureproof.value}"
    )

    # Architectural constraints derived from slider presets
    constraints = inject_constraints(config.sliders.to_dict())
    constraint_block = constraints.to_prompt_block()
    if constraint_block:
        sections.append(constraint_block)

    thresholds = derive_thresholds(config.sliders)
    sections.append(
        f"## Performance Targets\n"
        f"- Min throughput: {thresholds.min_requests_per_second} req/s\n"
        f"- Max avg latency: {thresholds.max_avg_latency_ms}ms\n"
        f"- Max p99 latency: {thresholds.max_p99_latency_ms}ms\n"
        f"- Max error rate: {thresholds.max_error_rate * 100}%"
    )

    if file_contexts:
        ctx_parts = []
        for fpath, content in file_contexts.items():
            # Truncate large files to keep under token budget
            truncated = content[:3000]
            ctx_parts.append(f"### {fpath}\n```\n{truncated}\n```")
        sections.append("## Current File Context\n" + "\n".join(ctx_parts))

    sections.append(
        "## Output Format\n"
        "Emit ONLY unified diff patches. One patch per file.\n"
        "Use --- a/path and +++ b/path headers.\n"
        "Do not include explanations or markdown fences."
    )

    return "\n\n".join(sections)


def build_correction_prompt(
    original_request: str,
    current_diff: str,
    syntax_card: Optional[str] = None,
    performance_card: Optional[str] = None,
    oracle_card: Optional[str] = None,
    round_number: int = 1,
) -> str:
    """Build a tightly scoped correction prompt from gate failures.

    Stays under 2,000 tokens by truncating and compressing aggressively.
    """
    char_budget = CONTEXT_CARD_MAX_TOKENS * 4  # ~4 chars per token
    sections = []

    sections.append(
        f"## Correction Round {round_number}\n"
        f"Your previous patch failed verification. Fix the issues below."
    )

    sections.append(f"## Original Request\n{original_request[:500]}")

    # Include the most recent diff so the model knows what it generated
    diff_budget = char_budget // 3
    sections.append(f"## Your Previous Patch\n```\n{current_diff[:diff_budget]}\n```")

    if syntax_card:
        sections.append(f"## Syntax Gate Failures\n```json\n{syntax_card[:1500]}\n```")

    if oracle_card and oracle_card != "{}":
        sections.append(f"## Property Oracle Violations\n```json\n{oracle_card[:1000]}\n```")

    if performance_card:
        sections.append(
            f"## Performance Gate Failures\n```json\n{performance_card[:1000]}\n```"
        )

    sections.append(
        "## Instructions\n"
        "Emit a corrected unified diff patch that fixes ALL the above failures.\n"
        "Do not emit explanations. Only emit the corrected unified diff."
    )

    prompt = "\n\n".join(sections)

    # Hard-truncate to token budget
    if len(prompt) > char_budget:
        prompt = prompt[:char_budget]

    return prompt


# ── Gate Evaluation ──────────────────────────────────────────────────────────


def evaluate_syntax_gate(staged_paths: list[str]) -> tuple[bool, GauntletReport, str]:
    """Run the syntax gate on staged files.

    Returns (passed, report, context_card_json).
    """
    logger.info("Running syntax gate on %d files", len(staged_paths))
    report = run_syntax_gate(target_paths=staged_paths)
    card = format_syntax_context_card(report, max_tokens=CONTEXT_CARD_MAX_TOKENS)
    return report.passed, report, card


def evaluate_oracle_gate(staged_paths: list[str]) -> tuple[bool, list[OracleReport], str]:
    """Run property-based testing oracle across staged files.

    Returns (passed, reports, context_card_json).
    """
    logger.info("Running property oracle gate on %d staged files", len(staged_paths))
    reports: list[OracleReport] = []
    all_passed = True

    for path_str in staged_paths:
        if path_str.endswith((".py", ".ts", ".js")):
            try:
                rep = run_oracle_for_file(path_str, timeout_per_function=30)
                reports.append(rep)
                if not rep.passed:
                    all_passed = False
            except Exception as exc:
                logger.warning("Oracle execution skipped for %s: %s", path_str, exc)

    card = "{}"
    if reports:
        for r in reports:
            if not r.passed:
                card = format_oracle_context_card(r, max_tokens=CONTEXT_CARD_MAX_TOKENS)
                break

    return all_passed, reports, card


def evaluate_performance_gate(
    config: ProjectConfig,
    thresholds: PerformanceThresholds,
) -> tuple[bool, Optional[SandboxResult], str, list[str]]:
    """Run the performance gate by launching the app and benchmarking it.

    Returns (passed, result, context_card_json, breach_descriptions).
    """
    if not config.entry_command:
        logger.info("No entry command configured — performance gate skipped")
        return True, None, "{}", []

    logger.info("Running performance gate: %s", " ".join(config.entry_command))

    result = run_load_sandbox(
        target_command=config.entry_command,
        endpoint_path=config.entry_endpoint,
        cwd=config.project_root,
    )

    card = format_performance_context_card(result, max_tokens=CONTEXT_CARD_MAX_TOKENS)
    breaches: list[str] = []

    if result.status != SandboxStatus.PASS:
        breaches.append(f"Sandbox status: {result.status.value}")

    t = result.telemetry

    if t.requests_per_second < thresholds.min_requests_per_second:
        breaches.append(
            f"Throughput {t.requests_per_second:.1f} req/s < "
            f"minimum {thresholds.min_requests_per_second:.1f} req/s"
        )

    if t.avg_latency_ms > thresholds.max_avg_latency_ms:
        breaches.append(
            f"Avg latency {t.avg_latency_ms:.1f}ms > "
            f"maximum {thresholds.max_avg_latency_ms:.1f}ms"
        )

    if t.p99_latency_ms > thresholds.max_p99_latency_ms:
        breaches.append(
            f"P99 latency {t.p99_latency_ms:.1f}ms > "
            f"maximum {thresholds.max_p99_latency_ms:.1f}ms"
        )

    if t.total_requests > 0:
        error_rate = t.error_count / t.total_requests
        if error_rate > thresholds.max_error_rate:
            breaches.append(
                f"Error rate {error_rate * 100:.1f}% > "
                f"maximum {thresholds.max_error_rate * 100:.1f}%"
            )

    if t.peak_cpu_percent > thresholds.max_peak_cpu_percent:
        breaches.append(
            f"Peak CPU {t.peak_cpu_percent:.1f}% > "
            f"maximum {thresholds.max_peak_cpu_percent:.1f}%"
        )

    if t.peak_memory_mb > thresholds.max_peak_memory_mb:
        breaches.append(
            f"Peak memory {t.peak_memory_mb:.1f}MB > "
            f"maximum {thresholds.max_peak_memory_mb:.1f}MB"
        )

    passed = len(breaches) == 0
    return passed, result, card, breaches


def _detect_paradox(
    syntax_card: str,
    perf_breaches: list[str],
    round_history: list[CorrectionRound],
) -> Optional[str]:
    """Detect contradictory requirements that the model cannot resolve.

    A paradox is declared if the same set of failures persists for 3+
    consecutive rounds with no measurable improvement.
    """
    if len(round_history) < 3:
        return None

    last_3 = round_history[-3:]

    # Check if syntax errors are stuck at the same count
    syntax_counts = [r.syntax_errors for r in last_3]
    if all(c > 0 for c in syntax_counts) and len(set(syntax_counts)) == 1:
        return (
            f"Paradox detected: syntax errors stuck at {syntax_counts[0]} "
            f"for {len(last_3)} consecutive rounds. "
            f"The original requirements may contain contradictory constraints."
        )

    # Check if performance breaches are identical across rounds
    breach_sets = [frozenset(r.performance_breaches) for r in last_3]
    if all(len(b) > 0 for b in breach_sets) and len(set(breach_sets)) == 1:
        return (
            f"Paradox detected: identical performance breaches for "
            f"{len(last_3)} consecutive rounds. "
            f"The performance targets may be unachievable on this hardware."
        )

    return None


# ── Main Orchestration Loop ─────────────────────────────────────────────────


def orchestrate(
    user_request: str,
    config: ProjectConfig,
    file_contexts: Optional[dict[str, str]] = None,
    max_rounds: int = MAX_CORRECTION_ROUNDS,
    skip_performance: bool = False,
    dry_run: bool = False,
) -> OrchestrationResult:
    """Execute the full self-healing orchestration pipeline.

    Flow
    ────
    1. Build initial prompt from user request + slider config.
    2. Call local LLM for a code patch.
    3. Write patch to staging directory.
    4. Run syntax gate on staged files.
    5. If syntax passes AND entry_command is configured, run performance gate.
    6. If any gate fails, build a correction prompt and loop back to step 2.
    7. Only write to disk when all gates are green.
    8. If a logical paradox is detected, interrupt and notify the user.

    Parameters
    ----------
    user_request : str
        Natural language / business-level request from the user.
    config : ProjectConfig
        Project configuration including slider values and target files.
    file_contexts : dict[str, str] | None
        Map of file paths to their current content for context.
    max_rounds : int
        Maximum correction rounds before giving up (default: 5).
    skip_performance : bool
        If True, skip the performance gate entirely.
    dry_run : bool
        If True, do not write final patches to disk.

    Returns
    -------
    OrchestrationResult
    """
    pipeline_start = time.monotonic()
    thresholds = derive_thresholds(config.sliders)
    rounds: list[CorrectionRound] = []
    current_patches: list[DiffPatch] = []
    current_diff_text = ""

    logger.info("=" * 70)
    logger.info("ORCHESTRATION STARTED")
    logger.info("User request: %s", user_request[:200])
    logger.info("Slider config: %s", json.dumps(config.sliders.to_dict()))
    logger.info(
        "Performance thresholds: min_rps=%.0f, max_avg_lat=%.0fms, max_p99=%.0fms",
        thresholds.min_requests_per_second,
        thresholds.max_avg_latency_ms,
        thresholds.max_p99_latency_ms,
    )
    logger.info("=" * 70)

    # ── Build initial prompt ──
    prompt = build_initial_prompt(user_request, config, file_contexts)

    for round_num in range(1, max_rounds + 1):
        logger.info("─── Round %d / %d ───", round_num, max_rounds)

        # ── Step 1: Call LLM ──
        llm_start = time.monotonic()
        raw_response = _call_llm(
            prompt=prompt,
            host=config.llm_host,
            port=config.llm_port,
        )
        llm_elapsed = (time.monotonic() - llm_start) * 1000

        if raw_response is None:
            logger.error("LLM sidecar unreachable — aborting pipeline")
            return OrchestrationResult(
                outcome=LoopOutcome.LLM_UNREACHABLE,
                total_rounds=round_num,
                rounds=rounds,
                elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                error_detail=f"LLM at {config.llm_host}:{config.llm_port} is not responding",
            )

        logger.info("LLM responded: %d chars in %.0fms", len(raw_response), llm_elapsed)

        # ── Step 2: Parse diffs ──
        current_patches = _parse_unified_diffs(raw_response, config.project_root)
        current_diff_text = raw_response

        if not current_patches:
            logger.warning("LLM produced no parseable diff patches")
            # Treat as a syntax failure and retry
            round_record = CorrectionRound(
                round_number=round_num,
                syntax_passed=False,
                performance_passed=False,
                syntax_errors=1,
                context_card_tokens=0,
                llm_latency_ms=llm_elapsed,
            )
            rounds.append(round_record)

            prompt = build_correction_prompt(
                original_request=user_request,
                current_diff="(no parseable diff was produced)",
                syntax_card='{"error":"No valid unified diff patches found in your output"}',
                round_number=round_num + 1,
            )
            continue

        logger.info("Parsed %d diff patch(es)", len(current_patches))
        for p in current_patches:
            logger.info("  → %s (%d bytes)", p.file_path, len(p.patched_content))

        # ── Step 3: Write to staging ──
        staging_dir = tempfile.mkdtemp(prefix="ide_staging_")
        try:
            staged_paths = _write_patches_to_staging(current_patches, staging_dir)

            # ── Step 4: Syntax Gate ──
            syntax_passed, syntax_report, syntax_card = evaluate_syntax_gate(staged_paths)

            syntax_errors = syntax_report.total_errors if syntax_report else 0
            logger.info(
                "Syntax gate: %s (%d errors, %d warnings)",
                "PASSED" if syntax_passed else "FAILED",
                syntax_errors,
                syntax_report.total_warnings if syntax_report else 0,
            )

            # ── Step 5: Performance Gate (only if syntax passes) ──
            perf_passed = True
            perf_card = "{}"
            perf_breaches: list[str] = []

            if syntax_passed and not skip_performance and config.entry_command:
                # Write patches to actual project for the sandbox to run
                temp_project = tempfile.mkdtemp(prefix="ide_perf_staging_")
                try:
                    # Copy project root to temp location
                    if Path(config.project_root).exists():
                        shutil.copytree(
                            config.project_root,
                            temp_project,
                            dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns(
                                "__pycache__", "node_modules", ".git", ".venv"
                            ),
                        )

                    # Overlay patches
                    for patch in current_patches:
                        rel = os.path.relpath(patch.file_path, config.project_root)
                        target = Path(temp_project) / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(patch.patched_content, encoding="utf-8")

                    temp_config = ProjectConfig(
                        project_root=temp_project,
                        entry_command=config.entry_command,
                        entry_endpoint=config.entry_endpoint,
                        sliders=config.sliders,
                    )

                    perf_passed, _, perf_card, perf_breaches = evaluate_performance_gate(
                        temp_config, thresholds
                    )

                    logger.info(
                        "Performance gate: %s (%d breaches)",
                        "PASSED" if perf_passed else "FAILED",
                        len(perf_breaches),
                    )
                    for breach in perf_breaches:
                        logger.info("  ✗ %s", breach)

                finally:
                    shutil.rmtree(temp_project, ignore_errors=True)

            elif syntax_passed and skip_performance:
                logger.info("Performance gate: SKIPPED (--skip-performance)")

            # ── Record round telemetry ──
            round_record = CorrectionRound(
                round_number=round_num,
                syntax_passed=syntax_passed,
                performance_passed=perf_passed,
                syntax_errors=syntax_errors,
                performance_breaches=perf_breaches,
                context_card_tokens=len(syntax_card) // 4,
                llm_latency_ms=llm_elapsed,
            )
            rounds.append(round_record)

            # ── Step 6: Check for 100% green ──
            if syntax_passed and perf_passed:
                logger.info("=" * 70)
                logger.info("ALL GATES PASSED — Round %d", round_num)
                logger.info("=" * 70)

                # ── Step 7: Write to disk ──
                if not dry_run:
                    written = _write_patches_to_disk(current_patches)
                    logger.info("Finalized %d files to disk", len(written))
                else:
                    logger.info("Dry run — skipping disk write")

                return OrchestrationResult(
                    outcome=LoopOutcome.SUCCESS,
                    total_rounds=round_num,
                    rounds=rounds,
                    final_patches=current_patches,
                    elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                )

            # ── Step 8: Paradox detection ──
            paradox = _detect_paradox(syntax_card, perf_breaches, rounds)
            if paradox:
                logger.error("PARADOX DETECTED: %s", paradox)
                return OrchestrationResult(
                    outcome=LoopOutcome.PARADOX_DETECTED,
                    total_rounds=round_num,
                    rounds=rounds,
                    elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                    error_detail=paradox,
                )

            # ── Step 9: Build correction prompt ──
            prompt = build_correction_prompt(
                original_request=user_request,
                current_diff=current_diff_text,
                syntax_card=syntax_card if not syntax_passed else None,
                performance_card=perf_card if not perf_passed else None,
                round_number=round_num + 1,
            )

            logger.info(
                "Correction prompt built: %d chars (~%d tokens)",
                len(prompt),
                len(prompt) // 4,
            )

        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)

    # ── Max retries exceeded ──
    logger.error(
        "Max correction rounds (%d) exceeded — pipeline failed", max_rounds
    )
    return OrchestrationResult(
        outcome=LoopOutcome.MAX_RETRIES_EXCEEDED,
        total_rounds=max_rounds,
        rounds=rounds,
        elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
        error_detail=f"Failed to achieve 100% green after {max_rounds} rounds",
    )


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> int:
    """Command-line entry point for isolated verification of the orchestrator."""
    import argparse

    parser = argparse.ArgumentParser(
        description="IDE Orchestrator — Self-healing code generation pipeline",
    )
    parser.add_argument(
        "request",
        help="Natural language code generation request",
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Path to the project root directory",
    )
    parser.add_argument(
        "--language",
        default="python",
        help="Target language (default: python)",
    )
    parser.add_argument(
        "--entry-command",
        nargs="*",
        default=None,
        help="Command to launch the target app for load testing",
    )
    parser.add_argument(
        "--entry-endpoint",
        default="/",
        help="HTTP endpoint to benchmark (default: /)",
    )
    parser.add_argument(
        "--scale",
        choices=["low", "medium", "high"],
        default="medium",
        help="Budget vs Scale slider",
    )
    parser.add_argument(
        "--speed",
        choices=["low", "medium", "high"],
        default="medium",
        help="Speed vs Precision slider",
    )
    parser.add_argument(
        "--modularity",
        choices=["low", "medium", "high"],
        default="medium",
        help="Simplicity vs Future-proof slider",
    )
    parser.add_argument(
        "--llm-host",
        default=LLM_DEFAULT_HOST,
        help=f"LLM sidecar host (default: {LLM_DEFAULT_HOST})",
    )
    parser.add_argument(
        "--llm-port",
        type=int,
        default=LLM_DEFAULT_PORT,
        help=f"LLM sidecar port (default: {LLM_DEFAULT_PORT})",
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_CORRECTION_ROUNDS,
        help=f"Max correction rounds (default: {MAX_CORRECTION_ROUNDS})",
    )
    parser.add_argument(
        "--skip-performance",
        action="store_true",
        help="Skip the performance gate",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write final patches to disk",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Emit JSON result to stdout",
    )

    args = parser.parse_args()

    config = ProjectConfig(
        project_root=str(Path(args.project_root).resolve()),
        language=args.language,
        entry_command=args.entry_command or [],
        entry_endpoint=args.entry_endpoint,
        llm_host=args.llm_host,
        llm_port=args.llm_port,
        sliders=SliderConfig(
            budget_vs_scale=SliderPreset(args.scale),
            speed_vs_precision=SliderPreset(args.speed),
            simplicity_vs_futureproof=SliderPreset(args.modularity),
        ),
    )

    result = orchestrate(
        user_request=args.request,
        config=config,
        max_rounds=args.max_rounds,
        skip_performance=args.skip_performance,
        dry_run=args.dry_run,
    )

    if args.json_output:
        sys.stdout.write(result.to_json() + "\n")

    return 0 if result.outcome == LoopOutcome.SUCCESS else 1


if __name__ == "__main__":
    raise SystemExit(main())
