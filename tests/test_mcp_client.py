"""Tests for the MCP client and the agent-facing MCP tools."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from agent_tools import mcp_call, mcp_list_tools
from mcp_client import McpError, McpStdioClient

REPO_ROOT = Path(__file__).resolve().parent.parent
MOCK_SERVER = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"
WORKSPACE_SERVER = REPO_ROOT / "core-engine" / "mcp_servers" / "workspace_server.py"


class McpClientTests(unittest.TestCase):
    def _client(self) -> McpStdioClient:
        return McpStdioClient(command=sys.executable, args=[str(MOCK_SERVER)], timeout=10)

    def test_lists_tools(self):
        with self._client() as client:
            tools = client.list_tools()
        self.assertEqual([t["name"] for t in tools], ["echo"])
        self.assertIn("Echo text back", tools[0]["description"])

    def test_calls_tool_and_normalises_text_content(self):
        with self._client() as client:
            result = client.call_tool("echo", {"text": "hi"})
        self.assertTrue(result["ok"])
        self.assertEqual(result["text"], "echo:hi")

    def test_unknown_tool_raises(self):
        with self._client() as client:
            with self.assertRaises(McpError):
                client.call_tool("does_not_exist", {})

    def test_missing_command_raises(self):
        client = McpStdioClient(command="definitely-not-a-real-mcp-binary-xyz")
        with self.assertRaises(McpError):
            client.connect()


class AgentMcpToolTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-mcp-"))
        (self.root / "hello.py").write_text(
            "def greet():\n    return 'hi'\n", encoding="utf-8"
        )
        (self.root / ".acsa").mkdir(parents=True, exist_ok=True)
        (self.root / ".acsa" / "mcp.json").write_text(
            json.dumps(
                {
                    "servers": {
                        "acsa-workspace": {
                            "command": sys.executable,
                            "args": [str(WORKSPACE_SERVER)],
                            "env": {"ACSA_MCP_ROOT": str(self.root)},
                        }
                    }
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_lists_installed_server_and_tools(self):
        listing = mcp_list_tools(str(self.root))
        self.assertIn("acsa-workspace", listing)
        self.assertIn("search_code", listing)

    def test_calls_installed_tool(self):
        out = mcp_call(
            str(self.root),
            server="acsa-workspace",
            tool="search_code",
            arguments={"query": "def greet"},
        )
        self.assertIn("hello.py", out)

    def test_unknown_server_is_reported(self):
        self.assertIn("not installed", mcp_call(str(self.root), server="nope", tool="x"))

    def test_no_servers_installed(self):
        empty = Path(tempfile.mkdtemp(prefix="acsa-mcp-empty-"))
        try:
            self.assertIn("No MCP servers", mcp_list_tools(str(empty)))
        finally:
            shutil.rmtree(empty, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
