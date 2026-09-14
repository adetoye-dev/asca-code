"""Tests for the persisted LLM usage & cost ledger."""

import shutil
import tempfile
import unittest
from pathlib import Path

from usage_metrics import (
    estimate_cost_usd,
    load_usage,
    record_usage,
    summarize_usage,
)


class UsageMetricsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="acsa-usage-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_record_and_load_roundtrip(self):
        record_usage(str(self.root), "ollama", "qwen2.5-coder:7b", 1000, 500, 1234.5)
        record_usage(str(self.root), "deepseek", "deepseek-v4-pro", 2000, 800, 999.0)
        rows = load_usage(str(self.root))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["provider"], "ollama")
        self.assertEqual(rows[1]["prompt_tokens"], 1000)

    def test_cost_is_zero_for_local_and_positive_for_cloud(self):
        self.assertEqual(estimate_cost_usd("ollama", 1000000, 1000000), 0.0)
        self.assertGreater(estimate_cost_usd("deepseek", 1000000, 1000000), 0.0)

    def test_summarize_usage_aggregates_by_model(self):
        record_usage(str(self.root), "ollama", "m1", 1000, 500, 1000)
        record_usage(str(self.root), "ollama", "m1", 500, 250, 500)
        record_usage(str(self.root), "openai", "gpt-4o", 100, 50, 800)
        summary = summarize_usage(str(self.root))
        self.assertEqual(summary["total_calls"], 3)
        self.assertEqual(summary["prompt_tokens"], 1600)
        self.assertEqual(summary["completion_tokens"], 800)
        by_model = {f"{b['provider']}/{b['model']}": b for b in summary["by_model"]}
        self.assertEqual(by_model["ollama/m1"]["calls"], 2)
        self.assertEqual(by_model["openai/gpt-4o"]["calls"], 1)


if __name__ == "__main__":
    unittest.main()
