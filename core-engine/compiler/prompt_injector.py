#!/usr/bin/env python3
"""
prompt_injector.py — Slider-to-Prompt Architectural Translator

Converts the UI slider selections (Cost/Capacity, Speed/Precision,
Modularity) into strict engineering constraint sentences injected into
the LLM prompt payload. Ensures the generated code meets the
deterministic quality bar defined by the user's slider positions.

Stdlib only — no external dependencies.
"""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("PromptInjector")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s",'
        '"component":"PromptInjector","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


# ── Data Structures ──────────────────────────────────────────────────────────


class SliderLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class SliderPayload:
    """Raw slider configuration from the frontend."""

    budget_vs_scale: str = "medium"
    speed_vs_precision: str = "medium"
    simplicity_vs_futureproof: str = "medium"

    def normalize(self) -> "NormalizedSliders":
        """Validate and normalize raw string values to enum levels."""
        def _to_level(raw: str, name: str) -> SliderLevel:
            cleaned = raw.strip().lower()
            try:
                return SliderLevel(cleaned)
            except ValueError:
                logger.warning(
                    "Invalid slider value for %s: '%s', defaulting to medium",
                    name, raw,
                )
                return SliderLevel.MEDIUM

        return NormalizedSliders(
            scale=_to_level(self.budget_vs_scale, "budget_vs_scale"),
            precision=_to_level(self.speed_vs_precision, "speed_vs_precision"),
            modularity=_to_level(
                self.simplicity_vs_futureproof, "simplicity_vs_futureproof"
            ),
        )


@dataclass
class NormalizedSliders:
    """Validated slider levels."""

    scale: SliderLevel = SliderLevel.MEDIUM
    precision: SliderLevel = SliderLevel.MEDIUM
    modularity: SliderLevel = SliderLevel.MEDIUM


@dataclass
class InjectedConstraints:
    """Collection of engineering constraint sentences to inject."""

    scale_constraints: list[str] = field(default_factory=list)
    precision_constraints: list[str] = field(default_factory=list)
    modularity_constraints: list[str] = field(default_factory=list)

    @property
    def all_constraints(self) -> list[str]:
        return (
            self.scale_constraints
            + self.precision_constraints
            + self.modularity_constraints
        )

    def to_prompt_block(self) -> str:
        """Format constraints as a markdown prompt section."""
        if not self.all_constraints:
            return ""

        lines = ["## Architectural Constraints\n"]
        lines.append(
            "The following constraints are MANDATORY. "
            "The generated code MUST satisfy every one of them.\n"
        )
        for i, c in enumerate(self.all_constraints, 1):
            lines.append(f"{i}. {c}")

        return "\n".join(lines)


# ── Constraint Mapping Tables ────────────────────────────────────────────────

# Each slider position maps to a list of precise engineering directives.
# These are intentionally directive and non-negotiable — they constrain
# the LLM's output at the architectural level.

SCALE_CONSTRAINTS: dict[SliderLevel, list[str]] = {
    SliderLevel.LOW: [
        "CRITICAL: Use SQLite as the database engine with in-process file-based "
        "storage. Do NOT use any networked database.",
        "Store all persistent data in a single SQLite database file within the "
        "project directory.",
        "Do NOT implement connection pooling. Use a single synchronous database "
        "connection.",
        "Optimize for minimal memory footprint. Target < 50 MB RSS at idle.",
        "Do NOT add caching layers, message queues, or background workers.",
    ],
    SliderLevel.MEDIUM: [
        "Use PostgreSQL as the primary database with a connection pool "
        "(min 5, max 20 connections).",
        "Implement prepared statements for all database queries to prevent "
        "SQL injection and improve plan caching.",
        "Add an in-memory cache (TTL 60s) for read-heavy endpoints to reduce "
        "database round-trips.",
        "Use database transactions for multi-step write operations. "
        "Roll back on any error.",
        "Configure connection timeouts at 5 seconds and query timeouts at 30 seconds.",
    ],
    SliderLevel.HIGH: [
        "CRITICAL: You must write non-blocking asynchronous code blocks and "
        "utilize connection pools with a minimum of 50 connections.",
        "Implement read replicas for all SELECT queries. Route writes to the "
        "primary instance only.",
        "Add a Redis or Memcached caching layer with TTL-based invalidation for "
        "all GET endpoints.",
        "Implement database sharding or partitioning for tables exceeding "
        "10 million rows.",
        "Add circuit breakers on all external service calls with 5-second "
        "timeout thresholds.",
        "Use background job queues for any operation taking longer than 500ms.",
        "Implement health check endpoints at /health and /ready for load balancer "
        "integration.",
    ],
}

