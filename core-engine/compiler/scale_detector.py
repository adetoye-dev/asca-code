#!/usr/bin/env python3
"""
scale_detector.py — Autonomous Project Scale & Architecture Standards Engine

Replaces manual trade-off sliders. Automatically inspects the project's
codebase (LOC, file count, detected framework, existing patterns) to derive
deterministic performance bounds and industry-standard engineering guidelines.

Principles:
1. Implement to industry standard for the framework and stack.
2. Scale appropriately to the project:
   - Micro (< 1,000 LOC): direct, clean, zero bloat, idiomatic.
   - Standard (1,000 - 25,000 LOC): modular, typed, unit-tested, defensive error handling.
   - Enterprise (> 25,000 LOC): strict interfaces, decoupled layers, observability.
3. No under-optimizing (no sloppy code) and no over-optimizing (no premature microservices).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger("ScaleDetector")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s","component":"ScaleDetector","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


class ScaleTier(str, Enum):
    MICRO = "micro"
    STANDARD = "standard"
    ENTERPRISE = "enterprise"


@dataclass
class ProjectScaleProfile:
    tier: ScaleTier
    total_loc: int
    file_count: int
    primary_language: str
    frameworks: list[str]
    min_requests_per_second: float
    max_avg_latency_ms: float
    max_p99_latency_ms: float
    max_error_rate: float
    max_peak_cpu_percent: float
    max_peak_memory_mb: float
    standards_summary: str


def detect_project_scale(project_root_str: str) -> ProjectScaleProfile:
    """Analyze project root to determine scale tier and performance bounds."""
    project_root = Path(project_root_str).resolve()

    # Try reading .acsa/index.json if it exists
    index_file = project_root / ".acsa" / "index.json"
    if index_file.exists():
        try:
            data = json.loads(index_file.read_text(encoding="utf-8"))
            prof = data.get("profile", {})
            tier_str = prof.get("scale_tier", "standard")
            tier = ScaleTier(tier_str) if tier_str in ("micro", "standard", "enterprise") else ScaleTier.STANDARD
            total_loc = prof.get("total_loc", 2500)
            file_count = prof.get("indexed_files", 15)
            primary_lang = prof.get("primary_language", "python")
            frameworks = prof.get("frameworks", [])
            return _build_profile(tier, total_loc, file_count, primary_lang, frameworks)
        except Exception:
            pass

    # Quick heuristic scan if index.json is not present
    loc = 0
    files = 0
    lang_counts: dict[str, int] = {}
    for root, dirs, filenames in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".acsa", "dist", "build")]
        for f in filenames:
            ext = os.path.splitext(f)[1].lower()
            if ext in (".py", ".ts", ".tsx", ".js", ".jsx"):
                files += 1
                lang = "python" if ext == ".py" else "typescript"
                lang_counts[lang] = lang_counts.get(lang, 0) + 1
                try:
                    fp = Path(root) / f
                    loc += len(fp.read_text(encoding="utf-8", errors="ignore").splitlines())
                except Exception:
                    pass

    tier = ScaleTier.MICRO if loc < 1000 and files < 10 else (ScaleTier.ENTERPRISE if loc > 25000 else ScaleTier.STANDARD)
    primary_lang = max(lang_counts, key=lang_counts.get) if lang_counts else "python"
    frameworks = []
    if (project_root / "package.json").exists():
        frameworks.append("Node/TypeScript")
    if (project_root / "requirements.txt").exists() or (project_root / "pyproject.toml").exists():
        frameworks.append("Python")

    return _build_profile(tier, loc, files, primary_lang, frameworks)


def _build_profile(
    tier: ScaleTier,
    total_loc: int,
    file_count: int,
    primary_language: str,
    frameworks: list[str],
) -> ProjectScaleProfile:
    """Map tier to concrete performance bounds and standards."""
    if tier == ScaleTier.MICRO:
        rps = 100.0
        avg_lat = 300.0
        p99_lat = 1000.0
        err_rate = 0.01
        cpu = 80.0
        mem = 256.0
        standards = "Direct, clean, idiomatic architecture with minimal abstractions."
    elif tier == ScaleTier.ENTERPRISE:
        rps = 1000.0
        avg_lat = 100.0
        p99_lat = 500.0
        err_rate = 0.005
        cpu = 90.0
        mem = 1024.0
        standards = "Strict decoupled interfaces, typed contracts, defensive resilience, full observability."
    else:  # STANDARD
        rps = 350.0
        avg_lat = 200.0
        p99_lat = 800.0
        err_rate = 0.01
        cpu = 85.0
        mem = 512.0
        standards = "Industry-standard modularity, clean error handling, type safety, and maintainable structure."

    logger.info(
        "Auto-detected project scale tier: %s (%d LOC across %d files). Target RPS: %.0f, max avg latency: %.0fms",
        tier.value.upper(), total_loc, file_count, rps, avg_lat
    )

    return ProjectScaleProfile(
        tier=tier,
        total_loc=total_loc,
        file_count=file_count,
        primary_language=primary_language,
        frameworks=frameworks,
        min_requests_per_second=rps,
        max_avg_latency_ms=avg_lat,
        max_p99_latency_ms=p99_lat,
        max_error_rate=err_rate,
        max_peak_cpu_percent=cpu,
        max_peak_memory_mb=mem,
        standards_summary=standards,
    )
