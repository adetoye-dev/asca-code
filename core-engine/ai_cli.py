#!/usr/bin/env python3
"""ai_cli.py — provider connectivity, verified server-side.

Why this exists: `/api/ai/test-connection` was a ~250-line pile of per-vendor
branches in `vite-fs-bridge.ts`, a Vite dev-server middleware. In the packaged app
"Test Connection" therefore always failed, in both Settings and the AI dashboard —
and the failure looked like a bad key rather than a missing backend.

The credential never leaves the machine: it is resolved here, server-side, from the
provider registry (env first, then the database), exactly as the engine resolves it
for real requests. The page only learns whether the provider answered.

Usage: python3 ai_cli.py test-connection '{"provider": "deepseek"}'
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

# Vendors that speak the OpenAI wire format (`GET /models`, bearer token).
OPENAI_COMPATIBLE = {
    "openai",
    "deepseek",
    "groq",
    "mistral",
    "moonshot",
    "together",
    "openrouter",
    "xai",
    "perplexity",
    "huggingface",
}

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "moonshot": "https://api.moonshot.cn/v1",
    "together": "https://api.together.xyz/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "xai": "https://api.x.ai/v1",
    "perplexity": "https://api.perplexity.ai",
    "huggingface": "https://api-inference.huggingface.co/v1",
    "anthropic": "https://api.anthropic.com",
    "google": "https://generativelanguage.googleapis.com",
    "ollama": "http://127.0.0.1:11434",
}


def _resolve_key(provider: str, explicit: str) -> str:
    """Explicit value first, then the registry (environment, then database)."""
    if explicit.strip():
        return explicit.strip()
    try:
        import db_cli

        resolved = db_cli._cmd_providers_resolve_key({"id": provider})
        return (resolved or "").strip()
    except Exception:  # noqa: BLE001 - no key is a valid answer, not a crash
        return ""


def _get(url: str, headers: dict[str, str], timeout: float = 12.0):
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            body = json.loads(exc.read().decode("utf-8", "replace"))
            detail = (body.get("error") or {}).get("message") or body.get("message") or ""
        except Exception:  # noqa: BLE001 - the status code is the useful part
            detail = ""
        return exc.code, {"error": detail}
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return 0, {"error": str(exc)}


def _names(payload: dict) -> list[str]:
    """OpenAI-shaped `{"data": [{"id": ...}]}` or Gemini's `{"models": [...]}`."""
    entries = payload.get("data") or payload.get("models") or []
    names: list[str] = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("id") or entry.get("name") or entry.get("model")
        # Gemini reports `models/gemini-2.0-flash`.
        if isinstance(name, str) and name:
            names.append(name.split("/", 1)[-1])
    return names


