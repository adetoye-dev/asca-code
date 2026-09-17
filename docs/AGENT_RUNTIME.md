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

## Token usage

`turn.completed` carries the counts, one per turn:

```json
{"type":"turn.completed","usage":{"input_tokens":2050,"cached_input_tokens":0,
 "cache_write_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0}}
```

Rust sums them and emits `codex:usage` just before `codex:exit`; the hook records
one row in the usage ledger against the provider and model. Emitting it *before*
the exit event matters — the UI treats `codex:exit` as the end of the run.

## Approval modes

Chosen up front in Settings → AI Assistant → Agent, and mapped in
`src/services/agentApproval.ts`:

| Mode | `approval_policy` | `approvals_reviewer` | `sandbox_mode` |
| --- | --- | --- | --- |
| Read only | `on-request` | `auto_review` | `read-only` |
| Approve for me (default) | `on-request` | `auto_review` | `workspace-write` |
| Full access | `never` | `user` | `danger-full-access` |

There is no interactive "ask me" mode yet. `codex exec` is one-shot and
non-interactive: it has no channel to answer `ExecApprovalRequest`, so a prompt
would be auto-denied rather than shown. That needs the app-server protocol, which
is a different transport; until then the mode picker *is* the approval surface,
and the chat has no approve/reject card to mislead anyone.

## Credentials

The API key never travels over IPC. The Rust side asks the engine
(`db providers.resolveKey`) and sets it in the child's environment as
`ACSA_CODEX_API_KEY`; the provider table refers to it by name via `env_key`.

The runtime uses its own `CODEX_HOME` under the app's data directory — never the
user's `~/.codex` — so their own Codex setup is untouched.
