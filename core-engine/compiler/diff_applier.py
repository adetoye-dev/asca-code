#!/usr/bin/env python3
"""
diff_applier.py — Atomic Unified Diff Patch Applier

Parses unified diff blocks emitted by the LLM, validates that the
context lines match the actual file content on disk, and applies
patches atomically (write to temp file → rename) to prevent corruption.

Rejects diffs whose context lines don't match the target file,
guaranteeing the AI cannot silently corrupt source files.

Stdlib only — no external dependencies.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────

logger = logging.getLogger("DiffApplier")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(
    logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s",'
        '"component":"DiffApplier","message":"%(message)s"}'
    )
)
logger.addHandler(_handler)
logger.setLevel(logging.INFO)


# ── Data Structures ──────────────────────────────────────────────────────────


class PatchStatus(str, Enum):
    APPLIED = "applied"
    REJECTED = "rejected"
    CREATED = "created"
    ERROR = "error"


@dataclass
class HunkHeader:
    """Parsed @@ hunk header."""

    old_start: int  # 1-indexed
    old_count: int
    new_start: int  # 1-indexed
    new_count: int
    context_label: str = ""

    @staticmethod
    def parse(line: str) -> Optional["HunkHeader"]:
        """Parse a unified diff hunk header line."""
        match = re.match(
            r"@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)",
            line,
        )
        if not match:
            return None

        return HunkHeader(
            old_start=int(match.group(1)),
            old_count=int(match.group(2)) if match.group(2) else 1,
            new_start=int(match.group(3)),
            new_count=int(match.group(4)) if match.group(4) else 1,
            context_label=match.group(5).strip(),
        )


@dataclass
class DiffHunk:
    """A single hunk within a diff block."""

    header: HunkHeader
    lines: list[str] = field(default_factory=list)

    @property
    def context_lines(self) -> list[tuple[int, str]]:
        """Return (1-indexed line number, content) for context and removal lines."""
        pairs: list[tuple[int, str]] = []
        line_no = self.header.old_start
        for line in self.lines:
            if line.startswith(" "):
                pairs.append((line_no, line[1:]))
                line_no += 1
            elif line.startswith("-"):
                pairs.append((line_no, line[1:]))
                line_no += 1
            # '+' lines don't consume old-file line numbers
        return pairs

    @property
    def added_lines(self) -> list[str]:
        """Return content of added lines (without the '+' prefix)."""
        return [line[1:] for line in self.lines if line.startswith("+")]

    @property
    def removed_lines(self) -> list[str]:
        """Return content of removed lines (without the '-' prefix)."""
        return [line[1:] for line in self.lines if line.startswith("-")]


@dataclass
class FilePatch:
    """Complete patch for a single file, potentially containing multiple hunks."""

    old_path: str
    new_path: str
    hunks: list[DiffHunk] = field(default_factory=list)
    is_new_file: bool = False
    is_deleted: bool = False
    raw_text: str = ""


class DiffValidationError(Exception):
    """Raised when a diff's context lines don't match the actual file."""

    def __init__(self, file_path: str, details: list[str]):
        self.file_path = file_path
        self.details = details
        super().__init__(
            f"Diff rejected for {file_path}: {len(details)} context mismatch(es)"
        )


@dataclass
class ApplyResult:
    """Result of applying a single file patch."""

    file_path: str
    status: PatchStatus = PatchStatus.ERROR
    hunks_applied: int = 0
    hunks_total: int = 0
    backup_path: str = ""
    error_message: str = ""

    def to_dict(self) -> dict:
        d = {
            "file_path": self.file_path,
            "status": self.status.value,
            "hunks_applied": self.hunks_applied,
            "hunks_total": self.hunks_total,
        }
        if self.backup_path:
            d["backup_path"] = self.backup_path
        if self.error_message:
            d["error"] = self.error_message
        return d


@dataclass
class BatchResult:
    """Result of applying a batch of file patches."""

    total_files: int = 0
    applied: int = 0
    rejected: int = 0
    created: int = 0
    errors: int = 0
    results: list[ApplyResult] = field(default_factory=list)

    @property
    def all_succeeded(self) -> bool:
        return self.rejected == 0 and self.errors == 0

    def to_dict(self) -> dict:
        return {
            "total_files": self.total_files,
            "applied": self.applied,
            "rejected": self.rejected,
            "created": self.created,
            "errors": self.errors,
            "all_succeeded": self.all_succeeded,
            "results": [r.to_dict() for r in self.results],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


# ── Diff Parser ──────────────────────────────────────────────────────────────


def parse_diff_text(raw_text: str, project_root: str = "") -> list[FilePatch]:
    """Parse raw unified diff text into structured FilePatch objects.

    Handles both standard unified diffs and the simplified format the
    LLM might emit. Strips markdown fences if present.
    """
    # Strip markdown code fences that the LLM might wrap diffs in
    cleaned = _strip_markdown_fences(raw_text)

    patches: list[FilePatch] = []

    # Split into per-file diff blocks at --- headers
    blocks = re.split(r"(?=^---\s)", cleaned, flags=re.MULTILINE)

    for block in blocks:
        block = block.strip()
        if not block.startswith("---"):
            continue

        lines = block.splitlines()
        if len(lines) < 3:
            logger.warning("Skipping malformed diff block (< 3 lines)")
            continue

        # Parse file headers
        old_line = lines[0]
        new_line = lines[1]

        old_match = re.match(r"^---\s+(?:a/)?(.+?)(?:\s|$)", old_line)
        new_match = re.match(r"^\+\+\+\s+(?:b/)?(.+?)(?:\s|$)", new_line)

        if not new_match:
            logger.warning("Skipping block: missing +++ header")
            continue

        old_path = old_match.group(1).strip() if old_match else "/dev/null"
        new_path = new_match.group(1).strip()

        # Resolve paths
        if project_root:
            if old_path != "/dev/null":
                old_path = str(Path(project_root) / old_path)
            new_path = str(Path(project_root) / new_path)

        is_new = old_path == "/dev/null" or old_path.endswith("/dev/null")
        is_deleted = new_path == "/dev/null" or new_path.endswith("/dev/null")

        # Parse hunks from remaining lines
        hunks = _parse_hunks(lines[2:])

        patches.append(
            FilePatch(
                old_path=old_path,
                new_path=new_path,
                hunks=hunks,
                is_new_file=is_new,
                is_deleted=is_deleted,
                raw_text=block,
            )
        )

    logger.info("Parsed %d file patch(es) from diff text", len(patches))
    return patches


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences wrapping diff blocks."""
    # Remove ```diff ... ``` or ``` ... ```
    cleaned = re.sub(r"^```(?:diff|patch)?\s*\n", "", text, flags=re.MULTILINE)
    cleaned = re.sub(r"\n```\s*$", "", cleaned, flags=re.MULTILINE)
    # Also handle inline fences
    cleaned = re.sub(r"^```\s*$", "", cleaned, flags=re.MULTILINE)
    return cleaned


