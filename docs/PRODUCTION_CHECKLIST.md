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
| Encryption at rest | **[open]** | Secrets sit in a `0600` SQLite file rather than a fake-encrypted one, which is honest but not encrypted. **The design is now settled and is smaller than "a Tauri plugin" implies** — investigated, not guessed: no crypto is needed anywhere, because the OS keychain is the cipher. Three facts make it fit. (1) Rust never touches secrets today, so there is no partial state to unpick. (2) There is exactly **one** Rust seam that resolves a provider credential — `engine_resolve_key`, used by the agent spawn — so it becomes keychain-first with the SQLite row migrated on first sight, which is inherently idempotent and needs no startup sweep. (3) The engine already resolves secrets **environment-first** (`get_secret` checks `ACSA_SECRET_<NAME>` before the database), so Rust can feed it through `ACSA_SECRET_*` in the child's environment and the stdlib-only, frozen sidecar needs no change at all. `keyring = "3"` builds here (verified); v4 exists and Dependabot will offer it. **Two hazards stop this being a blind change, and neither is visible from a dev run.** First, an OS keychain cannot be enumerated: "which providers are connected" has to become a per-provider lookup rather than a list, which changes `listSecretNames`' callers. Second, and the reason this was not attempted: the **dev binary is ad-hoc signed with a per-build identifier** (`Signature=adhoc`, `Identifier=acsa_code-<hash>`), while the shipped app carries a stable Developer ID — and macOS binds Keychain access to the signing identity. A key written by `tauri dev` is therefore not reliably readable by the signed release, so deleting the plaintext row after a dev-time "verified" migration could lose the user's key while looking successful. The migration must keep the SQLite copy until a **shipped, signed** build has read the value back. That is a release-time check, not a dev-time one, and it is why this is staged rather than done. |
| Backup / restore | **[done]** | `core-engine/backup.py` exports and imports the database, and Settings → **Data & backups** drives it (`src/services/backupRestore.ts`, `DataPane.tsx`). Two decisions worth knowing: a default export **leaves credentials behind** and then *vacuums*, because deleting the rows is not enough — SQLite keeps the bytes in free pages, and `strings` finds them; `--with-secrets` is there for a real migration. An import keeps the database it replaced as `.before-import`, so it is not a one-way door, and the UI says to restart rather than pretending the running app picked the change up. |
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
| No accounts, by design | **[done]** | There is no sign-in, no account and no session. The auth surface that existed — the `accounts` and `auth_sessions` tables, PBKDF2 hashing, session tokens, the `auth.*` engine commands and their client methods — was **removed** rather than left unclaimed. Nothing called any of it: the endpoints shipped with no screen, which is a claim the app could not back. A local-first workbench has nothing to authenticate against. It is in git history, and multi-device sync is what would bring it back. |
| Usage metrics without accounts | **[open]** | Decided, and the honest answer is that it is not free: there is no way to know DAU, retention or feature use without either an anonymous install id sent to a server of ours, or public signals that already exist (GitHub release download counts, issues). The app currently reports nothing, and its one outbound call is the update check. When this is picked up: it is an endpoint decision, not an accounts decision, and the "nothing leaves the machine" copy has to move with it. |
| Multi-user | **[open]** | One data directory, one database, one user. Roles, teams and sharing are not modelled and would need a server. |

## Build, release, updates

