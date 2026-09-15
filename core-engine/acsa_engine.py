#!/usr/bin/env python3
"""acsa_engine.py — one entry point for the whole Python engine.

The app used to shell out to `python3 core-engine/manager.py`, which means an
end user needs a Python interpreter. macOS no longer ships a usable one and
Windows ships none, so the agent simply cannot run on a clean machine. This
module exists so the engine can be frozen into a single self-contained binary:

    acsa-engine manager --task ... --project-root ...
    acsa-engine db settings.get '{}'
    acsa-engine index --project-root ... --json
    acsa-engine pty

It is equally the development entry point (`python3 core-engine/acsa_engine.py
manager …`), so the freeze adds a packaging step rather than a second code path.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path


def _bundle_root() -> Path:
    """Directory holding the engine modules.

    PyInstaller unpacks to `sys._MEIPASS`; running from source it is this file's
    directory. Everything is resolved from here so both cases behave the same.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    return Path(meipass) if meipass else Path(__file__).resolve().parent


def _extend_path() -> Path:
    root = _bundle_root()
    for sub in ("", "gauntlet", "compiler", "data-map", "mcp_servers", "skills"):
        candidate = (root / sub) if sub else root
        if candidate.is_dir() and str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))
    return root


ROOT = _extend_path()

# subcommand -> (module, entry function)
COMMANDS: dict[str, tuple[str, str]] = {
    "manager": ("manager", "main"),
    "db": ("db_cli", "run"),
    "index": ("project_indexer", "main"),
    "pty": ("pty_bridge", "main"),
}


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"usage: acsa-engine <{'|'.join(COMMANDS)}> [args...]",
                }
            )
        )
        return 2

    name, rest = argv[0], argv[1:]
    entry = COMMANDS.get(name)
    if entry is None:
        print(json.dumps({"ok": False, "error": f"unknown command: {name}"}))
        return 2

    module_name, func_name = entry
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:  # noqa: BLE001 - report, do not traceback at the user
        print(json.dumps({"ok": False, "error": f"cannot load {module_name}: {exc}"}))
        return 1

    func = getattr(module, func_name)
    # Each module reads sys.argv; present the subcommand's own arguments.
    sys.argv = [f"acsa-engine {name}", *rest]
    result = func(sys.argv) if func_name == "run" else func()
    return result if isinstance(result, int) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
