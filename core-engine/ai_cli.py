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


COMMANDS = {"test-connection": test_connection}


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
