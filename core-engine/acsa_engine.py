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
    # `pty_bridge.py` lives in the repository's scripts/ directory, not in the
    # engine package. A frozen build has already collected it as a top-level
    # module; running from source needs this path, or `pty` fails to import and
    # the integrated terminal exits with "No module named 'pty_bridge'".
    repo_scripts = root.parent / "scripts"
    if repo_scripts.is_dir() and str(repo_scripts) not in sys.path:
        sys.path.insert(0, str(repo_scripts))
    return root


ROOT = _extend_path()

# subcommand -> (module, entry function)
COMMANDS: dict[str, tuple[str, str]] = {
    "manager": ("manager", "main"),
    "db": ("db_cli", "run"),
    "index": ("project_indexer", "main"),
    "pty": ("pty_bridge", "main"),
}


def _selftest() -> int:
    """Import every entry point and report what failed.

    Each subcommand is reached through `importlib`, so a module that the runtime
    cannot see fails only when that subcommand is used — which is how a missing
    `scripts/` path silently broke the integrated terminal. This makes the whole
    surface checkable in one call, in both source and frozen mode.
    """
    failures: dict[str, str] = {}
    for name, (module_name, _func) in COMMANDS.items():
        try:
            importlib.import_module(module_name)
        except Exception as exc:  # noqa: BLE001 - the report is the point
            failures[name] = f"{type(exc).__name__}: {exc}"
    print(
        json.dumps(
            {
                "ok": not failures,
                "data": {
                    "root": str(ROOT),
                    "frozen": bool(getattr(sys, "_MEIPASS", None)),
                    "checked": sorted(COMMANDS),
                    "failures": failures,
                },
            }
        )
    )
    return 0 if not failures else 1


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"usage: acsa-engine <{'|'.join([*COMMANDS, 'selftest'])}> [args...]",
                }
            )
        )
        return 2

    if argv[0] == "selftest":
        return _selftest()

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
