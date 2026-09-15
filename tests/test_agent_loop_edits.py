"""Regression: an identical edit must not be applied twice in one turn.

Re-applying the same SEARCH/REPLACE silently duplicates the inserted block,
because the search text still matches after the first application. Observed in
the wild: the same guard clause inserted three times into a user's file. The
old duplicate guard compared only against the immediately previous step, so an
intervening read_file/run_command defeated it.
"""

import shutil
import tempfile
import unittest
from pathlib import Path

import agent_loop


SEARCH = "    return a * b"
REPLACE = (
    "    if not isinstance(a, (int, float)):\n"
    "        raise TypeError('a must be numeric')\n"
    "    return a * b"
)
EDIT_BLOCK = f"[calc.py]\n<<<<<<< SEARCH\n{SEARCH}\n=======\n{REPLACE}\n>>>>>>> REPLACE"

# A non-edit tool call. Emitting one between two identical edits is what defeated
# the original guard, which only compared against the immediately previous step.
READ_CALL = 'Action: read_file\nAction Input: {"path": "calc.py"}'


class DuplicateEditTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-loop-"))
        self.file = self.root / "calc.py"
        self.file.write_text("def multiply(a, b):\n    return a * b\n", encoding="utf-8")
        # Keep the test hermetic and fast: the in-loop gate shells out to linters.
        self._gate = agent_loop.run_syntax_gate
        agent_loop.run_syntax_gate = None

    def tearDown(self):
        agent_loop.run_syntax_gate = self._gate
        shutil.rmtree(self.root, ignore_errors=True)

    def _run(self, turns):
        """Drive the real agent loop against a scripted model."""
        scripted = list(turns)

        def fake_llm(prompt=None, system=None, *args, **kwargs):
            if "--- ASSISTANT ---" not in (prompt or ""):
                return "1. Apply the edit."
            return scripted.pop(0) if scripted else "Done."

        return agent_loop.run_agent_loop(
            # Under 140 chars, so the planner LLM call is skipped.
            user_request="Add numeric validation to multiply.",
            project_root=str(self.root),
            llm_caller=fake_llm,
            max_iterations=6,
        )

    def test_identical_edits_separated_by_a_read_are_applied_once(self):
        # This is the real-world shape: edit -> read -> same edit again.
        self._run([EDIT_BLOCK, READ_CALL, EDIT_BLOCK, "The change is applied."])
        content = self.file.read_text()
        self.assertEqual(content.count("raise TypeError"), 1, content)

    def test_back_to_back_identical_edits_are_applied_once(self):
        self._run([EDIT_BLOCK, EDIT_BLOCK, "The change is applied."])
        content = self.file.read_text()
        self.assertEqual(content.count("raise TypeError"), 1, content)

    def test_genuinely_different_edits_both_apply(self):
        second = (
            "[calc.py]\n<<<<<<< SEARCH\n    return a * b\n=======\n"
            "    return float(a) * float(b)\n>>>>>>> REPLACE"
        )
        self._run([EDIT_BLOCK, second, "Done."])
        content = self.file.read_text()
        self.assertIn("raise TypeError", content)
        self.assertIn("float(a) * float(b)", content)

    def test_ambiguous_edit_is_anchored_to_last_read_line(self):
        self.file.write_text(
            "def f1(a, b):\n    return a * b\n\n"
            "def f2(a, b):\n    return a * b\n\n"
            "def f3(a, b):\n    return a * b\n",
            encoding="utf-8",
        )
        read_call = (
            'Action: read_file\nAction Input: {"path": "calc.py", "start_line": 4, "end_line": 6}'
        )
        edit = (
            "[calc.py]\n<<<<<<< SEARCH\n    return a * b\n=======\n    return a + b\n>>>>>>> REPLACE"
        )
        self._run([read_call, edit, "Done."])
        content = self.file.read_text()
        self.assertEqual(content.count("return a * b"), 2)
        self.assertEqual(content.count("return a + b"), 1)
        # The harness should have anchored the edit to the f2 block the model read.
        self.assertIn("def f2(a, b):\n    return a + b", content)


class ContextCompactionTests(unittest.TestCase):
    def test_small_history_is_untouched(self):
        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        out = agent_loop._compact_history(history, "task", [])
        self.assertEqual(out, history)

    def test_over_budget_history_is_compacted_to_summary_plus_recent(self):
        history = [{"role": "user", "content": "x" * 100}]
        for _ in range(30):
            history.append({"role": "assistant", "content": "y" * 500})
            history.append({"role": "user", "content": "z" * 500})

        step = agent_loop.AgentStep(
            name="Edit File",
            detail="calc.py",
            status="done",
            tool_name="edit_file",
            arguments={},
            observation="",
            elapsed_s=0.0,
        )
        out = agent_loop._compact_history(
            history, "Add a feature to calc.py", [step], max_tokens=2000
        )

        self.assertEqual(len(out), 1 + agent_loop.KEEP_RECENT_MESSAGES)
        self.assertIn("CONTEXT COMPACTED", out[0]["content"])
        self.assertIn("Objective:", out[0]["content"])
        self.assertIn("edit_file", out[0]["content"])
        # The most recent turns must survive verbatim.
        self.assertEqual(
            out[-agent_loop.KEEP_RECENT_MESSAGES:],
            history[-agent_loop.KEEP_RECENT_MESSAGES:],
        )


