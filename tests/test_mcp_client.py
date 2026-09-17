"""Tests for the MCP stdio client that backs the marketplace's MCP servers."""

import sys
import unittest
from pathlib import Path

from mcp_client import McpError, McpStdioClient

MOCK_SERVER = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"


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



if __name__ == "__main__":
    unittest.main()
