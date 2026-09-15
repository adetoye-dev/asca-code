"""Outcome honesty: a mutation that leaves broken syntax must not be "success"."""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import manager
from gauntlet.syntax_guard import (
    Diagnostic,
    GauntletReport,
    LinterResult,
    LinterStatus,
    Severity,
)


def _report(path: str, errors: int) -> GauntletReport:
    diags = [
        Diagnostic(
            file=path,
            line=1,
            column=1,
            severity=Severity.ERROR,
            code="E999",
            message="unexpected indent",
            source="ruff",
        )
        for _ in range(errors)
    ]
    return GauntletReport(
        target_paths=[path],
        passed=errors == 0,
        linter_results=[
            LinterResult(
                linter="ruff",
                status=LinterStatus.FAIL if errors else LinterStatus.PASS,
                exit_code=1 if errors else 0,
                diagnostics=diags,
            )
        ],
        total_diagnostics=errors,
        total_errors=errors,
    )


class _FakeAgentResult:
    def __init__(self, edited_files):
        self.edited_files = edited_files
        self.answer = "Done."
        self.total_rounds = 1


class OrchestrateOutcomeTests(unittest.TestCase):
    """`orchestrate()` used to return SUCCESS even when the self-healing pass
    still left syntax errors on disk, so the UI reported success on a corrupted
    file. Pin the honest outcome here.
    """

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-orch-"))
        (self.root / "calc.py").write_text("def multiply(a, b):\n    return a * b\n", encoding="utf-8")
        self.config = manager.ProjectConfig(
            project_root=str(self.root),
            language="python",
            llm_provider="ollama",
            llm_model="qwen2.5-coder:7b",
        )

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _run(self, syntax_reports):
        """Drive orchestrate() through the mutation path with a scripted gate."""
        reports = list(syntax_reports)

        def fake_gate(*_args, **_kwargs):
            return reports.pop(0) if reports else _report(str(self.root / "calc.py"), 0)

        with mock.patch.object(manager, "classify_intent", return_value="mutation"), \
             mock.patch.object(
                 manager,
                 "run_agent_loop",
                 return_value=_FakeAgentResult(["calc.py"]),
             ), \
             mock.patch.object(manager, "run_syntax_gate", side_effect=fake_gate):
            return manager.orchestrate(
                "Add validation to multiply",
                self.config,
                skip_performance=True,
            )

    def test_unresolved_syntax_errors_report_failure(self):
        path = str(self.root / "calc.py")
        # First gate finds errors; the self-healing re-check finds them again.
        result = self._run([_report(path, 1), _report(path, 1)])
        self.assertEqual(result.outcome, manager.LoopOutcome.FAILED)
        self.assertIn("syntax", result.error_detail.lower())

    def test_clean_edit_still_reports_success(self):
        path = str(self.root / "calc.py")
        result = self._run([_report(path, 0)])
        self.assertEqual(result.outcome, manager.LoopOutcome.SUCCESS)


if __name__ == "__main__":
    unittest.main()
