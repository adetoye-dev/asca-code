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
ls "target/release/bundle/macos/ACSA Code.app/Contents/Resources/engine/acsa-engine/acsa-engine"
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
scripts/build_engine_sidecar.sh        # -> .tauri/engine/acsa-engine/acsa-engine
```

`acsa-engine` exposes the subcommands the app spawns (`db`, `index`, `indexer`,
`git`, `pty`, `ollama`, `skills`, `mcp`, `ai`); `bundle.resources` ships the
on-dir tree and the Rust command and the development bridge both resolve it,
falling back to `python3 core-engine/acsa_engine.py` for a source checkout.
`acsa-engine selftest` imports every subcommand, and CI asserts it answers — the
dispatcher loads its entry points dynamically, so a missing import would
otherwise only fail when that subcommand is used.

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

1. **On the Mac that will sign**, Keychain Access → Certificate Assistant →
   *Request a Certificate From a Certificate Authority*, and choose **Saved to
   disk**. This is the step that generates the private key: it stays in your
   `login` keychain and never leaves this machine.
2. developer.apple.com → Certificates, Identifiers & Profiles → **+** →
   *Developer ID Application* → upload the CSR → download the `.cer`.
3. Double-click the `.cer`, set the **Keychain** dropdown to **login** (it
   defaults to iCloud), and *Add*. Then in Keychain Access click the
   certificate's disclosure triangle so the certificate **and its private key**
   are both selected, right-click → *Export* → `.p12`, and set a password.

   Check the identity really formed before exporting — the `.cer` is only the
   public half and cannot sign anything on its own:

   ```bash
   security find-identity -v -p codesigning
   # want: "1 valid identities found" plus
   # "Developer ID Application: Your Name (TEAMID)"
   # "0 valid identities found" has two causes — see the traps below. Compare
   # against `security find-identity -p codesigning` (no -v) before concluding
   # that the private key is missing.
   ```

4. Base64 it for CI:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy     # paste into APPLE_CERTIFICATE
   ```

5. Copy the identity string verbatim from the step-3 output — that exact text,
   including the `(TEAMID)` suffix, is what `APPLE_SIGNING_IDENTITY` wants.

6. Notarisation needs an **app-specific password** (appleid.apple.com → Sign-In
   and Security → App-Specific Passwords), not your Apple ID password. The Team
   ID is the 10-character code in the membership details.

#### Traps that cost us a detour

- **The Keychain dropdown defaults to iCloud.** Pick **login** every time. An
  import that targets iCloud fails with `-25294` (`errSecNoSuchKeychain`), which
  reads like a corrupt certificate but only means the target keychain was not
  usable. If a later import reports
  `SecKeychainItemImport: The specified item already exists in the keychain`,
  take it literally — the certificate is already in the keychain you selected, so
  skip the import and go to the identity check. Confirm with:

  ```bash
  security find-certificate -a -c "<your name>" -p \
    ~/Library/Keychains/login.keychain-db | openssl x509 -noout -subject
  ```

  Do not delete and re-import by reflex; the ordinary case is that the import
  already worked.
- **A `.cer` from a different machine is useless.** Only the public half lives
  in the file. If the CSR was not made on this Mac, the certificate imports but
  reports no identity, and `codesign`/CI cannot use it.
- **Apple will issue several certs for the same name, and they collide.** They
  share a common name, so they overwrite each other as keychain items. Keep the
  one issued under **Developer ID Certification Authority G2** (five years) and
  revoke the rest in the portal — an older **G1** cert expires within a year.
- **A fresh leaf often imports as "not trusted".** Keychain Access shows a red X
  and `find-identity -v` reports `0 valid identities found` — but drop the `-v`
  and it reports `1 identities found`. That means the certificate and private key
  are both fine and only the **intermediate is missing**. The leaf says which one
  it needs:

  ```bash
  security find-certificate -a -c "<your name>" -p \
    ~/Library/Keychains/login.keychain-db | openssl x509 -noout -issuer
  # "Developer ID Certification Authority, OU=G2"  -> you need the G2 intermediate
  # "Developer ID Certification Authority, OU=Apple Certification Authority" -> G1
  ```

  A G2 leaf does **not** chain through the G1 intermediate even though both are
  called "Developer ID Certification Authority" — the `OU` is what differs, and
  macOS ships the G1 one, so the G2 leaf stays untrusted until you add G2. Install
  the matching intermediate from <https://www.apple.com/certificateauthority/>:

  ```bash
  curl -fsSL -o /tmp/DeveloperIDG2CA.cer \
    https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
  security import /tmp/DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db
  security find-identity -v -p codesigning   # now: 1 valid identities found
  ```

  This is normally local-only: the macOS GitHub runners already ship Apple's
  intermediates, so the `.p12` does not need to carry the chain.

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

#### When notarisation stalls, or looks like a hang

`notarytool submit --wait` polls until Apple returns a verdict. A few minutes is
normal; anything much longer means the submission is stuck, and waiting will not
clear it. The release workflow notarises explicitly rather than through Tauri —
Tauri's built-in path discards `notarytool`'s output, so this exact stall presents
as a silent fifteen-minute-or-longer hang inside the bundle step — and it prints
the submission id, so you can ask Apple directly what happened. `notarytool info`
needs the credentials, so keep the app-specific password in a password manager
rather than only in the repository secrets:

```bash
xcrun notarytool info <submission-id> \
  --apple-id "$APPLE_ID" --password "<app-specific password>" --team-id "$APPLE_TEAM_ID"
```

Read the result against <https://developer.apple.com/system-status/>:

- `Accepted` — the service was merely slow; the run can be repeated as-is.
- `Invalid` — Apple rejected it. `xcrun notarytool log <submission-id>` names the
  reason, which is a useful failure rather than silence.
- `In Progress` hours after submission, especially with a recent incident listed
  under *App Store Connect - App Upload* on the status page, means the submission
  was orphaned by that incident. `notarytool` has no cancel, so do not wait:
  re-run the release and submit again. A fresh submission completes in minutes
  once the service is healthy.

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