PRECISION_CONSTRAINTS: dict[SliderLevel, list[str]] = {
    SliderLevel.LOW: [
        "Prioritize response speed over strict data consistency. "
        "Eventual consistency is acceptable.",
        "Use optimistic concurrency control. Do NOT acquire database locks "
        "for read operations.",
        "WebSocket push or SSE is preferred for real-time updates. "
        "Polling is acceptable as fallback.",
        "Fire-and-forget writes are acceptable for non-critical data "
        "(analytics, logs, metrics).",
    ],
    SliderLevel.MEDIUM: [
        "Use write-ahead logging (WAL) mode for database operations.",
        "All write operations must be acknowledged before returning a success "
        "response to the client.",
        "Implement retry logic with exponential backoff for transient failures "
        "(max 3 retries, base delay 200ms).",
        "Validate all input data at the API boundary using schema validation. "
        "Reject malformed requests with 400 status.",
        "Log all write operations with a request correlation ID for audit trails.",
    ],
    SliderLevel.HIGH: [
        "CRITICAL: All database operations must use ACID transactions with "
        "SERIALIZABLE isolation level.",
        "Implement distributed locks for any shared resource access across "
        "concurrent requests.",
        "Every write must be idempotent. Use idempotency keys for all "
        "state-changing endpoints.",
        "Implement full input validation with type checking, range validation, "
        "and business rule enforcement at every API boundary.",
        "Add database constraints (CHECK, UNIQUE, FOREIGN KEY) that mirror "
        "application-level validations as a defense-in-depth measure.",
        "Implement optimistic locking with version columns for all mutable entities.",
        "Log every state transition with before/after snapshots for forensic "
        "auditability.",
    ],
}

MODULARITY_CONSTRAINTS: dict[SliderLevel, list[str]] = {
    SliderLevel.LOW: [
        "Use a single-file or minimal-file monolithic architecture. "
        "All logic lives in one deployable unit.",
        "Do NOT create abstract interfaces, dependency injection containers, "
        "or plugin systems.",
        "Direct function calls between modules are preferred over event systems "
        "or message passing.",
        "Keep the import graph flat — maximum 2 levels of local imports.",
    ],
    SliderLevel.MEDIUM: [
        "Organize code into clearly separated modules by domain concern "
        "(routes, services, models, utils).",
        "Each module must have a single public API surface. Internal functions "
        "must be prefixed with underscore or marked private.",
        "Use dependency injection for database and external service clients. "
        "No hard-coded instantiation in business logic.",
        "Shared data structures must be defined in a single 'types' or 'schemas' "
        "module and imported by consumers.",
        "Each module must be independently testable with mock/stub boundaries "
        "at the module edges.",
    ],
    SliderLevel.HIGH: [
        "CRITICAL: Implement a clean hexagonal (ports and adapters) architecture "
        "with strict dependency inversion.",
        "Define explicit interface contracts (abstract base classes or Protocol "
        "types) for every cross-module boundary.",
        "Each service module must be deployable independently. No shared mutable "
        "state between modules.",
        "Use event-driven communication between modules. Direct cross-module "
        "function calls are forbidden.",
        "All configuration must be externalized via environment variables or "
        "config files. No hardcoded values.",
        "Each module must define its own data transfer objects (DTOs). Do NOT "
        "pass ORM/database models across module boundaries.",
        "Implement API versioning from the start. All endpoints must include "
        "a version prefix (e.g., /v1/).",
    ],
}


# ── Core Injection Logic ─────────────────────────────────────────────────────


def map_sliders_to_constraints(sliders: NormalizedSliders) -> InjectedConstraints:
    """Convert normalized slider levels to concrete engineering constraints."""
    constraints = InjectedConstraints(
        scale_constraints=list(SCALE_CONSTRAINTS[sliders.scale]),
        precision_constraints=list(PRECISION_CONSTRAINTS[sliders.precision]),
        modularity_constraints=list(MODULARITY_CONSTRAINTS[sliders.modularity]),
    )

    logger.info(
        "Mapped sliders (scale=%s, precision=%s, modularity=%s) → %d constraints",
        sliders.scale.value,
        sliders.precision.value,
        sliders.modularity.value,
        len(constraints.all_constraints),
    )

    return constraints


def inject_constraints(raw_payload: dict) -> InjectedConstraints:
    """Accept raw frontend payload dict and return injected constraints.

    This is the primary entry point called by the orchestrator.
    """
    payload = SliderPayload(
        budget_vs_scale=raw_payload.get("budget_vs_scale", "medium"),
        speed_vs_precision=raw_payload.get("speed_vs_precision", "medium"),
        simplicity_vs_futureproof=raw_payload.get(
            "simplicity_vs_futureproof", "medium"
        ),
    )

    normalized = payload.normalize()
    return map_sliders_to_constraints(normalized)


# ── Prompt Assembly ──────────────────────────────────────────────────────────


