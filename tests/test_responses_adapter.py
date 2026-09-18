"""The Responses <-> Ollama chat translation, exercised without a network.

The adapter exists because Codex requires the Responses API and Ollama's
implementation of it drops tool definitions. Every shape below was found by a
real Codex run failing in a way that pointed somewhere else, so these assert the
exact shapes rather than a plausible-looking approximation.
"""

import importlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core-engine"))
adapter = importlib.import_module("responses_adapter")


class ToolTranslationTests(unittest.TestCase):
    def test_flat_responses_tool_becomes_nested_chat_tool(self):
        # Codex sends `{type, name, description, parameters}` -- flat. Ollama
        # wants the same thing nested under `function`.
        converted = adapter.chat_tools(
            [
                {
                    "type": "function",
                    "name": "exec_command",
                    "description": "run a command",
                    "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}},
                }
            ]
        )
        self.assertEqual(len(converted), 1)
        self.assertEqual(converted[0]["type"], "function")
        self.assertEqual(converted[0]["function"]["name"], "exec_command")
        self.assertEqual(converted[0]["function"]["parameters"]["properties"]["cmd"]["type"], "string")

    def test_non_function_tools_are_dropped_not_mangled(self):
        # Codex also advertises `namespace` and `web_search` entries. Ollama has
        # no idea what those are; passing them through is a schema error there.
        converted = adapter.chat_tools(
            [
                {"type": "namespace", "name": "multi_agent_v1"},
                {"type": "web_search"},
                {"type": "function", "name": "get_goal", "parameters": {}},
            ]
        )
        self.assertEqual([t["function"]["name"] for t in converted], ["get_goal"])


class ArgumentTests(unittest.TestCase):
    def test_null_arguments_are_dropped(self):
        # A real failure: llama3.2:3b sent `"yield_time_ms": null`, and Codex's own
        # schema for exec_command wants a u64, so the call died with
        # "invalid type: null, expected u64" even though the model meant "default".
        cleaned = json.loads(
            adapter.clean_arguments('{"cmd": "echo hi", "yield_time_ms": null, "tty": true}')
        )
        self.assertEqual(cleaned, {"cmd": "echo hi", "tty": True})

    def test_arguments_that_cannot_match_the_schema_are_dropped(self):
        # llama3.2:3b sent `"prefix_rule": ""` where exec_command declares an
        # array, and the call died with 'invalid type: string "", expected a
        # sequence' before anything ran. The tool's own schema is in the request,
        # so the guess can be dropped instead of failing the call.
        schema = {
            "type": "object",
            "properties": {
                "cmd": {"type": "string"},
                "yield_time_ms": {"type": "integer"},
                "prefix_rule": {"type": ["array", "null"]},
            },
        }
        cleaned = json.loads(
            adapter.clean_arguments(
                '{"cmd": "echo hi", "yield_time_ms": null, "prefix_rule": ""}', schema
            )
        )
        self.assertEqual(cleaned, {"cmd": "echo hi"})

    def test_unknown_arguments_survive_unless_the_schema_forbids_them(self):
        permissive = {"properties": {"cmd": {"type": "string"}}}
        self.assertEqual(
            json.loads(adapter.clean_arguments('{"cmd":"x","extra":1}', permissive)),
            {"cmd": "x", "extra": 1},
        )
        strict = {"properties": {"cmd": {"type": "string"}}, "additionalProperties": False}
        self.assertEqual(
            json.loads(adapter.clean_arguments('{"cmd":"x","extra":1}', strict)), {"cmd": "x"}
        )

    def test_a_boolean_is_not_accepted_where_a_number_was_asked_for(self):
        # `True` is an `int` in Python, so this needs saying explicitly.
        schema = {"properties": {"n": {"type": "integer"}}}
        self.assertEqual(json.loads(adapter.clean_arguments('{"n": true}', schema)), {})
        self.assertEqual(json.loads(adapter.clean_arguments('{"n": 3}', schema)), {"n": 3})

    def test_unparseable_arguments_pass_through_so_the_error_survives(self):
        broken = '{"cmd": "echo hi"'
        self.assertEqual(adapter.clean_arguments(broken), broken)

    def test_object_arguments_are_accepted_and_used_for_chat(self):
        # Ollama wants an object here; posting a string is a 400.
        self.assertEqual(adapter.as_object('{"a": 1}'), {"a": 1})
        self.assertEqual(adapter.as_object({"a": 1}), {"a": 1})
        self.assertEqual(adapter.as_object("not json"), {})


class MessageTranslationTests(unittest.TestCase):
    def test_instructions_and_roles_survive(self):
        messages = adapter.chat_messages(
            {
                "instructions": "be brief",
                "input": [
                    {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "rules"}]},
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]},
                ],
            }
        )
        self.assertEqual([m["role"] for m in messages], ["system", "system", "user"])
        self.assertEqual(messages[0]["content"], "be brief")
        # `developer` is what this runtime calls the system prompt.
        self.assertEqual(messages[1]["content"], "rules")

    def test_tool_history_round_trips_in_the_direction_each_side_wants(self):
        messages = adapter.chat_messages(
            {
                "input": [
                    {
                        "type": "function_call",
                        "name": "exec_command",
                        "call_id": "call_1",
                        "arguments": '{"cmd": "echo hi"}',
                    },
                    {"type": "function_call_output", "call_id": "call_1", "output": "hi\n"},
                ]
            }
        )
        call = messages[0]["tool_calls"][0]["function"]
        self.assertEqual(call["name"], "exec_command")
        # An object, not the Responses string.
        self.assertEqual(call["arguments"], {"cmd": "echo hi"})
        self.assertEqual(messages[1]["role"], "tool")
        self.assertEqual(messages[1]["content"], "hi\n")


if __name__ == "__main__":
    unittest.main()
