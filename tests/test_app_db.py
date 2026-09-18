"""The app's own database: one owner, secrets kept out of the UI, real auth."""

import importlib
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import app_db


class AppDbTestCase(unittest.TestCase):
    """Every test gets a private database so the real one is never touched."""

    def setUp(self):
        self.data_dir = Path(tempfile.mkdtemp(prefix="acsa-appdb-"))
        self._previous = os.environ.get("ACSA_DATA_DIR")
        os.environ["ACSA_DATA_DIR"] = str(self.data_dir)
        importlib.reload(app_db)
        app_db.init_db()

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("ACSA_DATA_DIR", None)
        else:
            os.environ["ACSA_DATA_DIR"] = self._previous
        shutil.rmtree(self.data_dir, ignore_errors=True)
        importlib.reload(app_db)


class SchemaTests(AppDbTestCase):
    def test_a_scoped_connection_closes_when_its_block_ends(self):
        # `with sqlite3.connect(...) as conn` only commits; it does not close.
        # The connection here is a subclass that does, because every caller
        # treats the block as the connection's lifetime — and the ones that did
        # not left open handles for the collector (Python 3.14 warns about it).
        with app_db.connect() as conn:
            self.assertEqual(conn.execute("SELECT 1").fetchone()[0], 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")

    def test_database_file_is_owner_only(self):
        app_db.connect().close()
        mode = stat.S_IMODE(app_db.db_path().stat().st_mode)
        self.assertEqual(mode, 0o600, f"expected 0600, got {oct(mode)}")

    def test_migrations_are_idempotent(self):
        app_db.init_db()
        app_db.init_db()
        with app_db.connect() as conn:
            applied = conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
        self.assertEqual(applied, app_db.SCHEMA_VERSION)

    def test_expected_tables_exist(self):
        with app_db.connect() as conn:
            names = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        for table in ("settings", "providers", "secrets", "projects", "chat_messages",
                      "usage_events", "accounts", "auth_sessions"):
            self.assertIn(table, names)


class SettingsAndProvidersTests(AppDbTestCase):
    def test_settings_round_trip_json_values(self):
        app_db.set_setting("selected_model", {"id": "m", "n": 2})
        app_db.set_setting("ollama_ready", True)
        settings = app_db.get_settings()
        self.assertEqual(settings["selected_model"], {"id": "m", "n": 2})
        self.assertIs(settings["ollama_ready"], True)

    def test_provider_upsert_is_partial(self):
        app_db.upsert_provider("deepseek", base_url="https://api.deepseek.com/v1")
        app_db.upsert_provider("deepseek", selected_model="deepseek-flash")
        provider = app_db.get_providers()["deepseek"]
        self.assertEqual(provider["baseUrl"], "https://api.deepseek.com/v1")
        self.assertEqual(provider["selectedModel"], "deepseek-flash")

    def test_providers_report_key_presence_without_the_key(self):
        app_db.set_secret("deepseek_api_key", "sk-super-secret")
        provider = app_db.get_providers().get("deepseek")
        # No providers row needed for the flag to be meaningful, but the settings
        # payload itself must never carry the value.
        self.assertNotIn("sk-super-secret", json.dumps(app_db.get_providers()))
        self.assertTrue(app_db.has_secret("deepseek_api_key"))
        if provider is not None:
            self.assertTrue(provider["hasApiKey"])

    def test_clearing_a_secret_with_empty_value(self):
        app_db.set_secret("groq_api_key", "abc")
        app_db.set_secret("groq_api_key", "")
        self.assertFalse(app_db.has_secret("groq_api_key"))


class SecretResolutionTests(AppDbTestCase):
    def test_environment_wins_over_the_database(self):
        app_db.set_secret("deepseek_api_key", "from-database")
        os.environ["ACSA_DEEPSEEK_API_KEY"] = "from-environment"
        try:
            self.assertEqual(app_db.resolve_api_key("deepseek"), "from-environment")
        finally:
            os.environ.pop("ACSA_DEEPSEEK_API_KEY", None)
        self.assertEqual(app_db.resolve_api_key("deepseek"), "from-database")

    def test_generic_environment_key_is_a_fallback(self):
        os.environ["AIDE_API_KEY"] = "generic-env-key"
        try:
            self.assertEqual(app_db.resolve_api_key("openai"), "generic-env-key")
        finally:
            os.environ.pop("AIDE_API_KEY", None)

    def test_resolution_is_none_when_nothing_is_configured(self):
        os.environ.pop("AIDE_API_KEY", None)
        os.environ.pop("ACSA_API_KEY", None)
        self.assertIsNone(app_db.resolve_api_key("openai"))


class ProjectRegistryTests(AppDbTestCase):
    def test_active_project_is_singular_and_tracks_the_latest(self):
        app_db.touch_project("/tmp/one", "one")
        app_db.touch_project("/tmp/two", "two")
        self.assertEqual(app_db.get_active_project()["path"], "/tmp/two")
        with app_db.connect() as conn:
            active = conn.execute("SELECT COUNT(*) FROM projects WHERE is_active = 1").fetchone()[0]
        self.assertEqual(active, 1)
        self.assertEqual([p["path"] for p in app_db.list_projects()][0], "/tmp/two")

    def test_forget_project_also_drops_its_transcript(self):
        app_db.touch_project("/tmp/one", "one")
        app_db.save_chat("/tmp/one", [{"id": "m1", "role": "user", "content": "hi", "timestamp": 1_700_000_000_000}])
        app_db.forget_project("/tmp/one")
        self.assertEqual(app_db.list_projects(), [])
        self.assertEqual(app_db.load_chat("/tmp/one"), [])


class ChatHistoryTests(AppDbTestCase):
    def test_round_trip_and_project_isolation(self):
        messages = [
            {"id": "m1", "role": "user", "content": "build a thing", "timestamp": 1_700_000_000_000},
            {"id": "m2", "role": "assistant", "content": "done", "model": "deepseek-flash", "timestamp": 1_700_000_001_000},
        ]
        app_db.save_chat("/tmp/a", messages)
        app_db.save_chat("/tmp/b", [{"id": "x", "role": "user", "content": "other", "timestamp": 1}])
        loaded = app_db.load_chat("/tmp/a")
        self.assertEqual([m["id"] for m in loaded], ["m1", "m2"])
        self.assertEqual(loaded[1]["model"], "deepseek-flash")
        self.assertEqual([m["content"] for m in app_db.load_chat("/tmp/b")], ["other"])

    def test_saving_replaces_rather_than_appends(self):
        app_db.save_chat("/tmp/a", [{"id": "m1", "role": "user", "content": "one", "timestamp": 1}])
        app_db.save_chat("/tmp/a", [{"id": "m2", "role": "user", "content": "two", "timestamp": 2}])
        self.assertEqual([m["content"] for m in app_db.load_chat("/tmp/a")], ["two"])

    def test_error_and_provider_flags_survive(self):
        app_db.save_chat("/tmp/a", [
            {"id": "m1", "role": "assistant", "content": "boom", "error": True, "provider": "deepseek", "timestamp": 5}
        ])
        message = app_db.load_chat("/tmp/a")[0]
        self.assertTrue(message["error"])
        self.assertEqual(message["provider"], "deepseek")

    def test_ui_only_fields_round_trip(self):
        # Attached images and step telemetry live only on the message object, so
        # the stored payload has to carry them.
        app_db.save_chat("/tmp/a", [
            {
                "id": "m1",
                "role": "user",
                "content": "look at this",
                "images": ["data:image/png;base64,AAAA"],
                "steps": [{"name": "Read File", "status": "done"}],
                "timestamp": 5,
            }
        ])
        message = app_db.load_chat("/tmp/a")[0]
        self.assertEqual(message["images"], ["data:image/png;base64,AAAA"])
        self.assertEqual(message["steps"][0]["name"], "Read File")


class UsageLedgerTests(AppDbTestCase):
    def test_summary_aggregates_and_filters(self):
        app_db.record_usage("deepseek", "deepseek-flash", 100, 50, 1200.0, 0.01, "/tmp/a")
        app_db.record_usage("deepseek", "deepseek-flash", 200, 80, 900.0, 0.02, "/tmp/a")
        app_db.record_usage("ollama", "qwen2.5-coder:7b", 10, 5, 100.0, 0.0, "/tmp/b")

        everything = app_db.usage_summary()
        self.assertEqual(everything["total_calls"], 3)
        self.assertEqual(everything["prompt_tokens"], 310)
        self.assertEqual(everything["total_tokens"], 310 + 135)
        self.assertAlmostEqual(everything["cost_usd"], 0.03, places=6)
        # One entry per day of the window, even on days with no activity.
        self.assertEqual(len(everything["daily"]), 14)
        self.assertEqual(sum(day["calls"] for day in everything["daily"]), 3)
        self.assertEqual(len(everything["recent"]), 3)

        scoped = app_db.usage_summary("/tmp/a")
        self.assertEqual(scoped["total_calls"], 2)
        self.assertEqual([row["model"] for row in scoped["by_model"]], ["deepseek-flash"])

    def test_cost_is_derived_when_the_caller_omits_it(self):
        # Callers used to pass cost_usd=0 for hosted providers, so the spend
        # panel read $0.00 while real money was being spent.
        app_db.record_usage("deepseek", "deepseek-flash", 1_000_000, 1_000_000)
        row = app_db.usage_summary()["recent"][0]
        self.assertAlmostEqual(row["cost_usd"], 0.27 + 1.10, places=6)

    def test_local_models_are_free(self):
        app_db.record_usage("ollama", "qwen2.5-coder:7b", 10_000, 10_000)
        self.assertEqual(app_db.usage_summary()["recent"][0]["cost_usd"], 0.0)


class AccountTests(AppDbTestCase):
    def test_password_is_hashed_with_a_salt(self):
        account = app_db.create_account("Dev@Example.com", "correct horse battery")
        self.assertEqual(account["email"], "dev@example.com")
        with app_db.connect() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account["id"],)).fetchone()
        self.assertNotIn("correct horse battery", row["password_hash"])
        self.assertNotEqual(row["password_hash"], row["password_salt"])
        self.assertGreaterEqual(row["iterations"], 100_000)

    def test_login_accepts_the_right_password_and_rejects_others(self):
        app_db.create_account("dev@example.com", "correct horse battery")
        self.assertIsNotNone(app_db.verify_login("DEV@example.com", "correct horse battery"))
        self.assertIsNone(app_db.verify_login("dev@example.com", "wrong"))
        self.assertIsNone(app_db.verify_login("nobody@example.com", "correct horse battery"))

    def test_duplicate_and_weak_credentials_are_refused(self):
        app_db.create_account("dev@example.com", "correct horse battery")
        with self.assertRaises(ValueError):
            app_db.create_account("dev@example.com", "correct horse battery")
        with self.assertRaises(ValueError):
            app_db.create_account("other@example.com", "short")
        with self.assertRaises(ValueError):
            app_db.create_account("not-an-email", "correct horse battery")