def _parse_hunks(lines: list[str]) -> list[DiffHunk]:
    """Parse hunk headers and their body lines."""
    hunks: list[DiffHunk] = []
    current_header: Optional[HunkHeader] = None
    current_lines: list[str] = []

    for line in lines:
        if line.startswith("@@"):
            if current_header is not None:
                hunks.append(DiffHunk(header=current_header, lines=current_lines))
            current_header = HunkHeader.parse(line)
            current_lines = []
        elif current_header is not None:
            if line.startswith(("+", "-", " ")):
                current_lines.append(line)
            elif line.strip() == "":
                # Treat blank lines in diff body as context lines
                current_lines.append(" ")

    if current_header is not None:
        hunks.append(DiffHunk(header=current_header, lines=current_lines))

    return hunks


# ── Context Validation ───────────────────────────────────────────────────────


def validate_patch(
    patch: FilePatch, strict: bool = True
) -> list[str]:
    """Validate that a patch's context lines match the actual file on disk.

    Returns a list of mismatch descriptions. Empty list means valid.
    Raises DiffValidationError if strict=True and mismatches are found.
    """
    mismatches: list[str] = []

    if patch.is_new_file:
        if Path(patch.new_path).exists():
            mismatches.append(
                f"File already exists: {patch.new_path} "
                f"(patch claims new file)"
            )
        return mismatches

    target_path = Path(patch.old_path if patch.old_path != "/dev/null" else patch.new_path)

    if not target_path.exists():
        mismatches.append(f"Target file not found: {target_path}")
        if strict:
            raise DiffValidationError(str(target_path), mismatches)
        return mismatches

    try:
        file_content = target_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        mismatches.append(f"Cannot read file: {exc}")
        if strict:
            raise DiffValidationError(str(target_path), mismatches)
        return mismatches

    file_lines = file_content.splitlines()

    for hunk in patch.hunks:
        for line_no, expected_content in hunk.context_lines:
            idx = line_no - 1  # Convert to 0-indexed

            if idx < 0 or idx >= len(file_lines):
                mismatches.append(
                    f"Line {line_no}: out of range "
                    f"(file has {len(file_lines)} lines)"
                )
                continue

            actual = file_lines[idx]
            expected_stripped = expected_content.rstrip("\n\r")
            actual_stripped = actual.rstrip("\n\r")

            if expected_stripped != actual_stripped:
                mismatches.append(
                    f"Line {line_no}: context mismatch\n"
                    f"  expected: {repr(expected_stripped[:120])}\n"
                    f"  actual:   {repr(actual_stripped[:120])}"
                )

    if mismatches:
        logger.error(
            "Patch validation failed for %s: %d mismatch(es)",
            patch.new_path, len(mismatches),
        )
        for m in mismatches[:5]:
            logger.error("  %s", m.split("\n")[0])

        if strict:
            raise DiffValidationError(
                patch.old_path if patch.old_path != "/dev/null" else patch.new_path,
                mismatches,
            )
    else:
        logger.info("Patch validation passed for %s", patch.new_path)

    return mismatches


