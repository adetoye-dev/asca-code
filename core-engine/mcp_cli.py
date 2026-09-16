#!/usr/bin/env python3
"""mcp_cli.py — the MCP server registry and its tools.

Why this exists: `/api/mcp/*` lived in `vite-fs-bridge.ts` and only the tool call
delegated to `core-engine/mcp_client.py`; reading and writing `.acsa/mcp.json` was
done in JavaScript. A packaged app therefore had no MCP at all. The registry now
lives here, beside the client that speaks the protocol, and tool calls go through
that same client rather than through a second process.

Usage: python3 mcp_cli.py servers '{"projectRoot": "/path/to/repo"}'
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_TIMEOUT = 30.0


def _root(payload: dict) -> str:
    candidate = str(payload.get("projectRoot") or os.getcwd())
    return candidate if Path(candidate).is_dir() else os.getcwd()


def _config_path(payload: dict) -> Path:
    return Path(_root(payload)) / ".acsa" / "mcp.json"


def _read_servers(payload: dict) -> dict:
    try:
        parsed = json.loads(_config_path(payload).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    servers = parsed.get("servers") if isinstance(parsed, dict) else None
    return servers if isinstance(servers, dict) else {}


def _write_servers(payload: dict, servers: dict) -> None:
    target = _config_path(payload)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"servers": servers}, indent=2), encoding="utf-8")


def servers(payload: dict) -> dict:
    if str(payload.get("action") or "") == "add":
        return add_server(payload)
    return {"ok": True, "servers": _read_servers(payload)}


def add_server(payload: dict) -> dict:
    server_id = str(payload.get("id") or "").strip()
    config = payload.get("config")
    if not server_id or not isinstance(config, dict) or not config.get("command"):
        return {"ok": False, "error": "id and config.command are required"}
    servers_map = _read_servers(payload)
    servers_map[server_id] = config
    _write_servers(payload, servers_map)
    return {"ok": True, "id": server_id}


def remove_server(payload: dict) -> dict:
    server_id = str(payload.get("id") or "").strip()
    servers_map = _read_servers(payload)
    if server_id and server_id in servers_map:
        del servers_map[server_id]
        _write_servers(payload, servers_map)
    return {"ok": True, "id": server_id}


def tools(payload: dict) -> dict:
    """List or call a tool on one server, through the engine's MCP client."""
    import mcp_client

    config = payload.get("config")
    if not isinstance(config, dict):
        config = _read_servers(payload).get(str(payload.get("id") or ""))
    if not isinstance(config, dict) or not config.get("command"):
        return {"ok": False, "error": "Unknown MCP server config", "tools": []}

    client = mcp_client._build_client(config, DEFAULT_TIMEOUT)
    try:
        client.connect()
        if str(payload.get("action") or "") == "call-tool":
            result = client.call_tool(str(payload.get("tool") or ""), payload.get("arguments") or {})
            return {"ok": True, "result": result, "tools": []}
        return {"ok": True, "tools": client.list_tools()}
    except Exception as exc:  # noqa: BLE001 - surface the server's error to the UI
        return {"ok": False, "error": str(exc), "tools": []}
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # noqa: BLE001 - the caller already has its answer
                pass


COMMANDS = {
    "servers": servers,
    "servers/remove": remove_server,
    "tools": tools,
}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: mcp_cli.py <{'|'.join(COMMANDS)}> [json]"}))
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
