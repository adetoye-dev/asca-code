"""Unit tests for the git status parser behind the source-control panel.

`git status --porcelain=v1 -b` is a terse format and the panel reads its shape
directly, so the parse is worth pinning down without needing a repository.
"""

from __future__ import annotations

import sys
import unittest
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "core-engine"))

import git_cli  # noqa: E402


class ParseStatusTests(unittest.TestCase):
    def test_branch_and_divergence(self):
        parsed = git_cli.parse_status("## dev...origin/dev [ahead 2, behind 3]\n")
        self.assertEqual(parsed["branch"], "dev")
        self.assertEqual(parsed["ahead"], 2)
        self.assertEqual(parsed["behind"], 3)
        self.assertTrue(parsed["isGit"])

    def test_branch_without_upstream(self):
        parsed = git_cli.parse_status("## main\n")
        self.assertEqual(parsed["branch"], "main")
        self.assertEqual((parsed["ahead"], parsed["behind"]), (0, 0))

    def test_staged_unstaged_and_untracked(self):
        parsed = git_cli.parse_status(
            "## dev\n"
            "M  staged-only.py\n"
            " M worktree-only.py\n"
            "MM both.py\n"
            "?? new.py\n"
        )
        staged = {f["path"] for f in parsed["staged"]}
        unstaged = {f["path"] for f in parsed["unstaged"]}
        self.assertEqual(staged, {"staged-only.py", "both.py"})
        self.assertEqual(unstaged, {"worktree-only.py", "both.py", "new.py"})
        self.assertEqual(len(parsed["files"]), 4)

    def test_clean_tree(self):
        parsed = git_cli.parse_status("## dev\n")
        self.assertEqual(parsed["files"], [])
        self.assertEqual(parsed["staged"], [])
        self.assertEqual(parsed["unstaged"], [])

    def test_renames_keep_the_path(self):
        parsed = git_cli.parse_status("## dev\nR  old.py -> new.py\n")
        self.assertEqual([f["path"] for f in parsed["files"]], ["old.py -> new.py"])


class ResponseShapeTests(unittest.TestCase):
    def test_missing_cwd_falls_back_to_the_current_directory(self):
        """A stale project path must not break the panel.

        The dev bridge defaulted to `process.cwd()` the same way; this keeps that
        behaviour explicit instead of accidental.
        """
        self.assertEqual(git_cli._cwd({"cwd": "/nonexistent-directory-for-tests"}), os.getcwd())
        self.assertEqual(git_cli._cwd({}), os.getcwd())


if __name__ == "__main__":
    unittest.main()
