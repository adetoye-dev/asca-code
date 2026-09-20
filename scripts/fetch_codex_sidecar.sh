#!/usr/bin/env bash
# Fetch the Codex CLI the agent will run on.
#
# Why this replaces our own agent loop: Codex does native tool calling, which our
# harness could not — the model narrated `read_file` in prose and the loop answered
# with a guard message. Its binary is Apache-2.0, so we can ship it; pinning the
# release keeps builds reproducible, and shipping it as a resource means the user
# installs nothing.
#
# Usage:  scripts/fetch_codex_sidecar.sh
# Output: .tauri/engine-codex/codex   (gitignored; ~88 MB extracted)
# Override the pin with CODEX_VERSION when deliberately moving up.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${CODEX_VERSION:-rust-v0.154.0}"
TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"

case "$TRIPLE" in
  aarch64-apple-darwin) ASSET="codex-aarch64-apple-darwin" ;;
  x86_64-apple-darwin)  ASSET="codex-x86_64-apple-darwin" ;;
  aarch64-unknown-linux-gnu) ASSET="codex-aarch64-unknown-linux-gnu" ;;
  x86_64-unknown-linux-gnu)  ASSET="codex-x86_64-unknown-linux-gnu" ;;
  *) echo "error: no pinned Codex build for ${TRIPLE}" >&2; exit 1 ;;
esac

DEST="$REPO_ROOT/.tauri/engine-codex"
BIN="$DEST/codex"

if [ -x "$BIN" ]; then
  echo "Already present: $("$BIN" --version 2>/dev/null || echo 'unusable')"
  exit 0
fi

mkdir -p "$DEST"
ARCHIVE="${TMPDIR:-/tmp}/codex-${ASSET}.tar.gz"

echo "Downloading ${ASSET} (${VERSION})…"
# `--retry` and `-C -`: the release is a large asset and the first attempt on a slow
# connection otherwise leaves a truncated file that fails at extract time.
curl -fsSL --retry 3 --retry-all-errors -C - -o "$ARCHIVE" \
  "https://github.com/openai/codex/releases/download/${VERSION}/${ASSET}.tar.gz"

tar xzf "$ARCHIVE" -C "$DEST"
mv -f "$DEST/${ASSET}" "$BIN"
chmod +x "$BIN"
# A downloaded binary is quarantined; ours ships inside a signed bundle, but a source
# checkout would trip Gatekeeper on first run.
xattr -dr com.apple.quarantine "$BIN" 2>/dev/null || true

echo "Codex ready: $("$BIN" --version)"
