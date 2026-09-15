"""Native function calling: providers stream tool calls in `delta.tool_calls`.

The agent used to ask every model to imitate a private XML convention in prose.
Models routinely ignore that and answer in their own format, and the run ends
with zero tool calls and no edits. Sending real `tools` schemas and reading the
native channel removes that failure mode; these tests pin the wire handling and
the exact round-trip of file content through to the agent loop's parser.
"""

import json
import unittest
from unittest import mock

import agent_loop
import agent_tools
import manager


def _sse(obj) -> bytes:
    return f"data: {json.dumps(obj)}\n\n".encode("utf-8")


def _fragment(index: int, arguments: str, name: str = "") -> bytes:
    function = {"arguments": arguments}
    if name:
        function["name"] = name
    return _sse({"choices": [{"delta": {"tool_calls": [{"index": index, "function": function}]}}]})


CONTENT = (
    "import { useState } from 'react';\n"
    "\n"
    "export function App() {\n"
    "  return <div className=\"x\">&amp; {\"quote\"} \\ backslash</div>;\n"
    "}\n"
)

# The arguments JSON is deliberately split across fragments: that is how real
# providers stream it, and only the first fragment carries the name.
ARGS = json.dumps({"path": "src/App.tsx", "content": CONTENT})
SPLIT = len(ARGS) // 2
TOOL_STREAM = [
    _fragment(0, ARGS[:SPLIT], name="write_file"),
    _fragment(0, ARGS[SPLIT:]),
    _sse({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}),
    b"data: [DONE]\n\n",
]


class _FakeResponse:
    def __init__(self, chunks):
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def __iter__(self):
        return iter(self._chunks)


class _FakeOpener:
    def __init__(self, chunks):
        self._chunks = chunks

    def open(self, *_args, **_kwargs):
        return _FakeResponse(self._chunks)


class ToolSchemaTests(unittest.TestCase):
    def test_schemas_are_openai_shaped(self):
        tools = agent_tools.openai_tool_schemas()
        self.assertTrue(tools)
        for tool in tools:
            self.assertEqual(tool["type"], "function")
            fn = tool["function"]
            self.assertTrue(fn["name"])
            self.assertTrue(fn["description"])
            self.assertEqual(fn["parameters"]["type"], "object")
            self.assertIn("properties", fn["parameters"])

    def test_line_arguments_are_typed_as_integers(self):
        by_name = {t["function"]["name"]: t["function"] for t in agent_tools.openai_tool_schemas()}
        read_props = by_name["read_file"]["parameters"]["properties"]
        self.assertEqual(read_props["start_line"]["type"], "integer")
        self.assertEqual(read_props["path"]["type"], "string")


class NativeToolCallStreamTests(unittest.TestCase):
    def setUp(self):
        self.config = manager.ProjectConfig(
            project_root="/tmp/acsa-native",
            llm_provider="deepseek",
            llm_model="deepseek-flash",
            llm_api_key="test-key",
            llm_base_url="https://api.deepseek.com/v1",
        )

    def _call(self, stream):
        with mock.patch("urllib.request.build_opener", return_value=_FakeOpener(stream)), \
             mock.patch.object(manager, "emit_thought"):
            return manager._call_llm(
                prompt="hi",
                config=self.config,
                stream=True,
                tools=agent_tools.openai_tool_schemas(),
            )

    def test_split_tool_call_fragments_are_reassembled(self):
        text = self._call(TOOL_STREAM)
        calls = agent_loop._parse_all_tool_calls(text or "")
        self.assertEqual(len(calls), 1, calls)
        name, args = calls[0]
        self.assertEqual(name, "write_file")
        self.assertEqual(args["path"], "src/App.tsx")

    def test_file_content_round_trips_exactly(self):
        text = self._call(TOOL_STREAM)
        _, args = agent_loop._parse_all_tool_calls(text or "")[0]
        self.assertEqual(args["content"], CONTENT)

    def test_tool_calls_are_not_shown_as_answer_text(self):
        thoughts: list[str] = []
        with mock.patch("urllib.request.build_opener", return_value=_FakeOpener(TOOL_STREAM)), \
             mock.patch.object(manager, "emit_thought", side_effect=thoughts.append):
            manager._call_llm(
                prompt="hi",
                config=self.config,
                stream=True,
                tools=agent_tools.openai_tool_schemas(),
            )
        # The transcript should announce the call, not dump raw JSON at the user.
        self.assertTrue(any("write_file" in t for t in thoughts), thoughts)
        self.assertFalse(any(CONTENT[:20] in t for t in thoughts), "raw file content leaked into the transcript")

    def test_clean_thought_text_strips_the_rendered_json(self):
        text = self._call(TOOL_STREAM)
        cleaned = agent_loop._clean_thought_text(text or "")
        self.assertNotIn("useState", cleaned)


if __name__ == "__main__":
    unittest.main()
