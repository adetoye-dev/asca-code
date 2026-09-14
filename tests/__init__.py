"""Test support for the ACSA Code engine.

The engine lives in ``core-engine/`` - a hyphenated directory that is not an
importable package - so this package puts it on ``sys.path`` once for every
test module. Keeping the path shim here means the suite runs with a bare
``python3 -m unittest``: no install step and no third-party dependency, which
matches the engine's stated stdlib-only design constraint.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "core-engine"

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
