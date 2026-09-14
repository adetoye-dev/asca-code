"""Behavioural tests for the unified-diff patch applier."""

import shutil
import tempfile
import unittest
from pathlib import Path

from compiler.diff_applier import apply_diff_text


class DiffApplierTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-diff-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, name: str, text: str) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_applies_unified_diff_hunk(self):
        target = self.write("calc.py", "def add(a, b):\n    return a + b\n")
        diff = (
            "--- a/calc.py\n"
            "+++ b/calc.py\n"
            "@@ -1,2 +1,3 @@\n"
            " def add(a, b):\n"
            '+    """Add two numbers."""\n'
            "     return a + b\n"
        )
        batch = apply_diff_text(diff, project_root=str(self.root))
        self.assertTrue(batch.all_succeeded, batch.to_json())
        self.assertIn('"""Add two numbers."""', target.read_text())

    def test_rejects_and_leaves_file_intact_when_context_mismatches(self):
        target = self.write("calc.py", "def add(a, b):\n    return a + b\n")
        original = target.read_text()
        # Context claims the body is "return a - b", which is wrong.
        diff = (
            "--- a/calc.py\n"
            "+++ b/calc.py\n"
            "@@ -1,2 +1,3 @@\n"
            " def add(a, b):\n"
            "+    # injected\n"
            "     return a - b\n"
        )
        batch = apply_diff_text(diff, project_root=str(self.root), backup=False)
        self.assertFalse(batch.all_succeeded)
        self.assertEqual(target.read_text(), original, "rejected patch must not touch the file")

    def test_creates_new_file(self):
        diff = "--- /dev/null\n+++ b/fresh.py\n@@ -0,0 +1,2 @@\n+print('hi')\n+x = 1\n"
        batch = apply_diff_text(diff, project_root=str(self.root))
        self.assertEqual(batch.created, 1, batch.to_json())
        self.assertEqual((self.root / "fresh.py").read_text(), "print('hi')\nx = 1\n")


if __name__ == "__main__":
    unittest.main()
