# Production checklist

Status legend: **[done]** implemented and verified · **[partial]** some of it
exists · **[open]** not started.

Anything marked open is a real gap for shipping to someone else's machine.

## Data & state

| Item | Status | Notes |
| --- | --- | --- |
| App-owned database | **[done]** | SQLite via `core-engine/app_db.py`, one schema + migration path, reached over IPC through the `db` engine subcommand. |
| State out of browser storage | **[done]** | Provider registry, credentials, chat history, recent projects and the active-project pointer moved out of `localStorage`. Existing values are migrated once and the browser copies deleted. |
| Credentials never reach the page | **[done]** | Keys are write-only across the API (`hasApiKey`, no value). Resolved server-side by the engine, and put into the agent child's environment by the Rust layer. |
| Database file permissions | **[done]** | Data dir `0700`, database and its WAL/SHM `0600`. |
| Encryption at rest | **[open]** | The standard library has no authenticated cipher, so secrets sit in a `0600` file rather than a fake-encrypted one. Next step is OS keychain (macOS Keychain / Windows Credential Manager) via a Tauri plugin. |
| Backup / restore | **[open]** | No export or import of the database. Users have no way to move their settings to a new machine. |
| Data retention | **[partial]** | Chat trimmed to the 100 most recent messages per project; the usage ledger grows without bound. |

## Configuration & secrets

| Item | Status | Notes |
| --- | --- | --- |
| Environment overrides | **[done]** | `.env` (repo root or `$ACSA_DATA_DIR`) documented in `.env.example`; provider keys, `ACSA_SECRET_*`, tuning flags. Real environment beats the file, and the file beats the database. |
| No secrets in the repo | **[done]** | Only `.env.example` is tracked; `.env` is gitignored. |
| Secrets in logs | **[done]** | The picture was checked rather than assumed. The engine's loggers emit paths, counts and exceptions — never contents. Nothing writes a log *file*; the activity log is in-memory state. The runtime's stdout/stderr is forwarded verbatim, so free text passes through `redact_for_display`: it masks credential-shaped text and any secret we handed the child, wherever it appears. `agent:event` is deliberately excluded — it is JSON-RPC the UI parses and answers, and an approval has to show the command being approved. Residual: a key echoed in the model's *answer* is displayed, because that is transcript, not log. |

## Accounts & access

| Item | Status | Notes |
| --- | --- | --- |
| Account schema + auth primitives | **[done]** | `accounts` / `auth_sessions`; PBKDF2-HMAC-SHA256 (600k iterations, per-account salt, constant-time compare); session tokens stored only as SHA-256 digests; password change revokes sessions. |
| Local-first default | **[done]** | No account is required to use the app. Sign-in exists as an opt-in surface, not a gate. |
| Sign-in UI | **[open]** | Endpoints exist (`/api/app/auth/*`); no screen consumes them yet. Decide first whether accounts mean anything for a desktop-local app beyond a profile name. |
| Session transport | **[partial]** | Token sent as an `x-acsa-session` header and held in `sessionStorage`. Fine on loopback; would need real transport security if a remote backend is ever added. |
| Roles / teams / sharing | **[open]** | Single-user model only. |

## Build, release, updates

| Item | Status | Notes |
| --- | --- | --- |
| Bundles and launches | **[done]** | `tauri build` produces an `.app` that starts and finds its engine in `Contents/Resources`. |
| Engine shipped with the app | **[done]** | `bundle.resources` plus resource-dir resolution. |
| Icons | **[done]** | `.tauri/icon-source.svg` generates the platform set; the titlebar/watermark logo is `public/logos/acsa.svg`. Hand-authored stand-in — swap in final art when ready. |
| Python runtime | **[done]** | The engine is frozen into a single `acsa-engine` tree (`scripts/build_engine_sidecar.sh`) and resolved by the Rust spawn path, falling back to `python3` for a source checkout. No interpreter needed on the user's machine. |
| Code signing / notarisation | **[partial]** | Hardened runtime and entitlements are configured and `release.yml` imports the certificate, notarises, and verifies the ticket — but it needs an Apple Developer certificate, so no signed build has been produced yet. |
| Auto-update | **[open]** | Documented end to end in `RELEASING.md`; needs a signing key and a release host. |
| CI | **[done]** | `ci.yml` runs lint + typecheck + the Python suite, checks the notices, runs the **Rust tests**, builds the sidecar, and bundles, launches and engine-checks the `.app`. `release.yml` signs on tag. Two things were fixed here: `cargo test` was in no job at all, and the bundle assertion named `manager.py` — a file the harness removal deleted — so the job failed on a file that was supposed to be gone. |

## Quality gates