# ── Patch Application ────────────────────────────────────────────────────────


def apply_patch(
    patch: FilePatch,
    backup: bool = True,
    dry_run: bool = False,
    strict_validation: bool = True,
) -> ApplyResult:
    """Apply a single file patch atomically.

    1. Validates context lines against the actual file.
    2. Applies hunks in reverse order to preserve line offsets.
    3. Writes to a temp file first, then renames (atomic on POSIX).
    4. Creates a .bak backup of the original.
    """
    result = ApplyResult(
        file_path=patch.new_path,
        hunks_total=len(patch.hunks),
    )

    # ── Handle new file creation ──
    if patch.is_new_file:
        new_content = _collect_added_content(patch)

        if dry_run:
            logger.info("[DRY RUN] Would create: %s (%d bytes)", patch.new_path, len(new_content))
            result.status = PatchStatus.CREATED
            result.hunks_applied = len(patch.hunks)
            return result

        try:
            target = Path(patch.new_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write(target, new_content)
            result.status = PatchStatus.CREATED
            result.hunks_applied = len(patch.hunks)
            logger.info("Created new file: %s (%d bytes)", patch.new_path, len(new_content))
        except OSError as exc:
            result.status = PatchStatus.ERROR
            result.error_message = str(exc)
            logger.error("Failed to create %s: %s", patch.new_path, exc)

        return result

    # ── Handle file deletion ──
    if patch.is_deleted:
        if dry_run:
            logger.info("[DRY RUN] Would delete: %s", patch.old_path)
            result.status = PatchStatus.APPLIED
            return result

        target = Path(patch.old_path)
        if backup and target.exists():
            bak_path = str(target) + ".bak"
            shutil.copy2(str(target), bak_path)
            result.backup_path = bak_path

        try:
            target.unlink(missing_ok=True)
            result.status = PatchStatus.APPLIED
            logger.info("Deleted file: %s", patch.old_path)
        except OSError as exc:
            result.status = PatchStatus.ERROR
            result.error_message = str(exc)

        return result

    # ── Validate context lines ──
    try:
        mismatches = validate_patch(patch, strict=strict_validation)
    except DiffValidationError as exc:
        result.status = PatchStatus.REJECTED
        result.error_message = "; ".join(exc.details[:3])
        return result

    if mismatches and strict_validation:
        result.status = PatchStatus.REJECTED
        result.error_message = "; ".join(mismatches[:3])
        return result

    # ── Read original file ──
    target = Path(patch.new_path)
    try:
        original = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        result.status = PatchStatus.ERROR
        result.error_message = f"Cannot read target file: {exc}"
        return result

    # ── Apply hunks in reverse order ──
    orig_lines = original.splitlines(keepends=True)
    patched_lines = list(orig_lines)

    applied_count = 0
    for hunk in reversed(patch.hunks):
        try:
            patched_lines = _apply_single_hunk(patched_lines, hunk)
            applied_count += 1
        except ValueError as exc:
            result.status = PatchStatus.ERROR
            result.error_message = f"Hunk application failed: {exc}"
            logger.error(
                "Hunk at line %d failed for %s: %s",
                hunk.header.old_start, patch.new_path, exc,
            )
            return result

    patched_content = "".join(patched_lines)

    if dry_run:
        logger.info(
            "[DRY RUN] Would patch: %s (%d hunks, %d→%d bytes)",
            patch.new_path, applied_count,
            len(original), len(patched_content),
        )
        result.status = PatchStatus.APPLIED
        result.hunks_applied = applied_count
        return result

    # ── Backup original ──
    if backup:
        bak_path = str(target) + ".bak"
        try:
            shutil.copy2(str(target), bak_path)
            result.backup_path = bak_path
        except OSError as exc:
            logger.warning("Failed to create backup for %s: %s", target, exc)

    # ── Atomic write ──
    try:
        _atomic_write(target, patched_content)
        result.status = PatchStatus.APPLIED
        result.hunks_applied = applied_count
        logger.info(
            "Applied patch: %s (%d/%d hunks, %d→%d bytes)",
            patch.new_path, applied_count, len(patch.hunks),
            len(original), len(patched_content),
        )
    except OSError as exc:
        result.status = PatchStatus.ERROR
        result.error_message = f"Atomic write failed: {exc}"
        logger.error("Failed to write %s: %s", patch.new_path, exc)

    return result


def _apply_single_hunk(
    lines: list[str], hunk: DiffHunk
) -> list[str]:
    """Apply a single hunk to a list of lines (with keepends=True)."""
    old_start = hunk.header.old_start - 1  # 0-indexed

    replacement: list[str] = []
    consumed = 0

    for hline in hunk.lines:
        if hline.startswith("-"):
            consumed += 1
        elif hline.startswith("+"):
            content = hline[1:]
            if not content.endswith("\n"):
                content += "\n"
            replacement.append(content)
        elif hline.startswith(" "):
            consumed += 1
            content = hline[1:]
            if not content.endswith("\n"):
                content += "\n"
            replacement.append(content)

    end_idx = min(
        old_start + max(consumed, hunk.header.old_count), len(lines)
    )
    result = list(lines)
    result[old_start:end_idx] = replacement
    return result


def _collect_added_content(patch: FilePatch) -> str:
    """Collect all added lines from a new-file patch."""
    content_lines: list[str] = []
    for hunk in patch.hunks:
        for line in hunk.lines:
            if line.startswith("+") and not line.startswith("+++"):
                content_lines.append(line[1:])
            elif line.startswith(" "):
                content_lines.append(line[1:])
    return "\n".join(content_lines) + "\n" if content_lines else ""


def _atomic_write(target: Path, content: str) -> None:
    """Write content to a file atomically via temp file + rename."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(target.parent),
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, str(target))
    except BaseException:
        # Clean up temp file on any error
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ── Batch Application ────────────────────────────────────────────────────────


def apply_diff_text(
    raw_diff: str,
    project_root: str = "",
    backup: bool = True,
    dry_run: bool = False,
    strict: bool = True,
) -> BatchResult:
    """Parse and apply a complete unified diff text to disk.

    This is the primary public API. It:
    1. Parses the raw diff text into FilePatch objects.
    2. Validates every patch's context lines against the actual files.
    3. Applies patches atomically with backup.
    4. Returns a BatchResult summarizing what happened.
    """
    patches = parse_diff_text(raw_diff, project_root)

    batch = BatchResult(total_files=len(patches))

    for patch in patches:
        result = apply_patch(
            patch,
            backup=backup,
            dry_run=dry_run,
            strict_validation=strict,
        )
        batch.results.append(result)

        if result.status == PatchStatus.APPLIED:
            batch.applied += 1
        elif result.status == PatchStatus.CREATED:
            batch.created += 1
        elif result.status == PatchStatus.REJECTED:
            batch.rejected += 1
        elif result.status == PatchStatus.ERROR:
            batch.errors += 1

    status_str = "ALL SUCCEEDED" if batch.all_succeeded else "SOME FAILED"
    logger.info(
        "Batch apply %s — %d applied, %d created, %d rejected, %d errors",
        status_str, batch.applied, batch.created, batch.rejected, batch.errors,
    )

    return batch


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> int:
    """CLI: python diff_applier.py <diff_file> [--project-root DIR] [--dry-run]"""
    import argparse

    parser = argparse.ArgumentParser(description="Apply unified diff patches")
    parser.add_argument("diff_file", help="Path to file containing unified diffs")
    parser.add_argument(
        "--project-root", default="",
        help="Project root for resolving relative paths",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate and report without writing files",
    )
    parser.add_argument(
        "--no-backup", action="store_true",
        help="Don't create .bak backups",
    )
    parser.add_argument(
        "--no-strict", action="store_true",
        help="Apply even if context lines don't match (dangerous)",
    )

    args = parser.parse_args()

    try:
        diff_text = Path(args.diff_file).read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("Cannot read diff file: %s", exc)
        return 1

    result = apply_diff_text(
        raw_diff=diff_text,
        project_root=args.project_root,
        backup=not args.no_backup,
        dry_run=args.dry_run,
        strict=not args.no_strict,
    )

    print(result.to_json())
    return 0 if result.all_succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
