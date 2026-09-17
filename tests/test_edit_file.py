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

    def test_edits_leave_no_stray_files_behind(self):
        """An edit must not litter the user's working tree.

        The editor used to drop a `<file>.bak` beside every edit. Nothing ever read it,
        and it shared a filename with the pipeline's own rollback point — so it could
        overwrite the state a failed verification restores from. Covers both outcomes:
        an applied edit and a refused one.
        """
        edit_file(
            project_root=str(self.root),
            path="calc.py",
            search="    return a + b",
            replace="    return (a + b)",
        )
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()),
            ["calc.py"],
            "a successful edit left stray files behind",
        )

        self.file.write_text(
            "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n",
            encoding="utf-8",
        )
        refused = edit_file(
            project_root=str(self.root), path="calc.py", search="    return", replace="    pass"
        )
        self.assertTrue(refused.startswith("Error"), refused)
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()),
            ["calc.py"],
            "a refused edit left stray files behind",
        )

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

    def test_anchor_line_disambiguates_duplicate_search(self):
        self.file.write_text(
            "def f1(a, b):\n    return a * b\n\n"
            "def f2(a, b):\n    return a * b\n\n"
            "def f3(a, b):\n    return a * b\n",
            encoding="utf-8",
        )
        result = edit_file(
            project_root=str(self.root),
            path="calc.py",
            search="    return a * b",
            replace="    return a + b",
            start_line=5,
        )
        self.assertTrue(result.startswith("Success"), result)
        content = self.file.read_text()
        self.assertEqual(content.count("return a * b"), 2)
        self.assertEqual(content.count("return a + b"), 1)
        # The change must land in f2 (line 5), the closest to the anchor.
        self.assertIn("def f2(a, b):\n    return a + b", content)

    def test_ambiguous_anchor_is_still_refused(self):
        # occurrences at lines 2 and 8; anchor line 5 is equally distant.
        self.file.write_text(
            "def f1(a, b):\n    return a * b\n\n"
            "def f2(a, b):\n    return a - b\n\n"
            "def f3(a, b):\n    return a * b\n",
            encoding="utf-8",
        )
        before = self.file.read_text()
        result = edit_file(
            project_root=str(self.root),
            path="calc.py",
            search="    return a * b",
            replace="    return a + b",
            start_line=5,
        )
        self.assertTrue(result.startswith("Error"), result)
        self.assertEqual(self.file.read_text(), before)

    def test_missing_file_reports_error(self):
        result = edit_file(project_root=str(self.root), path="nope.py", search="x", replace="y")
        self.assertTrue(result.startswith("Error"), result)

    def test_write_file_success_contract(self):
        result = write_file(project_root=str(self.root), path="new.py", content="x = 1\n")
        # worker_pool relies on this exact phrase to decide an edit landed.
        self.assertIn("Successfully wrote", result)


class DestructiveEditGuardTests(unittest.TestCase):
    """An edit must never silently gut a file."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-guard-"))
        self.file = self.root / "calc.py"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_refuses_to_empty_a_file(self):
        original = "def multiply(a, b):\n    return a * b\n"
        self.file.write_text(original, encoding="utf-8")
        result = edit_file(
            project_root=str(self.root),
            path="calc.py",
            search="def multiply(a, b):\n    return a * b",
            replace="",
        )
        self.assertTrue(result.startswith("Error"), result)
        self.assertEqual(self.file.read_text(), original, "file must be untouched")

    def test_small_deletion_is_still_allowed(self):
        self.file.write_text(
            "a = 1\nb = 2\nc = 3\nd = 4\ne = 5\nf = 6\ng = 7\nh = 8\n",
            encoding="utf-8",
        )
        result = edit_file(
            project_root=str(self.root), path="calc.py", search="b = 2\n", replace=""
        )
        self.assertTrue(result.startswith("Success"), result)
        self.assertNotIn("b = 2", self.file.read_text())


if __name__ == "__main__":

    unittest.main()
