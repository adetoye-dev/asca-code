"""backup.py — move the app's state to another machine, or to tomorrow.

There is no way to do this today: the registry, chat history, recent projects and
the active-project pointer live in one SQLite file, and if that file is lost the
user starts over.

Two decisions worth stating, because both are defaults someone will disagree with:

* **Credentials are left out unless asked for.** The database holds provider keys
  in `secrets`. A backup is a file people copy to a NAS, a cloud folder or an
  email; putting keys in it silently would be a worse default than making the
  user ask. `--with-secrets` is there for a real migration.
* **Deleting the rows is not enough.** SQLite leaves the bytes in free pages, so
  a "stripped" copy can still contain a key that a `strings` command will find.
  The export vacuums afterwards, which rewrites the file without them. Verified
  with `strings` rather than assumed.

Reached as `acsa-engine backup export <path> [--with-secrets]` and
`acsa-engine backup import <path>`.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import app_db

MAGIC = "acsa-backup"


def _copy_database(source: Path, destination: Path) -> None:
    """Consistent copy through SQLite, so a WAL in flight cannot corrupt it."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(str(source))
    try:
        dst = sqlite3.connect(str(destination))
        try:
            src.backup(dst)
            dst.commit()
        finally:
            dst.close()
    finally:
        src.close()


def _is_acsa_database(path: Path) -> bool:
    """A SQLite file with our migration table — not just any `.db`."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error:
        return False
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        ).fetchone()
        return row is not None
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def export(destination: Path, include_secrets: bool = False) -> dict:
    """Write a copy of the app database to `destination`."""
    source = app_db.db_path()
    if not source.is_file():
        raise FileNotFoundError(f"no database at {source}")

    _copy_database(source, destination)

    removed = 0
    if not include_secrets:
        conn = sqlite3.connect(str(destination))
        try:
            removed = conn.execute("SELECT COUNT(*) FROM secrets").fetchone()[0]
            conn.execute("DELETE FROM secrets")
            conn.commit()
            # The delete leaves the bytes in free pages. This is the step that
            # actually removes them.
            conn.execute("VACUUM")
        finally:
            conn.close()

    try:
        os.chmod(destination, 0o600)
    except OSError:
        pass

    return {
        "path": str(destination),
        "secretsIncluded": include_secrets,
        "secretsRemoved": removed,
        "bytes": destination.stat().st_size,
        "exportedAt": time.time(),
    }


def import_from(source: Path) -> dict:
    """Replace the live database with `source`, keeping a copy of what was there."""
    if not source.is_file():
        raise FileNotFoundError(f"no backup at {source}")
    if not _is_acsa_database(source):
        raise ValueError(f"{source} is not an ACSA Code database")

    target = app_db.db_path()
    safety = target.with_suffix(target.suffix + ".before-import")
    if target.is_file():
        _copy_database(target, safety)
    # Stale sidecars from the database being replaced would be read alongside it.
    for suffix in ("-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()

    _copy_database(source, target)
    app_db.init_db()
    return {
        "path": str(target),
        "replacedFrom": str(source),
        "previousKeptAt": str(safety) if safety.is_file() else None,
        "importedAt": time.time(),
    }


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    action = args[0] if args else ""

    try:
        if action == "export":
            if len(args) < 2:
                raise ValueError("backup export needs a destination path")
            data = export(Path(args[1]).expanduser(), include_secrets="--with-secrets" in args)
        elif action == "import":
            if len(args) < 2:
                raise ValueError("backup import needs a source path")
            data = import_from(Path(args[1]).expanduser())
        else:
            print(json.dumps({"ok": False, "error": "usage: backup export|import <path>"}))
            return 2
    except Exception as exc:  # noqa: BLE001 - reported, not traced back at the user
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1

    print(json.dumps({"ok": True, "data": data}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
