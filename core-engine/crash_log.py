"""crash_log.py — where a crash goes when nothing is watching.

This app sends no telemetry and never will (see the production checklist), so
"crash reporting" here means the honest local version: write a bounded, redacted
record to the data directory, and let the user attach it to a bug report
themselves. That makes support possible without making surveillance possible.

Two rules keep it useful rather than dangerous:

* **Redacted on the way in.** A stack trace or an error message can carry a URL
  with a token in it, and a render error can quote the props it choked on. The
  same shape the runtime-facing redactor uses is applied here before anything is
  written, so a credential never reaches the file in the first place.
* **Bounded.** The last `MAX_RECORDS` entries are kept and the rest dropped. A
  crash loop must not fill a disk.

Reached as `acsa-engine crash append '<json>'`, `crash list`, `crash path`.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import app_db

LOG_NAME = "crashes.log"
MAX_RECORDS = 200

# A value is only masked when a strong separator follows the key. A plain space
# is not one, so prose like "reading token counts" survives intact.
_STRONG = (":", "=", '"', "'")
# Longest first, so `client_secret` wins over `secret`.
_SECRET_KEYS = (
    "acsa_codex_api_key",
    "acsa_secret_",
    "client_secret",
    "private_key",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "api-key",
    "apikey",
    "password",
    "passwd",
    "env_key",
    "secret",
    "bearer",
    "token",
)
MIN_SECRET_LEN = 6
MASK = "***"


# Values recognisable by shape, wherever they appear — a key quoted into a
# props dump has no key *name* next to it to give it away.
_SECRET_PREFIXES = (
    "sk_live_",
    "sk_test_",
    "sk-proj-",
    "sk-",
    "ghp_",
    "gho_",
    "github_pat_",
    "xoxb-",
    "xoxp-",
    "AKIA",
    "AIza",
)


def _is_boundary(text: str, index: int) -> bool:
    """Not preceded by a letter or digit.

    Without this, `task-runner.ts` reads as an `sk-` key and gets a hole punched
    through the middle of a filename — which is exactly the kind of false
    positive that makes a redactor untrustworthy.
    """
    if index == 0:
        return True
    return not text[index - 1].isalnum()


def _value_run_end(text: str, start: int) -> int:
    j = start
    while j < len(text) and text[j] not in _STRONG and not text[j].isspace() and text[j] not in ",}]":
        j += 1
    return j


def _mask_after_key(text: str, i: int, key: str):
    """Mask the value introduced by a key, or report that there is none."""
    end = i + len(key)
    j = end
    separated = False
    while j < len(text) and text[j] in _STRONG:
        separated = True
        j += 1
    # `Bearer <token>` is separated by the space, and only by that.
    if key == "bearer" and j < len(text) and text[j].isspace():
        separated = True
        j += 1
    while separated and j < len(text) and text[j] == " ":
        j += 1
    if not separated:
        return None, end

    start = j
    j = _value_run_end(text, start)

    # `Authorization: Bearer <token>` — the scheme is not the credential, and
    # masking it would hide *what kind* of credential leaked.
    if text[start:j].lower() in ("bearer", "basic"):
        k = j
        while k < len(text) and text[k].isspace():
            k += 1
        token_start = k
        k = _value_run_end(text, token_start)
        if k - token_start >= MIN_SECRET_LEN:
            return text[i:start] + text[start:j] + text[j:token_start] + MASK, k
        return None, end

    if j - start >= MIN_SECRET_LEN:
        return text[i:start] + MASK, j
    return None, end


def redact(text: str) -> str:
    """Mask credential-shaped text. Mirrors the Rust redactor, plus prefixes.

    Two ways in: a key we know by name followed by a value, and a value we know
    by shape wherever it sits. A bare token with neither is left alone, which is
    the honest limit — guessing by entropy would eat commit hashes.
    """
    lowered = text.lower()
    out: list[str] = []
    i = 0
    while i < len(text):
        key = next((k for k in _SECRET_KEYS if lowered.startswith(k, i)), None)
        if key is not None:
            masked, nxt = _mask_after_key(text, i, key)
            if masked is not None:
                out.append(masked)
                i = nxt
                continue
            out.append(text[i : i + len(key)])
            i += len(key)
            continue

        prefix = next(
            (p for p in _SECRET_PREFIXES if text.startswith(p, i) and _is_boundary(text, i)),
            None,
        )
        if prefix is not None:
            j = _value_run_end(text, i)
            if j - i >= MIN_SECRET_LEN:
                out.append(MASK)
                i = j
                continue

        out.append(text[i])
        i += 1
    return "".join(out)


def log_path() -> Path:
    return app_db.data_dir() / LOG_NAME


def _clean(value: Any, depth: int = 0) -> Any:
    """Redact a value structure, keeping the shape and dropping the bulk."""
    if depth > 6:
        return "<deep>"
    if isinstance(value, str):
        return redact(value[:2000])
    if isinstance(value, dict):
        return {str(k)[:80]: _clean(v, depth + 1) for k, v in list(value.items())[:40]}
    if isinstance(value, (list, tuple)):
        return [_clean(v, depth + 1) for v in list(value)[:40]]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return redact(str(value)[:400])


def rotate(records: int) -> None:
    """Keep the newest `MAX_RECORDS` entries."""
    if records <= MAX_RECORDS:
        return
    path = log_path()
    try:
        lines = path.read_text(errors="replace").splitlines()
        path.write_text("\n".join(lines[-MAX_RECORDS:]) + "\n")
    except OSError:
        pass


def record(payload: dict) -> dict:
    """Append one crash. Returns the entry as written."""
    entry = {
        "ts": time.time(),
        "app": os.environ.get("ACSA_APP_VERSION", ""),
        **_clean(payload),
    }
    path = log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    try:
        with path.open() as handle:
            record_count = sum(1 for _ in handle)
    except OSError:
        record_count = 0
    rotate(record_count)
    return entry


def read(limit: int = 20) -> list:
    """The most recent crashes, newest last."""
    path = log_path()
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(errors="replace").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out[-limit:]


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    action = args[0] if args else "list"

    if action == "append":
        if len(args) < 2:
            print(json.dumps({"ok": False, "error": "crash append needs a JSON payload"}))
            return 2
        try:
            payload = json.loads(args[1])
        except json.JSONDecodeError as exc:
            print(json.dumps({"ok": False, "error": f"payload is not JSON: {exc}"}))
            return 2
        entry = record(payload if isinstance(payload, dict) else {"message": payload})
        print(json.dumps({"ok": True, "data": {"ts": entry["ts"], "path": str(log_path())}}))
        return 0

    if action == "list":
        limit = 20
        if "--limit" in args:
            try:
                limit = int(args[args.index("--limit") + 1])
            except (IndexError, ValueError):
                pass
        print(json.dumps({"ok": True, "data": {"path": str(log_path()), "entries": read(limit)}}))
        return 0

    if action == "path":
        print(json.dumps({"ok": True, "data": {"path": str(log_path())}}))
        return 0

    print(json.dumps({"ok": False, "error": f"unknown crash action: {action}"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