class SystemPromptTests(unittest.TestCase):
    def test_template_renders_without_keyerror(self):
        # Guards a nasty failure mode: a stray {brace} in the .format() template
        # raises KeyError and takes down every single agent run.
        rendered = agent_loop.SYSTEM_PROMPT_TEMPLATE.format(
            repo_map="RM", tool_schemas_json="[]", project_root="/p", active_file_info=""
        )
        self.assertIn("MCP TOOLS", rendered)


class LoopGuardTests(unittest.TestCase):
    """The loop must not spin when a model refuses or just repeats itself."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-guard-"))
        (self.root / "calc.py").write_text(
            "def add(a, b):\n    return a + b\n", encoding="utf-8"
        )
        self._gate = agent_loop.run_syntax_gate
        agent_loop.run_syntax_gate = None

    def tearDown(self):
        agent_loop.run_syntax_gate = self._gate
        shutil.rmtree(self.root, ignore_errors=True)

    def test_repeated_refusals_stop_the_loop_early(self):
        def fake_llm(prompt=None, system=None, *args, **kwargs):
            return "I'm sorry, but I can't assist with that."

        result = agent_loop.run_agent_loop(
            user_request="Add validation to the add function.",
            project_root=str(self.root),
            llm_caller=fake_llm,
            max_iterations=8,
        )
        self.assertLessEqual(result.total_rounds, 3, "must not burn all 8 rounds")
        self.assertIn("refused", result.answer.lower())
        self.assertEqual(result.edited_files, [])

    def test_identical_replies_stop_the_loop_early(self):
        def fake_llm(prompt=None, system=None, *args, **kwargs):
            return "Here is my plan for the change."

        result = agent_loop.run_agent_loop(
            user_request="Add validation to the add function.",
            project_root=str(self.root),
            llm_caller=fake_llm,
            max_iterations=8,
        )
        self.assertLessEqual(result.total_rounds, 3)

    def test_prior_turns_are_background_context_not_a_transcript(self):
        prompts = []

        def fake_llm(prompt=None, system=None, *args, **kwargs):
            prompts.append(prompt or "")
            return "Done."

        agent_loop.run_agent_loop(
            user_request="Add a docstring to the add function.",
            project_root=str(self.root),
            llm_caller=fake_llm,
            max_iterations=1,
            conversation_history=[
                {"role": "user", "content": "reduce the number of open projects to 3 instead of 5"},
                {"role": "assistant", "content": "I'm sorry, but I can't assist with that."},
            ],
        )
        first_prompt = prompts[0]
        self.assertIn("BACKGROUND CONTEXT ONLY", first_prompt)
        self.assertIn("reduce the number of open projects", first_prompt)
        # The old assistant turn must not be emitted as its own turn to continue.
        self.assertEqual(first_prompt.count("--- ASSISTANT ---"), 1)


class ToolCallParsingTests(unittest.TestCase):
    """Models use several argument keys; dropping them yields empty-argument calls."""

    def test_arguments_key_is_parsed(self):
        raw = '```json\n{"name": "read_file", "arguments": {"path": "calc.py"}}\n```'
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        self.assertTrue(calls, calls)
        self.assertEqual(calls[0][0], "read_file")
        self.assertEqual(calls[0][1].get("path"), "calc.py")

    def test_arguments_as_json_string_is_parsed(self):
        raw = '{"name": "edit_file", "arguments": "{\\"path\\": \\"a.py\\"}"}'
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        self.assertTrue(calls, calls)
        self.assertEqual(calls[0][1].get("path"), "a.py")

    def test_flat_tool_object_without_wrapper(self):
        raw = '```json\n{"name": "read_file", "path": "calc.py", "start_line": 1, "end_line": 3}\n```'
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        self.assertTrue(calls, calls)
        self.assertEqual(calls[0][1].get("path"), "calc.py")
        self.assertEqual(calls[0][1].get("start_line"), 1)

    def test_flat_edit_object_keeps_search_and_replace(self):
        raw = ('{"name": "edit_file", "path": "a.py", "search": "x = 1", "replace": "x = 2"}')
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        args = calls[0][1]
        self.assertEqual(args.get("path"), "a.py")
        self.assertEqual(args.get("search"), "x = 1")
        self.assertEqual(args.get("replace"), "x = 2")

    def test_parameters_key_still_works(self):
        raw = '{"name": "read_file", "parameters": {"path": "calc.py"}}'
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        self.assertEqual(calls[0][1].get("path"), "calc.py")


class EscapedNewlineTests(unittest.TestCase):
    """Models sometimes emit a literal backslash-n inside XML parameters."""

    def test_escaped_newlines_in_search_are_unescaped(self):
        bs = chr(92)  # a single backslash
        raw = (
            '<invoke name="edit_file">\n'
            '  <parameter name="path">calc.py</parameter>\n'
            f'  <parameter name="search">def f():{bs}n    return 1</parameter>\n'
            f'  <parameter name="replace">def f():{bs}n    return 2</parameter>\n'
            "</invoke>"
        )
        calls = agent_loop._parse_all_tool_calls(raw, fallback_file=None)
        self.assertEqual(calls[0][0], "edit_file")
        search = calls[0][1]["search"]
        self.assertIn("\n", search, "should contain a real newline")
        self.assertNotIn(bs + "n", search, "literal backslash-n must be gone")


if __name__ == "__main__":




    unittest.main()
