"""The local crash log: useful for support, safe to have on disk.

There is no telemetry in this app, so the file *is* the report. That makes two
properties load-bearing, and both are asserted here: nothing credential-shaped
reaches it, and a crash loop cannot fill a disk with it.
"""

import importlib
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core-engine"))
crash_log = importlib.import_module("crash_log")


class CrashLogTestCase(unittest.TestCase):
    def setUp(self):
        self.data_dir = Path(tempfile.mkdtemp(prefix="acsa-crash-"))
        self._previous = os.environ.get("ACSA_DATA_DIR")
        os.environ["ACSA_DATA_DIR"] = str(self.data_dir)

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("ACSA_DATA_DIR", None)
        else:
            os.environ["ACSA_DATA_DIR"] = self._previous
        shutil.rmtree(self.data_dir, ignore_errors=True)


class RedactionTests(CrashLogTestCase):
    def test_credentials_are_masked(self):
        for line, secret in [
            ("boom api_key=sk-abcdef123456", "sk-abcdef123456"),
            ("https://x/?token=zzzzzzzzzzzz", "zzzzzzzzzzzz"),
            ('{"apiKey":"sk-abcdef123456"}', "sk-abcdef123456"),
            ("Authorization: Bearer sk-live-abcdef123", "sk-live-abcdef123"),
            ("client_secret: abcdef123456", "abcdef123456"),
        ]:
            masked = crash_log.redact(line)
            self.assertNotIn(secret, masked, masked)
            self.assertIn("***", masked, masked)

    def test_bearer_keeps_the_scheme(self):
        # Masking the word too would hide *what kind* of credential leaked.
        masked = crash_log.redact("Authorization: Bearer sk-live-abcdef123")
        self.assertIn("Bearer", masked)
        self.assertNotIn("sk-live-abcdef123", masked)

    def test_ordinary_text_is_left_alone(self):
        for line in [
            "reading token counts from turn.completed",
            "no secrets are logged here",
            "TypeError: cannot read properties of undefined (reading 'map')",
            "at /src/components/Dashboard.tsx:42:11",
        ]:
            self.assertEqual(crash_log.redact(line), line)


class RecordTests(CrashLogTestCase):
    def test_a_record_is_written_redacted_and_owner_only(self):
        entry = crash_log.record(
            {
                "kind": "render",
                "message": "failed with api_key=sk-abcdef123456",
                "stack": "at run (/src/app.tsx:1:1)",
                "context": {"route": "/settings", "nested": {"deep": ["sk-abcdef123456"]}},
            }
        )
        self.assertIn("ts", entry)

        path = crash_log.log_path()
        self.assertTrue(path.is_file())
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

        written = json.loads(path.read_text().splitlines()[0])
        self.assertEqual(written["kind"], "render")
        self.assertNotIn("sk-abcdef123456", json.dumps(written))
        # The shape survives, which is the part that makes it diagnosable.
        self.assertEqual(written["context"]["nested"]["deep"], ["***"])
        self.assertEqual(written["stack"], "at run (/src/app.tsx:1:1)")

    def test_rotation_keeps_the_newest(self):
        for index in range(crash_log.MAX_RECORDS + 25):
            crash_log.record({"kind": "loop", "message": f"crash {index}"})
        entries = crash_log.read(limit=crash_log.MAX_RECORDS + 50)
        self.assertEqual(len(entries), crash_log.MAX_RECORDS)
        # The newest survived and the oldest did not.
        self.assertEqual(entries[-1]["message"], f"crash {crash_log.MAX_RECORDS + 24}")
        self.assertNotEqual(entries[0]["message"], "crash 0")

    def test_read_skips_junk_and_is_empty_before_anything_happens(self):
        self.assertEqual(crash_log.read(), [])
        path = crash_log.log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"kind":"real"}\nnot json\n\n')
        self.assertEqual([e["kind"] for e in crash_log.read()], ["real"])


class CliTests(CrashLogTestCase):
    def test_append_list_and_path(self):
        payload = json.dumps({"kind": "render", "message": "boom"})
        self.assertEqual(self._captured(lambda: crash_log.main(["append", payload]))[0], 0)
        listing = json.loads(self._captured(lambda: crash_log.main(["list"]))[1])
        self.assertEqual(len(listing["data"]["entries"]), 1)
        self.assertTrue(listing["data"]["path"].endswith("crashes.log"))

    def test_bad_input_is_an_error_not_a_traceback(self):
        self.assertEqual(self._captured(lambda: crash_log.main(["append", "not json"]))[0], 2)
        self.assertEqual(self._captured(lambda: crash_log.main(["nonsense"]))[0], 2)

    def _captured(self, fn) -> tuple[int, str]:
        """Run something that prints, and keep the suite output readable."""
        import io
        from contextlib import redirect_stdout

        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = fn()
        return code, buffer.getvalue()


if __name__ == "__main__":
    unittest.main()
