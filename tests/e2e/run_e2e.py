#!/usr/bin/env python3
"""End-to-end regression: run the real agent pipeline on a small task and verify.

Unlike the unit suite (which pins code contracts with fake models), this drives
`core-engine/manager.py` end-to-end against a real local Ollama model and checks
that the resulting files actually behave correctly. It is opt-in because it
needs a live model and takes a couple of minutes:

    npm run test:e2e                 # edit scenario (most important)
    npm run test:e2e -- --scenario all

Skips cleanly when Ollama is unreachable.
"""

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MANAGER = REPO_ROOT / "core-engine" / "manager.py"
OLLAMA_URL = os.environ.get("ACSA_E2E_OLLAMA_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("ACSA_E2E_MODEL", "qwen2.5-coder:7b")

MODEL = DEFAULT_MODEL


def ollama_reachable() -> bool:
    try:
        req = urllib.request.Request(f"{OLLAMA_URL.rstrip('/')}/api/tags")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False


def run_scenario(name: str, setup, task: str, verify) -> bool:
    root = Path(tempfile.mkdtemp(prefix=f"acsa-e2e-{name}-"))
    setup(root)
    print(f"[{name}] project: {root}")

    cmd = [
        sys.executable, str(MANAGER),
        "--task", task,
        "--project-root", str(root),
        "--auto-scale",
        "--language", "python",
        "--provider", "ollama",
        "--model", MODEL,
        "--base-url", OLLAMA_URL,
        "--skip-performance",
        "--json",
    ]
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        print(f"[{name}] FAIL: timed out after 600s")
        shutil.rmtree(root, ignore_errors=True)
        return False
    elapsed = time.time() - t0
    print(f"[{name}] manager exited {proc.returncode} in {elapsed:.0f}s")

    if proc.returncode != 0:
        tail = (proc.stdout or proc.stderr or "")[-1500:]
        print(f"[{name}] FAIL (exit {proc.returncode}):\n{tail}")
        shutil.rmtree(root, ignore_errors=True)
        return False

    try:
        verify(root)
        print(f"[{name}] PASS ({elapsed:.0f}s)")
        return True
    except AssertionError as exc:
        print(f"[{name}] FAIL: {exc}")
        for p in sorted(root.rglob("*.py")):
            if ".acsa" in p.parts:
                continue
            print(f"### {p.relative_to(root)}")
            print(p.read_text(encoding="utf-8", errors="replace"))
        return False
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_edit(root: Path) -> None:
    (root / "calc.py").write_text(
        "def multiply(a, b):\n    return a * b\n", encoding="utf-8"
    )


def verify_edit(root: Path) -> None:
    path = root / "calc.py"
    src = path.read_text(encoding="utf-8")
    assert "raise TypeError" in src, "validation was not added"
    assert src.count("raise TypeError") <= 2, "validation was duplicated"
    assert "def test_" not in src, "agent leaked test functions into the source file"
    assert "import pytest" not in src, "agent added a pytest import to the source file"
    mod = _load_module(path)
    assert mod.multiply(2, 3) == 6, "multiply no longer multiplies"
    try:
        mod.multiply("x", 3)
        raise AssertionError("multiply('x', 3) did not raise TypeError")
    except TypeError:
        pass


def setup_greenfield(root: Path) -> None:
    return None


def verify_greenfield(root: Path) -> None:
    path = root / "utils.py"
    assert path.exists(), "utils.py was not created"
    mod = _load_module(path)
    assert mod.add(2, 3) == 5, "add() does not return the sum"
    assert mod.add(-1, 1) == 0, "add() mishandles negatives"


SCENARIOS = {
    "edit": (
        "edit",
        "Add input validation to the multiply function: raise a TypeError if a or b is not an int or float.",
        setup_edit,
        verify_edit,
    ),
    "greenfield": (
        "greenfield",
        "Create a file utils.py containing a function add(a, b) that returns a + b.",
        setup_greenfield,
        verify_greenfield,
    ),
}


def main() -> int:
    global MODEL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--scenario", choices=["edit", "greenfield", "all"], default="edit"
    )
    args = parser.parse_args()
    MODEL = args.model

    if not ollama_reachable():
        print(f"SKIP: Ollama not reachable at {OLLAMA_URL}")
        return 0

    names = ["edit", "greenfield"] if args.scenario == "all" else [args.scenario]
    failures = 0
    for name in names:
        scenario_name, task, setup, verify = SCENARIOS[name]
        if not run_scenario(scenario_name, setup, task, verify):
            failures += 1

    print("\nE2E RESULT:", "ALL PASS" if failures == 0 else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
