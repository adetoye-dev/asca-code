"""The frozen engine must be able to answer every subcommand it advertises.

`acsa_engine.COMMANDS` is the dispatch table, and
`scripts/build_engine_sidecar.sh` lists the same modules for PyInstaller by hand.
The two drifted exactly once and the cost was a shipped feature: `snapshot` was
added to the dispatch and not to the freeze, so the packaged engine answered
`ModuleNotFoundError: No module named 'snapshot_cli'`. Source-mode tests cannot
see that, because source mode finds the module on `sys.path` — the only thing that
noticed was CI's "Sidecar answers each subcommand" step, on the commit *after* the
one that broke it.

This is the local half of that check: it asserts the two lists agree, so the drift
fails here rather than in a packaged build.
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core-engine"))

import acsa_engine  # noqa: E402


class EngineFreezeTests(unittest.TestCase):
    def frozen_modules(self) -> set[str]:
        script = (ROOT / "scripts" / "build_engine_sidecar.sh").read_text(encoding="utf-8")
        # `--hidden-import name \` — one per line in the shell invocation.
        return set(re.findall(r"--hidden-import\s+([A-Za-z_][A-Za-z0-9_]*)", script))

    def test_every_subcommand_module_is_frozen(self):
        frozen = self.frozen_modules()
        missing = {
            name: module
            for name, (module, _func) in acsa_engine.COMMANDS.items()
            if module not in frozen
        }
        self.assertEqual(
            missing,
            {},
            "these subcommands would fail in a packaged build with "
            f"ModuleNotFoundError: {missing}. Add them to "
            "scripts/build_engine_sidecar.sh as --hidden-import.",
        )

    def test_the_freeze_list_was_actually_parsed(self):
        # Guards the check above against a regex that quietly stopped matching: a
        # set that came back empty would fail loudly, but a set that came back
        # *small* would report a drift that is not there. `app_db` is pinned
        # because it is fundamental rather than a feature that might be removed —
        # whether `snapshot_cli` is frozen is what the check above is for.
        frozen = self.frozen_modules()
        self.assertIn("app_db", frozen)
        self.assertGreater(len(frozen), 15)


if __name__ == "__main__":
    unittest.main()
