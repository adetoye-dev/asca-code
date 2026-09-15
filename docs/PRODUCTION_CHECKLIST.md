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
| Icons | **[done]** | `.tauri/icon-source.svg` generates the platform set; the titlebar/watermark logo is `public/logos/acsa.svg`. Hand-authored stand-in — swap in final art when ready. |
| Python runtime | **[done]** | The engine is frozen into a single ~10 MB `acsa-engine` sidecar (`scripts/build_engine_sidecar.sh`) and resolved by the Rust and bridge spawn paths. No interpreter needed on the user's machine. |
| Code signing / notarisation | **[partial]** | Hardened runtime and entitlements are configured and `release.yml` imports the certificate, notarises, and verifies the ticket — but it needs an Apple Developer certificate, so no signed build has been produced yet. |
| Auto-update | **[open]** | Documented end to end in `RELEASING.md`; needs a signing key and a release host. |
| CI | **[done]** | `ci.yml` runs typecheck + tests + build, builds the sidecar, and bundles, launches and engine-checks the `.app`. `release.yml` signs on tag. |

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
| Licence and third-party notices | **[done]** | MIT `LICENSE`; `THIRD-PARTY-NOTICES.md` generated from the runtime tree (`npm run notices`), embed­ding the SIL OFL text the bundled fonts require. Both ship **inside** the app bundle, and CI fails if the notices go stale or if either file is missing from a build. |

## Suggested order

1. **An Apple Developer certificate** — so `release.yml` produces a signed, notarised build rather than an unsigned one.
2. **Secret redaction in logs**, then **crash reporting**, so support is possible.
3. **Auto-update**, once builds are signed and there is a release host.
4. **Windows and Linux release jobs** — the config exists (`nsis`, `deb`/`rpm`) but nothing signs or publishes them.
5. **Backup/restore** and **OS keychain** for credentials.
6. **Accessibility audit**.
7. **Final brand artwork** — the icon and runtime mark are a clean hand-authored stand-in; drop the real logo over `.tauri/icon-source.svg` and `public/logos/acsa.svg`.