def test_connection(payload: dict) -> dict:
    provider = str(payload.get("provider") or "").strip()
    base_url = str(payload.get("baseUrl") or DEFAULT_BASE_URLS.get(provider, "")).rstrip("/")
    key = _resolve_key(provider, str(payload.get("apiKey") or ""))

    if provider == "deterministic":
        return {"ok": True, "success": True, "latencyMs": 2, "message": "Deterministic AST compiler ready"}

    if provider == "ollama":
        started = time.monotonic()
        status, body = _get(f"{base_url or DEFAULT_BASE_URLS['ollama']}/api/tags", {})
        latency = int((time.monotonic() - started) * 1000)
        if status != 200:
            return {
                "ok": False,
                "success": False,
                "latencyMs": latency,
                "error": body.get("error") or "Ollama is not reachable on 127.0.0.1:11434.",
            }
        return {
            "ok": True,
            "success": True,
            "latencyMs": latency,
            "models": [m.get("name") for m in body.get("models", []) if m.get("name")],
        }

    if not key:
        return {"ok": False, "success": False, "latencyMs": 0, "error": "API Key is required"}

    started = time.monotonic()
    if provider in OPENAI_COMPATIBLE:
        status, body = _get(
            f"{base_url}/models",
            {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
    elif provider == "anthropic":
        status, body = _get(
            f"{base_url}/v1/models",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
    elif provider == "google":
        status, body = _get(f"{base_url}/v1beta/models?key={key}", {})
    else:
        status, body = _get(f"{base_url}/models", {"Authorization": f"Bearer {key}"})

    latency = int((time.monotonic() - started) * 1000)
    if status != 200:
        return {
            "ok": False,
            "success": False,
            "latencyMs": latency,
            "error": body.get("error") or f"Provider returned HTTP {status or 'unreachable'}",
        }

    models = _names(body)
    return {
        "ok": True,
        "success": True,
        "latencyMs": latency,
        "models": models,
        "message": f"Connection verified — {len(models)} models available." if models else "Connection verified!",
    }


def _post_json(url: str, headers: dict[str, str], body: dict, timeout: float):
    request = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        return exc.code, {"error": f"HTTP {exc.code}"}
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return 0, {"error": str(exc)}


# The review prompt is the behaviour, so it is ported verbatim: strict JSON, real
# line numbers from the gutter, and a hard cap on how much of a big file is sent.
REVIEW_SYSTEM_PROMPT = (
    "You are a meticulous senior code reviewer. Analyse the provided file and report concrete issues: bugs, logic errors, edge cases, security problems, and worthwhile refactors. "
    'Respond with ONLY a JSON object whose top-level key is exactly "issues": {"issues":[{"line":<number>,"severity":"error|warning|info","title":"<short>","detail":"<why>","suggestion":"<concrete fix>"}]}. '
    'Example of the exact shape expected (illustrative only): {"issues":[{"line":42,"severity":"warning","title":"Missing null check","detail":"provider can be undefined here","suggestion":"Guard with if (!provider) return;"}]}. '
    "The file is given with its real line numbers in a left gutter formatted 'NNNN| code'. Set `line` to the exact number shown in that gutter for the code you are describing. "
    "Never invent line numbers and never cite a line that is not shown. Different findings normally sit on different lines; only repeat a line when two findings genuinely concern that one line. "
    'Report at most 12 issues, most important first. If the file is clean, return {"issues":[]}. No prose, no markdown fences.'
)

REVIEW_CHAR_BUDGET = 12000


def _number_lines(content: str) -> tuple[str, int, int, int]:
    """Number the lines the model is allowed to cite, within a character budget."""
    lines = content.split("\n")
    numbered: list[str] = []
    used = 0
    first = last = 1
    for index, line in enumerate(lines, start=1):
        entry = f"{index:4d}| {line}"
        if numbered and used + len(entry) + 1 > REVIEW_CHAR_BUDGET:
            break
        if not numbered:
            first = index
        numbered.append(entry)
        used += len(entry) + 1
        last = index
    return "\n".join(numbered), first, last, len(lines)


def _extract_issues(raw: str) -> list[dict]:
    """Pull the findings out of a model reply, tolerating fences and stray prose."""
    candidate = raw.strip()
    if candidate.startswith("```"):
        candidate = candidate.split("```", 2)[1] if candidate.count("```") >= 2 else candidate
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else candidate
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        parsed = json.loads(candidate[start : end + 1])
    except ValueError:
        return []
    issues = parsed.get("issues") if isinstance(parsed, dict) else None
    if not isinstance(issues, list):
        return []
    cleaned = []
    for issue in issues[:12]:
        if not isinstance(issue, dict):
            continue
        try:
            line = int(issue.get("line"))
        except (TypeError, ValueError):
            continue
        cleaned.append(
            {
                "line": line,
                "severity": str(issue.get("severity") or "info"),
                "title": str(issue.get("title") or "Finding"),
                "detail": str(issue.get("detail") or ""),
                "suggestion": str(issue.get("suggestion") or ""),
            }
        )
    return cleaned


def _review_completion(
    provider: str, model: str, base_url: str, api_key: str, system: str, user: str
) -> tuple[bool, str, str]:
    """One non-streaming completion. Returns (ok, text, error)."""
    timeout = 180.0
    if provider == "ollama":
        status, body = _post_json(
            f"{base_url or DEFAULT_BASE_URLS['ollama']}/api/chat",
            {"Content-Type": "application/json"},
            {
                "model": model or "qwen2.5-coder:7b",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 1600},
            },
            timeout,
        )
        if status != 200:
            return False, "", body.get("error") or f"Ollama request failed ({status})"
        return True, ((body.get("message") or {}).get("content") or "").strip(), ""

    if not api_key:
        return False, "", f"An API key is required for provider '{provider}'."

    if provider == "anthropic":
        status, body = _post_json(
            f"{base_url or DEFAULT_BASE_URLS['anthropic']}/v1/messages",
            {"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
            {
                "model": model or "claude-3-5-sonnet-latest",
                "max_tokens": 1600,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout,
        )
        if status != 200:
            return False, "", body.get("error") or f"Anthropic request failed ({status})"
        content = body.get("content") or [{}]
        return True, (content[0].get("text") or "").strip(), ""

    status, body = _post_json(
        f"{base_url or DEFAULT_BASE_URLS.get(provider, 'https://api.openai.com/v1')}/chat/completions",
        {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        {
            "model": model or "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
        },
        timeout,
    )
    if status != 200:
        return False, "", body.get("error") or f"Provider request failed ({status})"
    choices = body.get("choices") or [{}]
    return True, ((choices[0].get("message") or {}).get("content") or "").strip(), ""


def review_file(payload: dict) -> dict:
    """Review one file and return findings anchored to real line numbers."""
    content = str(payload.get("content") or "")
    if not content.strip():
        return {"ok": False, "error": "File is empty.", "issues": []}

    provider = str(payload.get("provider") or "ollama").strip()
    model = str(payload.get("model") or "").strip()
    base_url = str(payload.get("baseUrl") or "").rstrip("/")
    api_key = _resolve_key(provider, str(payload.get("apiKey") or ""))

    numbered, first_line, last_line, total_lines = _number_lines(content)
    language = str(payload.get("language") or "")
    excerpt = (
        f"Only lines {first_line}-{last_line} of {total_lines} are shown (the file was truncated). Report issues only within that range."
        if last_line < total_lines
        else f"The whole file ({total_lines} lines) is shown."
    )
    user_prompt = (
        f"File: {payload.get('path') or ''}{f' ({language})' if language else ''}\n"
        f"{excerpt}\n\n{numbered}\n\nReturn the JSON review object."
    )

    started = time.monotonic()
    ok, raw, error = _review_completion(provider, model, base_url, api_key, REVIEW_SYSTEM_PROMPT, user_prompt)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    if not ok:
        return {"ok": False, "error": error, "issues": []}

    # A citation outside the excerpt cannot have been seen, and repeats would stack
    # two threads on one line — the same guards the dev bridge applied.
    visible = set(range(first_line, last_line + 1))
    seen: set[str] = set()
    issues = []
    for issue in _extract_issues(raw):
        key = f"{issue['line']}|{issue['title']}"
        if issue["line"] not in visible or key in seen:
            continue
        seen.add(key)
        issues.append(issue)

    # `usage.record` is best-effort: metrics must never break the review itself.
    try:
        import db_cli

        db_cli._cmd_usage_record(
            {
                "provider": provider,
                "model": model or provider,
                "prompt_tokens": round((len(REVIEW_SYSTEM_PROMPT) + len(user_prompt)) / 4),
                "completion_tokens": round(len(raw) / 4),
                "latency_ms": elapsed_ms,
            }
        )
    except Exception:  # noqa: BLE001 - see above
        pass

    return {
        "ok": True,
        "model": model,
        "provider": provider,
        "note": "",
        "warning": ""
        if issues or '"issues"' in raw
        else "The model returned a response that could not be parsed as review findings.",
        "issues": issues,
    }


INLINE_SYSTEM_PROMPT = (
    "You are an expert code editing assistant. Given existing code and instructions, return ONLY the updated replacement code. "
    "Do not include conversational commentary, explanations, or markdown code fences."
)


def _sanitize_inline_replacement(replacement: str, selected: str, prefix: str, suffix: str) -> dict:
    """Reduce a model reply to just the edited code, or explain why it cannot be.

    Ported because it is what makes the feature safe to apply: models routinely wrap
    output in fences, echo the context back, or answer a small edit with a whole
    rewritten file.
    """
    selected = (selected or "").replace("\r\n", "\n")
    replacement = (replacement or "").replace("\r\n", "\n").strip()

    # 1. Unwrap a fenced block, discarding prose around it.
    fenced = re.search(r"```[a-zA-Z0-9_+-]*\n([\s\S]*?)```", replacement)
    if fenced:
        replacement = fenced.group(1).strip()
    else:
        replacement = re.sub(r"^```[a-zA-Z0-9_+-]*\n?", "", replacement)
        replacement = re.sub(r"\n?```\s*$", "", replacement).strip()

    # 2. If the model echoed the surrounding context, keep only the edited region.
    prefix_tail = (prefix or "").replace("\r\n", "\n")[-160:].strip()
    if len(prefix_tail) >= 60:
        at = replacement.find(prefix_tail)
        if at > 0:
            replacement = re.sub(r"^\n+", "", replacement[at + len(prefix_tail) :])
    suffix_head = (suffix or "").replace("\r\n", "\n")[:160].strip()
    if len(suffix_head) >= 60:
        at = replacement.find(suffix_head)
        if at >= 0:
            replacement = re.sub(r"\n+$", "", replacement[:at])
    replacement = replacement.strip()

    if not replacement:
        return {"replacement": "", "reason": "the model returned no usable code"}

    # 3. Refuse implausible growth: the edit was requested for a small range, so a
    #    much larger answer is a rewritten file, not an edit.
    selected_lines = max(1, len(selected.split("\n")))
    produced_lines = len(replacement.split("\n"))
    if produced_lines > max(selected_lines * 3, selected_lines + 60):
        return {
            "replacement": "",
            "reason": f"the model returned {produced_lines} lines for a {selected_lines}-line edit, so it was not applied",
        }

    # 4. Trim a trailing explanation block the model added after the code.
    prose_tail = re.search(
        r"\n\s*\n\s*(?:Explanation|Note|This|The (?:code|change|edit|fix)|Changes?:)[\s\S]{40,}$",
        replacement,
        re.IGNORECASE,
    )
    if prose_tail:
        trimmed = replacement[: prose_tail.start()].rstrip()
        if trimmed and len(trimmed.split("\n")) >= max(1, selected_lines - 5):
            replacement = trimmed

    return {"replacement": replacement, "reason": ""}


def inline_edit(payload: dict) -> dict:
    """Rewrite the selected code and return only the replacement."""
    provider = str(payload.get("provider") or "ollama").strip()
    model = str(payload.get("model") or "").strip()
    api_key = _resolve_key(provider, str(payload.get("apiKey") or ""))
    selected = str(payload.get("selectedCode") or "")
    prefix = str(payload.get("surroundingPrefix") or "")
    suffix = str(payload.get("surroundingSuffix") or "")

    user_prompt = (
        f"Context before:\n{prefix[-600:]}\n\n"
        f"Code to edit:\n{selected}\n\n"
        f"Context after:\n{suffix[:600]}\n\n"
        f"Instruction: {payload.get('instruction') or ''}\n\nEmit updated code:"
    )

    ok, raw, error = _review_completion(
        provider,
        model,
        str(payload.get("baseUrl") or "").rstrip("/"),
        api_key,
        INLINE_SYSTEM_PROMPT,
        user_prompt,
    )
    if not ok:
        return {"ok": False, "error": error, "replacement": ""}
    if not raw:
        return {"ok": False, "error": "The provider returned an empty replacement.", "replacement": ""}

    cleaned = _sanitize_inline_replacement(raw, selected, prefix, suffix)
    if not cleaned["replacement"]:
        return {"ok": False, "reason": cleaned["reason"], "replacement": ""}
    return {"ok": True, "replacement": cleaned["replacement"], "reason": cleaned["reason"]}


COMMANDS = {
    "test-connection": test_connection,
    "review-file": review_file,
    "inline-edit": inline_edit,
}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: ai_cli.py <{'|'.join(COMMANDS)}> [json]"}))
        return 2

    handler = COMMANDS.get(argv[1])
    if handler is None:
        print(json.dumps({"ok": False, "error": f"unknown command: {argv[1]}"}))
        return 2

    try:
        raw = argv[2] if len(argv) > 2 else (sys.stdin.read() or "{}")
        payload = json.loads(raw or "{}")
        print(json.dumps({"ok": True, "data": handler(payload)}))
        return 0
    except Exception as exc:  # noqa: BLE001 - the CLI reports, it does not raise
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv))
