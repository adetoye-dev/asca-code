#!/usr/bin/env python3
"""git_cli.py — the source-control actions the workbench asks for.

Why this exists: these were implemented in `vite-fs-bridge.ts`, a Vite dev-server
middleware, by shelling out to the `git` CLI. `configureServer()` never runs in a
build, so source control was dead in the packaged app — the whole panel, on a
repository the user was probably already working in.

Nothing here is new behaviour: each action is the same `git` invocation the bridge
made, with the same response shape, so the callers did not have to change.

Usage: python3 git_cli.py status '{"cwd": "/path/to/repo"}'
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# Local actions are instant; anything that talks to a remote can take a while.
LOCAL_TIMEOUT = 20
REMOTE_TIMEOUT = 180


def _run(cwd: str, args: list[str], timeout: int = LOCAL_TIMEOUT) -> tuple[bool, str, str]:
    """Run git, returning (ok, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return False, "", "git is not installed or not on PATH."
    except subprocess.TimeoutExpired:
        return False, "", f"git {' '.join(args)} timed out."
    except OSError as exc:
        return False, "", str(exc)
    return result.returncode == 0, result.stdout, result.stderr


def _cwd(payload: dict) -> str:
    candidate = str(payload.get("cwd") or os.getcwd())
    return candidate if Path(candidate).is_dir() else os.getcwd()


def _file(payload: dict) -> str:
    return str(payload.get("filePath") or "").strip()


def parse_status(stdout: str) -> dict:
    """Turn `git status --porcelain=v1 -b` output into the shape the panel expects."""
    lines = stdout.strip().split("\n")
    header = lines[0] if lines else ""
    branch = "main"
    ahead = behind = 0

    # `## main...origin/main [ahead 1, behind 2]`
    head = header[3:] if header.startswith("## ") else ""
    if head:
        branch = head.split("...")[0].split(" ")[0] or branch
    if "ahead " in header:
        ahead = int("".join(c for c in header.split("ahead ")[1].split(",")[0] if c.isdigit()) or 0)
    if "behind " in header:
        behind = int("".join(c for c in header.split("behind ")[1].split("]")[0] if c.isdigit()) or 0)

    staged: list[dict] = []
    unstaged: list[dict] = []
    files: list[dict] = []
    for line in lines[1:]:
        if not line.strip() or len(line) < 3:
            continue
        index_status, worktree_status = line[0], line[1]
        item = {
            "path": line[3:].strip(),
            "indexStatus": index_status,
            "workTreeStatus": worktree_status,
        }
        files.append({**item, "isStaged": index_status not in (" ", "?")})
        if index_status not in (" ", "?"):
            staged.append({**item, "isStaged": True})
        if worktree_status != " " or index_status == "?":
            unstaged.append({**item, "isStaged": False})

    return {
        "isGit": True,
        "branch": branch,
        "ahead": ahead,
        "behind": behind,
        "staged": staged,
        "unstaged": unstaged,
        "files": files,
    }


def status(payload: dict) -> dict:
    ok, stdout, _ = _run(_cwd(payload), ["status", "--porcelain=v1", "-b"])
    if not ok:
        return {"isGit": False, "branch": "none", "staged": [], "unstaged": [], "files": []}
    return parse_status(stdout)


def diff_file(payload: dict) -> dict:
    """Return the two sides of a file so the editor can show a real diff."""
    cwd, file_path = _cwd(payload), _file(payload)
    staged = bool(payload.get("staged"))

    # HEAD side: the index when the change is staged, otherwise HEAD itself.
    original_args = (
        ["show", f":{file_path}"] if staged else ["show", f"HEAD:{file_path}"]
    )
    ok, original, _ = _run(cwd, original_args)
    if not ok:
        original = ""

    if staged:
        # Staged means "HEAD vs index"; an empty side means a new file.
        ok_head, head_content, _ = _run(cwd, ["show", f"HEAD:{file_path}"])
        original, modified = (head_content if ok_head else ""), original
    else:
        try:
            modified = Path(cwd, file_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            modified = ""

    return {"success": True, "originalContent": original, "modifiedContent": modified}


def _simple(payload: dict, args: list[str], *, ok_key: str = "output") -> dict:
    ok, stdout, stderr = _run(_cwd(payload), args)
    if not ok:
        return {"success": False, "error": (stderr or stdout or "git failed").strip()}
    return {"success": True, ok_key: (stdout or stderr).strip()}


def stage(payload: dict) -> dict:
    return _simple(payload, ["add", "--", _file(payload)])


def unstage(payload: dict) -> dict:
    """Unstage without losing the change: restore, then two older fallbacks."""
    cwd, file_path = _cwd(payload), _file(payload)
    for args in (
        ["restore", "--staged", "--", file_path],
        ["rm", "--cached", "--", file_path],
        ["reset", "HEAD", "--", file_path],
    ):
        ok, stdout, _ = _run(cwd, args)
        if ok:
            return {"success": True, "output": stdout.strip()}
    return {"success": False, "error": "Could not unstage the file."}


def discard(payload: dict) -> dict:
    """Revert working-tree changes; untracked files are removed."""
    cwd, file_path = _cwd(payload), _file(payload)
    ok, stdout, _ = _run(cwd, ["checkout", "--", file_path])
    if ok:
        return {"success": True, "output": stdout.strip()}
    ok, stdout, stderr = _run(cwd, ["clean", "-f", "--", file_path])
    if ok:
        return {"success": True, "output": stdout.strip()}
    return {"success": False, "error": (stderr or "Could not discard changes.").strip()}


def stage_all(payload: dict) -> dict:
    return _simple(payload, ["add", "-A"])


def unstage_all(payload: dict) -> dict:
    ok, stdout, _ = _run(_cwd(payload), ["restore", "--staged", "."])
    if ok:
        return {"success": True, "output": stdout.strip()}
    return _simple(payload, ["reset", "HEAD", "."])


def commit(payload: dict) -> dict:
    cwd = _cwd(payload)
    message = str(payload.get("message") or "").strip()
    if not message:
        return {"success": False, "error": "A commit message is required."}
    if payload.get("stageAll"):
        ok, _, stderr = _run(cwd, ["add", "-A"])
        if not ok:
            return {"success": False, "error": stderr.strip()}
    ok, stdout, stderr = _run(cwd, ["commit", "-m", message])
    if not ok:
        return {"success": False, "error": (stderr or stdout).strip()}
    return {"success": True, "message": (stdout or stderr).strip()}


def branches(payload: dict) -> dict:
    ok, stdout, _ = _run(_cwd(payload), ["branch", "--format=%(refname:short)|%(HEAD)"])
    if not ok:
        return {"branches": []}
    parsed = []
    for line in stdout.strip().split("\n"):
        if not line.strip():
            continue
        name, _, marker = line.partition("|")
        parsed.append({"name": name.strip(), "current": marker.strip() == "*"})
    return {"branches": parsed}


def checkout(payload: dict) -> dict:
    branch = str(payload.get("branch") or "").strip()
    if not branch:
        return {"success": False, "error": "A branch name is required."}
    args = ["checkout", "-b", branch] if payload.get("createNew") else ["checkout", branch]
    return _simple(payload, args)


def pull(payload: dict) -> dict:
    return _simple(payload, ["pull"], ok_key="output")


def push(payload: dict) -> dict:
    cwd = _cwd(payload)
    ok, stdout, stderr = _run(cwd, ["push"], timeout=REMOTE_TIMEOUT)
    if ok:
        return {"success": True, "output": (stdout or stderr).strip()}
    # A branch with no upstream is the common first-push failure; set it and retry
    # rather than making the user do it in a terminal.
    if "no upstream" in (stderr or "").lower() or "set-upstream" in (stderr or "").lower():
        ok, stdout, stderr = _run(cwd, ["push", "-u", "origin", "HEAD"], timeout=REMOTE_TIMEOUT)
        if ok:
            return {"success": True, "output": (stdout or stderr).strip()}
    return {"success": False, "error": (stderr or stdout or "git push failed").strip()}


def clone(payload: dict) -> dict:
    url = str(payload.get("url") or "").strip()
    target = str(payload.get("targetDir") or "").strip()
    if not url:
        return {"success": False, "error": "A repository URL is required."}
    if not target:
        return {"success": False, "error": "A target directory is required."}
    dest = Path(os.path.expanduser(target))
    if dest.exists() and any(dest.iterdir()):
        return {"success": False, "error": f"{dest} already exists and is not empty."}
    dest.parent.mkdir(parents=True, exist_ok=True)
    ok, stdout, stderr = _run(
        str(dest.parent), ["clone", url, str(dest)], timeout=REMOTE_TIMEOUT
    )
    if not ok:
        return {"success": False, "error": (stderr or stdout).strip()}
    return {"success": True, "targetDir": str(dest), "output": (stdout or stderr).strip()}


COMMANDS = {
    "status": status,
    "diff-file": diff_file,
    "stage": stage,
    "unstage": unstage,
    "discard": discard,
    "stage-all": stage_all,
    "unstage-all": unstage_all,
    "commit": commit,
    "branches": branches,
    "checkout": checkout,
    "pull": pull,
    "push": push,
    "clone": clone,
}


def run(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(json.dumps({"ok": False, "error": f"usage: git_cli.py <{'|'.join(COMMANDS)}> [json]"}))
        return 2

    handler = COMMANDS.get(argv[1])
    if handler is None:
        print(json.dumps({"ok": False, "error": f"unknown command: {argv[1]}"}))
        return 2

    try:
        raw = argv[2] if len(argv) > 2 else (sys.stdin.read() or "{}")
        payload = json.loads(raw or "{}")
        print(json.dumps({"ok": True, "data": handler(payload)}))
        return 0
    except Exception as exc:  # noqa: BLE001 - the CLI reports, it does not raise
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv))