| Item | Status | Notes |
| --- | --- | --- |
| Bundles and launches | **[done]** | `tauri build` produces an `.app` that starts and finds its engine in `Contents/Resources`. |
| Engine shipped with the app | **[done]** | `bundle.resources` plus resource-dir resolution. |
| Icons | **[done]** | `.tauri/icon-source.svg` generates the platform set; the titlebar/watermark logo is `public/logos/acsa.svg`. Hand-authored stand-in — swap in final art when ready. |
| Python runtime | **[done]** | The engine is frozen into a single `acsa-engine` tree (`scripts/build_engine_sidecar.sh`) and resolved by the Rust spawn path, falling back to `python3` for a source checkout. No interpreter needed on the user's machine. |
| Code signing / notarisation | **[done]** | Verified in CI, not just locally: `release.yml` run 35356869102 produced a signed, notarised, stapled app and `spctl --assess` reports `accepted, source=Notarized Developer ID` (it was `rejected, source=Unnotarized Developer ID` before). Three things were actually wrong, none of them the certificate: `signingIdentity` was `null` so Tauri never auto-detected and every build was **ad-hoc** (and invalid — it sealed no resources, which was the Gatekeeper complaint); the frozen engine is a resource *directory*, which Tauri copies unsigned, so notarisation would have rejected the bundle; and `--bundles app,dmg` rebuilds then consumes the app, so Tauri's DMG step could never carry a nested signature. `scripts/sign_bundle.sh` handles the middle one; the release builds the app only and ships the stapled zip. |
| Auto-update | **[done]** | Check and install both verified end to end on the published `0.2.0`: the signed app found `0.2.0`, the titlebar button read **Update** (not a version number), and the click ran download → verify → install → restart, after which About reported `0.2.0`. `latest.json` resolves anonymously (302 → the asset). `createUpdaterArtifacts` stays `false` in the committed config on purpose — turning it on would break `tauri build` for anyone without the signing key — so `release.yml` builds and signs the updater tarball itself. Asset names are hyphenated because GitHub rewrites a space (`ACSA Code.app.tar.gz` arrived as `ACSA.Code.app.tar.gz`) and the manifest would then 404. **One manual step, and it is a trap:** the workflow publishes with `draft: true`, so a tag push ships nothing — green run, attached assets, and `/latest/download/latest.json` still advertising the previous version. `v0.2.1` shipped only after `gh release edit v0.2.1 --draft=false`; `docs/RELEASING.md` now says so next to the checklist. |
| CI | **[done]** | `ci.yml` runs lint + typecheck + the Python suite, checks the notices, runs the **Rust tests**, builds the sidecar, and bundles, launches and engine-checks the `.app`. `release.yml` signs on tag. Two things were fixed here: `cargo test` was in no job at all, and the bundle assertion named `manager.py` — a file the harness removal deleted — so the job failed on a file that was supposed to be gone. |

## Quality gates

| Item | Status | Notes |
| --- | --- | --- |
| Unit suite | **[done]** | `npm test`: the database, engine CLIs, env handling, indexing and the dependency graph, MCP client, workspace search/replace, project readiness. |
| Real end-to-end agent test | **[partial]** | Two scripted runs exist in `.tauri/src/main.rs`: `a_turn_completes_over_the_real_runtime` and `a_real_approval_is_answered_and_the_turn_continues`. Both are `#[ignore]`d (they need a reachable provider and localhost) and both skip loudly rather than fail when it is unreachable. Run with `cargo test -- --ignored`. What has been verified *live*, in the packaged app, is now considerably more than the approval round-trip: a scaffolded project built end to end; an approval answered and the turn continued; a question asked through `request_user_input` and answered; a change log matching the files on disk; and a resumed thread implementing a design it first proposed. What is still scripted-only is everything that has to hold in CI — that is what these two tests are for, and they remain the honest gap. |
| Typecheck | **[done]** | `strict: true`, including the Node-side dev-bridge config. |
| Honest failure reporting | **[done]** | Broken edits, unparseable verifier output and crashed linters all report failure rather than success. |
| Flake budget | **[done]** | The default suite is deterministic and offline: 112 Python tests, 70 Vitest tests and 19 Rust tests, none of which touch the network. The two real-runtime tests are `#[ignore]`d and self-skipping, so they cannot flake the build. |
| Frontend tests | **[done]** | Vitest runs in `verify`: services (approval vocabulary, model-registry reconciliation, updater preference) and, via jsdom, components — the update button renders nothing when there is nothing to say, says `Update` rather than a version number, installs only on a click, and offers the restart separately; the About pane says "up to date" only when the check said so and prints the reason when it failed. Component tests opt into jsdom per file with a docblock, so the service tests stay on node. |
| Generated-class check | **[done]** | `scripts/check_generated_classes.mjs`, run by `npm run build`. It scans the app's own token utilities (`bg-workbench/60`, `bg-modal/95`, …) and fails if the built CSS has no rule for one — which is how thirteen of them shipped silently. Verified by re-introducing the bug: it names the two classes and exits non-zero. Scoped to the design tokens on purpose; checking every class would be all false positives. |

