"""Export and import: the only way state moves between machines.

Two properties matter more than the mechanics, and both are asserted here:
a default export does not carry credentials, and "not carrying" means the bytes
are gone rather than just the rows — SQLite keeps deleted values in free pages.
"""

import importlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core-engine"))
app_db = importlib.import_module("app_db")
backup = importlib.import_module("backup")

SECRET = "sk-super-secret-value-123456"


class BackupTestCase(unittest.TestCase):
    def setUp(self):
        self.data_dir = Path(tempfile.mkdtemp(prefix="acsa-backup-"))
        self.work = Path(tempfile.mkdtemp(prefix="acsa-backup-out-"))
        self._previous = os.environ.get("ACSA_DATA_DIR")
        os.environ["ACSA_DATA_DIR"] = str(self.data_dir)
        app_db.init_db()
        app_db.set_setting("theme", {"id": "obsidian"})
        app_db.set_secret("deepseek_api_key", SECRET)

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("ACSA_DATA_DIR", None)
        else:
            os.environ["ACSA_DATA_DIR"] = self._previous
        shutil.rmtree(self.data_dir, ignore_errors=True)
        shutil.rmtree(self.work, ignore_errors=True)


class ExportTests(BackupTestCase):
    def test_a_default_export_leaves_credentials_behind(self):
        out = self.work / "backup.db"
        result = backup.export(out)

        self.assertTrue(out.is_file())
        self.assertFalse(result["secretsIncluded"])
        self.assertEqual(result["secretsRemoved"], 1)

        conn = sqlite3.connect(str(out))
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM secrets").fetchone()[0], 0)
            # Everything else came across.
            self.assertIsNotNone(conn.execute("SELECT value FROM settings WHERE key='theme'").fetchone())
        finally:
            conn.close()

    def test_the_bytes_are_gone_and_not_just_the_rows(self):
        # The reason the export vacuums: DELETE leaves the value in free pages,
        # where `strings` still finds it. This is the assertion that makes the
        # default trustworthy rather than reassuring.
        out = self.work / "backup.db"
        backup.export(out)
        self.assertNotIn(SECRET.encode(), out.read_bytes())

    def test_an_export_can_include_them_when_asked(self):
        out = self.work / "full.db"
        backup.export(out, include_secrets=True)
        self.assertIn(SECRET.encode(), out.read_bytes())

    def test_the_export_is_owner_only(self):
        out = self.work / "backup.db"
        backup.export(out)
        self.assertEqual(out.stat().st_mode & 0o777, 0o600)


class ImportTests(BackupTestCase):
    def test_a_round_trip_restores_what_was_exported(self):
        out = self.work / "backup.db"
        backup.export(out)

        app_db.set_setting("theme", {"id": "changed"})
        result = backup.import_from(out)

        self.assertEqual(app_db.get_settings()["theme"], {"id": "obsidian"})
        # The database that was replaced is kept, so an import is not a one-way door.
        self.assertTrue(Path(result["previousKeptAt"]).is_file())

    def test_it_refuses_a_file_that_is_not_ours(self):
        junk = self.work / "random.db"
        conn = sqlite3.connect(str(junk))
        conn.execute("CREATE TABLE unrelated (x INTEGER)")
        conn.commit()
        conn.close()

        with self.assertRaises(ValueError):
            backup.import_from(junk)

    def test_a_missing_file_is_an_error_not_a_traceback(self):
        with self.assertRaises(FileNotFoundError):
            backup.import_from(self.work / "nope.db")


class CliTests(BackupTestCase):
    def test_usage_and_round_trip(self):
        import io
        from contextlib import redirect_stdout

        out = self.work / "cli.db"
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.assertEqual(backup.main(["export", str(out)]), 0)
        self.assertIn('"ok": true', buffer.getvalue())

        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.assertEqual(backup.main(["import", str(out)]), 0)
        self.assertIn('"ok": true', buffer.getvalue())

        with redirect_stdout(io.StringIO()):
            for bad in (["export"], ["import"], [], ["nonsense"]):
                self.assertNotEqual(backup.main(bad), 0)

    def test_a_bad_path_reports_rather_than_raises(self):
        import io
        from contextlib import redirect_stdout

        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = backup.main(["import", str(self.work / "missing.db")])
        self.assertEqual(code, 1)
        self.assertIn('"ok": false', buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
