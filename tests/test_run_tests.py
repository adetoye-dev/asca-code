"""Tests for the deterministic run_tests verification tool."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from agent_tools import run_tests


class RunTestsToolTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-rt-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_uses_npm_test_when_configured(self):
        (self.root / "package.json").write_text(
            json.dumps(
                {
                    "scripts": {
                        "test": "python3 -c \"print('Ran 1 test in 0.001s'); print('OK')\"",
                    }
                }
            ),
            encoding="utf-8",
        )
        result = run_tests(str(self.root))
        self.assertIn("SUCCESS", result)
        self.assertIn("npm test", result)

    def test_falls_back_to_unittest_discovery(self):
        tests = self.root / "tests"
        tests.mkdir()
        (tests / "test_smoke.py").write_text(
            "import unittest\n"
            "class Smoke(unittest.TestCase):\n"
            "    def test_ok(self):\n"
            "        self.assertEqual(1, 1)\n",
            encoding="utf-8",
        )
        result = run_tests(str(self.root))
        self.assertIn("SUCCESS", result)
        self.assertIn("Ran 1 test", result)

    def test_reports_no_suite_instead_of_false_failure(self):
        result = run_tests(str(self.root))
        self.assertIn("No test suite", result)


if __name__ == "__main__":
    unittest.main()
