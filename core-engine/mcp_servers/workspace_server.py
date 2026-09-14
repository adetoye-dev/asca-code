"""workspace_server.py - Built-in ACSA Workspace MCP server (stdio, stdlib only).

A reference Model Context Protocol server that exposes read-only workspace
tools to any MCP-compatible client. Ships with ACSA Code so the marketplace
works offline and demonstrates full protocol compatibility.

Tools: list_files, read_file, search_code
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("ACSA_MCP_ROOT") or os.getcwd()).resolve()

IGNORED_DIRS = {
    ".git", "node_modules", "dist", "build", "__pycache__", ".acsa",
    ".mypy_cache", ".ruff_cache", ".pytest_cache", ".venv", ".tauri",
}
TEXT_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html",
    ".yml", ".yaml", ".toml", ".sh", ".rs", ".go", ".java", ".sql",
}

TOOLS = [
    {
        "name": "list_files",
        "description": "List workspace files, optionally filtered by a glob or substring.",
        "inputSchema": {
            "type": "object",
            "properties": {"pattern": {"type": "string", "description": "Substring or glob filter"}},
        },
    },
    {
        "name": "read_file",
        "description": "Read a UTF-8 text file from the workspace by relative path.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "max_bytes": {"type": "integer"}},
            "required": ["path"],
        },
    },
    {
        "name": "search_code",
        "description": "Search workspace source files for a substring (case-insensitive).",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "max_results": {"type": "integer"}},
            "required": ["query"],
        },
    },
]


def _safe_path(relative: str) -> Path:
    candidate = (ROOT / relative).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        raise ValueError("path escapes the workspace root")
    return candidate


def tool_list_files(arguments: dict) -> str:
    pattern = str(arguments.get("pattern", "")).lower().strip()
    results = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
        for name in filenames:
            rel = str(Path(dirpath, name).relative_to(ROOT))
            if pattern and pattern not in rel.lower():
                continue
            results.append(rel)
            if len(results) >= 200:
                break
        if len(results) >= 200:
            break
    return "\n".join(sorted(results)) or "(no files matched)"


def tool_read_file(arguments: dict) -> str:
    rel = str(arguments.get("path", "")).strip()
    if not rel:
        raise ValueError("path is required")
    target = _safe_path(rel)
    if not target.exists() or not target.is_file():
        raise ValueError(f"file not found: {rel}")
    limit = int(arguments.get("max_bytes") or 200_000)
    return target.read_text(encoding="utf-8", errors="replace")[:limit]


def tool_search_code(arguments: dict) -> str:
    query = str(arguments.get("query", "")).strip().lower()
    if not query:
        raise ValueError("query is required")
    limit = int(arguments.get("max_results") or 40)
    hits = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
        for name in filenames:
            path = Path(dirpath, name)
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for lineno, line in enumerate(text.splitlines(), start=1):
                if query in line.lower():
                    hits.append(f"{path.relative_to(ROOT)}:{lineno}: {line.strip()[:160]}")
                    if len(hits) >= limit:
                        return "\n".join(hits)
    return "\n".join(hits) or "(no matches)"


HANDLERS = {
    "list_files": tool_list_files,
    "read_file": tool_read_file,
    "search_code": tool_search_code,
}


def _reply(message_id, result=None, error=None) -> None:
    payload = {"jsonrpc": "2.0", "id": message_id}
    if error is not None:
        payload["error"] = {"code": -32603, "message": str(error)}
    else:
        payload["result"] = result
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method = message.get("method")
        message_id = message.get("id")

        if method == "notifications/initialized":
            continue
        if method == "initialize":
            _reply(message_id, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "acsa-workspace", "version": "1.0.0"},
            })
        elif method == "tools/list":
            _reply(message_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = message.get("params", {})
            name = params.get("name")
            handler = HANDLERS.get(name)
            if handler is None:
                _reply(message_id, error=f"unknown tool: {name}")
                continue
            try:
                text = handler(params.get("arguments") or {})
                _reply(message_id, {"content": [{"type": "text", "text": text}], "isError": False})
            except Exception as exc:  # noqa: BLE001
                _reply(message_id, {"content": [{"type": "text", "text": str(exc)}], "isError": True})
        else:
            if message_id is not None:
                _reply(message_id, error=f"method not found: {method}")


if __name__ == "__main__":
    main()