## UX & accessibility

| Item | Status | Notes |
| --- | --- | --- |
| First-run guidance | **[done]** | A freshly scaffolded project shows what to do next (install dependencies, then run) instead of an editor that silently cannot run. |
| Offline behaviour | **[done]** | Monaco and the webfonts are bundled; no runtime CDN dependency. |
| Keyboard coverage | **[done]** | Strong command-palette and shortcut coverage, and the two things that were missing now exist and are tested. **Focus traps**: there were none — Tab walked out of every dialog into the page behind it, and `ProjectModal` and `CloneModal` had no Escape handling either, so the only way out was the mouse. One `useDialogA11y` covers all four dialogs (Tab wraps both ways, Escape closes, focus returns to what opened it), with component tests asserting each. Verified non-vacuous: disabling the trap makes "keeps Tab inside the dialog" fail. **Labelling**: two icon-only close buttons had no accessible name; the jsx-a11y rules did not catch either. |
| Error surfaces | **[partial]** | Pipeline failures surface in the transcript, but a dead provider still reads as a generic "needs attention". |
| Accessibility audit | **[partial]** | Four layers, three of them automated. `eslint-plugin-jsx-a11y` runs with `--max-warnings=0`. **Contrast** is now measured rather than eyeballed: `scripts/check_contrast.mjs` reads the palette from `primitives.css`, scans for the colour classes actually used, composites `/NN` opacity before comparing, and runs in `npm run verify`. It found the muted grey at 3.67:1 against a 4.5 requirement — which matters because the type scale is 9–11px and gets no large-text allowance — plus a focus ring at 2.27:1 against the 3:1 a focus indicator needs. Both fixed, both now gated. **Focus and dialogs** are covered above. Not done: a screen-reader pass with a human listening, and reduced-motion. |

## Operations

| Item | Status | Notes |
| --- | --- | --- |
| Crash reporting | **[done]** | `ErrorBoundary` plus two global handlers (window `error`, `unhandledrejection`) write a record through `crash_log.py` to `crashes.log` in the data directory. Local-only, matching the no-telemetry stance: redacted on the way in by the same key/value rules the runtime redactor uses plus known key prefixes (`sk-`, `ghp_`, `AKIA`, …), `0600`, rotated to the last 200 so a crash loop cannot fill a disk. Verified in the frozen engine, and the last 20 entries ship inside the support bundle. |
| Support bundle | **[done]** | `core-engine/support.py`, reached from Settings → **Data & backups**. One JSON file: app + schema version, OS, paths, table row counts, redacted settings, recent crashes. Deliberately omits credential values (the `secrets` table is counted, never read), chat history, and any environment dump, and shortens the home directory to `~` in keys as well as values — the render test is `tests/test_support.py`, which asserts a real key does not reach the file. |
| Structured logs | **[partial]** | The engine logs JSON lines to stdout and the crash log is collected by the support bundle; stdout itself still has no rotation or retention. |
| Telemetry | **[partial]** | No usage data leaves the machine — metrics are local (`usage_events`). The one outbound call is the **update check**, which reveals a version and an IP, so it is a visible setting (Settings → About, default on) rather than something that happens quietly. |
| Dependency updates | **[done]** | `.github/dependabot.yml` covers the three ecosystems this repo has — npm at the root, cargo in `/\.tauri`, and the actions its own workflows pin — weekly, with minor/patch grouped into one pull request each so the routine bumps are one review rather than twenty, and majors left out of the groups because they need reading. There is deliberately no pip entry: the engine is stdlib-only and the sidecar is frozen from it. `npm audit --audit-level=high` now runs in the `verify` job, after install and before the suite. It gates on high and critical only, and that is a decision rather than laziness: the tree currently carries one low and one moderate (DOMPurify advisories reached through Monaco), whose only "fix" is `npm audit fix --force` downgrading Monaco across a breaking change to patch a sanitiser the app does not expose. **A gate that can only be satisfied by breaking something gets ignored, and that is how it ends up unwired.** Raise the level when those two clear. |
| Licence and third-party notices | **[done]** | MIT `LICENSE`; `THIRD-PARTY-NOTICES.md` generated from the runtime tree (`npm run notices`), embed­ding the SIL OFL text the bundled fonts require. Both ship **inside** the app bundle, and CI fails if the notices go stale or if either file is missing from a build. |

