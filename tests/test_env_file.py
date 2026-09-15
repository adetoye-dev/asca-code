"""`.env` handling: the same file configures both halves of the app."""

import importlib
import os
import shutil
import tempfile
import unittest
from pathlib import Path

import env_file


class EnvFileParsingTests(unittest.TestCase):
    def test_parses_values_comments_and_quotes(self):
        parsed = env_file.parse_env_text(
            "\n".join(
                [
                    "# a comment",
                    "",
                    "PLAIN=value",
                    "  SPACED  =  trimmed  ",
                    "QUOTED=\"quoted value\"",
                    "SINGLE='single value'",
                    "WITH_EQUALS=a=b=c",
                    "EMPTY=",
                    "no_equals_sign",
                ]
            )
        )
        self.assertEqual(parsed["PLAIN"], "value")
        self.assertEqual(parsed["SPACED"], "trimmed")
        self.assertEqual(parsed["QUOTED"], "quoted value")
        self.assertEqual(parsed["SINGLE"], "single value")
        self.assertEqual(parsed["WITH_EQUALS"], "a=b=c")
        self.assertEqual(parsed["EMPTY"], "")
        self.assertNotIn("no_equals_sign", parsed)
        self.assertNotIn("# a comment", parsed)


class EnvFileLoadingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="acsa-env-"))
        self._saved = {
            k: os.environ.get(k)
            for k in ("ACSA_ENV_FILE", "ACSA_TEST_FROM_FILE", "ACSA_TEST_PRESET")
        }
        for key in self._saved:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, text: str) -> Path:
        path = self.tmp / ".env"
        path.write_text(text, encoding="utf-8")
        return path

    def test_loads_from_the_configured_file(self):
        path = self._write("ACSA_TEST_FROM_FILE=from-file\n")
        os.environ["ACSA_ENV_FILE"] = str(path)
        try:
            loaded = env_file.load_env_file()
            self.assertIn("ACSA_TEST_FROM_FILE", loaded)
            self.assertEqual(os.environ["ACSA_TEST_FROM_FILE"], "from-file")
        finally:
            os.environ.pop("ACSA_TEST_FROM_FILE", None)

    def test_real_environment_wins_over_the_file(self):
        path = self._write("ACSA_TEST_PRESET=from-file\n")
        os.environ["ACSA_ENV_FILE"] = str(path)
        os.environ["ACSA_TEST_PRESET"] = "from-real-env"
        env_file.load_env_file()
        self.assertEqual(os.environ["ACSA_TEST_PRESET"], "from-real-env")

    def test_missing_file_is_not_an_error(self):
        os.environ["ACSA_ENV_FILE"] = str(self.tmp / "does-not-exist")
        self.assertEqual(env_file.load_env_file(), [])


if __name__ == "__main__":
    unittest.main()
