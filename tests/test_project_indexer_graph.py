"""Tests for the indexer's resolved file->file dependency graph.

The indexer only emitted "file -> its own symbols" and "file -> external
package" edges, so nothing downstream (blast radius, the Code Map) could
answer "who imports this file?". These tests pin the resolution rules that
added real `file_import` edges, and their stdlib-only, project-local scope.
"""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_MAP_DIR = REPO_ROOT / "core-engine" / "data-map"
if str(DATA_MAP_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_MAP_DIR))

import project_indexer as pi  # noqa: E402


class ResolveLocalImportTests(unittest.TestCase):
    def test_relative_ts_specifier_resolves(self):
        known = {"src/a.ts", "src/b.ts"}
        self.assertEqual(pi.resolve_local_import("./b", "src/a.ts", known), "src/b.ts")

    def test_directory_import_resolves_to_index_file(self):
        known = {"src/a.ts", "src/lib/index.ts"}
        self.assertEqual(pi.resolve_local_import("./lib", "src/a.ts", known), "src/lib/index.ts")

    def test_js_specifier_maps_to_ts_source(self):
        known = {"src/a.ts", "src/util.ts"}
        self.assertEqual(pi.resolve_local_import("./util.js", "src/a.ts", known), "src/util.ts")

    def test_parent_traversal_is_normalized(self):
        known = {"src/shared/x.ts", "src/feature/a.ts"}
        self.assertEqual(
            pi.resolve_local_import("../shared/x", "src/feature/a.ts", known),
            "src/shared/x.ts",
        )

    def test_python_sibling_module_resolves(self):
        known = {"core/a.py", "core/tools.py"}
        self.assertEqual(pi.resolve_local_import("tools", "core/a.py", known), "core/tools.py")

    def test_third_party_and_missing_specifiers_do_not_resolve(self):
        known = {"src/a.ts"}
        self.assertIsNone(pi.resolve_local_import("react", "src/a.ts", known))
        self.assertIsNone(pi.resolve_local_import("@scope/pkg", "src/a.ts", known))
        self.assertIsNone(pi.resolve_local_import("./missing", "src/a.ts", known))
        self.assertIsNone(pi.resolve_local_import("", "src/a.ts", known))


class BuildDependencyGraphTests(unittest.TestCase):
    @staticmethod
    def _file(path, imports, symbols=None):
        return pi.FileIndex(
            relative_path=path,
            language="typescript",
            size_bytes=0,
            line_count=1,
            content_hash="",
            symbols=symbols or [],
            imports=imports,
        )

    def test_file_import_edges_are_emitted_between_indexed_files(self):
        files = [self._file("src/a.ts", ["./b"]), self._file("src/b.ts", [])]
        nodes, edges = pi.build_dependency_graph(files)
        file_edges = [e for e in edges if e["type"] == "file_import"]
        self.assertEqual(len(file_edges), 1)
        self.assertEqual(file_edges[0]["source"], "file:src/a.ts")
        self.assertEqual(file_edges[0]["target"], "file:src/b.ts")
        # Every edge endpoint must be a real node, or graph consumers reject it.
        node_ids = {n["id"] for n in nodes}
        self.assertIn(file_edges[0]["source"], node_ids)
        self.assertIn(file_edges[0]["target"], node_ids)

    def test_external_imports_create_no_file_edges(self):
        files = [self._file("src/a.ts", ["react", "node:path"])]
        _, edges = pi.build_dependency_graph(files)
        self.assertEqual([e for e in edges if e["type"] == "file_import"], [])

    def test_self_import_is_ignored(self):
        files = [self._file("src/a.ts", ["./a"])]
        _, edges = pi.build_dependency_graph(files)
        self.assertEqual([e for e in edges if e["type"] == "file_import"], [])

    def test_symbol_nodes_and_structural_edges_are_preserved(self):
        symbol = pi.SymbolEntry(
            name="f",
            kind="function",
            file_path="src/a.ts",
            start_line=1,
            end_line=2,
            signature="f() -> int",
        )
        files = [self._file("src/a.ts", [], symbols=[symbol])]
        nodes, edges = pi.build_dependency_graph(files)
        self.assertIn("src/a.ts::f", {n["id"] for n in nodes})
        self.assertIn("structural_import", {e["type"] for e in edges})

    def test_import_reference_edges_are_still_recorded(self):
        files = [self._file("src/a.ts", ["react"])]
        _, edges = pi.build_dependency_graph(files)
        self.assertEqual(
            [e["target"] for e in edges if e["type"] == "import_reference"],
            ["import:react"],
        )


if __name__ == "__main__":
    unittest.main()


class AtomicIndexWriteTests(unittest.TestCase):
    """The index is read while it is rewritten; partial reads broke everything."""

    def test_write_json_atomic_round_trips_and_leaves_no_temp_files(self):
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / ".acsa" / "index.json"
            payload = {"files": {"a.ts": {"line_count": 3}}, "total_symbols": 1}
            pi.write_json_atomic(target, payload)

            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), payload)
            leftovers = [p.name for p in target.parent.iterdir() if p.name != "index.json"]
            self.assertEqual(leftovers, [], f"temp files left behind: {leftovers}")

    def test_write_json_atomic_overwrites_existing_document_cleanly(self):
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "index.json"
            # A larger document overwritten by a smaller one must not leave
            # trailing bytes (which is exactly how the file got corrupted).
            pi.write_json_atomic(target, {"n": list(range(500))})
            pi.write_json_atomic(target, {"n": [1]})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"n": [1]})
