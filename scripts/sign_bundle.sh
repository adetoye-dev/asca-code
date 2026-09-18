#!/usr/bin/env bash
# Sign everything inside the bundle that Tauri did not, then re-sign the bundle.
#
# Why this exists
# ───────────────
# The frozen Python engine ships as a *resource directory*
# (`Contents/Resources/engine/acsa-engine/`), and Tauri copies resources
# verbatim — so the engine and its embedded libpython stay AD-HOC signed while
# the app around them gets a Developer ID. Verified on a real build:
#
#   ACSA Code.app                     TeamIdentifier=TFNTZSW82U  flags=runtime
#   Contents/Resources/engine-codex/codex   flags=0x10000(runtime)
#   Contents/Resources/engine/acsa-engine/acsa-engine   flags=0x2(adhoc)
#
# It still runs locally — an ad-hoc binary has no hardened-runtime flag, so
# nothing enforces library validation on it — but Apple will not notarize a
# bundle containing code that is not signed with the same Developer ID. That is
# the whole gap between "signed" and "shippable".
#
# Order matters: nested code first, outermost bundle last. Signing a child after
# its parent invalidates the parent's seal, which is why this cannot be a
# `beforeBundle` hook and runs after `tauri build`.
#
# Usage: APPLE_SIGNING_IDENTITY="Developer ID Application: …" scripts/sign_bundle.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$REPO_ROOT/.tauri/target/release/bundle/macos/ACSA Code.app}"
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
ENTITLEMENTS="$REPO_ROOT/.tauri/Entitlements.plist"

if [[ -z "$IDENTITY" ]]; then
  echo "error: set APPLE_SIGNING_IDENTITY (e.g. \"Developer ID Application: Name (TEAMID)\")" >&2
  exit 1
fi
if [[ ! -d "$APP" ]]; then
  echo "error: no bundle at $APP" >&2
  exit 1
fi

# A secure timestamp needs Apple's timestamp server. CI has it; a sandboxed local
# run may not, and `--timestamp=none` still produces a *valid* signature — just
# not one notarization would accept, which is the honest local case.
TIMESTAMP_ARGS=(--timestamp)
if [[ "${ACSA_NO_TIMESTAMP:-}" == "1" ]]; then
  TIMESTAMP_ARGS=(--timestamp=none)
fi

signed=0
while IFS= read -r -d '' file; do
  # Only real Mach-O binaries; `.so`/`.dylib` from PyInstaller count, JSON does not.
  if file -b "$file" | grep -q "Mach-O"; then
    codesign --force --options runtime "${TIMESTAMP_ARGS[@]}" --sign "$IDENTITY" "$file"
    signed=$((signed + 1))
  fi
done < <(find "$APP/Contents/Resources" -type f -print0)

echo "Signed $signed nested binaries."

# The main executable carries the entitlements, then the bundle seals everything.
codesign --force --options runtime "${TIMESTAMP_ARGS[@]}" \
  --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$APP/Contents/MacOS/acsa-code"
codesign --force --options runtime "${TIMESTAMP_ARGS[@]}" --sign "$IDENTITY" "$APP"

echo "Verifying…"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -3
spctl -a -vv "$APP" 2>&1 | head -2 || true
echo "Signed bundle: $APP"
