"""mcp_client.py - Minimal Model Context Protocol (MCP) stdio client.

Lets ACSA Code consume any stdio MCP server (filesystem, git, sqlite, memory,
fetch, ...) using the standard JSON-RPC 2.0 handshake:

    initialize -> notifications/initialized -> tools/list -> tools/call

Stdlib only. Used by the dev-server bridge (list/call tools) and available to
the agent so installed MCP servers become first-class tools.

CLI:
    python3 mcp_client.py --config-stdin --action list-tools < config.json
    python3 mcp_client.py --config '<json>' --action call-tool --tool NAME --args '{}'
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
from typing import Any, Optional

PROTOCOL_VERSION = "2024-11-05"
DEFAULT_TIMEOUT = 30.0


class McpError(RuntimeError):
    """Raised when an MCP server cannot be reached or returns an error."""


class McpStdioClient:
    """Speaks JSON-RPC 2.0 to an MCP server over stdin/stdout."""

    def __init__(
        self,
        command: str,
        args: Optional[list[str]] = None,
        env: Optional[dict[str, str]] = None,
        cwd: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.command = command
        self.args = list(args or [])
        self.env = {**os.environ, **(env or {})}
        self.cwd = cwd
        self.timeout = timeout
        self._proc: Optional[subprocess.Popen] = None
        self._next_id = 1
        self._lock = threading.Lock()
        self._stderr_tail: list[str] = []

    # -- lifecycle ---------------------------------------------------------
    def connect(self) -> None:
        if self._proc is not None:
            return
        try:
            self._proc = subprocess.Popen(
                [self.command, *self.args],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=self.env,
                cwd=self.cwd,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as exc:
            raise McpError(f"MCP server command not found: {self.command}") from exc
        except OSError as exc:
            raise McpError(f"Failed to start MCP server: {exc}") from exc

        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "acsa-code", "version": "1.0.0"},
            },
        )
        self._notify("notifications/initialized", {})

    def close(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def __enter__(self) -> "McpStdioClient":
        self.connect()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- protocol ----------------------------------------------------------
    def _drain_stderr(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        try:
            for line in proc.stderr:
                self._stderr_tail.append(line.rstrip())
                if len(self._stderr_tail) > 40:
                    self._stderr_tail.pop(0)
        except Exception:
            pass

    def _write(self, payload: dict[str, Any]) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise McpError("MCP server is not connected.")
        try:
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise McpError(f"MCP server closed the connection: {exc}") from exc

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def _read_message(self, deadline: float) -> dict[str, Any]:
        proc = self._proc
        if proc is None or proc.stdout is None:
            raise McpError("MCP server is not connected.")
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if line == "":
                detail = "; ".join(self._stderr_tail[-5:]) or "no stderr output"
                raise McpError(f"MCP server exited early ({detail})")
            line = line.strip()
            if not line:
                continue
            try:
                return json.loads(line)
            except ValueError:
                continue  # servers sometimes interleave non-JSON noise
        raise McpError("Timed out waiting for MCP server response.")

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            message_id = self._next_id
            self._next_id += 1
            self._write(
                {"jsonrpc": "2.0", "id": message_id, "method": method, "params": params}
            )
            deadline = time.monotonic() + self.timeout
            while True:
                message = self._read_message(deadline)
                if message.get("id") != message_id:
                    continue  # ignore notifications / other responses
                if "error" in message:
                    error = message["error"]
                    raise McpError(
                        f"{method} failed: {error.get('message', error)}"
                        if isinstance(error, dict)
                        else f"{method} failed: {error}"
                    )
                return message.get("result", {}) or {}

    # -- high-level API ----------------------------------------------------
    def list_tools(self) -> list[dict[str, Any]]:
        result = self._request("tools/list", {})
        tools = result.get("tools", [])
        return tools if isinstance(tools, list) else []

    def call_tool(self, name: str, arguments: Optional[dict[str, Any]] = None) -> Any:
        result = self._request("tools/call", {"name": name, "arguments": arguments or {}})
        content = result.get("content")
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                else:
                    parts.append(json.dumps(block))
            return {"ok": not result.get("isError", False), "text": "\n".join(parts)}
        return result


def _build_client(config: dict[str, Any], timeout: float) -> McpStdioClient:
    command = config.get("command")
    if not command:
        raise McpError("MCP server config is missing 'command'.")
    return McpStdioClient(
        command=command,
        args=config.get("args") or [],
        env=config.get("env") or {},
        cwd=config.get("cwd") or None,
        timeout=timeout,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="MCP stdio client")
    config_group = parser.add_mutually_exclusive_group(required=True)
    config_group.add_argument("--config", help="JSON MCP server config")
    config_group.add_argument("--config-stdin", action="store_true", help="Read JSON MCP server config from stdin")
    parser.add_argument("--action", required=True, choices=["list-tools", "call-tool"])
    parser.add_argument("--tool", default="")
    parser.add_argument("--args", default="{}")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parsed = parser.parse_args()

    try:
        config_text = os.sys.stdin.read() if parsed.config_stdin else parsed.config
        config = json.loads(config_text)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": f"Invalid config JSON: {exc}"}))
        return 1

    client = _build_client(config, parsed.timeout)
    try:
        client.connect()
        if parsed.action == "list-tools":
            print(json.dumps({"ok": True, "tools": client.list_tools()}))
            return 0
        try:
            call_args = json.loads(parsed.args)
        except ValueError as exc:
            print(json.dumps({"ok": False, "error": f"Invalid --args JSON: {exc}"}))
            return 1
        print(json.dumps({"ok": True, "result": client.call_tool(parsed.tool, call_args)}))
        return 0
    except McpError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    except Exception as exc:  # noqa: BLE001 - surface anything to the caller
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
