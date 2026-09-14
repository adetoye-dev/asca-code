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


if __name__ == "__main__":
    unittest.main()
