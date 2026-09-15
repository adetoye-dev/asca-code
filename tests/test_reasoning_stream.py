"""Reasoning models stream chain-of-thought separately from the answer.

Providers such as DeepSeek's reasoner (and Qwen/others in "thinking" mode) emit
OpenAI-compatible deltas where the thought arrives as `reasoning_content` and the
final answer as `content`. The streaming parser only looked at `content`, so a
long reasoning phase produced no output at all: the UI sat on "Thinking…", no
tool ever ran, and the run made no progress until it was cancelled.

The transport is stubbed (no sockets) so the real SSE delta handling inside
`_call_llm` is what gets exercised.
"""

import json
import unittest
from unittest import mock

import manager


def _sse(obj) -> bytes:
    return f"data: {json.dumps(obj)}\n\n".encode("utf-8")


REASONING_STREAM = [
    _sse({"choices": [{"delta": {"reasoning_content": "Step one. "}}]}),
    _sse({"choices": [{"delta": {"reasoning_content": "Step two. "}}]}),
    _sse({"choices": [{"delta": {"content": "FINAL"}, "finish_reason": "stop"}]}),
    b"data: [DONE]\n\n",
]

# A response cut off by the token limit: the payload stops mid-tool-call.
TRUNCATED_STREAM = [
    _sse({"choices": [{"delta": {"content": '<invoke name="write_file">'}}]}),
    _sse({"choices": [{"delta": {"content": '<parameter name="content">half a file'}}]}),
    _sse({"choices": [{"delta": {}, "finish_reason": "length"}]}),
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


class ReasoningStreamTests(unittest.TestCase):
    def setUp(self):
        self.config = manager.ProjectConfig(
            project_root="/tmp/acsa-reasoning",
            llm_provider="deepseek",
            llm_model="deepseek-reasoner",
            llm_api_key="test-key",
            llm_base_url="https://api.deepseek.com/v1",
        )

    def _call(self, **kwargs):
        with mock.patch(
            "urllib.request.build_opener", return_value=_FakeOpener(REASONING_STREAM)
        ):
            return manager._call_llm(prompt="hi", config=self.config, stream=True, **kwargs)

    def _call_stream(self, stream, **kwargs):
        with mock.patch("urllib.request.build_opener", return_value=_FakeOpener(stream)):
            return manager._call_llm(prompt="hi", config=self.config, stream=True, **kwargs)

    def test_content_deltas_are_returned(self):
        self.assertEqual(self._call(), "FINAL")

    def test_reasoning_deltas_are_streamed_as_thoughts(self):
        # Reasoning belongs in the thought channel; the answer stays the answer.
        thoughts: list[str] = []
        chunks: list[str] = []
        with mock.patch.object(manager, "emit_thought", side_effect=thoughts.append), \
             mock.patch.object(manager, "emit_chunk", side_effect=chunks.append):
            out = self._call()
        self.assertEqual(out, "FINAL")
        self.assertEqual("".join(thoughts), "Step one. Step two. ")
        self.assertEqual("".join(chunks), "FINAL")

    def test_token_limit_is_surfaced_not_silent(self):
        # A response cut off at the limit can hold half a tool call; the user
        # must be told rather than silently getting nothing.
        thoughts: list[str] = []
        with mock.patch.object(manager, "emit_thought", side_effect=thoughts.append), \
             mock.patch.object(manager, "logger") as fake_log:
            out = self._call_stream(TRUNCATED_STREAM)
        self.assertTrue(out.startswith('<invoke name="write_file">'))
        self.assertTrue(any("token limit" in t for t in thoughts), thoughts)
        self.assertTrue(fake_log.warning.called)


if __name__ == "__main__":
    unittest.main()
