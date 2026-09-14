"""A minimal stdio MCP server used to test the MCP client without a network.

Implements the JSON-RPC 2.0 methods the client relies on:
initialize, notifications/initialized, tools/list, tools/call.
"""

import json
import sys

TOOLS = [
    {
        "name": "echo",
        "description": "Echo text back",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    }
]


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
            reply = {
                "jsonrpc": "2.0",
                "id": message_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "mock", "version": "1.0"},
                },
            }
        elif method == "tools/list":
            reply = {"jsonrpc": "2.0", "id": message_id, "result": {"tools": TOOLS}}
        elif method == "tools/call":
            params = message.get("params", {})
            name = params.get("name")
            arguments = params.get("arguments", {})
            if name == "echo":
                reply = {
                    "jsonrpc": "2.0",
                    "id": message_id,
                    "result": {
                        "content": [
                            {"type": "text", "text": "echo:" + str(arguments.get("text", ""))}
                        ],
                        "isError": False,
                    },
                }
            else:
                reply = {
                    "jsonrpc": "2.0",
                    "id": message_id,
                    "error": {"code": -32601, "message": "unknown tool: " + str(name)},
                }
        else:
            if message_id is None:
                continue
            reply = {
                "jsonrpc": "2.0",
                "id": message_id,
                "error": {"code": -32601, "message": "method not found: " + str(method)},
            }

        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
