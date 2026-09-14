"""Usage & cost ledger for LLM calls.

The engine runs as a short-lived subprocess for every request, so metrics are
appended to ``.acsa/usage.jsonl`` in the project root (one JSON object per
call) and can be aggregated by the UI. Local models are recorded at $0.00.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Optional

# Approximate USD per 1M tokens: (input, output). Local providers are free.
_PRICING: dict[str, tuple[float, float]] = {
    "openai": (2.50, 10.00),
    "anthropic": (3.00, 15.00),
    "google": (1.25, 5.00),
    "groq": (0.79, 0.79),
    "deepseek": (0.27, 1.10),
    "mistral": (0.20, 0.60),
    "moonshot": (0.60, 0.60),
    "xai": (2.00, 8.00),
    "together": (0.88, 0.88),
    "perplexity": (1.00, 1.00),
    "openrouter": (1.00, 3.00),
}


def estimate_cost_usd(
    provider: Optional[str], prompt_tokens: int, completion_tokens: int
) -> float:
    """Return an estimated cost in USD. Local/unknown providers are $0."""
    price = _PRICING.get((provider or "").lower())
    if not price:
        return 0.0
    return (prompt_tokens / 1_000_000) * price[0] + (
        completion_tokens / 1_000_000
    ) * price[1]


def record_usage(
    project_root: Optional[str],
    provider: Optional[str],
    model: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    latency_ms: float,
) -> None:
    """Append one call to the project's usage ledger."""
    if not project_root:
        return
    try:
        root = Path(project_root)
        if not root.exists():
            return
        entry = {
            "ts": time.time(),
            "provider": provider or "unknown",
            "model": model or "unknown",
            "prompt_tokens": int(prompt_tokens or 0),
            "completion_tokens": int(completion_tokens or 0),
            "latency_ms": round(float(latency_ms or 0.0), 1),
            "cost_usd": round(
                estimate_cost_usd(provider, prompt_tokens, completion_tokens), 6
            ),
        }
        path = root / ".acsa" / "usage.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except Exception:
        pass


def load_usage(project_root: str) -> list[dict[str, Any]]:
    """Return all recorded usage rows (newest first)."""
    path = Path(project_root) / ".acsa" / "usage.jsonl"
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    except OSError:
        return []
    rows.reverse()
    return rows


def summarize_usage(project_root: str) -> dict[str, Any]:
    """Aggregate the ledger into totals plus recent rows."""
    rows = load_usage(project_root)
    total_calls = len(rows)
    prompt_tokens = sum(r.get("prompt_tokens", 0) for r in rows)
    completion_tokens = sum(r.get("completion_tokens", 0) for r in rows)
    cost_usd = round(sum(r.get("cost_usd", 0.0) for r in rows), 6)
    total_latency_ms = round(sum(r.get("latency_ms", 0.0) for r in rows), 1)
    by_model: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = f"{r.get('provider')}/{r.get('model')}"
        bucket = by_model.setdefault(
            key, {"provider": r.get("provider"), "model": r.get("model"),
                  "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                  "cost_usd": 0.0, "latency_ms": 0.0}
        )
        bucket["calls"] += 1
        bucket["prompt_tokens"] += r.get("prompt_tokens", 0)
        bucket["completion_tokens"] += r.get("completion_tokens", 0)
        bucket["cost_usd"] = round(bucket["cost_usd"] + r.get("cost_usd", 0.0), 6)
        bucket["latency_ms"] = round(bucket["latency_ms"] + r.get("latency_ms", 0.0), 1)
    return {
        "total_calls": total_calls,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "cost_usd": cost_usd,
        "total_latency_ms": total_latency_ms,
        "by_model": sorted(by_model.values(), key=lambda b: b["calls"], reverse=True),
        "recent": rows[:20],
    }


def record_llm_call(func: Callable[..., Optional[str]]) -> Callable[..., Optional[str]]:
    """Decorator: record usage for every successful LLM call made through func."""

    def wrapper(*args: Any, **kwargs: Any) -> Optional[str]:
        config = kwargs.get("config") or (args[1] if len(args) > 1 else None)
        prompt = kwargs.get("prompt") or (args[0] if args else "") or ""
        started = time.monotonic()
        result = func(*args, **kwargs)
        if result:
            record_usage(
                project_root=getattr(config, "project_root", None),
                provider=getattr(config, "llm_provider", None),
                model=getattr(config, "llm_model", None),
                prompt_tokens=len(prompt) // 4,
                completion_tokens=len(result) // 4,
                latency_ms=(time.monotonic() - started) * 1000,
            )
        return result

    return wrapper