class SessionTests(AppDbTestCase):
    def setUp(self):
        super().setUp()
        self.account = app_db.create_account("dev@example.com", "correct horse battery")

    def test_token_is_stored_only_as_a_digest(self):
        token = app_db.create_session(self.account["id"])
        with app_db.connect() as conn:
            stored = conn.execute("SELECT token_hash FROM auth_sessions").fetchone()["token_hash"]
        self.assertNotEqual(stored, token)
        self.assertEqual(len(stored), 64)  # sha256 hex

    def test_validate_round_trip_and_revoke(self):
        token = app_db.create_session(self.account["id"])
        self.assertEqual(app_db.validate_session(token)["email"], "dev@example.com")
        app_db.revoke_session(token)
        self.assertIsNone(app_db.validate_session(token))

    def test_expired_session_is_rejected_and_pruned(self):
        token = app_db.create_session(self.account["id"], ttl_seconds=-1)
        self.assertIsNone(app_db.validate_session(token))
        with app_db.connect() as conn:
            remaining = conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0]
        self.assertEqual(remaining, 0)

    def test_password_change_invalidates_existing_sessions(self):
        token = app_db.create_session(self.account["id"])
        self.assertTrue(
            app_db.change_password(self.account["id"], "correct horse battery", "a-new-password")
        )
        self.assertIsNone(app_db.validate_session(token))
        self.assertIsNotNone(app_db.verify_login("dev@example.com", "a-new-password"))

    def test_password_change_requires_the_current_password(self):
        self.assertFalse(app_db.change_password(self.account["id"], "nope", "a-new-password"))
        self.assertIsNotNone(app_db.verify_login("dev@example.com", "correct horse battery"))


