#!/usr/bin/env python3
"""Drive one turn through `codex app-server` — the reference for the migration.

Not part of the app: this is the working recipe, kept because it is fiddly to
rediscover and because the next step is to move the agent onto this protocol.

It exists to answer one question with evidence — what does a run actually take
over JSON-RPC? — and the answer is three requests and a notification stream:

    initialize      {clientInfo:{name,version}}          -> userAgent, codexHome
    thread/start    {model, modelProvider, cwd,          -> {thread:{id,...}}
                     approvalPolicy, approvalsReviewer,
                     sandbox}
    turn/start      {threadId, input:[{type,text}]}      -> {turn}
    ...then the turn streams as notifications.

Why this matters: `exec` is one-shot, so an approval request has no channel to
be answered on — with `approvalsReviewer = "user"` it is auto-denied. App-server
sends approvals as *server-to-client requests* (`execCommandApproval`,
`applyPatchApproval`, `attestation/generate`, `openai/form`) that the client must
answer. It also streams `item/agentMessage/delta` and
`thread/tokenUsage/updated`, which `exec` makes us reconstruct from whole
messages and `turn.completed`.

Framing is newline-delimited JSON. Responses come back as `{"id":N,"result":...}`
— note the `jsonrpc` field is not echoed — and notifications are
`{"method":...,"params":...,"emittedAtMs":...}`.

Usage:
    python3 scripts/probe_app_server.py            # local Ollama, needs it running
    ACSA_PROBE_MODEL=... python3 scripts/probe_app_server.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BIN = str(REPO / ".tauri" / "engine-codex" / "codex")
CODEX_HOME = os.environ.get("ACSA_PROBE_HOME", "/tmp/acsa-appserver-probe")
WORKSPACE = os.environ.get("ACSA_PROBE_WORKSPACE", "/tmp/acsa-appserver-ws")
MODEL = os.environ.get("ACSA_PROBE_MODEL", "qwen2.5-coder:1.5b")
PROVIDER = os.environ.get("ACSA_PROBE_PROVIDER", "ollama")
TIMEOUT_S = float(os.environ.get("ACSA_PROBE_TIMEOUT", "120"))


def main() -> int:
    if not Path(BIN).exists():
        print(f"missing runtime: {BIN}\nrun scripts/fetch_codex_sidecar.sh", file=sys.stderr)
        return 1
    Path(CODEX_HOME).mkdir(parents=True, exist_ok=True)
    Path(WORKSPACE).mkdir(parents=True, exist_ok=True)
    # No provider table: `modelProvider` names the built-in local provider.
    (Path(CODEX_HOME) / "config.toml").write_text(
        'approval_policy = "on-request"\n'
        'approvals_reviewer = "auto_review"\n'
        'sandbox_mode = "workspace-write"\n',
        encoding="utf-8",
    )

    proc = subprocess.Popen(
        [BIN, "app-server", "--listen", "stdio://"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        env={
            **os.environ,
            "CODEX_HOME": CODEX_HOME,
            # Same arrangement as the app: the credential reaches the child by
            # environment name, never as an argument.
            "ACSA_CODEX_API_KEY": os.environ.get("ACSA_CODEX_API_KEY", ""),
        },
    )

    state: dict[str, str] = {}
    notifications: list[str] = []
    done = threading.Event()

    def reader() -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get("id") == 2 and "result" in message:
                state["thread"] = message["result"]["thread"]["id"]
            method = message.get("method")
            if not method:
                continue
            notifications.append(method)
            if method == "item/agentMessage/delta":
                sys.stdout.write(message["params"].get("delta", ""))
                sys.stdout.flush()
            if method in ("turn/completed", "turn/failed"):
                print(f"\n[{method}]")
                done.set()

    threading.Thread(target=reader, daemon=True).start()

    def send(message: dict) -> None:
        proc.stdin.write(json.dumps(message) + "\n")  # type: ignore[union-attr]
        proc.stdin.flush()  # type: ignore[union-attr]

    send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
          "params": {"clientInfo": {"name": "acsa-probe", "version": "0.0.1"}}})
    time.sleep(1.5)
    send({"jsonrpc": "2.0", "id": 2, "method": "thread/start",
          "params": {"model": MODEL, "modelProvider": PROVIDER, "cwd": WORKSPACE,
                     "approvalPolicy": "on-request",
                     "approvalsReviewer": "auto_review",
                     "sandbox": "workspace-write"}})

    deadline = time.time() + 30
    while "thread" not in state and time.time() < deadline:
        time.sleep(0.2)
    if "thread" not in state:
        print("thread/start did not answer: is the provider reachable?", file=sys.stderr)
        proc.terminate()
        return 1

    prompt = os.environ.get("ACSA_PROBE_PROMPT", "Reply with just: ready")
    send({"jsonrpc": "2.0", "id": 3, "method": "turn/start",
          "params": {"threadId": state["thread"],
                     "input": [{"type": "text", "text": prompt}]}})

    done.wait(TIMEOUT_S)
    proc.terminate()
    print("\nnotifications:", sorted(set(notifications)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
