# Releasing the desktop app

Status of each step is marked **[done]** (implemented and verified by building
and running the app) or **[blocked]** (needs credentials, hosting, or a decision
that only the maintainer can make).

## What works today

- `cd .tauri && ../node_modules/.bin/tauri build --bundles app` produces
  `Autonomous IDE.app` and it launches.
- The Python engine ships inside the bundle and is found at runtime:
  `Contents/Resources/core-engine`, resolved via `app.path().resource_dir()`.
- `scripts/generate_placeholder_icon.py` regenerates the placeholder icons if
  the set is ever lost.

Verify a build before shipping:

```bash
scripts/build_engine_sidecar.sh
cd .tauri
../node_modules/.bin/tauri build --bundles app
ls "target/release/bundle/macos/Autonomous IDE.app/Contents/MacOS/acsa-engine"
"target/release/bundle/macos/Autonomous IDE.app/Contents/MacOS/autonomous-ide" &
# expect: [IDE] Autonomous IDE started. Engine dir: ".../Contents/Resources/core-engine"
```

## 1. Replace the placeholder icon — **[blocked: needs brand art]**

`tauri icon` produced the required set, but the artwork is a generic placeholder.

```bash
npx tauri icon path/to/brand-1024x1024.png --output .tauri/icons
```

## 2. Ship a Python runtime — **[done]**

The engine is frozen into a single binary and shipped as a Tauri sidecar, so the
app needs no interpreter on the user's machine.

```bash
scripts/build_engine_sidecar.sh        # -> .tauri/binaries/acsa-engine-<triple>
```

`acsa-engine` exposes the subcommands the app spawns (`manager`, `db`, `index`,
`pty`); `bundle.externalBin` ships it and Tauri strips the triple suffix when
bundling. Both the Rust commands and the development bridge prefer it and fall
back to `python3 <entry point>` for a source checkout. CI rebuilds it and asserts
each subcommand answers.

Rebuild it whenever the engine changes — the bundled copy is what users run.

## 3. Sign and notarise — **[configured; needs an Apple Developer account]**

Unsigned builds are quarantined by Gatekeeper on other people's Macs.

1. Developer ID Application certificate in the login keychain.
2. Set `bundle.macOS.signingIdentity` in `.tauri/tauri.conf.json` (currently
   `null`), and provide `entitlements` if the engine needs any.
3. Notarise and staple:

   ```bash
   xcrun notarytool submit "Autonomous IDE.dmg" --keychain-profile <profile> --wait
   xcrun stapler staple "Autonomous IDE.app"
   ```

   Tauri can do this in CI via `APPLE_CERTIFICATE`, `APPLE_ID`,
   `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

Windows equivalents: `bundle.windows.certificateThumbprint` (currently `null`)
and `digestAlgorithm`, then sign with `signtool`.

## 4. Auto-updates — **[blocked: needs a signing key and a release host]**

Nothing is wired up: `bundle.createUpdaterArtifacts` is `false` and
`tauri-plugin-updater` is not a dependency. Do not flip the flag alone — Tauri
refuses to build updater artifacts without a signing key, so enabling it without
step 4a breaks `tauri build` for everyone.

### 4a. Generate the update signing key

This is a **separate** minisign key from the OS code-signing certificate. Keep
the private key secret (CI secret / password manager); the public key is safe to
commit.

```bash
npx tauri signer generate -w ~/.tauri/acsa-updater.key
# prints the public key -> plugins.updater.pubkey
```

### 4b. Point the app at a manifest

Set `createUpdaterArtifacts: true`, add `tauri-plugin-updater` to
`.tauri/Cargo.toml`, register it in `src/main.rs`, add
`@tauri-apps/plugin-updater` to `package.json`, then in `tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "<public key from 4a>",
    "endpoints": ["https://<host>/releases/latest.json"]
  }
}
```

Host the manifest on any static host (GitHub Releases is the least effort). The
updater verifies each artifact's signature against `pubkey`, so an unsigned or
tampered manifest is rejected — never publish one without the `.sig`.

### 4c. Publish the manifest

```json
{
  "version": "0.2.0",
  "notes": "What changed",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<.sig contents>", "url": "https://<host>/Autonomous-IDE_0.2.0_aarch64.app.tar.gz" }
  }
}
```

Build with the signing key present:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/acsa-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>" \
  npx tauri build
```

### 4d. Prompt from the frontend

Check on launch in the background, then ask before installing — never install
silently:

```ts
import { check } from "@tauri-apps/plugin-updater";
const update = await check();
if (update) {
  // show "Version X is available" with Install / Later
  await update.downloadAndInstall();
}
```

## Release checklist

1. Bump `version` in `.tauri/tauri.conf.json` (and `package.json`).
2. `npm run verify` — typecheck plus the Python suite.
3. `tauri build` with the signing key set.
4. Launch the `.app` and confirm the engine resolves from `Contents/Resources`.
5. Notarise and staple, upload the artifact + `.sig`, publish `latest.json`.
6. Install the *previous* version and confirm it updates to the new one.
