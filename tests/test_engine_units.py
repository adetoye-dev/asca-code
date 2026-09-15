"""Unit tests for small, independently-testable engine helpers."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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


class PatchWriteFidelityTests(unittest.TestCase):
    """`patched_content` is the exact bytes the syntax gate validates in staging.
    The final write must land those same bytes on disk — if it instead re-derives
    content through the fuzzy diff applier, a file can pass the gate and still be
    corrupted. These tests pin that contract and the invalid-Python safety net.
    """

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-write-"))
        self.target = self.root / "calc.py"
        self.original = "def multiply(a, b):\n    return a * b\n"
        self.target.write_text(self.original, encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_writes_validated_patched_content_verbatim(self):
        validated = "def multiply(a, b):\n    return a * b  # verified\n"
        patch = manager.DiffPatch(
            file_path=str(self.target),
            original_content=self.original,
            patched_content=validated,
            diff_text="--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def multiply(a, b):\n-    return a * b\n+    return a * b  # verified\n",
        )
        manager._write_patches_to_disk([patch], str(self.root))
        self.assertEqual(self.target.read_text(encoding="utf-8"), validated)

    def test_noop_patch_does_not_invoke_fuzzy_applier(self):
        # patched_content equal to the original must be a clean no-op, not a
        # reason to fall through to the strict=False diff applier.
        patch = manager.DiffPatch(
            file_path=str(self.target),
            original_content=self.original,
            patched_content=self.original,
            diff_text="--- a/calc.py\n+++ b/calc.py\n@@ -1 +1 @@\n-broken(\n+broken(\n",
        )
        with mock.patch.object(
            manager, "apply_diff_text", side_effect=AssertionError("fuzzy applier must not run")
        ):
            manager._write_patches_to_disk([patch], str(self.root))
        self.assertEqual(self.target.read_text(encoding="utf-8"), self.original)

    def test_fallback_restores_backup_when_result_is_invalid_python(self):
        # No patched_content -> the diff fallback runs. If it produces invalid
        # Python we must not leave the broken file on disk.
        patch = manager.DiffPatch(
            file_path=str(self.target),
            original_content="",
            patched_content="",
            diff_text="--- a/calc.py\n+++ b/calc.py\n@@ -1 +1 @@\n-def multiply(a, b):\n+def multiply(a,:\n",
        )

        def fake_apply(diff_text, project_root="", backup=True, strict=False):
            (self.root / "calc.py.bak").write_text(self.original, encoding="utf-8")
            self.target.write_text("def multiply(a,\n", encoding="utf-8")
            result = mock.Mock(file_path=str(self.target), status="applied")
            return mock.Mock(results=[result], rejected=[], errors=[])

        with mock.patch.object(manager, "apply_diff_text", side_effect=fake_apply):
            manager._write_patches_to_disk([patch], str(self.root))
        self.assertEqual(self.target.read_text(encoding="utf-8"), self.original)

    def _ts_report(self, code: str):
        from gauntlet.syntax_guard import (
            Diagnostic,
            GauntletReport,
            LinterResult,
            LinterStatus,
            Severity,
        )

        return GauntletReport(
            target_paths=[str(self.root)],
            passed=False,
            linter_results=[
                LinterResult(
                    linter="tsc",
                    status=LinterStatus.FAIL,
                    exit_code=1,
                    diagnostics=[
                        Diagnostic(
                            file=str(self.root),
                            line=1,
                            column=1,
                            severity=Severity.ERROR,
                            code=code,
                            message="boom",
                            source="tsc",
                        )
                    ],
                )
            ],
            total_diagnostics=1,
            total_errors=1,
        )

    def _ts_fallback_case(self, new_content: str):
        """Stage an app.ts fallback write; returns (patch, target, original, fake_apply)."""
        original = "export const a = 1;\n"
        target = self.root / "app.ts"
        target.write_text(original, encoding="utf-8")
        patch = manager.DiffPatch(
            file_path=str(target),
            original_content="",
            patched_content="",
            diff_text="--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const a = 1;\n+x\n",
        )

        def fake_apply(diff_text, project_root="", backup=True, strict=False):
            (self.root / "app.ts.bak").write_text(original, encoding="utf-8")
            target.write_text(new_content, encoding="utf-8")
            return mock.Mock(results=[mock.Mock(file_path=str(target), status="applied")], rejected=[], errors=[])

        return patch, target, original, fake_apply

    def test_fallback_restores_backup_on_ts_syntax_error(self):
        patch, target, original, fake_apply = self._ts_fallback_case("export const a = ;\n")
        with mock.patch.object(manager, "apply_diff_text", side_effect=fake_apply), \
             mock.patch.object(manager, "run_syntax_gate", return_value=self._ts_report("TS1005")):
            manager._write_patches_to_disk([patch], str(self.root))
        self.assertEqual(target.read_text(encoding="utf-8"), original)

    def test_fallback_keeps_ts_type_errors(self):
        # TS2xxx are expected when a file is checked without its project graph,
        # so they must never revert an otherwise valid write.
        changed = "export const a = missingSymbol;\n"
        patch, target, _, fake_apply = self._ts_fallback_case(changed)
        with mock.patch.object(manager, "apply_diff_text", side_effect=fake_apply), \
             mock.patch.object(manager, "run_syntax_gate", return_value=self._ts_report("TS2304")):
            manager._write_patches_to_disk([patch], str(self.root))
        self.assertEqual(target.read_text(encoding="utf-8"), changed)


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


class TaskRoutingTests(unittest.TestCase):
    def _config(self, provider, model):
        return manager.ProjectConfig(
            project_root="/tmp/acsa-routing", llm_provider=provider, llm_model=model
        )

    def test_simple_mutation_detection(self):
        self.assertTrue(manager._is_simple_mutation_request("add input validation to multiply"))
        self.assertFalse(manager._is_simple_mutation_request("explain what this code does"))
        self.assertFalse(manager._is_simple_mutation_request("refactor the entire codebase"))
        self.assertFalse(manager._is_simple_mutation_request("x" * 300))

    def test_feature_builds_are_never_treated_as_simple(self):
        # A feature-sized build routed to a small local model stalls or writes
        # poor code, so these must keep the model the user selected.
        self.assertFalse(
            manager._is_simple_mutation_request(
                "Build a task manager in src/App.tsx: an input to add tasks, a list "
                "where each task can be toggled complete and deleted, and a live count "
                "of remaining tasks. Keep it to that one file and use Tailwind classes."
            )
        )
        self.assertFalse(manager._is_simple_mutation_request("Implement a todo app"))
        self.assertFalse(
            manager._is_simple_mutation_request(
                "Create a new file utils.py containing a function add(a, b) that returns a + b."
            )
        )

    def test_localized_edits_still_route_to_local(self):
        for request in (
            "rename helper to add_one",
            "add a null check for user",
            "fix the typo in the docstring",
        ):
            with self.subTest(request=request):
                self.assertTrue(manager._is_simple_mutation_request(request))

    def test_cloud_simple_request_routes_to_local(self):
        cfg = self._config("deepseek", "deepseek-v4-pro")
        with mock.patch.object(
            manager, "_pick_best_local_ollama_model", return_value="deepseek-coder:6.7b"
        ):
            out = manager._maybe_route_to_local(cfg, "add input validation to multiply")
        self.assertEqual(out.llm_provider, "ollama")
        self.assertEqual(out.llm_model, "deepseek-coder:6.7b")

    def test_complex_or_inquiry_requests_keep_cloud(self):
        with mock.patch.object(
            manager, "_pick_best_local_ollama_model", return_value="deepseek-coder:6.7b"
        ) as picker:
            complex_out = manager._maybe_route_to_local(
                self._config("deepseek", "deepseek-v4-pro"), "refactor the entire codebase"
            )
            inquiry_out = manager._maybe_route_to_local(
                self._config("deepseek", "deepseek-v4-pro"), "explain what this code does"
            )
        self.assertEqual(complex_out.llm_provider, "deepseek")
        self.assertEqual(inquiry_out.llm_provider, "deepseek")
        self.assertEqual(picker.call_count, 0)

    def test_local_provider_is_untouched_and_toggle_disables_routing(self):
        cfg = self._config("ollama", "qwen2.5-coder:7b")
        self.assertIs(manager._maybe_route_to_local(cfg, "add input validation"), cfg)
        with mock.patch.dict(os.environ, {manager.ROUTE_SIMPLE_TO_LOCAL_ENV: "0"}), mock.patch.object(
            manager, "_pick_best_local_ollama_model", return_value="x"
        ):
            out = manager._maybe_route_to_local(
                self._config("deepseek", "deepseek-v4-pro"), "add input validation"
            )
        self.assertEqual(out.llm_provider, "deepseek")

    def test_unreachable_local_model_keeps_cloud(self):
        with mock.patch.object(manager, "_pick_best_local_ollama_model", return_value=None):
            out = manager._maybe_route_to_local(
                self._config("deepseek", "deepseek-v4-pro"), "add input validation"
            )
        self.assertEqual(out.llm_provider, "deepseek")


if __name__ == "__main__":
    unittest.main()
