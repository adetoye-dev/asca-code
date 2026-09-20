#!/usr/bin/env python3
"""project_cli.py — what the open project needs before it will run.

A scaffolded project ships source and a manifest but no dependencies, so
nothing runs until they are installed. Nothing in the UI said so, and a user who
has never run `npm install` had no way to find out — the terminal was the only
clue, and only if they went looking. This reports the gap and the exact command
that closes it.

    acsa-engine project status '{"projectRoot": "/path/to/project"}'
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Lock file → the package manager it belongs to, most specific first.
_MANAGERS: list[tuple[str, str]] = [
    ("pnpm-lock.yaml", "pnpm"),
    ("bun.lockb", "bun"),
    ("yarn.lock", "yarn"),
    ("package-lock.json", "npm"),
]


def _package_manager(root: Path) -> str:
    for lockfile, manager in _MANAGERS:
        if (root / lockfile).exists():
            return manager
    return "npm"


def _script_command(manager: str, name: str) -> str:
    if manager == "npm":
        return f"npm run {name}"
    if manager == "yarn":
        return f"yarn {name}"
    if manager == "bun":
        return f"bun run {name}"
    return f"{manager} {name}"


def status(payload: dict[str, Any]) -> dict[str, Any]:
    raw_root = str(payload.get("projectRoot") or "").strip()
    root = Path(raw_root).expanduser()
    if not raw_root or not root.is_dir():
        return {
            "projectRoot": str(root),
            "hasPackageJson": False,
            "hasNodeModules": False,
            "needsInstall": False,
            "manager": "npm",
            "installCommand": "",
            "devCommand": "",
            "buildCommand": "",
            "testCommand": "",
            "scripts": {},
        }

    root = root.resolve()
    scripts: dict[str, str] = {}
    has_package_json = (root / "package.json").exists()
    if has_package_json:
        try:
            manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
            if isinstance(manifest.get("scripts"), dict):
                scripts = {
                    str(k): str(v) for k, v in manifest["scripts"].items() if isinstance(v, str)
                }
        except (OSError, ValueError):
            # A malformed manifest still means "there is something to install".
            pass

    has_node_modules = (root / "node_modules").is_dir()
    manager = _package_manager(root)

    def script_command(name: str) -> str:
        return _script_command(manager, name) if name in scripts else ""

    return {
        "projectRoot": str(root),
        "hasPackageJson": has_package_json,
        "hasNodeModules": has_node_modules,
        "needsInstall": has_package_json and not has_node_modules,
        "manager": manager,
        "installCommand": f"{manager} install" if has_package_json else "",
        "devCommand": script_command("dev"),
        "buildCommand": script_command("build"),
        "testCommand": script_command("test"),
        "scripts": scripts,
    }


COMMANDS = {"status": status}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: project_cli.py <{'|'.join(sorted(COMMANDS))}>"}))
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