| Item | Status | Notes |
| --- | --- | --- |
| Unit suite | **[done]** | `npm test`: database and accounts, engine CLIs, env handling, indexing and the dependency graph, MCP client, workspace search/replace, project readiness. |
| Real end-to-end agent test | **[partial]** | Two scripted runs exist in `.tauri/src/main.rs`: `a_turn_completes_over_the_real_runtime` and `a_real_approval_is_answered_and_the_turn_continues`. Both are `#[ignore]`d (they need a reachable provider and localhost) and both skip loudly rather than fail when it is unreachable. Run with `cargo test -- --ignored`. The approval round-trip was verified live in the packaged app: request → card → Approve → turn finished. |
| Typecheck | **[done]** | `strict: true`, including the Node-side dev-bridge config. |
| Honest failure reporting | **[done]** | Broken edits, unparseable verifier output and crashed linters all report failure rather than success. |
| Flake budget | **[done]** | The default suite is deterministic and offline: 92 Python tests plus 12 Rust tests, none of which touch the network. The two real-runtime tests are opt-in and self-skipping, so they cannot flake the build. |
| Frontend tests | **[open]** | There is no TypeScript test runner at all. Everything in `src/` is covered by typecheck and lint only — the model-picker, layout and z-index work in this repo was verified by driving the running app, not by automation. This is the largest hole in the gate. |
| Generated-class check | **[open]** | Tailwind dropped 13 utility classes silently because an opacity modifier cannot be applied to a `var()` colour, and nothing said so. A build step that greps the source for `bg-*`/`text-*`/`border-*` and asserts each has a generated rule would catch the next one. |

## UX & accessibility

| Item | Status | Notes |
| --- | --- | --- |
| First-run guidance | **[done]** | A freshly scaffolded project shows what to do next (install dependencies, then run) instead of an editor that silently cannot run. |
| Offline behaviour | **[done]** | Monaco and the webfonts are bundled; no runtime CDN dependency. |
| Keyboard coverage | **[partial]** | Strong command-palette and shortcut coverage; focus traps and screen-reader labelling are unverified. |
| Error surfaces | **[partial]** | Pipeline failures surface in the transcript, but a dead provider still reads as a generic "needs attention". |
| Accessibility audit | **[partial]** | Automated: `eslint-plugin-jsx-a11y` runs inside `npm run verify` with `--max-warnings=0`, and the 74 findings it opened with are fixed. Not done: a manual pass with a screen reader, focus-trap behaviour in dialogs, and contrast checking across every screen. |

## Operations

| Item | Status | Notes |
| --- | --- | --- |
| Crash reporting | **[open]** | An `ErrorBoundary` catches render errors; nothing is reported or persisted. |
| Structured logs | **[partial]** | The engine logs JSON lines to stdout; there is no rotation, retention, or support bundle. |
| Telemetry | **[done]** | None. Usage metrics are local (`usage_events`) and never leave the machine. |
| Dependency updates | **[open]** | No Dependabot or scheduled audit. `npm audit` is not wired into CI. |
| Licence and third-party notices | **[done]** | MIT `LICENSE`; `THIRD-PARTY-NOTICES.md` generated from the runtime tree (`npm run notices`), embed­ding the SIL OFL text the bundled fonts require. Both ship **inside** the app bundle, and CI fails if the notices go stale or if either file is missing from a build. |

## Agent runtime

| Item | Status | Notes |
| --- | --- | --- |
| Transport | **[partial]** | `exec` is the default; `app-server` is opt-in and is the only transport that can ask for approval. Choosing one as the default is still an open decision. |
| Local model tool support | **[done]** | `core-engine/responses_adapter.py` translates the Responses API the runtime requires into Ollama's native `/api/chat`, so a local model can actually run tools. Verified end to end, frozen into the engine sidecar, and covered by `tests/test_responses_adapter.py`. |
| Adapter lifecycle | **[partial]** | Started on demand and reused per provider. Nothing restarts it if it dies mid-run, and it is only reached when the resolved provider is local. |
| Steering | **[open]** | `turn/steer` is not wired to the UI. |
| Approval affordance | **[partial]** | The card renders in the composer, so on a long transcript it can start below the fold. |

## Suggested order

1. **An Apple Developer certificate** — so `release.yml` produces a signed, notarised build rather than an unsigned one.
2. **Secret redaction in logs**, then **crash reporting**, so support is possible.
3. **Auto-update**, once builds are signed and there is a release host.
4. **Windows and Linux release jobs** — the config exists (`nsis`, `deb`/`rpm`) but nothing signs or publishes them.
5. **A frontend test runner.** Nothing under `src/` is covered by a test. Every UI
   fix here — the model picker, the layout pass, the z-index scale — was verified
   by hand, which does not survive the next change.
6. **Backup/restore** and **OS keychain** for credentials.
7. **The manual half of the accessibility audit** — the automated half is in `verify`.
8. **Final brand artwork** — the icon and runtime mark are a clean hand-authored stand-in; drop the real logo over `.tauri/icon-source.svg` and `public/logos/acsa.svg`.
