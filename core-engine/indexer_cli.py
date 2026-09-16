#!/usr/bin/env python3
"""indexer_cli.py — the code map and symbol index, for the workbench UI.

Why this exists: `/api/indexer/*` lived in `vite-fs-bridge.ts`, a Vite dev-server
middleware, so in the packaged app the Code Map surface and the structural context
the agent uses were both unavailable — even though the indexer itself is part of
this engine and had already written `.acsa/index.json`.

These are read-mostly reshapes of that file. `sync` delegates to the real indexer
rather than reimplementing it, so there is one indexer, not two.

Usage: python3 indexer_cli.py status '{"projectRoot": "/path/to/repo"}'
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Reverse-edge traversal is bounded so a pathological graph cannot hang the UI.
MAX_TRAVERSAL_DEPTH = 12


def _root(payload: dict) -> str:
    candidate = str(payload.get("projectRoot") or os.getcwd())
    return candidate if Path(candidate).is_dir() else os.getcwd()


def _load(root: str) -> dict | None:
    try:
        return json.loads((Path(root) / ".acsa" / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _build_index(root: str) -> dict | None:
    """Run the engine's own indexer, then read what it wrote."""
    try:
        import project_indexer

        project_indexer.index_entire_project(root)
    except Exception:  # noqa: BLE001 - a missing index is a valid answer
        return None
    return _load(root)


def _load_or_build(root: str) -> dict | None:
    return _load(root) or _build_index(root)


def sync(payload: dict) -> dict:
    root = _root(payload)
    try:
        import project_indexer

        result = project_indexer.index_entire_project(root) or {}
    except Exception as exc:  # noqa: BLE001 - report, do not traceback at the user
        return {"success": False, "error": str(exc)}
    return {
        "success": True,
        "totalSymbols": result.get("total_symbols", 0),
        "profile": result.get("profile"),
        "elapsedMs": result.get("elapsed_ms"),
    }


def status(payload: dict) -> dict:
    data = _load(_root(payload))
    if not data:
        return {"indexed": False, "totalSymbols": 0, "profile": None, "updatedAt": None}
    return {
        "indexed": True,
        "totalSymbols": data.get("total_symbols", 0),
        "profile": data.get("profile"),
        "updatedAt": data.get("updated_at"),
    }


def symbols(payload: dict) -> dict:
    """Symbols for one file, or matching a name substring, or a capped sample."""
    data = _load_or_build(_root(payload))
    if not data:
        return {"symbols": [], "total": 0}

    file_name = str(payload.get("file") or "")
    query = str(payload.get("query") or "").lower()
    matches: list[dict] = []

    entries = data.get("files") or {}
    if file_name and file_name in entries:
        matches = entries[file_name].get("symbols") or []
    elif query:
        for name, symbol_list in (data.get("symbols") or {}).items():
            if query in name.lower():
                matches.extend(symbol_list)
    else:
        for symbol_list in (data.get("symbols") or {}).values():
            matches.extend(symbol_list)
        matches = matches[:100]

    return {"symbols": matches, "total": len(matches)}


def map_view(payload: dict) -> dict:
    """The compact, UI-shaped inventory the Code Map surface renders."""
    data = _load_or_build(_root(payload))
    if not data:
        return {"indexed": False, "error": "No symbol index available"}

    files = [
        {
            "path": path,
            "language": entry.get("language", ""),
            "lines": entry.get("line_count", 0),
            "hash": entry.get("content_hash", ""),
            "symbolCount": len(entry.get("symbols") or []),
            "importSpecifiers": [s for s in (entry.get("imports") or []) if isinstance(s, str)],
        }
        for path, entry in (data.get("files") or {}).items()
    ]

    architecture = data.get("architecture") or {}
    profile = data.get("profile") or {}
    return {
        "indexed": True,
        "updatedAt": data.get("updated_at"),
        "totalSymbols": data.get("total_symbols", 0),
        "totalFiles": len(files),
        "profile": profile or None,
        "architecture": {
            "archetype": profile.get("archetype") or architecture.get("archetype", ""),
            "mode": profile.get("mode") or architecture.get("mode", ""),
            "scaleTier": profile.get("scale_tier", ""),
            "ecosystems": profile.get("ecosystems") or architecture.get("ecosystems", []),
            "entrypoints": architecture.get("entrypoints", []),
            "landmarks": architecture.get("landmarks_summary", {}),
        },
        "files": files,
    }


def _node_file(node_id: str) -> str:
    """`file:a/b.ts` and `a/b.ts::symbol` both belong to `a/b.ts`."""
    if node_id.startswith("file:"):
        return node_id[len("file:") :]
    return node_id.split("::", 1)[0] if "::" in node_id else ""


def blast_radius(payload: dict) -> dict:
    """Files that depend on the given file, transitively.

    Walks the index graph backwards, which is what "who breaks if I change this"
    means. The old implementation asked a single-slot in-memory graph object, so
    it answered for whichever project had been indexed last; reading the graph for
    the file's own root cannot go stale that way.
    """
    data = _load_or_build(_root(payload))
    graph = (data or {}).get("graph") or {}
    target = f"file:{payload.get('filePath') or ''}"

    if target not in {node.get("id") for node in (graph.get("nodes") or [])}:
        return {"invalidatedNodes": [], "invalidatedFilePaths": [], "traversalDepth": 0}

    reverse: dict[str, list[str]] = {}
    for edge in graph.get("edges") or []:
        reverse.setdefault(edge.get("target", ""), []).append(edge.get("source", ""))

    seen = {target}
    frontier = [target]
    depth = 0
    while frontier and depth < MAX_TRAVERSAL_DEPTH:
        nxt: list[str] = []
        for node in frontier:
            for source in reverse.get(node, []):
                if source not in seen:
                    seen.add(source)
                    nxt.append(source)
        if not nxt:
            break
        depth += 1
        frontier = nxt

    invalidated = seen - {target}
    return {
        "invalidatedNodes": sorted(invalidated),
        "invalidatedFilePaths": sorted({_node_file(n) for n in invalidated if _node_file(n)}),
        "traversalDepth": depth,
    }


COMMANDS = {
    "sync": sync,
    "status": status,
    "symbols": symbols,
    "map": map_view,
    "blast-radius": blast_radius,
}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: indexer_cli.py <{'|'.join(COMMANDS)}> [json]"}))
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
