"""Workspace search/replace and project-readiness contracts."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "core-engine"))

import fs_cli  # noqa: E402
import project_cli  # noqa: E402


class FsSearchTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-fs-"))
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text(
            "def add(a, b):\n    return a + b  # TODO tighten\n", encoding="utf-8"
        )
        (self.root / "README.md").write_text("TODO: write docs\n", encoding="utf-8")
        # Must never be searched.
        (self.root / "node_modules").mkdir()
        (self.root / "node_modules" / "dep.js").write_text("TODO in a dependency\n", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config").write_text("TODO in git metadata\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_finds_matches_with_real_line_numbers(self):
        out = fs_cli.search({"projectRoot": str(self.root), "query": "TODO"})
        self.assertEqual(out["totalMatches"], 2)
        files = {r["relativeFilePath"] for r in out["results"]}
        self.assertEqual(files, {"src/app.py", "README.md"})
        app = next(r for r in out["results"] if r["fileName"] == "app.py")
        self.assertEqual(app["matches"][0]["lineNumber"], 2)
        self.assertEqual(app["relativeDir"], "src")

    def test_ignores_dependencies_and_git_metadata(self):
        out = fs_cli.search({"projectRoot": str(self.root), "query": "TODO"})
        blob = json.dumps(out)
        self.assertNotIn("node_modules", blob)
        self.assertNotIn("git metadata", blob)

    def test_match_case_and_whole_word(self):
        out = fs_cli.search({"projectRoot": str(self.root), "query": "todo", "matchCase": True})
        self.assertEqual(out["totalMatches"], 0)
        out = fs_cli.search(
            {"projectRoot": str(self.root), "query": "TODO", "matchWholeWord": True}
        )
        self.assertEqual(out["totalMatches"], 2)

    def test_invalid_regex_is_reported_not_raised(self):
        out = fs_cli.search({"projectRoot": str(self.root), "query": "([", "useRegex": True})
        self.assertIn("error", out)
        self.assertIn("Invalid regex", out["error"])

    def test_max_results_caps_and_flags(self):
        out = fs_cli.search({"projectRoot": str(self.root), "query": "TODO", "maxResults": 1})
        self.assertEqual(out["totalMatches"], 1)
        self.assertTrue(out["capped"])


class FsReplaceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-fsrep-"))
        self.file = self.root / "notes.md"
        self.file.write_text("alpha beta\nbeta gamma\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_replaces_every_occurrence_and_returns_new_content(self):
        out = fs_cli.replace(
            {"projectRoot": str(self.root), "query": "beta", "replaceText": "BETA"}
        )
        self.assertEqual(out["totalReplaced"], 2)
        self.assertEqual(out["updatedFiles"][0]["newContent"], "alpha BETA\nBETA gamma\n")
        self.assertEqual(self.file.read_text(encoding="utf-8"), "alpha BETA\nBETA gamma\n")

    def test_line_filter_touches_only_the_named_line(self):
        out = fs_cli.replace(
            {
                "projectRoot": str(self.root),
                "query": "beta",
                "replaceText": "BETA",
                "lineNumbers": [2],
            }
        )
        self.assertEqual(out["totalReplaced"], 1)
        self.assertEqual(self.file.read_text(encoding="utf-8"), "alpha beta\nBETA gamma\n")

    def test_preserve_case_follows_the_matched_text(self):
        self.file.write_text("Alpha\nALPHA\nalpha\n", encoding="utf-8")
        fs_cli.replace(
            {
                "projectRoot": str(self.root),
                "query": "alpha",
                "replaceText": "omega",
                "preserveCase": True,
            }
        )
        self.assertEqual(self.file.read_text(encoding="utf-8"), "Omega\nOMEGA\nomega\n")

    def test_refuses_a_path_outside_the_project(self):
        out = fs_cli.replace(
            {
                "projectRoot": str(self.root),
                "query": "a",
                "replaceText": "b",
                "filePath": "../../etc/passwd",
            }
        )
        self.assertIn("error", out)
        self.assertEqual(self.file.read_text(encoding="utf-8"), "alpha beta\nbeta gamma\n")

    def test_whole_word_does_not_touch_substrings(self):
        self.file.write_text("cat concatenate\n", encoding="utf-8")
        out = fs_cli.replace(
            {
                "projectRoot": str(self.root),
                "query": "cat",
                "replaceText": "dog",
                "matchWholeWord": True,
            }
        )
        self.assertEqual(out["totalReplaced"], 1)
        self.assertEqual(self.file.read_text(encoding="utf-8"), "dog concatenate\n")


class ProjectStatusTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-proj-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_scaffolded_project_without_node_modules_needs_install(self):
        (self.root / "package.json").write_text(
            json.dumps({"scripts": {"dev": "vite", "build": "vite build", "test": "vitest"}}),
            encoding="utf-8",
        )
        out = project_cli.status({"projectRoot": str(self.root)})
        self.assertTrue(out["needsInstall"])
        self.assertEqual(out["manager"], "npm")
        self.assertEqual(out["installCommand"], "npm install")
        self.assertEqual(out["devCommand"], "npm run dev")
        self.assertEqual(out["testCommand"], "npm run test")

    def test_installed_project_is_ready(self):
        (self.root / "package.json").write_text(json.dumps({"scripts": {"dev": "vite"}}), "utf-8")
        (self.root / "node_modules").mkdir()
        self.assertFalse(project_cli.status({"projectRoot": str(self.root)})["needsInstall"])

    def test_lockfile_decides_the_manager_and_its_commands(self):
        (self.root / "package.json").write_text(json.dumps({"scripts": {"dev": "next dev"}}), "utf-8")
        (self.root / "pnpm-lock.yaml").write_text("", encoding="utf-8")
        out = project_cli.status({"projectRoot": str(self.root)})
        self.assertEqual(out["manager"], "pnpm")
        self.assertEqual(out["installCommand"], "pnpm install")
        self.assertEqual(out["devCommand"], "pnpm dev")

    def test_missing_folder_is_not_an_error(self):
        out = project_cli.status({"projectRoot": "/nope/not/here"})
        self.assertFalse(out["hasPackageJson"])
        self.assertFalse(out["needsInstall"])


if __name__ == "__main__":
    unittest.main()
