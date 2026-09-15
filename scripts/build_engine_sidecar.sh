#!/usr/bin/env bash
# Freeze the Python engine into the single binary the desktop app ships.
#
# Why: the app used to run `python3 core-engine/manager.py`. macOS no longer
# ships a usable interpreter and Windows ships none, so on a clean machine the
# agent could not run at all. `acsa-engine` bundles the engine, the standard
# library and a Python runtime into one executable, so the app needs nothing
# installed.
#
# Usage:  scripts/build_engine_sidecar.sh
# Output: .tauri/binaries/acsa-engine-<target-triple>
#
# Tauri resolves `externalBin` entries by that triple suffix and strips it when
# bundling, so the app looks for a plain `acsa-engine` next to its executable.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
if [[ -z "${TRIPLE}" ]]; then
  echo "error: could not determine the Rust target triple (is rustc installed?)" >&2
  exit 1
fi

VENV="${ACSA_FREEZE_VENV:-/tmp/acsa-freeze-venv}"
if [[ ! -x "${VENV}/bin/pyinstaller" ]]; then
  echo "Creating build virtualenv at ${VENV}…"
  python3 -m venv "${VENV}"
  "${VENV}/bin/pip" install --quiet --disable-pip-version-check pyinstaller
fi

mkdir -p .tauri/binaries

# The dispatcher imports its entry points dynamically, so they are declared
# explicitly; PyInstaller's static analysis cannot see them.
"${VENV}/bin/pyinstaller" \
  --onefile --noconfirm --clean \
  --name acsa-engine \
  --distpath .tauri/binaries \
  --workpath "${TMPDIR:-/tmp}/acsa-freeze-build" \
  --specpath "${TMPDIR:-/tmp}/acsa-freeze-spec" \
  --paths core-engine \
  --paths core-engine/gauntlet \
  --paths core-engine/compiler \
  --paths core-engine/data-map \
  --paths core-engine/mcp_servers \
  --paths core-engine/skills \
  --paths scripts \
  --hidden-import manager \
  --hidden-import db_cli \
  --hidden-import project_indexer \
  --hidden-import pty_bridge \
  --hidden-import app_db \
  --hidden-import env_file \
  --hidden-import scale_detector \
  --hidden-import mcp_client \
  core-engine/acsa_engine.py

mv -f .tauri/binaries/acsa-engine ".tauri/binaries/acsa-engine-${TRIPLE}"

echo
echo "Built .tauri/binaries/acsa-engine-${TRIPLE}"
echo "Smoke test:"
".tauri/binaries/acsa-engine-${TRIPLE}" db info