def format_unified_prompt(
    user_request: str,
    slider_payload: dict,
    context_card: Optional[str] = None,
    language: str = "python",
    file_contexts: Optional[dict[str, str]] = None,
) -> str:
    """Build the complete LLM prompt combining all components.

    Parameters
    ----------
    user_request : str
        The business-level task description from the user.
    slider_payload : dict
        Raw slider config from the frontend.
    context_card : str | None
        Compressed context card from a previous gate failure.
    language : str
        Target programming language.
    file_contexts : dict[str, str] | None
        Existing file contents keyed by relative path.

    Returns
    -------
    str
        The complete, unified prompt string ready for the LLM.
    """
    sections: list[str] = []

    # 1. Task description
    sections.append(f"## Task\n{user_request}")

    # 2. Target language
    sections.append(f"## Target Language\n{language}")

    # 3. Architectural constraints from sliders
    constraints = inject_constraints(slider_payload)
    constraint_block = constraints.to_prompt_block()
    if constraint_block:
        sections.append(constraint_block)

    # 4. Performance thresholds (derived from slider scale)
    thresholds = _derive_threshold_sentences(slider_payload)
    if thresholds:
        sections.append(
            "## Performance Targets\n" + "\n".join(f"- {t}" for t in thresholds)
        )

    # 5. Context card from previous gate failure
    if context_card:
        sections.append(
            f"## Previous Gate Failure\n"
            f"Your last attempt failed verification. Fix these issues:\n"
            f"```json\n{context_card[:2000]}\n```"
        )

    # 6. Existing file contents
    if file_contexts:
        ctx_parts: list[str] = []
        for fpath, content in file_contexts.items():
            truncated = content[:3000]
            ctx_parts.append(f"### {fpath}\n```\n{truncated}\n```")
        sections.append("## Current File Context\n" + "\n".join(ctx_parts))

    # 7. Output format directive
    sections.append(
        "## Output Format\n"
        "Emit ONLY unified diff patches. One patch per file.\n"
        "Use --- a/path and +++ b/path headers.\n"
        "Do not include explanations, introductions, or markdown fences."
    )

    prompt = "\n\n".join(sections)

    logger.info(
        "Assembled unified prompt: %d chars, %d constraints, %s context card",
        len(prompt),
        len(constraints.all_constraints),
        "with" if context_card else "no",
    )

    return prompt


def _derive_threshold_sentences(slider_payload: dict) -> list[str]:
    """Derive concrete performance threshold sentences from slider values."""
    normalized = SliderPayload(
        budget_vs_scale=slider_payload.get("budget_vs_scale", "medium"),
        speed_vs_precision=slider_payload.get("speed_vs_precision", "medium"),
    ).normalize()
    scale = normalized.scale.value
    speed = normalized.precision.value
    thresholds: list[str] = []

    scale_targets = {
        "low": ("50", "5%"),
        "medium": ("200", "1%"),
        "high": ("1,000", "0.5%"),
    }
    rps, err_rate = scale_targets.get(scale, ("200", "1%"))
    thresholds.append(f"Minimum throughput: {rps} requests/second")
    thresholds.append(f"Maximum error rate: {err_rate}")

    speed_targets = {
        "low": ("1,000", "5,000"),
        "medium": ("500", "2,000"),
        "high": ("100", "500"),
    }
    avg_lat, p99_lat = speed_targets.get(speed, ("500", "2,000"))
    thresholds.append(f"Maximum average latency: {avg_lat}ms")
    thresholds.append(f"Maximum p99 latency: {p99_lat}ms")

    return thresholds


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> int:
    """CLI entry point for testing prompt injection."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate an LLM prompt from slider config"
    )
    parser.add_argument(
        "request", help="User's business-level request text"
    )
    parser.add_argument(
        "--scale", choices=["low", "medium", "high"], default="medium"
    )
    parser.add_argument(
        "--speed", choices=["low", "medium", "high"], default="medium"
    )
    parser.add_argument(
        "--modularity", choices=["low", "medium", "high"], default="medium"
    )
    parser.add_argument(
        "--language", default="python"
    )
    parser.add_argument(
        "--context-card", default=None,
        help="JSON context card from a previous gate failure"
    )
    parser.add_argument(
        "--json", action="store_true", dest="json_output",
        help="Output constraints as JSON instead of the full prompt"
    )

    args = parser.parse_args()

    payload = {
        "budget_vs_scale": args.scale,
        "speed_vs_precision": args.speed,
        "simplicity_vs_futureproof": args.modularity,
    }

    if args.json_output:
        constraints = inject_constraints(payload)
        output = {
            "sliders": payload,
            "constraint_count": len(constraints.all_constraints),
            "scale_constraints": constraints.scale_constraints,
            "precision_constraints": constraints.precision_constraints,
            "modularity_constraints": constraints.modularity_constraints,
        }
        print(json.dumps(output, indent=2))
    else:
        prompt = format_unified_prompt(
            user_request=args.request,
            slider_payload=payload,
            context_card=args.context_card,
            language=args.language,
        )
        print(prompt)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
