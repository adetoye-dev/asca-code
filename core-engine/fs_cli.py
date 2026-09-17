#!/usr/bin/env python3
"""fs_cli.py — workspace search and replace.

The Search view assumed a Vite dev server was serving `/api/fs/*`. In a packaged
build nothing answered, so workspace search — and every replace built on it —
silently returned nothing. This is the same feature on the engine, which is
reachable from both builds.

    acsa-engine fs search  '{"projectRoot": "...", "query": "TODO"}'
    acsa-engine fs replace '{"projectRoot": "...", "query": "foo", "replaceText": "bar"}'
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

# Directories and files that are never searched: VCS metadata, dependency trees,
# caches, and the index the app writes itself.
IGNORED_NAMES = {
    ".git",
    ".DS_Store",
    "node_modules",
    "__pycache__",
    ".acsa",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".eslintcache",
    "context-index.json",
    ".context-index.json",
    "context_index.json",
    ".context-index",
    ".context_index",
    "Thumbs.db",
    "dist",
    "build",
    ".venv",
    "venv",
    "target",
}

IGNORED_SUFFIXES = (".pyc", ".pyo", ".bak", ".orig")

BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".avif",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".pdf", ".mp4", ".webm", ".mov", ".mp3", ".wav",
    ".bin", ".exe", ".dylib", ".so", ".dll", ".class", ".pyc",
}


def _is_ignored(name: str) -> bool:
    if name in IGNORED_NAMES:
        return True
    return name.lower().endswith(IGNORED_SUFFIXES)


def _is_binary(path: Path) -> bool:
    if path.suffix.lower() in BINARY_EXTENSIONS:
        return True
    try:
        with path.open("rb") as handle:
            return b"\x00" in handle.read(512)
    except OSError:
        return True


def _project_files(root: Path) -> Iterable[Path]:
    for current, dirnames, filenames in os.walk(root):
        # Pruning in place is what keeps this from descending into node_modules.
        dirnames[:] = [d for d in dirnames if not _is_ignored(d)]
        for name in filenames:
            if _is_ignored(name):
                continue
            path = Path(current) / name
            if not _is_binary(path):
                yield path


def _resolve_root(raw: str) -> Path | None:
    if not raw or not raw.strip():
        return None
    root = Path(raw).expanduser()
    if not root.is_dir():
        return None
    return root.resolve()


def _matches_glob(relative: str, patterns: list[str]) -> bool:
    if not patterns:
        return False
    lowered = relative.lower()
    filename = Path(relative).name.lower()
    for raw in patterns:
        pattern = raw.strip().lower()
        if not pattern:
            continue
        if pattern.startswith("*."):
            if filename.endswith(pattern[1:]):
                return True
        elif pattern in lowered or pattern in filename:
            return True
    return False


def _build_regex(query: str, match_case: bool, match_whole_word: bool, use_regex: bool):
    pattern = query if use_regex else re.escape(query)
    if match_whole_word:
        pattern = rf"\b{pattern}\b"
    flags = 0 if match_case else re.IGNORECASE
    return re.compile(pattern, flags)


def _preserve_case(original: str, replacement: str) -> str:
    if not original or not replacement:
        return replacement
    if original == original.upper():
        return replacement.upper()
    if original == original.lower():
        return replacement.lower()
    if original[0] == original[0].upper():
        return replacement[0].upper() + replacement[1:]
    return replacement


def _split_patterns(raw: Any) -> list[str]:
    if not isinstance(raw, str) or not raw.strip():
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def search(payload: dict[str, Any]) -> dict[str, Any]:
    root = _resolve_root(str(payload.get("projectRoot") or ""))
    query = payload.get("query")
    if root is None or not isinstance(query, str) or not query:
        return {"success": True, "results": [], "totalMatches": 0, "totalFiles": 0, "capped": False}

    try:
        regex = _build_regex(
            query,
            bool(payload.get("matchCase")),
            bool(payload.get("matchWholeWord")),
            bool(payload.get("useRegex")),
        )
    except re.error as exc:
        return {"error": f"Invalid regex pattern: {exc}"}

    include = _split_patterns(payload.get("includePattern"))
    exclude = _split_patterns(payload.get("excludePattern"))
    max_results = int(payload.get("maxResults") or 1000)

    results: list[dict[str, Any]] = []
    total_matches = 0
    for path in _project_files(root):
        try:
            relative = str(path.relative_to(root))
        except ValueError:
            continue
        if include and not _matches_glob(relative, include):
            continue
        if exclude and _matches_glob(relative, exclude):
            continue

        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        file_matches: list[dict[str, Any]] = []
        for index, line in enumerate(content.splitlines(), start=1):
            for match in regex.finditer(line):
                file_matches.append(
                    {
                        "lineNumber": index,
                        "column": match.start() + 1,
                        "lineContent": line,
                        "matchStart": match.start(),
                        "matchLength": len(match.group(0)),
                    }
                )
                total_matches += 1
                if total_matches >= max_results:
                    break
            if total_matches >= max_results:
                break

        if file_matches:
            results.append(
                {
                    "filePath": str(path),
                    "fileName": path.name,
                    "relativeDir": "" if str(path.parent) == str(root) else str(path.parent.relative_to(root)),
                    "relativeFilePath": relative,
                    "matches": file_matches,
                }
            )
        if total_matches >= max_results:
            break

    return {
        "success": True,
        "results": results,
        "totalMatches": total_matches,
        "totalFiles": len(results),
        "capped": total_matches >= max_results,
    }


def replace(payload: dict[str, Any]) -> dict[str, Any]:
    root = _resolve_root(str(payload.get("projectRoot") or ""))
    query = payload.get("query")
    if root is None or not isinstance(query, str) or not query:
        return {"success": True, "updatedFiles": [], "totalReplaced": 0}

    try:
        regex = _build_regex(
            query,
            bool(payload.get("matchCase")),
            bool(payload.get("matchWholeWord")),
            bool(payload.get("useRegex")),
        )
    except re.error as exc:
        return {"error": f"Invalid regex pattern: {exc}"}

    replacement = str(payload.get("replaceText") or "")
    preserve_case = bool(payload.get("preserveCase"))
    line_numbers = payload.get("lineNumbers")
    wanted_lines = {int(n) for n in line_numbers} if isinstance(line_numbers, list) else None

    targets: list[Path]
    file_path = payload.get("filePath")
    if isinstance(file_path, str) and file_path.strip():
        candidate = Path(file_path)
        resolved = (root / candidate) if not candidate.is_absolute() else candidate
        try:
            resolved = resolved.resolve()
            resolved.relative_to(root)
        except (OSError, ValueError):
            return {"error": "Refusing to edit a file outside the project."}
        targets = [resolved]
    else:
        targets = list(_project_files(root))

    updated: list[dict[str, Any]] = []
    total_replaced = 0
    for path in targets:
        if not path.is_file() or _is_binary(path):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        separator = "\r\n" if "\r\n" in content else "\n"
        lines = re.split(r"\r?\n", content)
        file_replaced = 0
        new_lines: list[str] = []
        for index, line in enumerate(lines, start=1):
            if wanted_lines is not None and index not in wanted_lines:
                new_lines.append(line)
                continue

            def substitute(match: re.Match[str]) -> str:
                nonlocal file_replaced, total_replaced
                file_replaced += 1
                total_replaced += 1
                if preserve_case:
                    return _preserve_case(match.group(0), replacement)
                return replacement

            new_lines.append(regex.sub(substitute, line))

        if file_replaced:
            new_content = separator.join(new_lines)
            try:
                path.write_text(new_content, encoding="utf-8")
            except OSError:
                continue
            updated.append({"filePath": str(path), "newContent": new_content, "count": file_replaced})

    return {"success": True, "updatedFiles": updated, "totalReplaced": total_replaced}


COMMANDS = {"search": search, "replace": replace}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: fs_cli.py <{'|'.join(sorted(COMMANDS))}> [json]"}))
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
