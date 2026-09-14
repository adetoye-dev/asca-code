"""Behavioural tests for the surgical SEARCH/REPLACE editor."""

import shutil
import tempfile
import unittest
from pathlib import Path

from agent_tools import edit_file, write_file


class EditFileTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-edit-"))
        self.file = self.root / "calc.py"
        self.file.write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_exact_search_replace_applies(self):
        result = edit_file(
            project_root=str(self.root),
            path="calc.py",
            search="    return a + b",
            replace="    return (a + b)",
        )
        self.assertTrue(result.startswith("Success"), result)
        self.assertIn("return (a + b)", self.file.read_text())

    def test_refuses_ambiguous_search_block(self):
        self.file.write_text(
            "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n",
            encoding="utf-8",
        )
        before = self.file.read_text()
        result = edit_file(
            project_root=str(self.root), path="calc.py", search="    return", replace="    pass"
        )
        self.assertTrue(result.startswith("Error"), result)
        self.assertEqual(self.file.read_text(), before, "ambiguous edit must be refused, not guessed")

    def test_missing_file_reports_error(self):
        result = edit_file(project_root=str(self.root), path="nope.py", search="x", replace="y")
        self.assertTrue(result.startswith("Error"), result)

    def test_write_file_success_contract(self):
        result = write_file(project_root=str(self.root), path="new.py", content="x = 1\n")
        # worker_pool relies on this exact phrase to decide an edit landed.
        self.assertIn("Successfully wrote", result)


if __name__ == "__main__":
    unittest.main()
