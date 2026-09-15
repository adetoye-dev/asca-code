# Production checklist

Status legend: **[done]** implemented and verified · **[partial]** some of it
exists · **[open]** not started.

Anything marked open is a real gap for shipping to someone else's machine.

## Data & state

| Item | Status | Notes |
| --- | --- | --- |
| App-owned database | **[done]** | SQLite via `core-engine/app_db.py`, one schema + migration path, reached by the dev bridge and the packaged app through `db-cli`. |
| State out of browser storage | **[done]** | Provider registry, credentials, chat history, recent projects and the active-project pointer moved out of `localStorage`. Existing values are migrated once and the browser copies deleted. |
| Credentials never reach the page | **[done]** | Keys are write-only across the API (`hasApiKey`, no value). Server-side resolution in the bridge and the engine. |
| Database file permissions | **[done]** | Data dir `0700`, database and its WAL/SHM `0600`. |
| Encryption at rest | **[open]** | The standard library has no authenticated cipher, so secrets sit in a `0600` file rather than a fake-encrypted one. Next step is OS keychain (macOS Keychain / Windows Credential Manager) via a Tauri plugin. |
| Backup / restore | **[open]** | No export or import of the database. Users have no way to move their settings to a new machine. |
| Data retention | **[partial]** | Chat trimmed to the 100 most recent messages per project; the usage ledger grows without bound. |

## Configuration & secrets

| Item | Status | Notes |
| --- | --- | --- |
| Environment overrides | **[done]** | `.env` (repo root or `$ACSA_DATA_DIR`) documented in `.env.example`; provider keys, `ACSA_SECRET_*`, tuning flags. Real environment beats the file, and the file beats the database. |
| No secrets in the repo | **[done]** | Only `.env.example` is tracked; `.env` is gitignored. |
| Secrets in logs | **[partial]** | Provider keys are not logged, but the pipeline logs prompts and file contents at info level. Needs a redaction pass and a log level review. |

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
| Icons | **[partial]** | Valid generated placeholders; needs real brand art. |
| Python runtime | **[open]** | The app shells out to `python3`. A clean macOS or Windows machine has no usable interpreter, so the agent cannot run for an end user. **Largest remaining blocker.** |
| Code signing / notarisation | **[open]** | `signingIdentity` is `null`; unsigned builds are quarantined by Gatekeeper. See `RELEASING.md`. |
| Auto-update | **[open]** | Documented end to end in `RELEASING.md`; needs a signing key and a release host. |
| CI | **[open]** | No `.github/workflows`. `npm run verify` (typecheck + tests) and `tauri build` should run on every push. |

## Quality gates

| Item | Status | Notes |
| --- | --- | --- |
| Unit suite | **[done]** | 124 tests: database, CLI, env handling, agent parsing, stream handling, diff application, indexing, worker delegation. |
| Real end-to-end agent test | **[done]** | `npm run test:e2e` drives the real pipeline against local Ollama and verifies the resulting files behave correctly. |
| Typecheck | **[done]** | `strict: true`, including the Node-side bridge config. |
| Honest failure reporting | **[done]** | Broken edits, unparseable verifier output and crashed linters all report failure rather than success. |
| Flake budget | **[partial]** | The end-to-end edit scenario passes roughly four runs in five; it is opt-in and not part of CI. |

## UX & accessibility

| Item | Status | Notes |
| --- | --- | --- |
| First-run guidance | **[done]** | A freshly scaffolded project shows what to do next (install dependencies, then run) instead of an editor that silently cannot run. |
| Offline behaviour | **[done]** | Monaco and the webfonts are bundled; no runtime CDN dependency. |
| Keyboard coverage | **[partial]** | Strong command-palette and shortcut coverage; focus traps and screen-reader labelling are unverified. |
| Error surfaces | **[partial]** | Pipeline failures surface in the transcript, but a dead provider still reads as a generic "needs attention". |
| Accessibility audit | **[open]** | No automated or manual audit. |

## Operations

| Item | Status | Notes |
| --- | --- | --- |
| Crash reporting | **[open]** | An `ErrorBoundary` catches render errors; nothing is reported or persisted. |
| Structured logs | **[partial]** | The engine logs JSON lines to stdout; there is no rotation, retention, or support bundle. |
| Telemetry | **[done]** | None. Usage metrics are local (`usage_events`) and never leave the machine. |
| Dependency updates | **[open]** | No Dependabot or scheduled audit. `npm audit` is not wired into CI. |
| Licence and third-party notices | **[open]** | No `LICENSE` file and no notices bundle, which is a licensing problem for redistribution. |

## Suggested order

1. **Python runtime** — nothing else matters until a clean machine can run the agent.
2. **Signing + CI** — so there is a build anyone can install and it stays green.
3. **Licence + notices** — required before distributing.
4. **Secret redaction in logs**, then **crash reporting**, so support is possible.
5. **Auto-update**, once builds are signed and there is a release host.
6. **Backup/restore** and **keychain** for credentials.
7. **Accessibility audit**.
