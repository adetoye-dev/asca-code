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
    except Exception as exc:
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


def _assert_usage_recorded(root: Path) -> None:
    usage_file = root / ".acsa" / "usage.jsonl"
    assert usage_file.exists(), ".acsa/usage.jsonl was not created"
    lines = [ln for ln in usage_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert lines, "usage ledger is empty - LLM calls were not recorded"


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
    try:
        mod.multiply(2, "x")
        raise AssertionError("multiply(2, 'x') did not raise TypeError")
    except TypeError:
        pass
    _assert_usage_recorded(root)


def setup_greenfield(root: Path) -> None:
    return None


def verify_greenfield(root: Path) -> None:
    path = root / "utils.py"
    assert path.exists(), "utils.py was not created"
    mod = _load_module(path)
    assert mod.add(2, 3) == 5, "add() does not return the sum"
    assert mod.add(-1, 1) == 0, "add() mishandles negatives"
    _assert_usage_recorded(root)


def setup_multifile(root: Path) -> None:
    (root / "a.py").write_text("def helper(x):\n    return x + 1\n", encoding="utf-8")
    (root / "b.py").write_text(
        "from a import helper\n\n\ndef compute(x):\n    return helper(x) * 10\n",
        encoding="utf-8",
    )


def verify_multifile(root: Path) -> None:
    a_src = (root / "a.py").read_text(encoding="utf-8")
    b_src = (root / "b.py").read_text(encoding="utf-8")
    assert "def add_one" in a_src, "a.py function was not renamed"
    assert "from a import add_one" in b_src, "b.py import was not updated"
    assert "helper" not in b_src, "b.py still references the old name"
    sys.path.insert(0, str(root))
    try:
        mod_a = _load_module(root / "a.py")
        mod_b = _load_module(root / "b.py")
        assert mod_a.add_one(2) == 3, "renamed function behaves incorrectly"
        assert mod_b.compute(2) == 30, "b.py behaviour changed unexpectedly"
    finally:
        sys.path.pop(0)
    _assert_usage_recorded(root)


def setup_newproject(root: Path) -> None:
    return None


def verify_newproject(root: Path) -> None:
    utils = root / "utils.py"
    main = root / "main.py"
    assert utils.exists() and main.exists(), "expected utils.py and main.py to be scaffolded"
    sys.path.insert(0, str(root))
    try:
        mod = _load_module(utils)
        assert mod.greet("world") == "Hello, world", "greet() returns the wrong string"
    finally:
        sys.path.pop(0)
    proc = subprocess.run(
        [sys.executable, str(main)],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, f"main.py exited with {proc.returncode}: {proc.stderr}"
    assert "Hello, world" in proc.stdout, f"main.py produced unexpected output: {proc.stdout!r}"
    _assert_usage_recorded(root)


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
    "multifile": (
        "multifile",
        "Rename the function helper to add_one in a.py and update b.py to import and use the new name everywhere.",
        setup_multifile,
        verify_multifile,
    ),
    "newproject": (
        "newproject",
        "Create utils.py with a function greet(name) that returns 'Hello, ' + name, and create main.py that imports greet from utils and prints greet('world') when run.",
        setup_newproject,
        verify_newproject,
    ),
}


def main() -> int:
    global MODEL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--scenario",
        choices=["edit", "greenfield", "multifile", "newproject", "all"],
        default="edit",
    )
    args = parser.parse_args()
    MODEL = args.model

    if not ollama_reachable():
        print(f"SKIP: Ollama not reachable at {OLLAMA_URL}")
        return 0

    names = (
        ["edit", "greenfield", "multifile", "newproject"]
        if args.scenario == "all"
        else [args.scenario]
    )
    failures = 0
    for name in names:
        scenario_name, task, setup, verify = SCENARIOS[name]
        if not run_scenario(scenario_name, setup, task, verify):
            failures += 1

    print("\nE2E RESULT:", "ALL PASS" if failures == 0 else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
