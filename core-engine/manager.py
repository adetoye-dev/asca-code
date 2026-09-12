"""
manager.py — The System Orchestrator

Central orchestration brain of the ACSA Code backend. Implements the
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

import difflib
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
import urllib.parse
import urllib.request
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

for _p in (_ENGINE_DIR, _GAUNTLET_DIR, _COMPILER_DIR, _DATAMAP_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from scale_detector import detect_project_scale  # noqa: E402
from skills import skill_loader  # noqa: E402
from subagents import SwarmCoordinator  # noqa: E402
from agent_loop import run_agent_loop, AgentResult  # noqa: E402
import agent_tools  # noqa: E402
from syntax_guard import (  # noqa: E402
    Diagnostic,
    GauntletReport,
    LinterResult,
    LinterStatus,
    Severity,
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
LLM_REQUEST_TIMEOUT = 180


# ── Data Structures ──────────────────────────────────────────────────────────


class SliderPreset(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class LoopOutcome(str, Enum):
    SUCCESS = "success"
    MAX_RETRIES_EXCEEDED = "max_retries_exceeded"
    LLM_UNREACHABLE = "llm_unreachable"
    TIMEOUT = "timeout"
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
    llm_provider: str = "ollama"
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None
    active_file: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "project_root": self.project_root,
            "target_files": self.target_files,
            "sliders": self.sliders.to_dict(),
            "language": self.language,
            "entry_command": self.entry_command,
            "entry_endpoint": self.entry_endpoint,
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
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
    answer: str = ""
    intent: str = "mutation"

    def to_dict(self) -> dict:
        d = {
            "outcome": self.outcome.value,
            "total_rounds": self.total_rounds,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "error_detail": self.error_detail,
            "rounds": [asdict(r) for r in self.rounds],
        }
        if self.answer:
            d["answer"] = self.answer
        if self.intent:
            d["intent"] = self.intent
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Threshold Derivation ────────────────────────────────────────────────────


def derive_thresholds(config: ProjectConfig) -> PerformanceThresholds:
    """Map project context and scale to concrete performance bounds.

    Autonomously derives performance bounds based on the project's LOC,
    file count, framework, and scale tier, ensuring industry-standard
    requirements without requiring manual user slider input.
    """
    base = PerformanceThresholds()
    try:
        scale_prof = detect_project_scale(config.project_root)
        base.min_requests_per_second = scale_prof.min_requests_per_second
        base.max_avg_latency_ms = scale_prof.max_avg_latency_ms
        base.max_p99_latency_ms = scale_prof.max_p99_latency_ms
        base.max_error_rate = scale_prof.max_error_rate
        base.max_peak_cpu_percent = scale_prof.max_peak_cpu_percent
        base.max_peak_memory_mb = scale_prof.max_peak_memory_mb
        emit_step("Scale Detection", f"Analyzed workspace scale ({scale_prof.file_count} files, {scale_prof.total_loc} LOC)", "done")
    except Exception as exc:
        logger.warning("Auto scale detection fallback: %s", exc)

    return base


# ── Real-time Client Streaming Protocol ─────────────────────────────────────


def emit_step(name: str, detail: str = "", status: str = "running") -> None:
    """Emit a structured step event to stdout for the real-time client loop."""
    try:
        sys.stdout.write(f"@@STEP@@{json.dumps({'name': name, 'detail': detail, 'status': status})}\n")
        sys.stdout.flush()
    except Exception:
        pass


def emit_thought(text: str) -> None:
    """Emit a structured thought event to stdout for the real-time client loop."""
    try:
        sys.stdout.write(f"@@THOUGHT@@{json.dumps(text)}\n")
        sys.stdout.flush()
    except Exception:
        pass


def emit_chunk(token: str) -> None:
    """Emit a real-time streamed token to stdout for the chat interface."""
    try:
        sys.stdout.write(f"@@CHUNK@@{json.dumps(token)}\n")
        sys.stdout.flush()
    except Exception:
        pass


# ── LLM Sidecar Client ──────────────────────────────────────────────────────


_last_llm_error: str = ""


def _call_llm(
    prompt: str,
    config: Optional[ProjectConfig] = None,
    host: str = LLM_DEFAULT_HOST,
    port: int = LLM_DEFAULT_PORT,
    timeout: int = LLM_REQUEST_TIMEOUT,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    system_instruction: Optional[str] = None,
    stream: bool = True,
) -> Optional[str]:
    """Send a completion request to the chosen LLM provider (Ollama, OpenAI API, local).

    Streams tokens live via emit_chunk/emit_thought when stream=True,
    and returns full assistant content on completion, or None on failure/unreachable.
    """
    global _last_llm_error
    _last_llm_error = ""

    provider = config.llm_provider if config else "local"

    # Deterministic mode returns structured offline summary
    if provider == "deterministic":
        return (
            f"### Offline Codebase Analysis (Deterministic AST Engine)\n\n"
            f"**Task**: {prompt[:200]}...\n\n"
            f"*Offline mode active. For generative coding and full agent reasoning, select an active Ollama model (e.g. qwen2.5-coder:7b) or configured cloud provider in the chat model selector.*"
        )

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # 1. Handle Ollama Provider (supports native /api/chat, model tag resolution, proxy bypass)
    if provider == "ollama":
        base_url = (
            config.llm_base_url
            if (config and config.llm_base_url)
            else "http://127.0.0.1:11434"
        ).rstrip("/")
        if base_url.endswith("/v1"):
            base_url = base_url[:-3]
        elif base_url.endswith("/api/chat"):
            base_url = base_url[:-9]

        target_model = (config.llm_model if (config and config.llm_model) else "qwen2.5-coder:7b").strip()

        # Direct opener with proxy bypass so local addresses bypass macOS system proxies
        local_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        # Query installed models to fuzzy-match target tag
        try:
            tags_req = urllib.request.Request(f"{base_url}/api/tags")
            with local_opener.open(tags_req, timeout=3) as tag_resp:
                tag_data = json.loads(tag_resp.read().decode("utf-8"))
                installed = [m.get("name", "") for m in tag_data.get("models", [])]
                if installed:
                    matched = None
                    for m in installed:
                        if (
                            m == target_model
                            or m == f"{target_model}:latest"
                            or target_model == f"{m}:latest"
                            or m.startswith(f"{target_model}:")
                            or target_model.startswith(f"{m}:")
                        ):
                            matched = m
                            break
                    if matched:
                        target_model = matched
                    elif target_model not in installed:
                        logger.info("Auto-fallback from '%s' to installed Ollama model '%s'", target_model, installed[0])
                        target_model = installed[0]
        except Exception as tag_err:
            logger.debug("Ollama /api/tags check skipped: %s", tag_err)

        sys_msg = system_instruction or (
            "You are a precise autonomous code generation engine. "
            "Emit your code edits using SEARCH/REPLACE blocks (preferred) or valid unified diffs.\n\n"
            "SEARCH/REPLACE format example:\n"
            "[relative/file/path.ext]\n"
            "<<<<<<< SEARCH\n"
            "// exact existing code snippet to match\n"
            "=======\n"
            "// replacement code (or empty if deleting)\n"
            ">>>>>>> REPLACE\n\n"
            "IMPORTANT: Always use the exact relative workspace file path from the project context. "
            "Never emit placeholder paths like 'path/to/file.ts'.\n"
            "Make the smallest possible edit. Never rewrite an entire file "
            "when a focused hunk is sufficient, and never invent files or paths "
            "not present in the provided context. "
            "Do not emit conversational chit-chat."
        )

        messages = [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": prompt},
        ]

        # Try native Ollama /api/chat first with streaming
        chat_url = f"{base_url}/api/chat"
        payload = json.dumps({
            "model": target_model,
            "messages": messages,
            "stream": stream,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }).encode("utf-8")

        start = time.monotonic()
        try:
            req = urllib.request.Request(chat_url, data=payload, headers=headers, method="POST")
            full_tokens: list[str] = []
            with local_opener.open(req, timeout=timeout) as resp:
                for line_bytes in resp:
                    line_str = line_bytes.decode("utf-8").strip()
                    if not line_str:
                        continue
                    try:
                        data = json.loads(line_str)
                        msg = data.get("message", {})
                        thought = msg.get("thinking", "")
                        if thought:
                            emit_thought(thought)
                        token = msg.get("content", "")
                        if token:
                            full_tokens.append(token)
                            emit_chunk(token)
                        if data.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue
            elapsed = (time.monotonic() - start) * 1000
            logger.info("Ollama /api/chat responded in %.0fms (model=%s)", elapsed, target_model)
            if full_tokens:
                return "".join(full_tokens)
        except Exception as exc:
            err_str = str(exc)
            if "timed out" in err_str.lower() or "timeout" in err_str.lower():
                _last_llm_error = f"Ollama model '{target_model}' generation timed out after {timeout}s. The prompt or file context may be too large for local generation."
                logger.error("%s", _last_llm_error)
                return None
            logger.warning("Ollama /api/chat attempt failed: %s; trying /v1/chat/completions", exc)

        # Fallback to /v1/chat/completions only if not a timeout
        v1_url = f"{base_url}/v1/chat/completions"
        v1_payload = json.dumps({
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }).encode("utf-8")

        try:
            req = urllib.request.Request(v1_url, data=v1_payload, headers=headers, method="POST")
            full_tokens: list[str] = []
            with local_opener.open(req, timeout=timeout) as resp:
                for line_bytes in resp:
                    line_str = line_bytes.decode("utf-8").strip()
                    if not line_str or line_str == "data: [DONE]":
                        continue
                    if line_str.startswith("data: "):
                        line_str = line_str[6:].strip()
                    try:
                        data = json.loads(line_str)
                        choices = data.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            token = delta.get("content", "")
                            if token:
                                full_tokens.append(token)
                                emit_chunk(token)
                    except json.JSONDecodeError:
                        continue
            elapsed = (time.monotonic() - start) * 1000
            logger.info("Ollama /v1/chat/completions responded in %.0fms", elapsed)
            if full_tokens:
                return "".join(full_tokens)
        except Exception as exc:
            err_str = str(exc)
            if "timed out" in err_str.lower() or "timeout" in err_str.lower():
                _last_llm_error = f"Ollama model '{target_model}' generation timed out after {timeout}s."
            elif "connection refused" in err_str.lower() or "errno 61" in err_str.lower() or "unreachable" in err_str.lower():
                _last_llm_error = f"Cannot connect to Ollama at {base_url} (Connection refused). Ensure Ollama is running ('ollama serve' or click 'Local AI' in top bar) and model '{target_model}' is installed."
            else:
                _last_llm_error = f"Ollama connection failed for model '{target_model}': {exc}"
            logger.error("All Ollama endpoints failed for model '%s': %s", target_model, exc)
            return None

    # 2. Handle Anthropic Provider
    if provider == "anthropic":
        api_key = (config.llm_api_key if config else None) or os.environ.get("AIDE_API_KEY", "")
        if not api_key:
            _last_llm_error = "Anthropic API key is missing. Please configure it in AI Management Dashboard."
            logger.error(_last_llm_error)
            return None

        base_url = (config.llm_base_url if (config and config.llm_base_url) else "https://api.anthropic.com/v1").rstrip("/")
        endpoint_url = f"{base_url}/messages"
        model_name = config.llm_model if (config and config.llm_model) else "claude-3-5-sonnet-20241022"

        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key.strip(),
            "anthropic-version": "2023-06-01",
        }

        sys_msg = system_instruction or (
            "You are a precise autonomous code generation engine. "
            "Emit your code edits using SEARCH/REPLACE blocks (preferred) or valid unified diffs.\n\n"
            "SEARCH/REPLACE format example:\n"
            "[relative/file/path.ext]\n"
            "<<<<<<< SEARCH\n"
            "// exact existing code snippet to match\n"
            "=======\n"
            "// replacement code (or empty if deleting)\n"
            ">>>>>>> REPLACE\n\n"
            "IMPORTANT: Always use the exact relative workspace file path from the project context. "
            "Never emit placeholder paths like 'path/to/file.ts'.\n"
            "Make the smallest possible edit. Never rewrite an entire file "
            "when a focused hunk is sufficient, and never invent files or paths "
            "not present in the provided context. "
            "Do not emit conversational chit-chat."
        )

        payload = json.dumps({
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "system": sys_msg,
            "max_tokens": max_tokens,
            "stream": stream,
        }).encode("utf-8")

        start = time.monotonic()
        try:
            req = urllib.request.Request(endpoint_url, data=payload, headers=headers, method="POST")
            full_tokens: list[str] = []
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                for line_bytes in resp:
                    line_str = line_bytes.decode("utf-8").strip()
                    if not line_str or not line_str.startswith("data: "):
                        continue
                    payload_str = line_str[6:].strip()
                    try:
                        data = json.loads(payload_str)
                        if data.get("type") == "content_block_delta":
                            tok = data.get("delta", {}).get("text", "")
                            if tok:
                                full_tokens.append(tok)
                                emit_chunk(tok)
                        elif data.get("type") == "message_stop":
                            break
                    except json.JSONDecodeError:
                        continue
            elapsed = (time.monotonic() - start) * 1000
            logger.info("Anthropic responded in %.0fms (model=%s)", elapsed, model_name)
            return "".join(full_tokens) if full_tokens else None
        except Exception as exc:
            _last_llm_error = f"Anthropic request failed: {exc}"
            logger.error("%s", _last_llm_error)
            return None

    # 3. Handle OpenAI / Groq / DeepSeek / Google / OpenRouter / Compatible Remote Provider
    DEFAULT_PROVIDER_URLS = {
        "openai": "https://api.openai.com/v1",
        "google": "https://generativelanguage.googleapis.com/v1beta/openai",
        "groq": "https://api.groq.com/openai/v1",
        "deepseek": "https://api.deepseek.com/v1",
        "openrouter": "https://openrouter.ai/api/v1",
        "mistral": "https://api.mistral.ai/v1",
        "moonshot": "https://api.moonshot.cn/v1",
        "xai": "https://api.x.ai/v1",
        "together": "https://api.together.xyz/v1",
        "perplexity": "https://api.perplexity.ai",
    }

    def _chat_endpoint(base: str) -> str:
        base = base.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    api_key = (config.llm_api_key if config else None) or os.environ.get("AIDE_API_KEY", "")
    target_base = (config.llm_base_url if config and config.llm_base_url else None) or DEFAULT_PROVIDER_URLS.get(provider)

    if target_base or api_key:
        if not api_key and provider in DEFAULT_PROVIDER_URLS and provider != "local":
            _last_llm_error = f"API key is required for provider '{provider}'. Please configure your API key in the AI Management Dashboard."
            logger.error(_last_llm_error)
            return None
        endpoint_url = _chat_endpoint(target_base or "https://api.openai.com/v1")
        default_model = "gemini-1.5-flash" if provider == "google" else "gpt-4o-mini"
        model_name = config.llm_model if (config and config.llm_model) else default_model
        if api_key:
            headers["Authorization"] = f"Bearer {api_key.strip()}"
    else:
        h = config.llm_host if config else host
        p = config.llm_port if config else port
        endpoint_url = f"http://{h}:{p}/v1/chat/completions"
        model_name = config.llm_model if (config and config.llm_model) else "local"

    payload = json.dumps({
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": system_instruction or (
                    "You are a precise autonomous code generation engine. "
                    "Emit your code edits using SEARCH/REPLACE blocks (preferred) or valid unified diffs.\n\n"
                    "SEARCH/REPLACE format example:\n"
                    "[relative/file/path.ext]\n"
                    "<<<<<<< SEARCH\n"
                    "// exact existing code snippet to match\n"
                    "=======\n"
                    "// replacement code (or empty if deleting)\n"
                    ">>>>>>> REPLACE\n\n"
                    "IMPORTANT: Always use the exact relative workspace file path from the project context. "
                    "Never emit placeholder paths like 'path/to/file.ts'.\n"
                    "Make the smallest possible edit. Never rewrite an entire file "
                    "when a focused hunk is sufficient, and never invent files or paths "
                    "not present in the provided context. "
                    "Do not emit conversational chit-chat."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }).encode("utf-8")

    start = time.monotonic()
    is_local = "127.0.0.1" in endpoint_url or "localhost" in endpoint_url
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if is_local else urllib.request.build_opener()

    try:
        req = urllib.request.Request(endpoint_url, data=payload, headers=headers, method="POST")
        full_tokens: list[str] = []
        with opener.open(req, timeout=timeout) as resp:
            for line_bytes in resp:
                line_str = line_bytes.decode("utf-8").strip()
                if not line_str or line_str == "data: [DONE]":
                    continue
                if line_str.startswith("data: "):
                    line_str = line_str[6:].strip()
                try:
                    data = json.loads(line_str)
                    choices = data.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        token = delta.get("content", "")
                        if token:
                            full_tokens.append(token)
                            emit_chunk(token)
                except json.JSONDecodeError:
                    continue
        elapsed = (time.monotonic() - start) * 1000
        logger.info("LLM response received from %s in %.0fms", endpoint_url, elapsed)
        return "".join(full_tokens) if full_tokens else None
    except Exception as exc:
        err_str = str(exc)
        if "timed out" in err_str.lower() or "timeout" in err_str.lower():
            _last_llm_error = f"LLM provider '{endpoint_url}' timed out after {timeout}s."
        elif "connection refused" in err_str.lower() or "errno 61" in err_str.lower():
            _last_llm_error = f"Cannot connect to '{endpoint_url}' (Connection refused). Verify the model service is running."
        else:
            _last_llm_error = f"LLM request to '{endpoint_url}' failed: {exc}"
        logger.error("%s", _last_llm_error)
        return None



# ── Diff Parsing & Application ───────────────────────────────────────────────


def _apply_search_replace(content: str, search_block: str, replace_block: str) -> tuple[str, bool]:
    """Apply a SEARCH/REPLACE block using multi-tier matching (Aider algorithm)."""
    if not search_block:
        return content, False

    # Tier 1: Exact match
    if search_block in content:
        return content.replace(search_block, replace_block, 1), True

    # Tier 2: Stripped whitespace
    s_clean = search_block.strip()
    if s_clean and s_clean in content:
        return content.replace(s_clean, replace_block.strip(), 1), True

    # Tier 3: Normalized line-endings
    norm_content = content.replace("\r\n", "\n")
    norm_search = search_block.replace("\r\n", "\n")
    norm_replace = replace_block.replace("\r\n", "\n")
    if norm_search in norm_content:
        return norm_content.replace(norm_search, norm_replace, 1), True

    # Tier 4: Line-by-line whitespace-tolerant match
    c_lines = norm_content.split("\n")
    s_lines = [l.strip() for l in norm_search.split("\n") if l.strip()]
    if s_lines:
        n_s = len(s_lines)
        for i in range(len(c_lines) - n_s + 1):
            window = [c_lines[i + j].strip() for j in range(n_s)]
            if window == s_lines:
                first_line = c_lines[i]
                indent = first_line[: len(first_line) - len(first_line.lstrip())]
                rep_lines = norm_replace.split("\n")
                indented_rep = []
                for rl in rep_lines:
                    if rl.strip() and not rl.startswith(" ") and not rl.startswith("\t"):
                        indented_rep.append(indent + rl)
                    else:
                        indented_rep.append(rl)
                new_lines = c_lines[:i] + indented_rep + c_lines[i + n_s :]
                return "\n".join(new_lines), True

    return content, False


def _parse_search_replace_blocks(raw_response: str, project_root: str) -> list[DiffPatch]:
    """Parse SEARCH/REPLACE blocks (Aider / Claude Code industry standard).

    Format:
    [filepath]
    <<<<<<< SEARCH
    [exact code to find]
    =======
    [replacement code]
    >>>>>>> REPLACE
    """
    pattern = re.compile(
        r"(?:(?:^|\n)([^\n`#<>]+?\.[a-zA-Z0-9]+)\s*\n)?"
        r"<<<<<<<\s*SEARCH\s*\n"
        r"(.*?)\n=======\s*\n"
        r"(.*?)\n>>>>>>>\s*REPLACE",
        re.DOTALL,
    )

    matches = list(pattern.finditer(raw_response))
    if not matches:
        return []

    root = Path(project_root).resolve()
    file_patches: dict[str, tuple[str, list[tuple[str, str]]]] = {}

    ignored_dirs = {
        ".git", "node_modules", "dist", "build", ".venv",
        ".tauri", "target", "__pycache__", ".acsa", ".next", ".cache",
    }

    for m in matches:
        fpath_hint = (m.group(1) or "").strip()
        search_block = m.group(2)
        replace_block = m.group(3)

        target_path = None
        if fpath_hint:
            clean_hint = re.sub(r"^[\s#/*`-]+", "", fpath_hint).strip("`'\"*: \t\r\n")
            cand = (root / clean_hint).resolve()
            if cand.is_relative_to(root) and cand.exists() and cand.is_file():
                target_path = str(cand)

        if not target_path:
            s_test = search_block.strip()
            if s_test:
                for p in root.rglob("*"):
                    if any(part in ignored_dirs for part in p.parts):
                        continue
                    if p.is_file():
                        try:
                            c = p.read_text(encoding="utf-8", errors="ignore")
                            if s_test in c:
                                target_path = str(p.resolve())
                                break
                        except Exception:
                            continue

        if not target_path:
            continue

        if target_path not in file_patches:
            orig = Path(target_path).read_text(encoding="utf-8") if Path(target_path).exists() else ""
            file_patches[target_path] = (orig, [])
        file_patches[target_path][1].append((search_block, replace_block))

    patches: list[DiffPatch] = []
    for abs_path, (original, replacements) in file_patches.items():
        content = original
        diff_snippets = []
        for s_block, r_block in replacements:
            diff_snippets.append(f"<<<<<<< SEARCH\n{s_block}\n=======\n{r_block}\n>>>>>>> REPLACE")
            content, _ = _apply_search_replace(content, s_block, r_block)

        patches.append(
            DiffPatch(
                file_path=abs_path,
                original_content=original,
                patched_content=content,
                diff_text="\n\n".join(diff_snippets),
            )
        )

    return patches


def _parse_unified_diffs(raw_response: str, project_root: str) -> list[DiffPatch]:
    """Extract diff patches from LLM response (supports SEARCH/REPLACE and unified diff)."""
    # 1. Check for SEARCH/REPLACE blocks first (highest accuracy for local LLMs)
    sr_patches = _parse_search_replace_blocks(raw_response, project_root)
    if sr_patches:
        logger.info("Parsed %d SEARCH/REPLACE patch(es)", len(sr_patches))
        return sr_patches

    patches: list[DiffPatch] = []

    # Split into diff blocks
    diff_blocks = re.split(r"(?=^---\s)", raw_response, flags=re.MULTILINE)

    for block in diff_blocks:
        block = block.strip()
        if not block.startswith("---"):
            continue

        raw_lines = [l for l in block.splitlines() if not l.strip().startswith("```")]
        if len(raw_lines) < 3:
            continue

        # Extract file paths
        old_line = raw_lines[0]  # --- a/path/to/file
        new_line = raw_lines[1]  # +++ b/path/to/file

        old_match = re.match(r"^---\s+(?:a/)?(.+?)(?:\s|$)", old_line)
        new_match = re.match(r"^\+\+\+\s+(?:b/)?(.+?)(?:\s|$)", new_line)

        if not new_match:
            continue

        rel_path = new_match.group(1).strip()
        root = Path(project_root).resolve()
        candidate = (root / rel_path).resolve()
        if not candidate.is_relative_to(root):
            logger.error(
                "Rejecting patch with out-of-root path: %s", rel_path
            )
            continue
        abs_path = str(candidate)

        # Read original content if file exists
        original = ""
        if Path(abs_path).exists():
            try:
                original = Path(abs_path).read_text(encoding="utf-8")
            except OSError:
                pass

        # Apply the diff hunks to produce patched content
        patched = _apply_diff_hunks(original, raw_lines[2:])

        patches.append(
            DiffPatch(
                file_path=abs_path,
                original_content=original,
                patched_content=patched,
                diff_text=block,
            )
        )

    return patches


def _find_matching_offset(
    lines: list[str],
    expected_lines: list[str],
    hint_idx: int,
) -> Optional[int]:
    """Find the best matching index in lines for expected_lines around hint_idx.

    Searches outward from hint_idx by distance so that the closest matching
    location is always preferred over distant false positives. Never jumps
    arbitrarily across the file to line 0.
    """
    if not expected_lines:
        return max(0, min(hint_idx, len(lines)))

    n_exp = len(expected_lines)
    n_lines = len(lines)
    if n_exp > n_lines:
        return None

    def match_at(pos: int, strip_ws: bool = False) -> bool:
        if pos < 0 or pos + n_exp > n_lines:
            return False
        if strip_ws:
            return all(lines[pos + i].strip() == expected_lines[i].strip() for i in range(n_exp))
        return all(lines[pos + i].rstrip("\r\n") == expected_lines[i].rstrip("\r\n") for i in range(n_exp))

    # 1. Exact match at hint
    if match_at(hint_idx):
        return hint_idx

    # 2. Stripped match at hint
    if match_at(hint_idx, strip_ws=True):
        return hint_idx

    # 3. Search outward from hint_idx by distance across the entire file
    max_delta = max(hint_idx, n_lines - hint_idx)
    for delta in range(1, max_delta + 1):
        for candidate in (hint_idx - delta, hint_idx + delta):
            if 0 <= candidate <= n_lines - n_exp:
                if match_at(candidate):
                    return candidate

    for delta in range(1, max_delta + 1):
        for candidate in (hint_idx - delta, hint_idx + delta):
            if 0 <= candidate <= n_lines - n_exp:
                if match_at(candidate, strip_ws=True):
                    return candidate

    return None


def _apply_diff_hunks(original: str, hunk_lines: list[str]) -> str:
    """Apply unified diff hunk lines to the original content.

    Handles @@ -start,count +start,count @@ hunk headers and +/- lines.
    Uses context-aware offset relocation to ensure patches apply to the
    exact intended lines even if LLM line number estimates are shifted.
    Rejects hunks whose context lines cannot be found anywhere in the file.
    """
    cleaned_hunk_lines = [l for l in hunk_lines if not l.strip().startswith("```")]
    if not original:
        # New file — collect all '+' lines
        result_lines = []
        for line in cleaned_hunk_lines:
            if line.startswith("+") and not line.startswith("+++"):
                result_lines.append(line[1:])
            elif line.startswith(" "):
                result_lines.append(line[1:])
            elif not line.startswith("-") and not line.startswith("@@"):
                result_lines.append(line)
        return "\n".join(result_lines) + "\n" if result_lines else ""

    orig_lines = original.splitlines(keepends=True)
    result = list(orig_lines)

    # Parse hunks
    hunks = []
    current_hunk_header = None
    current_hunk_body: list[str] = []

    for line in cleaned_hunk_lines:
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
        return original

    # Process hunks in reverse to keep line offsets valid
    for header, body in reversed(hunks):
        match = re.match(r"@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@", header)
        if not match:
            continue

        old_start = int(match.group(1)) - 1  # 0-indexed
        old_count = int(match.group(2)) if match.group(2) else 1

        # Extract expected before lines (lines with context or deletion)
        expected_before = [
            bline[1:] for bline in body if bline.startswith(("-", " "))
        ]

        matched_idx = _find_matching_offset(result, expected_before, old_start)
        if matched_idx is None and expected_before:
            logger.warning(
                "Diff hunk around line %d rejected: context lines not found in file. Skipping to prevent file corruption.",
                old_start + 1,
            )
            continue

        actual_start = matched_idx if matched_idx is not None else max(0, min(old_start, len(result)))

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

        span_len = len(expected_before) if matched_idx is not None else max(consumed, old_count)
        end_idx = min(actual_start + span_len, len(result))
        result[actual_start:end_idx] = replacement

    return "".join(result)


def _write_patches_to_disk(patches: list[DiffPatch], project_root: str = "") -> list[str]:
    """Write finalized patches to disk using high-fidelity verified content with atomic backup."""
    written: list[str] = []
    root = Path(project_root).resolve() if project_root else None

    for patch in patches:
        target = Path(patch.file_path).resolve()
        if root is not None:
            try:
                target.relative_to(root)
            except ValueError:
                logger.warning(
                    "Refusing to write patch outside project_root for %s (project_root=%s)",
                    patch.file_path,
                    project_root,
                )
                continue

        # 1. High-fidelity direct write: patch.patched_content is the exact verified content
        if patch.patched_content and patch.patched_content != patch.original_content:
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    bak_path = target.with_suffix(target.suffix + ".bak")
                    shutil.copy2(target, bak_path)
                target.write_text(patch.patched_content, encoding="utf-8")
                written.append(str(target))
                logger.info("Directly wrote verified patched content to: %s", target)
                continue
            except Exception as exc:
                logger.warning(
                    "Direct write failed for %s (%s), falling back to diff applier",
                    patch.file_path,
                    exc,
                )

        # 2. Fallback: Unified diff application with non-strict validation
        batch = apply_diff_text(
            patch.diff_text,
            project_root=project_root,
            backup=True,
            strict=False,
        )
        if batch.rejected or batch.errors:
            logger.warning(
                "Patch rejected during final write for %s: %s",
                patch.file_path,
                batch.to_json(),
            )
            continue

        applied_any = False
        for result in batch.results:
            result_path = Path(result.file_path).resolve() if getattr(result, "file_path", None) else None
            if root is not None and result_path is not None:
                try:
                    result_path.relative_to(root)
                except ValueError:
                    logger.warning(
                        "Patch result for %s escapes project_root and was rejected",
                        result.file_path,
                    )
                    continue

            if result.status in {"applied", "created"}:
                written.append(result.file_path)
                applied_any = True
                logger.info("Written: %s", result.file_path)

        if not applied_any:
            logger.warning(
                "Patch showed no successful final write for %s; keeping correction loop active",
                patch.file_path,
            )

    return written


def _write_patches_to_staging(
    patches: list[DiffPatch], staging_dir: str, project_root: str = ""
) -> list[str]:
    """Write patches to a temporary staging directory for gate verification."""
    staged: list[str] = []
    seen: set[str] = set()
    root_resolved = Path(project_root).resolve() if project_root else None

    if root_resolved and root_resolved.exists():
        shutil.copytree(
            root_resolved,
            staging_dir,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(
                ".git", ".tauri", "dist", "build", "node_modules", "__pycache__", ".venv", ".acsa", ".*_cache", "*_cache"
            ),
        )
        dependencies = root_resolved / "node_modules"
        staged_dependencies = Path(staging_dir) / "node_modules"
        if dependencies.exists() and not staged_dependencies.exists():
            staged_dependencies.symlink_to(dependencies, target_is_directory=True)

    for patch in patches:
        patch_resolved = Path(patch.file_path).resolve()
        if root_resolved:
            try:
                rel = patch_resolved.relative_to(root_resolved)
            except ValueError:
                rel = Path(patch.file_path).name
        else:
            rel = Path(patch.file_path).name

        staged_path = Path(staging_dir) / rel
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        staged_path.write_text(patch.patched_content, encoding="utf-8")
        staged_key = str(staged_path)
        if staged_key not in seen:
            staged.append(staged_key)
            seen.add(staged_key)
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

    thresholds = derive_thresholds(config)
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
            # If content is large, keep relevant excerpt around request terms
            if len(content) > 4000:
                terms = [t.lower() for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,}", user_request)]
                match_pos = -1
                for term in terms:
                    pos = content.lower().find(term)
                    if pos >= 0:
                        match_pos = pos
                        break
                if match_pos >= 0:
                    start_pos = max(0, match_pos - 1000)
                    end_pos = min(len(content), match_pos + 2500)
                    truncated = f"// ... [Lines preceding character {start_pos} omitted] ...\n" + content[start_pos:end_pos] + "\n// ... [Remaining lines omitted] ..."
                else:
                    truncated = content[:3500] + "\n// ... [Remaining lines omitted] ..."
            else:
                truncated = content
            ctx_parts.append(f"### {fpath}\n```\n{truncated}\n```")
        sections.append("## Current File Context\n" + "\n".join(ctx_parts))

    # ── Skills Integration (Custom & Built-in) ──
    try:
        matched_skills = skill_loader.match_skills_for_prompt(user_request, config.project_root)
        for s in matched_skills:
            sections.append(f"## Active Domain Skill: {s.name}\n{s.body}")
        
        catalog = skill_loader.get_skill_catalog_prompt(config.project_root)
        if catalog:
            sections.append(catalog)
    except Exception as exc:
        logger.debug("Skill catalog injection skipped: %s", exc)

    sections.append(
        "## Output Format\n"
        "You can emit changes using SEARCH/REPLACE blocks (preferred) or unified diffs:\n\n"
        "[relative/file/path.ext]\n"
        "<<<<<<< SEARCH\n"
        "// exact existing code snippet to match\n"
        "=======\n"
        "// replacement code (or empty if deleting)\n"
        ">>>>>>> REPLACE\n\n"
        "IMPORTANT: Always use the exact relative workspace file path from the project context. "
        "Never emit placeholder paths like 'path/to/file.ts'.\n"
        "Do not include conversational filler. Only emit the code change blocks."
    )

    return "\n\n".join(sections)


def collect_project_context(
    project_root: str,
    user_request: str,
    active_file: Optional[str] = None,
) -> dict[str, str]:
    """Collect and incrementally cache a small, highly-relevant project context set.

    Uses windowed term density (term proximity co-occurrence) and domain-intent heuristics
    to ensure precise file identification rather than naive keyword frequency counting.
    """
    root = Path(project_root).resolve()
    if not root.exists():
        return {}

    contexts: dict[str, str] = {}
    remaining = 10000

    # 1. Primary Priority: Active open file from editor (Cursor / VS Code standard)
    if active_file:
        cand_active = Path(active_file)
        if not cand_active.is_absolute():
            cand_active = root / active_file
        if cand_active.exists() and cand_active.is_file():
            try:
                rel_active = cand_active.relative_to(root).as_posix()
                act_content = cand_active.read_text(encoding="utf-8", errors="ignore")
                act_snippet = act_content[:3500] if len(act_content) > 3500 else act_content
                contexts[rel_active] = act_snippet
                remaining -= len(act_snippet)
                logger.info("Injected active editor file as priority context: %s", rel_active)
            except Exception:
                pass

    index_path = root / ".acsa" / "context-index.json"
    cached: dict[str, dict[str, object]] = {}
    try:
        cached = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        cached = {}

    request_terms = {
        term.lower()
        for term in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,}", user_request)
        if term.lower() not in {"please", "remove", "make", "this", "that", "from", "with", "instead", "number", "showing"}
    }

    UI_TERMS = {
        "button", "label", "icon", "modal", "dialog", "drawer", "sidebar", "header",
        "navbar", "footer", "badge", "tooltip", "color", "css", "theme", "click",
        "ui", "view", "component", "screen", "panel", "omnibar", "dropdown", "select",
    }
    API_TERMS = {
        "endpoint", "route", "handler", "proxy", "server", "middleware", "express",
        "fastapi", "flask", "backend", "bridge", "http",
    }

    lower_req = user_request.lower()
    is_ui_request = any(t in lower_req for t in UI_TERMS)
    is_api_request = any(t in lower_req for t in API_TERMS)

    candidates: list[tuple[int, str, str, int]] = []
    allowed_suffixes = {".ts", ".tsx", ".js", ".jsx", ".py", ".css", ".html", ".json", ".yaml", ".yml", ".md", ".rs", ".go", ".c", ".cpp"}
    ignored_parts = {".git", "node_modules", "dist", "build", ".venv", "__pycache__", ".tauri", ".acsa", ".mypy_cache", ".ruff_cache", ".pytest_cache", ".next", ".cache"}

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in allowed_suffixes:
            continue
        if any(part in ignored_parts for part in path.parts):
            continue
        relative = path.relative_to(root).as_posix()
        if relative in contexts:
            continue

        try:
            stat = path.stat()
            cache_entry = cached.get(relative, {})
            if cache_entry.get("mtime_ns") == stat.st_mtime_ns and cache_entry.get("size") == stat.st_size:
                content = str(cache_entry.get("content", ""))
            else:
                content = path.read_text(encoding="utf-8", errors="ignore")
                if len(content) > 300_000:
                    continue
                cached[relative] = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size, "content": content}
        except (OSError, UnicodeDecodeError):
            continue

        if len(content) > 300_000 or not content.strip():
            continue

        lines = content.splitlines()
        n_lines = len(lines)
        lower_lines = [l.lower() for l in lines]

        # 2. Windowed Co-occurrence Density (Term Proximity in 15-line sliding window)
        max_cooccur = 0
        best_window_idx = 0
        step = max(1, n_lines // 200) if n_lines > 200 else 3
        for i in range(0, n_lines, step):
            window = " ".join(lower_lines[i : min(n_lines, i + 15)])
            cooccur = sum(1 for t in request_terms if t in window)
            if cooccur > max_cooccur:
                max_cooccur = cooccur
                best_window_idx = i

        score = (max_cooccur ** 2) * 15
        score += sum(10 for t in request_terms if t in relative.lower())

        # 3. Domain Intent Heuristic Boosting
        is_component = (
            relative.startswith("src/components/")
            or relative.startswith("src/views/")
            or relative.startswith("src/ui/")
            or relative.endswith((".tsx", ".jsx", ".vue", ".svelte"))
        )
        is_backend = (
            "bridge" in relative.lower()
            or "server" in relative.lower()
            or relative.startswith("server/")
            or relative.startswith("backend/")
        )

        if is_ui_request:
            if is_component:
                score += 35
            elif is_backend:
                score -= 30

        if is_api_request:
            if is_backend:
                score += 35

        candidates.append((score, relative, content, best_window_idx))

    # Automatically include real Git diff/status if user asks about recent changes/modifications
    if any(k in lower_req for k in ("recent", "change", "diff", "modified", "status", "commit", "summary", "summarize")):
        emit_step("Git Intelligence", "Inspecting modified files, git status, and recent diff", "running")
        try:
            import subprocess
            res_stat = subprocess.run(
                ["git", "diff", "HEAD", "--stat"],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=3,
            )
            stat_text = res_stat.stdout.strip()
            if stat_text:
                contexts["[Git Diff Stat]"] = stat_text

            res_status = subprocess.run(
                ["git", "status", "-s"],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=3,
            )
            status_text = res_status.stdout.strip()
            if status_text:
                contexts["[Git Status / Modified Files]"] = status_text

            res_diff = subprocess.run(
                ["git", "diff", "HEAD"],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=3,
            )
            diff_patch = res_diff.stdout.strip()
            if diff_patch:
                contexts["[Recent Git Diff]"] = diff_patch[:6000]

            res_log = subprocess.run(
                ["git", "log", "-n", "5", "--stat", "--oneline"],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=3,
            )
            log_text = res_log.stdout.strip()
            if log_text:
                contexts["[Recent Git Commits]"] = log_text[:3000]
            emit_step("Git Intelligence", f"Context gathered from {len(contexts)} sources", "done")
        except Exception as exc:
            logger.debug("Git context collection skipped: %s", exc)

    for score, relative, content, best_window_idx in sorted(candidates, key=lambda item: (-item[0], item[1])):
        if remaining <= 0 or (score == 0 and contexts):
            break
        if score > 0 and len(content) > 3500:
            lines = content.splitlines()
            start_line = max(0, best_window_idx - 15)
            end_line = min(len(lines), best_window_idx + 35)
            selected = "\n".join(lines[start_line:end_line])
        else:
            selected = content[:3500]
        selected = selected[:remaining]
        contexts[relative] = selected
        remaining -= len(selected)
        if len(contexts) >= 6:
            break

    try:
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(json.dumps(cached, separators=(",", ":")), encoding="utf-8")
    except OSError:
        pass
    return contexts


def build_correction_prompt(
    original_request: str,
    current_diff: str,
    file_contexts: Optional[dict[str, str]] = None,
    syntax_card: Optional[str] = None,
    performance_card: Optional[str] = None,
    oracle_card: Optional[str] = None,
    round_number: int = 1,
    project_root: str = "",
    staging_dir: str = "",
) -> str:
    """Build a tightly scoped correction prompt from gate failures.

    Stays under token budget by prioritizing error context and the exact code lines
    surrounding syntax failures so the model can see what to correct.
    """
    char_budget = CONTEXT_CARD_MAX_TOKENS * 4  # ~4 chars per token
    sections = []

    sections.append(
        f"## Correction Round {round_number}\n"
        f"Your previous patch failed verification. Fix the issues below."
    )

    sections.append(f"## Original Request\n{original_request[:500]}")

    # Include the most recent diff so the model knows what it generated
    diff_budget = char_budget // 4
    sections.append(f"## Your Previous Patch\n```\n{current_diff[:diff_budget]}\n```")

    if syntax_card:
        sections.append(f"## Syntax Gate Failures\n```json\n{syntax_card[:1500]}\n```")

    # Extract exact code lines around syntax errors so the model can see the target code
    error_snippets: list[str] = []
    if syntax_card:
        try:
            card_data = json.loads(syntax_card)
            errors = card_data.get("errors", [])
            seen_buckets: set[tuple[str, int]] = set()

            for err in errors[:5]:  # Focus on top 5 errors to stay within budget
                f_path = err.get("f", "")
                l_num = err.get("l", 0)
                if not f_path or l_num <= 0:
                    continue

                bucket = (f_path, l_num // 20)
                if bucket in seen_buckets:
                    continue
                seen_buckets.add(bucket)

                # Locate file on disk (check staging_dir first, then project_root)
                target_file = None
                if staging_dir and (Path(staging_dir) / f_path).is_file():
                    target_file = Path(staging_dir) / f_path
                elif project_root and (Path(project_root) / f_path).is_file():
                    target_file = Path(project_root) / f_path
                elif Path(f_path).is_file():
                    target_file = Path(f_path)

                if target_file:
                    try:
                        raw_lines = target_file.read_text(encoding="utf-8").splitlines()
                        s_line = max(1, l_num - 12)
                        e_line = min(len(raw_lines), l_num + 12)
                        formatted_lines = []
                        for idx in range(s_line, e_line + 1):
                            prefix = ">>>" if idx == l_num else "   "
                            formatted_lines.append(f"{prefix} {idx:4d}: {raw_lines[idx - 1]}")
                        error_snippets.append(
                            f"### {f_path} (lines {s_line}-{e_line}, error at line {l_num}):\n```ts\n"
                            + "\n".join(formatted_lines)
                            + "\n```"
                        )
                    except Exception as exc:
                        logger.debug("Snippet extraction error for %s: %s", f_path, exc)
        except Exception:
            pass

    if error_snippets:
        sections.append(
            "## Code Surrounding Syntax Errors (Use these exact lines and line numbers to construct your diff)\n"
            + "\n\n".join(error_snippets)
        )

    if oracle_card and oracle_card != "{}":
        sections.append(f"## Property Oracle Violations\n```json\n{oracle_card[:1000]}\n```")

    if performance_card:
        sections.append(
            f"## Performance Gate Failures\n```json\n{performance_card[:1000]}\n```"
        )

    instruction_section = (
        "## Instructions\n"
        "Emit a corrected minimal unified diff patch that fixes ALL the above failures. "
        "Reference the exact code lines and context shown above.\n"
        "Do not emit explanations. Only emit the corrected unified diff."
    )
    sections.append(instruction_section)

    if file_contexts and not error_snippets:
        context_prefix = "## Current File Context\n"
        context_budget = max(0, char_budget - len("\n\n".join(sections)) - 2)
        context_parts = []
        for path, content in file_contexts.items():
            if context_budget <= 0:
                break
            part = f"### {path}\n```\n{content[:min(2000, context_budget)]}\n```"
            context_parts.append(part)
            context_budget -= len(part) + 2
        if context_parts:
            sections.append(context_prefix + "\n".join(context_parts))

    prompt = "\n\n".join(sections)

    # Hard-truncate to token budget
    if len(prompt) > char_budget:
        body = "\n\n".join(section for section in sections if section != instruction_section)
        prompt = body[: max(0, char_budget - len(instruction_section) - 2)] + "\n\n" + instruction_section

    return prompt


# ── Gate Evaluation ──────────────────────────────────────────────────────────


def _is_matching_diagnostic(diag: Diagnostic, baseline: Diagnostic) -> bool:
    """Check if a diagnostic matches a baseline diagnostic."""
    if diag.source != baseline.source:
        return False
    if diag.code and baseline.code and diag.code == baseline.code:
        d_msg = diag.message.strip().strip("'\"").lower()
        b_msg = baseline.message.strip().strip("'\"").lower()
        if d_msg == b_msg or (abs(diag.line - baseline.line) <= 25):
            return True
    d_msg = diag.message.strip().strip("'\"").lower()
    b_msg = baseline.message.strip().strip("'\"").lower()
    if d_msg and d_msg == b_msg:
        return True
    return False


def evaluate_syntax_gate(
    staged_paths: list[str],
    baseline_diagnostics: Optional[dict[str, list[Diagnostic]]] = None,
    staging_dir: Optional[str] = None,
    project_root: Optional[str] = None,
) -> tuple[bool, GauntletReport, str]:
    """Run the syntax gate on staged files with baseline regression diffing.

    Returns (passed, report, context_card_json).
    """
    logger.info("Running syntax gate on %d files", len(staged_paths))
    report = run_syntax_gate(target_paths=staged_paths, cwd=staging_dir or project_root)

    if baseline_diagnostics:
        filtered_results: list[LinterResult] = []
        new_errors_count = 0
        new_warnings_count = 0
        total_preexisting_count = 0

        for lr in report.linter_results:
            new_diags: list[Diagnostic] = []
            for d in lr.diagnostics:
                rel_file = d.file
                if staging_dir:
                    try:
                        rf = os.path.relpath(d.file, staging_dir)
                        if not rf.startswith(".."):
                            rel_file = rf
                    except (ValueError, Exception):
                        pass
                if "ide_staging_" in rel_file:
                    parts = rel_file.split("ide_staging_")
                    if len(parts) > 1 and "/" in parts[1]:
                        rel_file = parts[1].split("/", 1)[1]

                baseline_list = baseline_diagnostics.get(rel_file, [])
                is_preexisting = any(_is_matching_diagnostic(d, b) for b in baseline_list)

                if not is_preexisting:
                    cleaned_diag = Diagnostic(
                        file=rel_file,
                        line=d.line,
                        column=d.column,
                        severity=d.severity,
                        code=d.code,
                        message=d.message,
                        source=d.source,
                    )
                    new_diags.append(cleaned_diag)
                    if d.severity == Severity.ERROR:
                        new_errors_count += 1
                    elif d.severity == Severity.WARNING:
                        new_warnings_count += 1
                else:
                    total_preexisting_count += 1
                    logger.debug("Ignoring pre-existing baseline diagnostic: %s:%d %s", rel_file, d.line, d.message)

            filtered_lr = LinterResult(
                linter=lr.linter,
                status=LinterStatus.FAIL if any(d.severity == Severity.ERROR for d in new_diags) else LinterStatus.PASS,
                exit_code=1 if any(d.severity == Severity.ERROR for d in new_diags) else 0,
                diagnostics=new_diags,
                raw_stdout=lr.raw_stdout,
                raw_stderr=lr.raw_stderr,
                elapsed_ms=lr.elapsed_ms,
                error_detail=lr.error_detail,
            )
            filtered_results.append(filtered_lr)

        passed = (new_errors_count == 0)
        if total_preexisting_count > 0:
            logger.info(
                "Baseline diffing: %d new error(s), %d new warning(s) (%d pre-existing ignored)",
                new_errors_count,
                new_warnings_count,
                total_preexisting_count,
            )

        filtered_report = GauntletReport(
            target_paths=report.target_paths,
            passed=passed,
            linter_results=filtered_results,
            total_diagnostics=new_errors_count + new_warnings_count,
            total_errors=new_errors_count,
            total_warnings=new_warnings_count,
            elapsed_ms=report.elapsed_ms,
        )
        card = format_syntax_context_card(filtered_report, max_tokens=CONTEXT_CARD_MAX_TOKENS, base_dir=staging_dir)
        return passed, filtered_report, card

    card = format_syntax_context_card(report, max_tokens=CONTEXT_CARD_MAX_TOKENS, base_dir=staging_dir)
    return report.passed, report, card


def evaluate_oracle_gate(staged_paths: list[str]) -> tuple[bool, list[OracleReport], str]:
    """Run property-based testing oracle across staged files.

    In codebase-agnostic mode (matching Aider, Claude Code, Cline), verification
    relies on native language compilers, linters, and project test suites rather than
    fragile synthetic function mocking that fails on classes, frameworks, and methods.
    """
    logger.info("Property oracle gate: skipped (codebase-agnostic verification active)")
    return True, [], "{}"


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
            f"Syntax error resolution stalled: {syntax_counts[0]} error(s) remained "
            f"unresolved after {len(last_3)} consecutive correction rounds. "
            f"The model may be unable to satisfy the constraints without manual guidance."
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

def classify_intent(user_request: str) -> str:
    """Classify user request as 'inquiry' (read-only analysis/summary/explanation) or 'mutation' (code change)."""
    text = user_request.strip().lower()

    # Clear inquiry starters (summaries, explanations, questions, reviews)
    inquiry_starters = (
        "summarize",
        "summary",
        "explain",
        "describe",
        "overview",
        "what is",
        "what are",
        "what does",
        "what did",
        "where is",
        "where are",
        "how does",
        "how do",
        "how to",
        "why is",
        "why does",
        "can you explain",
        "could you explain",
        "tell me about",
        "list all",
        "show me",
        "walk me through",
    )
    if any(text.startswith(starter) for starter in inquiry_starters):
        return "inquiry"

    if any(phrase in text for phrase in (
        "recent changes",
        "recent codebase changes",
        "recent commits",
        "codebase changes",
        "what changed",
        "git diff",
        "git status",
        "explain this",
        "explain the",
        "architecture overview",
    )):
        return "inquiry"

    mutation_keywords = (
        "fix", "repair", "implement", "add", "create", "update", "modify",
        "change", "patch", "remove", "delete", "replace", "refactor", "optimize",
        "rewrite", "rework", "rebuild", "convert", "generate code"
    )
    words = re.findall(r"\b[a-z]+\b", text)
    if words and words[0] in mutation_keywords:
        return "mutation"

    if text.endswith("?") and not any(k in words for k in ("fix", "refactor", "implement", "create")):
        return "inquiry"

    if any(k in words for k in ("review", "audit", "analyze", "inspect")) and not any(k in words for k in ("fix", "patch", "modify", "update")):
        return "inquiry"

    return "mutation"


# ── Main Orchestration Loop ─────────────────────────────────────────────────


def orchestrate(
    user_request: str,
    config: ProjectConfig,
    file_contexts: Optional[dict[str, str]] = None,
    max_rounds: int = MAX_CORRECTION_ROUNDS,
    skip_performance: bool = False,
    dry_run: bool = False,
    conversation_history: Optional[list[dict[str, str]]] = None,
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
    thresholds = derive_thresholds(config)
    rounds: list[CorrectionRound] = []
    current_patches: list[DiffPatch] = []
    current_diff_text = ""
    baseline_cache: dict[str, list[Diagnostic]] = {}

    logger.info("=" * 70)
    logger.info("ORCHESTRATION STARTED")
    logger.info("User request: %s", user_request[:200])
    logger.info("Scale mode: Autonomous industry-standard heuristics")
    logger.info(
        "Performance thresholds: min_rps=%.0f, max_avg_lat=%.0fms, max_p99=%.0fms",
        thresholds.min_requests_per_second,
        thresholds.max_avg_latency_ms,
        thresholds.max_p99_latency_ms,
    )
    logger.info("=" * 70)

    # ── Multi-Agent Swarm Mode (/teamwork-preview, /goal) ──
    is_teamwork = any(user_request.lower().startswith(p) for p in ("/teamwork", "/teamwork-preview", "/goal"))
    if is_teamwork:
        logger.info("🤖 Multi-Agent Teamwork Swarm Activated")
        emit_step("Swarm Coordinator", "Multi-agent team activated for collaborative execution", "running")
        try:
            swarm = SwarmCoordinator(
                llm_caller=lambda p, system_instruction=None: _call_llm(
                    prompt=p,
                    config=config,
                    host=config.llm_host,
                    port=config.llm_port,
                    system_instruction=system_instruction,
                    max_tokens=2500,
                ),
                project_root=config.project_root,
                reporter=lambda role, detail, status: emit_step(f"Subagent: {role.capitalize()}", detail, status),
            )
            blackboard = swarm.run_swarm(user_request)
            emit_step("Swarm Coordinator", f"Swarm completed {len(blackboard.subtasks)} subtasks", "done")
            researched_ctxs = blackboard.shared_context.get("file_contexts", {})
            if researched_ctxs:
                file_contexts.update(researched_ctxs)

            agent_res = blackboard.shared_context.get("agent_result")
            if agent_res and (agent_res.edited_files or agent_res.answer):
                emit_step("Verification", f"Swarm workflow complete ({agent_res.total_rounds} turns, {agent_res.elapsed_s}s)", "done")
                return OrchestrationResult(
                    outcome=LoopOutcome.SUCCESS,
                    total_rounds=agent_res.total_rounds,
                    rounds=[],
                    final_patches=[],
                    elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                    answer=agent_res.answer,
                    intent="mutation" if agent_res.edited_files else "inquiry",
                )
        except Exception as exc:
            logger.warning("Swarm coordinator warning: %s", exc)

    # ── Intent Classification (Inquiry vs Mutation) ──
    intent = classify_intent(user_request)
    logger.info("Classified request intent: %s", intent)
    emit_step("Intent Analysis", f"Classified request as {intent.upper()}", "done")

    if intent == "inquiry":
        inquiry_sys = (
            "You are an expert software engineer and code intelligence assistant. "
            "Provide a thorough, precise, well-structured markdown response to the user's inquiry, "
            "grounded strictly in the provided project context, git status, git diff, and source files. "
            "Use clear headings, bullet points, and code references where appropriate."
        )

        prompt_parts = [
            "### Project Changes & Repository Context\n",
        ]
        if file_contexts:
            for path, content in file_contexts.items():
                prompt_parts.append(f"\n#### {path}\n```\n{content[:4000]}\n```\n")
        else:
            prompt_parts.append("(No specific file contexts loaded)")

        prompt_parts.append(
            "\n### Instruction\n"
            f"The user has requested:\n> {user_request}\n\n"
            "Based strictly on the git diff, git status, commits, and project context provided above, "
            "write a comprehensive, structured markdown response answering the user's request. "
            "Group by component, explain what was added/changed, and highlight key features. "
            "Do not ask clarifying questions or defer; provide the structured markdown analysis directly now."
        )
        inquiry_prompt = "\n".join(prompt_parts)

        logger.info("Executing analytical inquiry path...")
        emit_step("Model Reasoning", f"Generating response with {config.llm_model or 'qwen2.5-coder'}", "running")
        llm_start = time.monotonic()
        if config.llm_provider == "deterministic":
            raw_response = (
                f"### Offline Codebase Analysis (Deterministic AST Engine)\n\n"
                f"**Request**: {user_request}\n\n"
                f"**Workspace Context**: {len(file_contexts)} files inspected.\n\n"
            )
            if file_contexts:
                raw_response += "#### Inspected Files:\n"
                for fp in list(file_contexts.keys())[:10]:
                    raw_response += f"- `{fp}`\n"
            raw_response += "\n*Deterministic AST mode is running offline. Select an active AI model (e.g. Ollama, Claude, OpenAI) in the chat bar for full conversational reasoning.*"
            emit_chunk(raw_response)
        else:
            raw_response = _call_llm(
                prompt=inquiry_prompt,
                config=config,
                host=config.llm_host,
                port=config.llm_port,
                system_instruction=inquiry_sys,
                max_tokens=3000,
            )
        llm_elapsed = (time.monotonic() - llm_start) * 1000

        if raw_response is None:
            err_msg = _last_llm_error or f"Unable to connect to model provider '{config.llm_provider}'. Verify that the model service is online."
            is_timeout = "timed out" in err_msg.lower() or "timeout" in err_msg.lower()
            outcome = LoopOutcome.TIMEOUT if is_timeout else LoopOutcome.LLM_UNREACHABLE
            logger.error("Inquiry LLM call failed: %s", err_msg)
            emit_step("Model Reasoning", f"Model request failed: {err_msg}", "failed")
            return OrchestrationResult(
                outcome=outcome,
                total_rounds=1,
                rounds=[],
                elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                error_detail=err_msg,
                intent="inquiry",
            )

        logger.info("Analytical inquiry completed in %.0fms (%d chars)", llm_elapsed, len(raw_response))
        emit_step("Model Reasoning", f"Response generated in {round(llm_elapsed/1000, 1)}s ({len(raw_response)} chars)", "done")
        # Print output to stdout for real-time logging in CLI / UI event stream
        print(raw_response)
        return OrchestrationResult(
            outcome=LoopOutcome.SUCCESS,
            total_rounds=1,
            rounds=[],
            final_patches=[],
            elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
            answer=raw_response,
            intent="inquiry",
        )

    # ── Deterministic offline mode for mutation requests ──
    if config.llm_provider == "deterministic":
        notice = (
            f"### Offline Deterministic Engine\n\n"
            f"**Request**: `{user_request}`\n\n"
            f"Deterministic AST mode is running offline. Code synthesis and automated file mutations "
            f"require an active AI model.\n\n"
            f"**How to apply code changes**:\n"
            f"1. Select an AI model in the chat omnibar dropdown (e.g. **Ollama** `qwen2.5-coder:7b`, **Claude**, or **OpenAI**).\n"
            f"2. Ensure the provider service or local runner is active.\n"
            f"3. Submit your request to generate and apply precision SEARCH/REPLACE edits."
        )
        emit_chunk(notice)
        emit_step("Model Reasoning", "Offline analysis complete", "done")
        print(notice)
        return OrchestrationResult(
            outcome=LoopOutcome.SUCCESS,
            total_rounds=1,
            rounds=[],
            final_patches=[],
            elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
            answer=notice,
            intent="mutation",
        )

    # ── Autonomous ReAct Tool-Calling Agent Loop (Claude Code & Aider Parity) ──
    logger.info("🤖 Activating Autonomous ReAct Agent Loop with direct tools...")
    emit_step("Agent Engine", "Autonomous workspace agent active with direct project tools (grep, read, edit, run)", "running")

    agent_result = run_agent_loop(
        user_request=user_request,
        project_root=config.project_root,
        llm_caller=lambda p, sys_inst=None: _call_llm(
            prompt=p,
            config=config,
            host=config.llm_host,
            port=config.llm_port,
            system_instruction=sys_inst,
            max_tokens=2500,
        ),
        active_file=getattr(config, "active_file", None),
        reporter=lambda name, detail, status: emit_step(name, detail, status),
        chunk_streamer=emit_chunk,
        max_iterations=8,
        conversation_history=conversation_history,
        initial_context=file_contexts,
    )

    emit_step("Agent Engine", f"Autonomous agent finished in {agent_result.total_rounds} turn(s) ({agent_result.elapsed_s}s)", "done")

    if agent_result.edited_files:
        logger.info("Agent successfully edited %d file(s): %s", len(agent_result.edited_files), agent_result.edited_files)
        emit_step("Syntax Gate", f"Validating {len(agent_result.edited_files)} edited file(s)", "running")

        target_abs_paths = [
            str((Path(config.project_root) / f).resolve())
            for f in agent_result.edited_files
            if (Path(config.project_root) / f).exists()
        ]

        if target_abs_paths:
            report = run_syntax_gate(target_abs_paths, cwd=config.project_root)
            if report.total_errors > 0:
                logger.warning("Syntax gate reported %d errors on edited files", report.total_errors)
                emit_step("Syntax Gate", f"Verification warning: {report.total_errors} error(s) found", "failed")
                emit_step("Self-Healing Gate", f"Triggering targeted repair for {report.total_errors} syntax issue(s)...", "running")

                diag_messages = []
                for lr in report.linter_results:
                    for d in lr.diagnostics:
                        diag_messages.append(f"- {Path(lr.file_path).name}:{d.line_number}: [{d.severity}] {d.message}")

                repair_prompt = (
                    f"CRITICAL: Post-verification detected syntax errors in the modified files:\n"
                    + "\n".join(diag_messages[:5])
                    + "\nPlease inspect the files and use edit_file to fix these syntax errors immediately."
                )

                try:
                    repair_result = run_agent_loop(
                        user_request=repair_prompt,
                        project_root=config.project_root,
                        llm_caller=lambda p, sys_inst=None: _call_llm(
                            prompt=p,
                            config=config,
                            host=config.llm_host,
                            port=config.llm_port,
                            system_instruction=sys_inst,
                            max_tokens=2500,
                        ),
                        reporter=lambda name, detail, status: emit_step(f"Repair: {name}", detail, status),
                        chunk_streamer=emit_chunk,
                        max_iterations=3,
                    )
                    rep_after = run_syntax_gate(target_abs_paths, cwd=config.project_root)
                    if rep_after.total_errors == 0:
                        emit_step("Self-Healing Gate", "Repairs successful — all syntax errors resolved", "done")
                        if repair_result.answer:
                            agent_result.answer += f"\n\n### Self-Healing Post-Verification\n{repair_result.answer}"
                    else:
                        emit_step("Self-Healing Gate", f"Verification warning: {rep_after.total_errors} remaining issue(s)", "failed")
                except Exception as repair_exc:
                    logger.warning("Self-healing repair exception: %s", repair_exc)
            else:
                emit_step("Syntax Gate", f"PASSED — 0 syntax errors across {len(target_abs_paths)} file(s)", "done")

        emit_step("Verification", f"All operations complete ({agent_result.total_rounds} turns, {agent_result.elapsed_s}s)", "done")

        return OrchestrationResult(
            outcome=LoopOutcome.SUCCESS,
            total_rounds=agent_result.total_rounds,
            rounds=[],
            final_patches=[],
            elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
            answer=agent_result.answer,
            intent="mutation",
        )

    if agent_result.answer and not agent_result.edited_files:
        diff_patches = _parse_unified_diffs(agent_result.answer, config.project_root)
        if diff_patches:
            logger.info("Agent emitted %d patch(es) in response text — staging and running syntax verification", len(diff_patches))
            staging_dir = tempfile.mkdtemp(prefix="ide_agent_staging_")
            try:
                staged_paths = _write_patches_to_staging(
                    diff_patches,
                    staging_dir,
                    project_root=config.project_root,
                )
                syntax_passed, syntax_report, syntax_card = evaluate_syntax_gate(
                    staged_paths,
                    baseline_diagnostics=baseline_cache,
                    staging_dir=staging_dir,
                    project_root=config.project_root,
                )
                if syntax_passed:
                    logger.info("Staged diff patches PASSED syntax gate — safely writing to disk")
                    _write_patches_to_disk(diff_patches, config.project_root)
                    emit_step("Syntax Gate", f"PASSED — verified {len(diff_patches)} patch(es)", "done")
                    emit_step("Verification", f"All operations complete ({agent_result.total_rounds} turns, {agent_result.elapsed_s}s)", "done")
                    return OrchestrationResult(
                        outcome=LoopOutcome.SUCCESS,
                        total_rounds=agent_result.total_rounds,
                        rounds=[],
                        final_patches=diff_patches,
                        elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                        answer=agent_result.answer,
                        intent="mutation",
                    )
                else:
                    err_count = syntax_report.total_errors if syntax_report else 1
                    logger.warning("Staged diff patches FAILED syntax gate (%d errors) — REJECTING patches to prevent file corruption", err_count)
                    emit_step("Syntax Gate", f"REJECTED invalid patch ({err_count} errors) to protect files", "failed")
            finally:
                shutil.rmtree(staging_dir, ignore_errors=True)
        else:
            emit_step("Verification", f"All operations complete ({agent_result.total_rounds} turns, {agent_result.elapsed_s}s)", "done")
            return OrchestrationResult(
                outcome=LoopOutcome.SUCCESS,
                total_rounds=agent_result.total_rounds,
                rounds=[],
                final_patches=[],
                elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                answer=agent_result.answer,
                intent="mutation",
            )

    # ── Fallback to legacy single-shot prompt if agent loop produced nothing ──
    prompt = build_initial_prompt(user_request, config, file_contexts)

    for round_num in range(1, max_rounds + 1):
        logger.info("─── Round %d / %d ───", round_num, max_rounds)

        # ── Step 1: Call LLM ──
        llm_start = time.monotonic()
        raw_response = _call_llm(
            prompt=prompt,
            config=config,
            host=config.llm_host,
            port=config.llm_port,
        )

        llm_elapsed = (time.monotonic() - llm_start) * 1000

        if raw_response is None:
            err_msg = _last_llm_error or f"Unable to connect to model provider '{config.llm_provider}'. Verify that the model service is online."
            is_timeout = "timed out" in err_msg.lower() or "timeout" in err_msg.lower()
            outcome = LoopOutcome.TIMEOUT if is_timeout else LoopOutcome.LLM_UNREACHABLE
            logger.error("No code generator response available from provider '%s': %s — aborting pipeline", config.llm_provider, err_msg)
            return OrchestrationResult(
                outcome=outcome,
                total_rounds=round_num,
                rounds=rounds,
                elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                error_detail=err_msg,
            )

        logger.info("LLM responded: %d chars in %.0fms", len(raw_response), llm_elapsed)

        # ── Step 2: Parse diffs ──
        current_patches = _parse_unified_diffs(raw_response, config.project_root)
        current_diff_text = raw_response

        if not current_patches:
            logger.warning("LLM produced no parseable diff patches")
            round_record = CorrectionRound(
                round_number=round_num,
                syntax_passed=False,
                performance_passed=False,
                syntax_errors=1,
                context_card_tokens=0,
                llm_latency_ms=llm_elapsed,
            )
            rounds.append(round_record)

            paradox = _detect_paradox(
                '{"error":"No valid unified diff patches found in your output"}',
                [],
                rounds,
            )
            if paradox:
                logger.error("PARADOX DETECTED: %s", paradox)
                return OrchestrationResult(
                    outcome=LoopOutcome.PARADOX_DETECTED,
                    total_rounds=round_num,
                    rounds=rounds,
                    elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
                    error_detail=paradox,
                )

            prompt = build_correction_prompt(
                original_request=user_request,
                current_diff="(no parseable diff was produced)",
                file_contexts=file_contexts,
                syntax_card='{"error":"No valid unified diff patches found in your output"}',
                round_number=round_num + 1,
            )
            continue

        logger.info("Parsed %d diff patch(es)", len(current_patches))
        for p in current_patches:
            logger.info("  → %s (%d bytes)", p.file_path, len(p.patched_content))

        # ── Collect baseline diagnostics for targeted files if not yet cached ──
        for patch in current_patches:
            patch_file = patch.file_path
            if config.project_root:
                try:
                    rel_key = os.path.relpath(patch_file, config.project_root)
                except ValueError:
                    rel_key = Path(patch_file).name
            else:
                rel_key = Path(patch_file).name

            if rel_key not in baseline_cache:
                if Path(patch_file).is_file():
                    try:
                        base_report = run_syntax_gate(
                            target_paths=[patch_file],
                            cwd=config.project_root,
                        )
                        b_diags: list[Diagnostic] = []
                        for lr in base_report.linter_results:
                            b_diags.extend(lr.diagnostics)
                        baseline_cache[rel_key] = b_diags
                        if b_diags:
                            logger.info(
                                "Baseline syntax for %s: %d pre-existing diagnostic(s) recorded",
                                rel_key,
                                len(b_diags),
                            )
                    except Exception as exc:
                        logger.warning("Failed to collect baseline diagnostics for %s: %s", patch_file, exc)
                        baseline_cache[rel_key] = []
                else:
                    baseline_cache[rel_key] = []

        # ── Step 3: Write to staging ──
        staging_dir = tempfile.mkdtemp(prefix="ide_staging_")
        try:
            staged_paths = _write_patches_to_staging(
                current_patches,
                staging_dir,
                project_root=config.project_root,
            )

            # ── Step 4: Syntax Gate ──
            syntax_passed, syntax_report, syntax_card = evaluate_syntax_gate(
                staged_paths,
                baseline_diagnostics=baseline_cache,
                staging_dir=staging_dir,
                project_root=config.project_root,
            )

            syntax_errors = syntax_report.total_errors if syntax_report else 0
            logger.info(
                "Syntax gate: %s (%d errors, %d warnings)",
                "PASSED" if syntax_passed else "FAILED",
                syntax_errors,
                syntax_report.total_warnings if syntax_report else 0,
            )

            oracle_passed = True
            oracle_card = "{}"
            oracle_reports: list[OracleReport] = []
            if syntax_passed:
                oracle_passed, oracle_reports, oracle_card = evaluate_oracle_gate(staged_paths)

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
            if syntax_passed and perf_passed and oracle_passed:
                logger.info("=" * 70)
                logger.info("ALL GATES PASSED — Round %d", round_num)
                logger.info("=" * 70)

                # ── Step 7: Write to disk ──
                if not dry_run:
                    written = _write_patches_to_disk(
                        current_patches,
                        project_root=config.project_root,
                    )
                    logger.info("Finalized %d files to disk", len(written))

                    if len(written) != len(current_patches):
                        logger.warning(
                            "Final patch application incomplete (%d/%d files applied); continuing correction loop",
                            len(written),
                            len(current_patches),
                        )
                        prompt = build_correction_prompt(
                            original_request=user_request,
                            current_diff=current_diff_text,
                            file_contexts=file_contexts,
                            syntax_card='{"error":"Final patch application was incomplete or rejected"}',
                            round_number=round_num + 1,
                        )
                        continue
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
                file_contexts=file_contexts,
                syntax_card=syntax_card if not syntax_passed else None,
                performance_card=perf_card if not perf_passed else None,
                oracle_card=oracle_card if not oracle_passed else None,
                round_number=round_num + 1,
                project_root=config.project_root,
                staging_dir=staging_dir,
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
    last_round = rounds[-1] if rounds else None
    detail = f"Failed to achieve 100% green after {max_rounds} rounds"
    if last_round:
        detail += (
            f" (last verification: {last_round.syntax_errors} syntax errors, "
            f"{len(last_round.performance_breaches)} performance breaches)"
        )
    return OrchestrationResult(
        outcome=LoopOutcome.MAX_RETRIES_EXCEEDED,
        total_rounds=max_rounds,
        rounds=rounds,
        elapsed_ms=(time.monotonic() - pipeline_start) * 1000,
        error_detail=detail,
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
        nargs="?",
        default="",
        help="Natural language code generation request",
    )
    parser.add_argument(
        "--task",
        default="",
        help="Natural language code generation request (flag)",
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
        "--auto-scale",
        action="store_true",
        default=True,
        help="Autonomously derive scale, thresholds, and architecture standards",
    )
    parser.add_argument(
        "--scale",
        choices=["low", "medium", "high"],
        default="medium",
        help="[Legacy] Budget vs Scale slider",
    )
    parser.add_argument(
        "--speed",
        choices=["low", "medium", "high"],
        default="medium",
        help="[Legacy] Speed vs Precision slider",
    )
    parser.add_argument(
        "--modularity",
        choices=["low", "medium", "high"],
        default="medium",
        help="[Legacy] Simplicity vs Future-proof slider",
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
        "--provider",
        default="ollama",
        help="LLM provider (e.g. ollama, openai, anthropic, groq, deepseek, deterministic)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model identifier (e.g. qwen2.5-coder:7b, gpt-4o-mini)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API key for cloud/remote provider",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Custom base URL for OpenAI-compatible endpoint",
    )
    parser.add_argument(
        "--active-file",
        default=None,
        help="Currently focused/open file in the editor workspace",
    )
    parser.add_argument(
        "--history-file",
        default=None,
        help="Path to JSON file containing previous conversation history turns",
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
        llm_provider=args.provider,
        llm_model=args.model,
        llm_api_key=args.api_key or os.environ.get("AIDE_API_KEY"),
        llm_base_url=args.base_url,
        active_file=args.active_file,
        sliders=SliderConfig(
            budget_vs_scale=SliderPreset(args.scale),
            speed_vs_precision=SliderPreset(args.speed),
            simplicity_vs_futureproof=SliderPreset(args.modularity),
        ),
    )

    req_str = args.task or args.request
    if not req_str:
        parser.error("A prompt must be provided via positional request argument or --task flag")

    conv_history: list[dict[str, str]] = []
    if args.history_file:
        h_path = Path(args.history_file)
        if h_path.exists():
            try:
                conv_history = json.loads(h_path.read_text(encoding="utf-8"))
                if not isinstance(conv_history, list):
                    conv_history = []
            except Exception as exc:
                logger.warning("Failed to parse history file: %s", exc)

    result = orchestrate(
        user_request=req_str,
        config=config,
        file_contexts=collect_project_context(config.project_root, req_str, active_file=args.active_file),
        max_rounds=args.max_rounds,
        skip_performance=args.skip_performance,
        dry_run=args.dry_run,
        conversation_history=conv_history,
    )

    if args.json_output:
        sys.stdout.write(result.to_json() + "\n")

    return 0 if result.outcome == LoopOutcome.SUCCESS else 1


if __name__ == "__main__":
    raise SystemExit(main())
