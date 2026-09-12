#!/usr/bin/env python3
"""
oracle_generator.py — Property-Based Testing Oracle

Reads function type signatures (from tree_sitter_cfg.py), generates
adversarial property-based test files using Hypothesis (Python) or
stdlib-only fuzzing (fallback), and executes them against the AI's
code draft to find edge-case crashes and invariant breaches.

Acts as an automated QA engineer — stress-testing generated code
before it passes the gauntlet.

Stdlib only for the oracle itself; Hypothesis is used at test runtime
if available, otherwise falls back to deterministic edge-case tables.
"""

from __future__ import annotations

import json
import itertools
import logging
import os
import random
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("OracleGenerator")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s",'
        '"component":"OracleGenerator","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)

MAX_FALLBACK_CASES = 100


# ── Resolve sibling imports ──────────────────────────────────────────────────

_GAUNTLET_DIR = Path(__file__).resolve().parent
_ENGINE_DIR = _GAUNTLET_DIR.parent
_DATAMAP_DIR = _ENGINE_DIR / "data-map"

if str(_GAUNTLET_DIR) not in sys.path:
    sys.path.insert(0, str(_GAUNTLET_DIR))
if str(_DATAMAP_DIR) not in sys.path:
    sys.path.insert(0, str(_DATAMAP_DIR))

from tree_sitter_cfg import (  # noqa: E402
    FunctionSignature,
    ParameterInfo,
    ParamKind,
    parse_file,
    extract_function_signature,
)
from load_sandbox import _sanitize_sandbox_environment  # noqa: E402


# ── Data Structures ──────────────────────────────────────────────────────────


