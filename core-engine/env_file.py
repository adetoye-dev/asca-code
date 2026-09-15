"""env_file.py — load a `.env` file into the process environment.

Format is the one `.env.example` documents (see the repo root): `KEY=value` per
line, `#` comments, optional surrounding quotes. The development bridge reads the
same file with the same rules, so there is one place to put a machine-local
credential and both halves of the app see it.

Precedence matters: a variable already present in the real environment always
wins, so `FOO=bar python3 manager.py` overrides a `FOO=` line in the file.
"""

from __future__ import annotations

import os
from pathlib import Path

ENV_FILES = ("ACSA_ENV_FILE",)


def _candidate_paths() -> list[Path]:
    paths: list[Path] = []
    explicit = (os.environ.get("ACSA_ENV_FILE") or "").strip()
    if explicit:
        paths.append(Path(explicit).expanduser())
    # The data directory is the durable, non-repo location; the working
    # directory covers developers running from a checkout.
    try:
        from app_db import data_dir

        paths.append(data_dir() / ".env")
    except Exception:
        pass
    paths.append(Path.cwd() / ".env")
    return paths


def parse_env_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key] = value
    return values


def load_env_file() -> list[str]:
    """Load the first `.env` found. Returns the keys it set. Never raises."""
    loaded: list[str] = []
    for path in _candidate_paths():
        try:
            if not path.is_file():
                continue
            values = parse_env_text(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        for key, value in values.items():
            # An explicit environment variable always wins.
            if key not in os.environ or not os.environ.get(key):
                os.environ[key] = value
                loaded.append(key)
        break
    return loaded
