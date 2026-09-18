# The agent runtime

Agent mode runs on the **Codex CLI**, shipped as a bundle resource and spawned by
the Rust layer (`codex_exec` in `.tauri/src/main.rs`). This file records what was
*verified against the binary* rather than assumed, because most of these were
found by a run failing in a way that looks like something else.

Fetch or refresh the runtime with `scripts/fetch_codex_sidecar.sh`.

## Configuration facts

Each of these was checked by running the binary, not read off documentation.

| Setting | Accepted | Notes |
| --- | --- | --- |
| `wire_api` | `"responses"` | `"chat"` is rejected outright. |
| `approval_policy` | `untrusted` · `on-failure` · `on-request` · `granular` · `never` | `untrusted` parses but is **refused at runtime** ("no longer supported"). Do not use it. |
| `approvals_reviewer` | `user` · `auto_review` · `guardian_subagent` | `"model"` and `"auto"` are config errors. |
| `sandbox_mode` | `read-only` · `workspace-write` · `danger-full-access` | |
| `model_catalog_json` | a **path** to a file | An inline value parses without error and is silently ignored. A *minimal* catalog silences the metadata warning and the agent then does nothing, so the entry needs the full field set — see `catalogJson` in `src/hooks/usePipeline.ts`. |

`approval_policy = "never"` **denies** tool calls that need approval (the runtime
says "requires approval, but approval policy is never"), so the working default is
`on-request` + `auto_review`.

TOML tables come last, so a top-level key written after a `[table]` lands inside
it and is rejected — which is why `model_catalog_json` is prepended.

Verify a combination before shipping it:

```bash
CODEX_HOME=/tmp/probe \
  .tauri/engine-codex/codex exec --strict-config --skip-git-repo-check "hi"
```

A config that cannot load says so immediately; a config that loads proceeds to
the provider and fails on the missing key instead. That distinction is the test.

## Local models (Ollama, LM Studio)

These are **not** OpenAI-compatible enough for the provider-table path: Ollama
serves `/v1/chat/completions` and does not implement the Responses API, so a
`wire_api = "responses"` entry can never reach it. They go through the runtime's
own switch instead:

```
codex exec --oss --local-provider ollama -m <model> "<task>"
```

`-m` is **required**. Without it `--oss` selects its own default model and will
start downloading it — observed pulling 12.85 GB while the config named an
already-installed 1.5B model.

### What local models can and cannot do

Verified against the installed `qwen2.5-coder:7b`: the model wrote its tool call
out as *message text* (`{"name":"spawn_agent",…}`), the turn completed, and no
file changed. Smaller local models frequently cannot drive the tool protocol.

A run with **zero tool calls** is therefore reported as such in the step list and
the Output panel, instead of being presented as a finished task. The check is
mechanical: `runAgentOnCodex` counts `command_execution`, `file_change`,
`mcp_tool_call` and `web_search` items.

## Continuing a conversation

A follow-up turn runs `codex exec resume <thread-id>` instead of a fresh `exec`,
so the agent still has everything it read and did. The id comes from the first
event of the previous run (`{"type":"thread.started","thread_id":"…"}`); the hook
keeps one live thread per project + provider + model + approval mode, and starts
a new one when any of those changes, because that is no longer the same
conversation. Threads are held in memory: a relaunch starts clean, like the CLI.

Two things about `resume` that are easy to get wrong:

* It **rejects `--oss` / `--local-provider`** ("unexpected argument") — a resumed
  thread keeps the model it was created with.
* It still needs the provider named, or it falls back to OpenAI. Verified: a
  resumed Ollama thread went to `api.openai.com` and 401'd. A config override is
  accepted where the flag is not, so resume passes
  `-c model_provider="<id>"` — the same name as our `[model_providers.*]` table
  for cloud providers, and the built-in `ollama` for local ones.

An unknown thread id fails **before the model sees anything** ("no rollout found
for thread id …"), which is what makes the retry safe: the hook drops the id and
re-runs once from scratch. That is not the two-edits risk a mid-run retry would
carry.

Verified end to end against the local model: after a resume, the thread's rollout
contains both the first turn's message and the second's, so the context travelled.
(The 1.5B model then failed to recall the number it was given — a capability
limit, not a plumbing one.)

## Failure detection

`turn.failed` decides whether a run failed. Error *items* do **not**: Codex emits
them for warnings too — a missing model-metadata entry, and a `code-mode-host`
helper it ships separately. Matching on their prose marked correct runs as
"needs attention" once already, and would again for the next warning it adds.

## Interactive approvals: the app-server protocol

Not implemented. `scripts/probe_app_server.py` drives a complete turn over it, so
the migration is a known quantity rather than an experiment — run it to see the
stream.

`codex app-server --listen stdio://` speaks newline-delimited JSON-RPC. A run is
**three requests**:

```
initialize     {clientInfo:{name,version}}                  -> userAgent, codexHome, platform
thread/start   {model, modelProvider, cwd, approvalPolicy,  -> {thread:{id,…}}
                approvalsReviewer, sandbox}
turn/start     {threadId, input:[{type:"text", text:…}]}     -> {turn}
```

then the turn streams as notifications. Responses are `{"id":N,"result":…}` —
the `jsonrpc` field is not echoed — and notifications are
`{"method":…,"params":…,"emittedAtMs":…}`.

Observed notification vocabulary on a real turn:

```
thread/started  thread/status/changed
turn/started    turn/completed
item/started    item/completed      item/agentMessage/delta
thread/tokenUsage/updated
warning         account/rateLimits/updated   remoteControl/status/changed
```

Two of those are strictly better than what `exec` gives us: **`item/agentMessage/delta`**
streams the answer as it is produced, where `exec` only delivers whole
`agent_message` items, and **`thread/tokenUsage/updated`** reports usage directly
instead of being reconstructed from `turn.completed`.

Approvals arrive as **server-initiated requests** that must be answered, which is
the whole point: `exec` is one-shot with no channel for them, so with
`approvalsReviewer = "user"` a request is auto-denied rather than shown. The four
the schema defines are `execCommandApproval`, `applyPatchApproval`,
`attestation/generate` and `openai/form`.

Generate the full definition from the binary rather than guessing — it ships the
schema and TypeScript bindings:

```bash
codex app-server generate-json-schema --out /tmp/cx-schema
codex app-server generate-ts --out /tmp/cx-ts
```

What a real implementation still needs: a long-lived child instead of a process
per run, request/response correlation by id, lifecycle management (respawn, one
turn at a time per thread), the approval UI wired back to a response, and
re-testing everything `exec` already does — model catalog, MCP servers,
attachments, `--oss` local providers, thread continuity. Do it as an isolated
change with the `exec` path intact behind a flag; a half-migrated agent is worse
than either end. `--listen` also supports `unix://` and `ws://`, and there is a
`daemon` subcommand for a shared instance.
