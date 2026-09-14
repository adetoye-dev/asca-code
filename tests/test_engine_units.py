"""Unit tests for small, independently-testable engine helpers."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import manager
import worker_pool


class ModelScoringTests(unittest.TestCase):
    def test_coder_model_outranks_general_model(self):
        self.assertGreater(
            worker_pool.score_local_model("qwen2.5-coder:7b"),
            worker_pool.score_local_model("llama3.2:3b"),
        )

    def test_blank_model_scores_zero(self):
        self.assertEqual(worker_pool.score_local_model(""), 0.0)


class SearchReplaceParsingTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-sr-"))
        (self.root / "calc.py").write_text(
            "def add(a, b):\n    return a + b\n", encoding="utf-8"
        )

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_parses_path_hinted_block(self):
        response = (
            "[calc.py]\n"
            "<<<<<<< SEARCH\n"
            "    return a + b\n"
            "=======\n"
            "    return (a + b)\n"
            ">>>>>>> REPLACE\n"
        )
        patches = manager._parse_search_replace_blocks(response, str(self.root))
        self.assertEqual(len(patches), 1)
        self.assertIn("return (a + b)", patches[0].patched_content)

    def test_fallback_without_path_hint_still_finds_file(self):
        (self.root / "util.py").write_text(
            "def helper():\n    return 'target-snippet'\n", encoding="utf-8"
        )
        # Deliberately no "[path]" line before the block - the parser must locate
        # the target by matching the SEARCH text against the project files.
        response = (
            "<<<<<<< SEARCH\n"
            "return 'target-snippet'\n"
            "=======\n"
            "return 'target-snippet-2'\n"
            ">>>>>>> REPLACE\n"
        )
        patches = manager._parse_search_replace_blocks(response, str(self.root))
        self.assertEqual(len(patches), 1)
        self.assertTrue(str(patches[0].file_path).endswith("util.py"))
        self.assertIn("target-snippet-2", patches[0].patched_content)


class ContextIndexPruningTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-ctx-"))
        (self.root / "real.py").write_text(
            "def real_fn():\n    return 1\n", encoding="utf-8"
        )
        self.index = self.root / ".acsa" / "context-index.json"
        self.index.parent.mkdir(parents=True, exist_ok=True)
        # Simulate the append-only cache bug: stale entries that are now ignored
        # (mypy cache) and the index's own previous giant snapshot.
        self.index.write_text(
            json.dumps(
                {
                    ".mypy_cache/3.12/builtins.data.json": {
                        "mtime_ns": 1, "size": 10, "content": "stale-mypy",
                    },
                    ".acsa/context-index.json": {
                        "mtime_ns": 1, "size": 99_999_999, "content": "x" * 1000,
                    },
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_stale_entries_are_pruned_but_current_files_kept(self):
        manager.collect_project_context(str(self.root), "make real_fn return 2")
        data = json.loads(self.index.read_text())
        self.assertNotIn(".mypy_cache/3.12/builtins.data.json", data)
        self.assertNotIn(".acsa/context-index.json", data)
        self.assertTrue(any(k.endswith("real.py") for k in data))


if __name__ == "__main__":
    unittest.main()