## Agent runtime

| Item | Status | Notes |
| --- | --- | --- |
| Transport | **[done]** | `app-server` is the default now, with `exec` as a fallback and still selectable. It is the only transport that can ask anything, so defaulting to `exec` meant most installs never saw the approval card, the question card or steering — all of which were built and verified and then hidden behind a setting. A runtime that cannot start the live session retries once on `exec` and says so in OUTPUT rather than swapping transports silently, and the approval mode is re-resolved per transport so `ask-me` cannot survive onto a run that would auto-deny. |
| Local model tool support | **[done]** | `core-engine/responses_adapter.py` translates the Responses API the runtime requires into Ollama's native `/api/chat`, so a local model can actually run tools. Verified end to end, frozen into the engine sidecar, and covered by `tests/test_responses_adapter.py`. |
| Runtime flags | **[done]** | The three flags the app writes into the runtime's config live in `AGENT_RUNTIME_FLAGS`, documented once and asserted. `features.plugins = false` is the load-bearing one: with it off, every start was spending ~45s of a ~75s run on OpenAI's curated plugin marketplace — a 401 at chatgpt.com, a `git fetch` that timed out after 30s, a GitHub 429 — for something a third-party provider can never reach. Verified at a cold `CODEX_HOME`: 1 plugin log line to 0, and an `[mcp_servers.*]` entry still reports `enabled` from `codex mcp list` with a mirrored skill still reaching the prompt. A turn's stderr is now also translated before the user reads it (`friendly_agent_line`): a rejected patch reads as a retry rather than a crash, and the runtime's internal model-metadata warning is dropped (see below). |
| Turn limit | **[done]** | A wall-clock ceiling on one turn — 20 minutes by default, `No limit` first in the picker, set in Settings → AI Assistant → Agent. The clock stops while the turn is blocked on the user, because a turn waiting on an answer is not burning time and a limit that counted it would stop runs for asking a question. The composer shows `Working 4m 12s of 20m`; a stopped turn says why in OUTPUT and stops through the existing Stop path rather than a second cancel mechanism. Policy is pure and tested (`agentTurnLimit.ts`); the 20-minute stop itself has not been observed end to end. |
| Active model | **[done]** | Two records described it — `selected_model`, which the picker writes and the agent reads, and a copy in `ai_settings`, which the editor chat reads — and nothing kept them in step. The real database had them disagreeing (`ai_settings.provider = ollama` on a 7B local model beside a `deepseek` selection), so the chat and the agent pointed at different models. Hydration now takes provider and model from the selection and repairs the stored copy on boot. |
| Internal model warning | **[done]** | Closed as no-longer-actionable rather than fixed. The runtime resolves a hardcoded model (`gpt-5.6-luna`) for its own auto-review and title generation and warns it has no metadata for it; probing the catalog validator, `auto_review_model_override` does not redirect it, and the only other lever would be inventing metadata for a model the app never asks for. It is metadata-only — auto-review was verified working end to end on DeepSeek with the warning present, a read-only sandbox forcing an approval that was then approved — and it is no longer shown, because the app writes every model the user picks into the catalog, so an unknown slug is always one of the runtime's own internals. Revisit only if upstream exposes a real override. |
| Adapter lifecycle | **[partial]** | Started on demand and reused per provider. Nothing restarts it if it dies mid-run, and it is only reached when the resolved provider is local. |
| Steering | **[done]** | Wired. `handleSend` used to start with `if (status === "running") return`, so pressing Enter mid-turn did nothing and said nothing, and the composer swapped Send for Stop so there was no control either. Sending while a turn runs now goes into that turn. The params are read from the runtime's own schema: `TurnSteerParams` requires `threadId`, `input` and `expectedTurnId`, the last of which the schema calls a precondition — so a steer aimed at a finished turn is refused by the runtime rather than quietly becoming a second turn. Both refusals are named in the UI (`ActiveTurnNotSteerable` for `/review` and manual `/compact`; a stale turn otherwise), the unsent text stays in the composer, and attachments are deliberately not consumed because a steer carries text only. Proven against the fake app-server, so the request is known to survive the pipe with its message intact; not yet exercised against a live run. |
| Approval affordance | **[partial]** | The live experience this came from: a run sat blocked for roughly six minutes and the only way to find out why was to read the accessibility tree. Those causes are fixed. The card is pinned above the composer (the "below the fold" note here predated it) and now carries `role="alertdialog"` with a label, taking focus when it appears, once per card. `waitingForUser` reaches the **status bar** — always on screen, as a polite live region — and the **chat toggle** carries the state when the panel is closed, so it is visible both that something is waiting and where to answer. Two things were found while testing rather than reasoned about: the composer's autofocus ran after the card's and stole focus back (guarded), and the toggle's cue had to be a colour-plus-name change rather than a colour-only one. Still open: the approval and question cards share one slot — if both were ever pending, one would win — and none of this has been seen against a real blocked run, only in tests, because producing one needs a provider to hold a turn open. |
| Host skills | **[done]** | `~/.agents/skills` is *not* skipped. It was being fought, and that was the wrong instinct: `superpowers:brainstorming` told the agent to present a design and wait for a human, the agent did exactly that, and the app had no way to notice — two runs of the same prompt wrote nothing while the transcript read like a report. `features.skip_host_skill_discovery` was tried and does not work (the flag is still "under development" upstream). The app now plays the other half of the conversation instead. |
| Asking the user | **[done]** | `ServerRequest::ToolRequestUserInput` is answered, not squeezed into the approval card. Verified live end to end: the agent asked two questions with options, the card collected the answers, and it implemented exactly what was chosen. The response shape is read from the runtime's own schema (`codex app-server generate-json-schema`), not inferred. |
| Blocked-on-human states | **[done]** | `thread/status/changed` was not consumed at all, so `waitingOnUserInput` and `waitingOnApproval` were invisible and a paused run looked finished. Now a waiting turn says so and says where to answer; the flag clears when the wait is over. |
| Change log | **[done]** | After a turn that changed files the chat shows "Edited N files +X −Y" with a row per file, and a row opens that file two-sided in the diff viewer. The counts come from the runtime's own item diffs, so they describe *this turn* where a `git diff` would also count the user's own uncommitted edits. This is the deliberate answer to "should every write need approval?": log it, do not gate it. Verified live: a two-file edit reported +9 −0 and the files were a 5-line comment and a 4-line one. |
| Undo a turn | **[done]** | The snapshot exists now, which was the condition for shipping this. The runtime cannot do it and says so — `thread/rollback` ("does not revert local file changes ... Clients are responsible") and its replacement `thread/revert` ("It does not revert local file changes") — so the engine captures the pre-turn state itself. It captures only the files that were already dirty, because a file that was clean then has its pre-turn content in HEAD; that is also what makes the undo safe rather than destructive, since the user's own edits *are* the thing snapshotted rather than the casualty that `git checkout --` would have made of them. Two refusals are honest rather than partial: an incomplete snapshot (a file over the cap) will not restore at all, and a missing one says so. The affordance appears only for the turn that just finished and only when it changed something, because snapshots are pruned and "undo" after two more turns would be a surprise. Not yet exercised against a live agent turn — the engine half and the wiring are tested, the end-to-end run is not. |
| Change log in the transcript | **[partial]** | It is live-only, so it answers "what did it just do?" and not "what did it do an hour ago?". A log that scrolls back needs it persisted as a transcript entry. |
| Workspace index refresh | **[done]** | The tree refreshed after a write and the symbol index did not, so Code Map and symbol search kept describing the project as it was before the run — the status bar read "3 files synced" before a turn that created two `.tsx` files and still read 3 afterwards. Create, delete and agent turns now refresh both. Re-indexing is a full walk but a cheap one (0.28s for 123 files, 0.39s for 172 through the frozen engine), so it is done rather than guessed at. |

