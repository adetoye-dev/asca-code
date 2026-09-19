#!/usr/bin/env python3
"""db_cli.py — JSON command line over `app_db`.

The workbench's state lives in one SQLite database owned by this Python package
(see `app_db`). The development bridge and the packaged Tauri commands are both
Node-free of that schema, so they shell out to this CLI rather than reimplement
it: one schema, one migration path, no drift.

Contract
────────
    python3 core-engine/db_cli.py <command> [json-payload]

Reads a JSON object from `argv[2]` (or stdin when absent) and writes a JSON
object to stdout. Success is `{"ok": true, "data": ...}`; failure is
`{"ok": false, "error": "..."}` with a non-zero exit code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

import env_file  # noqa: E402

# A machine-local `.env` may define credentials, which outrank the database.
env_file.load_env_file()

import app_db  # noqa: E402


def _payload(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("payload must be a JSON object")
    return parsed


def _cmd_settings_get(_: dict) -> Any:
    return app_db.get_settings()


def _cmd_settings_set(p: dict) -> Any:
    app_db.set_setting(str(p["key"]), p.get("value"))
    return True


def _cmd_settings_delete(p: dict) -> Any:
    app_db.delete_setting(str(p["key"]))
    return True


def _cmd_providers_get(_: dict) -> Any:
    return app_db.get_providers()


def _cmd_providers_upsert(p: dict) -> Any:
    app_db.upsert_provider(
        str(p["id"]),
        base_url=p.get("baseUrl"),
        selected_model=p.get("selectedModel"),
        available_models=p.get("availableModels"),
    )
    return True


def _cmd_providers_resolve_key(p: dict) -> Any:
    # Server-side only: the bridge injects this into the engine call and never
    # returns it to the client.
    return app_db.resolve_api_key(str(p["id"]))


def _cmd_secrets_list(_: dict) -> Any:
    return app_db.list_secret_names()


def _cmd_secrets_set(p: dict) -> Any:
    app_db.set_secret(str(p["name"]), str(p.get("value") or ""))
    return True


def _cmd_secrets_delete(p: dict) -> Any:
    app_db.delete_secret(str(p["name"]))
    return True


def _cmd_projects_list(p: dict) -> Any:
    return app_db.list_projects(int(p.get("limit", 10)))


def _cmd_projects_touch(p: dict) -> Any:
    app_db.touch_project(str(p["path"]), str(p.get("name") or ""), bool(p.get("makeActive", True)))
    return True


def _cmd_projects_forget(p: dict) -> Any:
    app_db.forget_project(str(p["path"]))
    return True


def _cmd_projects_active(_: dict) -> Any:
    return app_db.get_active_project()


def _cmd_projects_clear_active(_: dict) -> Any:
    app_db.clear_active_project()
    return True


def _cmd_chat_load(p: dict) -> Any:
    return app_db.load_chat(str(p.get("projectPath") or ""))


def _cmd_chat_save(p: dict) -> Any:
    app_db.save_chat(str(p.get("projectPath") or ""), list(p.get("messages") or []))
    return True


def _cmd_chat_clear(p: dict) -> Any:
    app_db.clear_chat(str(p.get("projectPath") or ""))
    return True


def _cmd_usage_record(p: dict) -> Any:
    # Both spellings are accepted: the review/inline-edit paths sent snake_case
    # while this read camelCase, so every one of those calls was recorded as 0
    # tokens and $0.00 — a silent hole in the ledger.
    def pick(*names: str, default: Any = 0) -> Any:
        for name in names:
            if p.get(name) is not None:
                return p[name]
        return default

    app_db.record_usage(
        provider=str(p.get("provider") or ""),
        model=str(p.get("model") or ""),
        prompt_tokens=int(pick("promptTokens", "prompt_tokens")),
        completion_tokens=int(pick("completionTokens", "completion_tokens")),
        latency_ms=float(pick("latencyMs", "latency_ms")),
        cost_usd=(
            float(pick("costUsd", "cost_usd"))
            if ("costUsd" in p or "cost_usd" in p)
            else None
        ),
        project_path=pick("projectPath", "project_path", default=None),
    )
    return True


def _cmd_usage_summary(p: dict) -> Any:
    return app_db.usage_summary(
        p.get("projectPath") or p.get("project_path"),
        float(p.get("sinceTs") or p.get("since_ts") or 0),
        int(p.get("days") or 14),
    )


def _cmd_info(_: dict) -> Any:
    return {"dataDir": str(app_db.data_dir()), "dbPath": str(app_db.db_path())}


COMMANDS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "info": _cmd_info,
    "settings.get": _cmd_settings_get,
    "settings.set": _cmd_settings_set,
    "settings.delete": _cmd_settings_delete,
    "providers.get": _cmd_providers_get,
    "providers.upsert": _cmd_providers_upsert,
    "providers.resolveKey": _cmd_providers_resolve_key,
    "secrets.list": _cmd_secrets_list,
    "secrets.set": _cmd_secrets_set,
    "secrets.delete": _cmd_secrets_delete,
    "projects.list": _cmd_projects_list,
    "projects.touch": _cmd_projects_touch,
    "projects.forget": _cmd_projects_forget,
    "projects.active": _cmd_projects_active,
    "projects.clearActive": _cmd_projects_clear_active,
    "chat.load": _cmd_chat_load,
    "chat.save": _cmd_chat_save,
    "chat.clear": _cmd_chat_clear,
    "usage.record": _cmd_usage_record,
    "usage.summary": _cmd_usage_summary,
}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: db_cli.py <{'|'.join(sorted(COMMANDS))}>"}))
        return 2

    command = argv[1]
    handler = COMMANDS.get(command)
    if handler is None:
        print(json.dumps({"ok": False, "error": f"unknown command: {command}"}))
        return 2

    try:
        raw = argv[2] if len(argv) > 2 else sys.stdin.read()
        result = handler(_payload(raw))
        print(json.dumps({"ok": True, "data": result}))
        return 0
    except Exception as exc:  # noqa: BLE001 - the CLI's job is to report, not raise
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv))
