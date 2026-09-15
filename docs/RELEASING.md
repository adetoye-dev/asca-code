# Releasing the desktop app

Status of each step is marked **[done]** (implemented and verified by building
and running the app) or **[blocked]** (needs credentials, hosting, or a decision
that only the maintainer can make).

## What works today

- `cd .tauri && ../node_modules/.bin/tauri build --bundles app` produces
  `ACSA Code.app` and it launches.
- The Python engine ships inside the bundle and is found at runtime:
  `Contents/Resources/core-engine`, resolved via `app.path().resource_dir()`.
- `.tauri/icon-source.svg` is the icon artwork; re-run `tauri icon` against it
  (step 1) if the generated set is ever lost.

Verify a build before shipping:

```bash
scripts/build_engine_sidecar.sh
cd .tauri
../node_modules/.bin/tauri build --bundles app
ls "target/release/bundle/macos/ACSA Code.app/Contents/MacOS/acsa-engine"
"target/release/bundle/macos/ACSA Code.app/Contents/MacOS/acsa-code" &
# expect: [ACSA Code] started. Engine dir: ".../Contents/Resources/core-engine"
```

## 1. Icon artwork — **[done]**

`.tauri/icon-source.svg` holds the artwork: the ACSA mark on a rounded-square
plate (macOS wants a full-bleed square with no transparency). Regenerate the
platform set from it whenever the art changes:

```bash
npx tauri icon .tauri/icon-source.svg --output .tauri/icons
# then delete `android/`, `ios/`, `Square*.png` and `StoreLogo.png` — this app
# bundles macOS, Linux and Windows only, so those variants are unused.
```

The logo shown in the titlebar and the dock watermark is `public/logos/acsa.svg`
— a transparent version of the same mark, so it sits next to the other provider
logos. Both files are hand-authored vectors.

_The mark is a clean stand-in, not the owner's final artwork: the asset it
replaced was a 300 KB bitmap trace that rendered as an empty box. Swap in the
real logo by overwriting these two paths._

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

Unsigned builds are quarantined by Gatekeeper on other people's Macs, so this is
the step between "it builds" and "someone else can install it".

Everything on our side is already wired: the hardened runtime and entitlements
are set in `.tauri/tauri.conf.json`, and `.github/workflows/release.yml` imports
the certificate, builds, notarises and then verifies the signature and the
ticket. What it needs is the certificate and the repository secrets.

### 3a. Get a Developer ID certificate

Requires a paid Apple Developer Program membership. Apple issues **Developer ID
Application** certificates only to members.

1. Keychain Access → Certificate Assistant → *Request a Certificate From a
   Certificate Authority* → save the CSR to disk (Keychain Access → *Saved to
   disk*, 2048-bit RSA).
2. developer.apple.com → Certificates, Identifiers & Profiles → **+** →
   *Developer ID Application* → upload the CSR → download the `.cer`.
3. Double-click the `.cer` to install it, then in Keychain Access select the
   certificate **and its private key**, right-click → *Export* → `.p12`, and set
   a password.
4. Base64 it for CI:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy     # paste into APPLE_CERTIFICATE
   ```

5. Note the exact identity string, which is what `APPLE_SIGNING_IDENTITY` wants:

   ```bash
   security find-identity -v -p codesigning
   # "Developer ID Application: Your Name (TEAMID)"
   ```

6. Notarisation needs an **app-specific password** (appleid.apple.com → Sign-In
   and Security → App-Specific Passwords), not your Apple ID password. The Team
   ID is the 10-character code in the membership details.

### 3b. Add the repository secrets

`.github/workflows/release.yml` reads exactly these:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` from step 4 |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting it |
| `KEYCHAIN_PASSWORD` | any password; used for the throwaway CI keychain |
| `APPLE_SIGNING_IDENTITY` | the string from step 5 |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from step 6 |
| `APPLE_TEAM_ID` | the 10-character team ID |

Tauri signs from `APPLE_SIGNING_IDENTITY` and notarises automatically once the
last three are present. Without `APPLE_CERTIFICATE` the workflow still runs and
warns that it is building unsigned, so a fork is not blocked.

### 3c. Verify locally before tagging

```bash
cd .tauri && ../node_modules/.bin/tauri build --bundles app,dmg
codesign --verify --deep --strict --verbose=2 "target/release/bundle/macos/ACSA Code.app"
spctl --assess --type execute --verbose=2 "target/release/bundle/macos/ACSA Code.app"
xcrun stapler validate "target/release/bundle/macos/ACSA Code.app"
```

`spctl` should report *accepted, source=Notarized Developer ID*. If it says
*rejected*, the entitlement that matters most for this app is
`com.apple.security.cs.disable-library-validation` — the frozen engine unpacks
its own libpython, and the hardened runtime kills the process on launch without
it.

### 3d. Windows (later)

`bundle.windows.certificateThumbprint` is `null` and no job signs or publishes a
Windows build. The shape is the same: an Authenticode certificate, then
`signtool` over the `nsis` installer.

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
    "darwin-aarch64": { "signature": "<.sig contents>", "url": "https://<host>/ACSA-Code_0.2.0_aarch64.app.tar.gz" }
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
2. `npm run verify` — typecheck plus the Python suite. `npm run notices:check` runs in CI and fails if a dependency change left the notices stale.
3. `tauri build` with the signing key set.
4. Launch the `.app` and confirm the engine resolves from `Contents/Resources`.
5. Notarise and staple, upload the artifact + `.sig`, publish `latest.json`.
6. Install the *previous* version and confirm it updates to the new one.
