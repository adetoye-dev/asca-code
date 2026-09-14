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


if __name__ == "__main__":
    unittest.main()