## Suggested order

Current plan, in order:

**Done, in this order:** shipped the agent-flow work as `0.2.2`; made a blocked run unmissable;
took both decisions (`app-server` is the default with
`exec` as a fallback, accounts removed rather than left dormant); then the identity — indigo,
tagline, the Apex mark — and the accessibility pass, measured rather than eyeballed.

`0.2.3` then carried the two workbench fixes that came out of the audit: panels read live state
(an open editor used to keep rendering the file as it was when its tab opened, and its Save handler
could write that stale buffer back over the new one), and a keystroke stopped re-registering the
dockview layout. `0.2.4` carries the rest of that audit: the composer's text and the host's telemetry
moved out of the workbench's state, the transcript and the editor sit behind memo boundaries, and the
macOS bundle job stopped running on every push to `dev`.

**Then a full end-to-end loop, run as a user would.** A scratch project, the real bundled runtime,
the real DeepSeek key: build a small task board (8 files, `tsc && vite build` passes, 11/11 browser
checks), then a follow-up multi-file change to add priorities (8/8 checks, no regression). The
output was good and the multi-file edit worked — and the exercise still produced five fixes and one
defect, all listed in the tables above and all of them about the *harness* rather than the model:
the ~45s of doomed OpenAI plugin syncing (#1), a recovered patch rejection reported as a crash (#2),
two records disagreeing about the active model (#3), approval copy that understated where the agent
may write (#4), and no ceiling on self-verification (#5, now a wall-clock limit).

The defect it shipped is worth recording because both the agent's own tests and mine missed it: the
priority change squeezed the card title to a 2px column, so the title rendered one character per
line — and *nothing overflowed*, so the overflow assertions passed. Behaviour was right; the layout
was broken. That is the argument for the render checks above growing the way they have.

One correction while reading back through this: the line above used to claim the change log was
persisted into the transcript, which the status table contradicts (`[partial]`, live-only, and no
change-log persistence exists in the code). The table is right; the claim is gone.

**Layout — done.** The permanent activity bar and sidebar are gone, replaced by one collapsible
navigation surface (`WorkbenchNav.tsx`): a rail that reveals a grouped panel on hover, collapses
after a choice, and pins with Cmd+B. The explorer now belongs to the editor screen rather than to the
whole workbench, the repository is a page that shows the diff beside the changes it came from, and
search-in-files was removed — the palette's file search covers it. Both new surfaces have render
tests (`WorkbenchNav.test.tsx`, `GitDashboard.test.tsx`).

**A GUI check exists.** `npm run gui:check` renders the workbench in headless
Chrome and asserts what the unit suite cannot see: nothing overflows the window at
three sizes, every screen paints with a way back, the sidebar's icons sit on the
column's centre line in both states, an entry's dialog opens without reshaping the
marketplace grid, and the new-project dialog opens on step 1, fits a 1024×700
window and shows its action. It also measures things a class scan cannot:

- **a size class actually decides the size** — the `Icon` component used to write
  its `size` as an inline style on every render, which beat every class, so 279
  call sites that size an icon with `className="h-3.5 w-3.5"` were silently 16px
  and a per-site size change did nothing;
- **the brand outranks the rail icons** — compared on ink, not on box, because the
  mark carries ~23% internal padding;
- **the highlight hugs the icon** — row height minus icon size, over two;
- **the primary action is readable against its own fill** — 4.5:1, computed in the
  browser. This one was found at 1.05:1: `--action-primary` resolved through the
  neutral "crisp zinc" accent, so every primary button was white on near-white,
  and the class-scanning contrast gate could not see it because the colour arrives
  through a var chain.

It starts its own Vite and browser, prints a report, and exits non-zero on
failure. It is deliberately not in CI (it needs a browser) — run it before a
release, and after touching layout.

**Left in this phase — the rest of the surfaces.** The model picker and the z-index scale still have
no render tests, and the pages behind the nav still carry their pre-identity spacing and hierarchy:
the palette and type scale are single-sourced now, so a change lands everywhere, but nobody has
decided what the *hierarchy* should be for those. Two smaller things ride along: the inline hexes in
the shell, and the old semantic token layer (`--obsidian-*`, `--text-*`), which nothing reads and
which should either be deleted or repointed at the real palette.

Then, in order: OS keychain; Windows and Linux release jobs; Dependabot and `npm audit`; and the
screen-reader pass, which needs a human listening.