class OracleOutcome(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"


@dataclass
class OracleViolation:
    """A single property violation found by the oracle."""

    function_name: str
    property_name: str
    input_repr: str
    error_type: str
    error_message: str
    line_number: int = 0

    def to_dict(self) -> dict:
        return {
            "function": self.function_name,
            "property": self.property_name,
            "input": self.input_repr,
            "error_type": self.error_type,
            "message": self.error_message,
            "line": self.line_number,
        }


@dataclass
class OracleResult:
    """Result of running oracle tests for a single function."""

    function_name: str
    outcome: OracleOutcome
    tests_run: int = 0
    violations: list[OracleViolation] = field(default_factory=list)
    elapsed_ms: float = 0.0
    test_file: str = ""
    raw_output: str = ""
    error_detail: str = ""

    def to_dict(self) -> dict:
        return {
            "function": self.function_name,
            "outcome": self.outcome.value,
            "tests_run": self.tests_run,
            "violations": [v.to_dict() for v in self.violations],
            "elapsed_ms": round(self.elapsed_ms, 2),
            "error_detail": self.error_detail,
        }


@dataclass
class OracleReport:
    """Aggregate report from running oracles over multiple functions."""

    target_file: str
    total_functions: int = 0
    functions_tested: int = 0
    total_violations: int = 0
    passed: bool = True
    results: list[OracleResult] = field(default_factory=list)
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "target_file": self.target_file,
            "total_functions": self.total_functions,
            "functions_tested": self.functions_tested,
            "total_violations": self.total_violations,
            "passed": self.passed,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "results": [r.to_dict() for r in self.results],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Type-to-Strategy Mapping ────────────────────────────────────────────────

# Maps Python type annotations to Hypothesis strategies or edge-case values.

HYPOTHESIS_STRATEGIES: dict[str, str] = {
    "int": "st.integers()",
    "float": "st.floats(allow_nan=False, allow_infinity=False)",
    "str": "st.text(max_size=200)",
    "bool": "st.booleans()",
    "bytes": "st.binary(max_size=200)",
    "list": "st.lists(st.integers(), max_size=50)",
    "dict": "st.dictionaries(st.text(max_size=20), st.integers(), max_size=20)",
    "set": "st.frozensets(st.integers(), max_size=50)",
    "tuple": "st.tuples(st.integers(), st.text(max_size=20))",
    "Optional[int]": "st.one_of(st.none(), st.integers())",
    "Optional[str]": "st.one_of(st.none(), st.text(max_size=200))",
    "Optional[float]": "st.one_of(st.none(), st.floats(allow_nan=False))",
    "list[int]": "st.lists(st.integers(), max_size=50)",
    "list[str]": "st.lists(st.text(max_size=50), max_size=30)",
    "list[float]": "st.lists(st.floats(allow_nan=False), max_size=50)",
    "dict[str, int]": "st.dictionaries(st.text(max_size=20), st.integers(), max_size=20)",
    "dict[str, str]": "st.dictionaries(st.text(max_size=20), st.text(max_size=50), max_size=20)",
    "Any": "st.one_of(st.integers(), st.text(max_size=50), st.booleans(), st.none())",
}

# Deterministic edge-case tables for fallback testing (no Hypothesis)
EDGE_CASES: dict[str, list] = {
    "int": [0, 1, -1, 2**31 - 1, -(2**31), 2**63 - 1, 42, 100, -100],
    "float": [0.0, -0.0, 1.0, -1.0, 0.1, 1e10, -1e10, 1e-10, 0.5, 99.99],
    "str": ["", " ", "hello", "a" * 300, "\n\t\r", "<script>", "'\"\\",
            "SELECT * FROM", "null", "undefined", "🎉", "0"],
    "bool": [True, False],
    "bytes": [b"", b"\x00", b"hello", b"\xff" * 10],
    "list": [[], [1], [1, 2, 3], list(range(100)), [None], [-1, 0, 1]],
    "dict": [{}, {"a": 1}, {"key": "value"}, {str(i): i for i in range(50)}],
    "None": [None],
}


def _type_to_strategy(type_str: Optional[str]) -> str:
    """Convert a type annotation string to a Hypothesis strategy expression."""
    if not type_str:
        return "st.one_of(st.integers(), st.text(max_size=50), st.none())"

    cleaned = type_str.strip()

    # Direct lookup
    if cleaned in HYPOTHESIS_STRATEGIES:
        return HYPOTHESIS_STRATEGIES[cleaned]

    # Handle Optional[X]
    opt_match = _extract_optional_inner(cleaned)
    if opt_match:
        inner_strategy = _type_to_strategy(opt_match)
        return f"st.one_of(st.none(), {inner_strategy})"

    # Handle list[X]
    list_match = _extract_generic_inner(cleaned, "list")
    if list_match:
        inner = _type_to_strategy(list_match)
        return f"st.lists({inner}, max_size=50)"

    # Handle dict[K, V]
    dict_match = _extract_dict_types(cleaned)
    if dict_match:
        k_strat = _type_to_strategy(dict_match[0])
        v_strat = _type_to_strategy(dict_match[1])
        return f"st.dictionaries({k_strat}, {v_strat}, max_size=20)"

    # Fallback: treat as opaque — use mixed strategy
    return "st.one_of(st.integers(), st.text(max_size=50), st.none())"


def _type_to_edge_cases(type_str: Optional[str]) -> list:
    """Convert a type annotation to deterministic edge-case values."""
    if not type_str:
        return EDGE_CASES["int"] + EDGE_CASES["str"] + [None]

    cleaned = type_str.strip().lower()

    cleaned = type_str.strip().lower()

    base = cleaned.split("[")[0].strip()
    if "optional" in cleaned:
        base = _extract_optional_inner(type_str.strip()) or base
        base = base.strip().lower().split("[")[0]

    for key in EDGE_CASES:
        if key.lower() == base:
            values = list(EDGE_CASES[key])
            if "optional" in cleaned:
                values.append(None)
            return values

    # Fallback
    return EDGE_CASES["int"] + EDGE_CASES["str"] + [None]


def _extract_optional_inner(type_str: str) -> Optional[str]:
    """Extract inner type from Optional[X]."""
    match = __import__("re").match(r"Optional\[(.+)\]", type_str)
    return match.group(1) if match else None


def _extract_generic_inner(type_str: str, generic: str) -> Optional[str]:
    """Extract inner type from generic[X]."""
    match = __import__("re").match(
        rf"{generic}\[(.+)\]", type_str, __import__("re").IGNORECASE
    )
    return match.group(1) if match else None


def _extract_dict_types(type_str: str) -> Optional[tuple[str, str]]:
    """Extract key and value types from dict[K, V]."""
    match = __import__("re").match(r"dict\[(.+?),\s*(.+)\]", type_str, __import__("re").IGNORECASE)
    if match:
        return (match.group(1).strip(), match.group(2).strip())
    return None


# ── Test File Generation ────────────────────────────────────────────────────


def _check_hypothesis_available() -> bool:
    """Check if Hypothesis is importable."""
    try:
        result = subprocess.run(
            [sys.executable, "-c", "import hypothesis"],
            capture_output=True, timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def generate_hypothesis_test(
    sig: FunctionSignature,
    target_module_path: str,
) -> str:
    """Generate a Hypothesis property-based test file for a function."""
    import_path = Path(target_module_path).stem

    # Build strategy arguments
    given_args: list[str] = []
    param_names: list[str] = []

    for param in sig.parameters:
        strategy = _type_to_strategy(param.type_annotation)
        param_names.append(param.name)
        given_args.append(f"        {param.name}={strategy},")

    given_block = "\n".join(given_args)
    call_args = ", ".join(f"{n}={n}" for n in param_names)

    test_code = textwrap.dedent(f"""\
        \"\"\"Auto-generated property-based tests for {sig.name}.\"\"\"
        import sys
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath("{target_module_path}")))

        from hypothesis import given, settings, HealthCheck
        import hypothesis.strategies as st

        from {import_path} import {sig.name}


        @given(
        {given_block}
        )
        @settings(
            max_examples=100,
            deadline=5000,
            suppress_health_check=[HealthCheck.too_slow],
        )
        def test_{sig.name}_no_crash({", ".join(param_names)}):
            \"\"\"Property: {sig.name} must not raise unhandled exceptions.\"\"\"
            try:
                result = {sig.name}({call_args})
            except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):
                pass  # Expected domain errors are OK
            except Exception as exc:
                raise AssertionError(
                    f"Unexpected {{type(exc).__name__}}: {{exc}}"
                ) from exc

    """)

    # Add return-type invariant test if we know the type
    if sig.return_type and sig.return_type not in ("None", "void"):
        type_checks = _build_return_type_check(sig.return_type)
        if type_checks:
            test_code += textwrap.dedent(f"""\

        @given(
        {given_block}
        )
        @settings(
            max_examples=50,
            deadline=5000,
            suppress_health_check=[HealthCheck.too_slow],
        )
        def test_{sig.name}_return_type({", ".join(param_names)}):
            \"\"\"Property: {sig.name} must return the declared type.\"\"\"
            try:
                result = {sig.name}({call_args})
            except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):
                return  # Skip on expected domain errors
            {type_checks}

        """)

    # Add idempotency test for pure functions (no 'self' param)
    if not sig.is_method and not sig.is_async:
        test_code += textwrap.dedent(f"""\

        @given(
        {given_block}
        )
        @settings(
            max_examples=30,
            deadline=5000,
            suppress_health_check=[HealthCheck.too_slow],
        )
        def test_{sig.name}_deterministic({", ".join(param_names)}):
            \"\"\"Property: calling {sig.name} twice with same args gives same result.\"\"\"
            try:
                r1 = {sig.name}({call_args})
                r2 = {sig.name}({call_args})
            except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):
                return  # Skip on expected domain errors
            assert r1 == r2, (
                f"Non-deterministic: {{repr(r1)}} != {{repr(r2)}}"
            )

        """)

    # Add runner at bottom
    test_code += textwrap.dedent(f"""\

        if __name__ == "__main__":
            import traceback
            test_functions = [
                f for f in dir() if f.startswith("test_{sig.name}")
            ]
            failures = []
            for name in test_functions:
                fn = globals()[name]
                try:
                    fn()
                    print(f"  PASS: {{name}}")
                except Exception as exc:
                    failures.append((name, exc))
                    print(f"  FAIL: {{name}}: {{exc}}")
            if failures:
                print(f"\\n{{len(failures)}}/{{len(test_functions)}} tests FAILED")
                sys.exit(1)
            else:
                print(f"\\n{{len(test_functions)}}/{{len(test_functions)}} tests PASSED")
                sys.exit(0)
    """)

    return test_code


def generate_fallback_test(
    sig: FunctionSignature,
    target_module_path: str,
) -> str:
    """Generate a deterministic edge-case test file (no Hypothesis)."""
    import_path = Path(target_module_path).stem

    # Build edge-case combinations
    param_edge_cases: list[tuple[str, list]] = []
    for param in sig.parameters:
        cases = _type_to_edge_cases(param.type_annotation)
        param_edge_cases.append((param.name, cases))

    # Generate test cases as a product-like iteration (capped)
    test_lines: list[str] = []
    test_lines.append(f'"""Auto-generated edge-case tests for {sig.name}."""')
    test_lines.append("import sys")
    test_lines.append("import os")
    test_lines.append("import itertools")
    test_lines.append(
        f'sys.path.insert(0, os.path.dirname(os.path.abspath("{target_module_path}")))'
    )
    test_lines.append(f"from {import_path} import {sig.name}")
    test_lines.append("")
    test_lines.append("EDGE_CASES = {")

    for pname, cases in param_edge_cases:
        safe_cases = repr(cases[:15])  # Cap at 15 per param
        test_lines.append(f'    "{pname}": {safe_cases},')

    test_lines.append("}")
    test_lines.append("")
    test_lines.append("def run_oracle():")
    test_lines.append("    passed = 0")
    test_lines.append("    failed = 0")
    test_lines.append("    violations = []")
    test_lines.append("")

    # Generate nested loops — cap to avoid combinatorial explosion
    if len(param_edge_cases) == 0:
        test_lines.append(f"    # No parameters — call once")
        test_lines.append(f"    try:")
        test_lines.append(f"        result = {sig.name}()")
        test_lines.append(f"        passed += 1")
        test_lines.append(f"    except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):")
        test_lines.append(f"        passed += 1  # Expected domain error")
        test_lines.append(f"    except Exception as exc:")
        test_lines.append(f"        failed += 1")
        test_lines.append(f'        violations.append(f"{{type(exc).__name__}}: {{exc}}")')
    elif len(param_edge_cases) == 1:
        pname = param_edge_cases[0][0]
        test_lines.append(f'    for {pname} in EDGE_CASES["{pname}"]:')
        test_lines.append(f"        try:")
        test_lines.append(f"            result = {sig.name}({pname}={pname})")
        test_lines.append(f"            passed += 1")
        test_lines.append(f"        except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):")
        test_lines.append(f"            passed += 1")
        test_lines.append(f"        except Exception as exc:")
        test_lines.append(f"            failed += 1")
        test_lines.append(f'            violations.append(f"{pname}={{repr({pname})}}: {{type(exc).__name__}}: {{exc}}")')
    else:
        # For 2+ params: bound the complete Cartesian product globally.
        all_names = ", ".join(f'EDGE_CASES["{p[0]}"]' for p in param_edge_cases)
        test_lines.append(
            f"    for values in itertools.islice(itertools.product({all_names}), {MAX_FALLBACK_CASES}):"
        )
        for idx, (oname, _) in enumerate(param_edge_cases):
            test_lines.append(f"        {oname} = values[{idx}]")

        indent = "        "
        call_args = ", ".join(f"{p[0]}={p[0]}" for p in param_edge_cases)
        arg_names = ", ".join(p[0] for p in param_edge_cases)

        test_lines.append(f"{indent}try:")
        test_lines.append(f"{indent}    result = {sig.name}({call_args})")
        test_lines.append(f"{indent}    passed += 1")
        test_lines.append(f"{indent}except (ValueError, TypeError, KeyError, IndexError, ZeroDivisionError):")
        test_lines.append(f"{indent}    passed += 1")
        test_lines.append(f"{indent}except Exception as exc:")
        test_lines.append(f"{indent}    failed += 1")
        test_lines.append(f'{indent}    violations.append(f"args=({{ {arg_names} }}): {{type(exc).__name__}}: {{exc}}")')

    test_lines.append("")
    test_lines.append('    print(f"  Tests run: {passed + failed}")')
    test_lines.append('    print(f"  Passed: {passed}")')
    test_lines.append('    print(f"  Failed: {failed}")')
    test_lines.append("    if violations:")
    test_lines.append('        print("  Violations:")')
    test_lines.append("        for v in violations[:10]:")
    test_lines.append('            print(f"    ✗ {v}")')
    test_lines.append("    return passed, failed, violations")
    test_lines.append("")
    test_lines.append("")
    test_lines.append('if __name__ == "__main__":')
    test_lines.append(f'    print("Oracle test: {sig.name}")')
    test_lines.append("    passed, failed, violations = run_oracle()")
    test_lines.append("    sys.exit(1 if failed > 0 else 0)")

    return "\n".join(test_lines) + "\n"


def _build_return_type_check(return_type: str) -> str:
    """Build an assertion checking the return type."""
    type_map = {
        "int": "int",
        "float": "(int, float)",
        "str": "str",
        "bool": "bool",
        "list": "list",
        "dict": "dict",
        "tuple": "tuple",
        "set": "(set, frozenset)",
        "bytes": "bytes",
    }

    cleaned = return_type.strip()
    opt_inner = _extract_optional_inner(cleaned)
    if opt_inner:
        inner_check = type_map.get(opt_inner.strip().split("[")[0].lower())
        if inner_check:
            return (
                f"if result is not None:\n"
                f"        assert isinstance(result, {inner_check}), (\n"
                f'            f"Expected {cleaned}, got {{type(result).__name__}}"\n'
                f"        )"
            )
        return ""

    base = cleaned.split("[")[0].lower()
    py_type = type_map.get(base)
    if py_type:
        return (
            f"assert isinstance(result, {py_type}), (\n"
            f'        f"Expected {cleaned}, got {{type(result).__name__}}"\n'
            f"    )"
        )

    return ""


# ── Test Execution ───────────────────────────────────────────────────────────


def run_oracle_test(
    test_file: str,
    timeout_seconds: int = 60,
    function_name: str = "",
) -> OracleResult:
    """Execute a generated oracle test file and parse the results."""
    result = OracleResult(
        function_name=function_name,
        outcome=OracleOutcome.ERROR,
        test_file=test_file,
    )

    if not Path(test_file).exists():
        result.error_detail = f"Test file not found: {test_file}"
        logger.error(result.error_detail)
        return result

    start = time.monotonic()

    try:
        safe_env = _sanitize_sandbox_environment({"PYTHONPATH": str(Path(test_file).parent)})
        proc = subprocess.run(
            [sys.executable, test_file],
            capture_output=True,
            timeout=timeout_seconds,
            text=True,
            cwd=str(Path(test_file).parent),
            env=safe_env,
        )
        elapsed = (time.monotonic() - start) * 1000
        result.elapsed_ms = elapsed
        result.raw_output = proc.stdout + proc.stderr

        if proc.returncode == 0:
            result.outcome = OracleOutcome.PASS
            # Parse test count from output
            result.tests_run = _count_tests_from_output(proc.stdout)
            logger.info(
                "Oracle PASSED for %s — %d tests in %.0fms",
                function_name, result.tests_run, elapsed,
            )
        else:
            raw_err = proc.stdout + proc.stderr
            missing_module = _missing_module_from_error(raw_err)
            fallback_dependency = missing_module in {"hypothesis"}
            if fallback_dependency:
                result.outcome = OracleOutcome.SKIPPED
                result.error_detail = f"Skipped: fallback dependency '{missing_module}' is not installed"
                logger.info(
                    "Oracle SKIPPED for %s — missing external framework dependency in host runner",
                    function_name,
                )
            else:
                result.outcome = OracleOutcome.FAIL
                result.tests_run = _count_tests_from_output(proc.stdout)
                result.violations = _parse_violations(
                    raw_err, function_name
                )
                logger.error(
                    "Oracle FAILED for %s — %d violations in %.0fms",
                    function_name, len(result.violations), elapsed,
                )

    except subprocess.TimeoutExpired:
        result.outcome = OracleOutcome.TIMEOUT
        result.elapsed_ms = timeout_seconds * 1000
        result.error_detail = f"Test timed out after {timeout_seconds}s"
        logger.error("Oracle TIMEOUT for %s after %ds", function_name, timeout_seconds)

    except OSError as exc:
        result.error_detail = f"Failed to execute test: {exc}"
        logger.error("Oracle execution error for %s: %s", function_name, exc)

    return result


def _missing_module_from_error(raw_output: str) -> Optional[str]:
    """Extract the missing module name from a Python import traceback."""
    import re

    match = re.search(r"(?:ModuleNotFoundError|ImportError): No module named ['\"]([^'\"]+)", raw_output)
    return match.group(1).split(".", 1)[0] if match else None


def _count_tests_from_output(output: str) -> int:
    """Parse test count from oracle output."""
    import re as _re
    # Match patterns like "3/3 tests PASSED" or "Tests run: 45"
    match = _re.search(r"(\d+)/\d+ tests", output)
    if match:
        return int(match.group(1))
    match = _re.search(r"Tests run:\s*(\d+)", output)
    if match:
        return int(match.group(1))
    # Count PASS/FAIL lines
    return output.count("PASS:") + output.count("FAIL:")


def _parse_violations(output: str, function_name: str) -> list[OracleViolation]:
    """Parse violation details from test output."""
    import re as _re
    violations: list[OracleViolation] = []

    # Parse "FAIL: test_name: error message" lines
    for match in _re.finditer(r"FAIL:\s*(\S+):\s*(.+)", output):
        test_name = match.group(1)
        message = match.group(2).strip()

        # Extract error type if present
        err_match = _re.match(r"(\w+Error|AssertionError):\s*(.*)", message)
        error_type = err_match.group(1) if err_match else "AssertionError"
        error_msg = err_match.group(2) if err_match else message

        violations.append(
            OracleViolation(
                function_name=function_name,
                property_name=test_name,
                input_repr="(see raw output)",
                error_type=error_type,
                error_message=error_msg[:500],
            )
        )

    # Parse "✗ input: ErrorType: message" lines from fallback tests
    for match in _re.finditer(r"✗\s*(.+?):\s*(\w+Error):\s*(.+)", output):
        violations.append(
            OracleViolation(
                function_name=function_name,
                property_name="edge_case",
                input_repr=match.group(1).strip()[:200],
                error_type=match.group(2),
                error_message=match.group(3).strip()[:500],
            )
        )

    # Parse Hypothesis-style Falsifying examples
    for match in _re.finditer(
        r"Falsifying example:.*?\n\s*(.+?)$", output, _re.MULTILINE
    ):
        violations.append(
            OracleViolation(
                function_name=function_name,
                property_name="hypothesis",
                input_repr=match.group(1).strip()[:200],
                error_type="PropertyViolation",
                error_message="Hypothesis found a falsifying example",
            )
        )

    return violations


# ── Public API ───────────────────────────────────────────────────────────────


def run_oracle_for_file(
    target_file: str,
    function_names: Optional[list[str]] = None,
    timeout_per_function: int = 60,
    keep_test_files: bool = False,
) -> OracleReport:
    """Generate and run property-based tests for functions in a file.

    Parameters
    ----------
    target_file : str
        Path to the source file to test.
    function_names : list[str] | None
        Specific functions to test. If None, tests all discovered functions.
    timeout_per_function : int
        Max seconds per function's test suite.
    keep_test_files : bool
        If True, don't delete generated test files after execution.

    Returns
    -------
    OracleReport
        Aggregate results across all tested functions.
    """
    report_start = time.monotonic()
    report = OracleReport(target_file=target_file)

    if not target_file.endswith(".py"):
        logger.info("Oracle gate: skipped for non-Python target %s", target_file)
        report.passed = True
        report.elapsed_ms = (time.monotonic() - report_start) * 1000
        return report

    # Parse the target file to discover functions
    parse_result = parse_file(target_file)

    if parse_result.parse_errors:
        for err in parse_result.parse_errors:
            logger.warning("Parse issue in %s: %s", target_file, err)

    all_functions = parse_result.functions
    report.total_functions = len(all_functions)

    if function_names:
        targets = [f for f in all_functions if f.name in function_names]
        skipped = set(function_names) - {f.name for f in targets}
        for s in skipped:
            logger.warning("Function '%s' not found in %s", s, target_file)
    else:
        # Skip private/dunder functions and very short ones
        targets = [
            f for f in all_functions
            if not f.name.startswith("_") and f.end_line - f.start_line >= 2
        ]

    if not targets:
        logger.info("No testable functions found in %s", target_file)
        report.passed = True
        report.elapsed_ms = (time.monotonic() - report_start) * 1000
        return report

    # Check if Hypothesis is available
    use_hypothesis = _check_hypothesis_available()
    if use_hypothesis:
        logger.info("Using Hypothesis for property-based testing")
    else:
        logger.info("Hypothesis not available — using deterministic edge-case oracle")

    # Generate and run tests for each function
    temp_dir = tempfile.mkdtemp(prefix="oracle_")

    try:
        for sig in targets:
            logger.info(
                "Generating oracle for %s(%s) → %s (lines %d-%d)",
                sig.name,
                ", ".join(f"{p.name}: {p.type_annotation or '?'}" for p in sig.parameters),
                sig.return_type or "?",
                sig.start_line, sig.end_line,
            )

            # Generate test file
            if use_hypothesis:
                test_code = generate_hypothesis_test(sig, target_file)
            else:
                test_code = generate_fallback_test(sig, target_file)

            test_file = os.path.join(temp_dir, f"test_oracle_{sig.name}.py")
            Path(test_file).write_text(test_code, encoding="utf-8")

            # Execute
            result = run_oracle_test(
                test_file, timeout_per_function, sig.name
            )
            report.results.append(result)
            report.functions_tested += 1

            if result.violations:
                report.total_violations += len(result.violations)

            if result.outcome not in (OracleOutcome.PASS, OracleOutcome.SKIPPED):
                report.passed = False

    finally:
        if not keep_test_files:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        else:
            logger.info("Test files preserved in: %s", temp_dir)

    report.elapsed_ms = (time.monotonic() - report_start) * 1000

    logger.info(
        "Oracle report for %s: %d/%d functions tested, %d violations, %s in %.0fms",
        target_file, report.functions_tested, report.total_functions,
        report.total_violations,
        "PASSED" if report.passed else "FAILED",
        report.elapsed_ms,
    )

    return report


def format_oracle_context_card(
    report: OracleReport, max_tokens: int = 2000
) -> str:
    """Compress an OracleReport into a context card for the model feedback loop."""
    char_budget = max_tokens * 4
    card: dict = {
        "gate": "oracle",
        "passed": report.passed,
        "functions_tested": report.functions_tested,
        "total_violations": report.total_violations,
        "violations": [],
    }

    for result in report.results:
        for v in result.violations:
            entry = {
                "fn": v.function_name,
                "prop": v.property_name,
                "input": v.input_repr[:100],
                "err": f"{v.error_type}: {v.error_message[:200]}",
            }
            card["violations"].append(entry)

            current = json.dumps(card, separators=(",", ":"))
            if len(current) > char_budget:
                card["violations"].pop()
                card["truncated"] = True
                break

    return json.dumps(card, separators=(",", ":"))


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> int:
    """CLI: python oracle_generator.py <target_file> [--functions f1 f2 ...]"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate and run property-based oracle tests"
    )
    parser.add_argument("target_file", help="Source file to test")
    parser.add_argument(
        "--functions", nargs="*", default=None,
        help="Specific function names to test",
    )
    parser.add_argument(
        "--timeout", type=int, default=60,
        help="Timeout per function (seconds)",
    )
    parser.add_argument(
        "--keep-tests", action="store_true",
        help="Keep generated test files for inspection",
    )

    args = parser.parse_args()

    report = run_oracle_for_file(
        target_file=args.target_file,
        function_names=args.functions,
        timeout_per_function=args.timeout,
        keep_test_files=args.keep_tests,
    )

    print(report.to_json())
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
