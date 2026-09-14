"""Regression: a delegated local-worker edit must actually persist to disk.

The original code tested for the string "Successfully applied edit", which
edit_file() never produces - it returns "Success: Successfully updated ...".
Because the check was therefore always true, every delegated edit was marked
failed and rolled back from the backup, silently discarding the worker's work.
These tests pin the contract so that class of bug cannot return unnoticed.
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import worker_pool


EDIT_RESPONSE = (
    "[calc.py]\n"
    "<<<<<<< SEARCH\n"
    "    return a * b\n"
    "=======\n"
    "    if not isinstance(a, (int, float)):\n"
    "        raise TypeError('a must be numeric')\n"
    "    return a * b\n"
    ">>>>>>> REPLACE\n"
)


class _FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeOpener:
    """Routes Ollama HTTP calls to canned payloads - no network, no real model."""

    def __init__(self, chat_content):
        self.chat_content = chat_content

    def open(self, request, timeout=None):
        url = getattr(request, "full_url", str(request))
        if url.endswith("/api/tags"):
            return _FakeResponse({"models": [{"name": "qwen2.5-coder:7b"}]})
        if url.endswith("/api/ps"):
            return _FakeResponse({"models": []})
        if url.endswith("/api/chat"):
            return _FakeResponse({"message": {"content": self.chat_content}})
        raise AssertionError(f"unexpected HTTP call: {url}")


class DelegationContractTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-deleg-"))
        self.file = self.root / "calc.py"
        self.file.write_text("def multiply(a, b):\n    return a * b\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _delegate(self, chat_content: str) -> str:
        pool = worker_pool.HardwareSafeWorkerPool()
        pool._opener = _FakeOpener(chat_content)
        with mock.patch.object(worker_pool, "get_worker_pool", return_value=pool):
            return worker_pool.delegate_to_local_worker(
                project_root=str(self.root),
                target_file="calc.py",
                instruction="Add numeric validation.",
            )

    def test_successful_worker_edit_persists(self):
        result = self._delegate(EDIT_RESPONSE)
        self.assertTrue(result.startswith("[SUCCESS]"), result)
        self.assertIn("raise TypeError", self.file.read_text())

    def test_file_is_untouched_when_worker_returns_no_edit_block(self):
        before = self.file.read_text()
        result = self._delegate("I could not determine the required change.")
        self.assertTrue(result.startswith("[FAILED]"), result)
        self.assertEqual(self.file.read_text(), before)


if __name__ == "__main__":
    unittest.main()