class DatabaseCliTests(AppDbTestCase):
    """The bridge and the packaged app talk to the database through this CLI."""

    def _run(self, *args, stdin: str = ""):
        cli = Path(__file__).resolve().parent.parent / "core-engine" / "db_cli.py"
        env = {**os.environ, "ACSA_DATA_DIR": str(self.data_dir)}
        proc = subprocess.run(
            [sys.executable, str(cli), *args],
            input=stdin, capture_output=True, text=True, env=env, timeout=60,
        )
        return proc.returncode, json.loads(proc.stdout.strip().splitlines()[-1])

    def test_settings_and_secret_round_trip(self):
        code, out = self._run("settings.set", json.dumps({"key": "k", "value": {"a": 1}}))
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])

        code, out = self._run("secrets.set", json.dumps({"name": "openai_api_key", "value": "sk-1"}))
        self.assertTrue(out["ok"])

        _, out = self._run("providers.resolveKey", json.dumps({"id": "openai"}))
        self.assertEqual(out["data"], "sk-1")

        _, out = self._run("secrets.list")
        self.assertEqual(out["data"], ["openai_api_key"])

    def test_resolved_key_never_appears_in_providers_payload(self):
        self._run("secrets.set", json.dumps({"name": "deepseek_api_key", "value": "sk-secret"}))
        self._run("providers.upsert", json.dumps({"id": "deepseek", "selectedModel": "deepseek-flash"}))
        _, out = self._run("providers.get")
        self.assertNotIn("sk-secret", json.dumps(out))
        self.assertTrue(out["data"]["deepseek"]["hasApiKey"])

    def test_project_and_chat_commands(self):
        self._run("projects.touch", json.dumps({"path": "/tmp/x", "name": "x"}))
        _, out = self._run("projects.active")
        self.assertEqual(out["data"]["path"], "/tmp/x")

        self._run("chat.save", json.dumps({
            "projectPath": "/tmp/x",
            "messages": [{"id": "m1", "role": "user", "content": "hi", "timestamp": 1}],
        }))
        _, out = self._run("chat.load", json.dumps({"projectPath": "/tmp/x"}))
        self.assertEqual(out["data"][0]["content"], "hi")

    def test_auth_login_issues_a_session_token(self):
        self._run("auth.register", json.dumps({"email": "a@b.com", "password": "long-enough-pw"}))
        code, out = self._run("auth.login", json.dumps({"email": "a@b.com", "password": "long-enough-pw"}))
        self.assertEqual(code, 0, out)
        token = out["data"]["token"]
        _, me = self._run("auth.me", json.dumps({"token": token}))
        self.assertEqual(me["data"]["email"], "a@b.com")

    def test_bad_credentials_fail_with_nonzero_exit(self):
        self._run("auth.register", json.dumps({"email": "a@b.com", "password": "long-enough-pw"}))
        code, out = self._run("auth.login", json.dumps({"email": "a@b.com", "password": "wrong-password"}))
        self.assertEqual(code, 1)
        self.assertFalse(out["ok"])

    def test_unknown_command_is_reported(self):
        code, out = self._run("nope.nope")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
