"""agent_tools.py — Unified Primitive Tool Suite for Autonomous Coding Agents

Implements the standard industry tool suite (Claude Code / Aider / Cline):
1. grep_search: High-speed ripgrep (rg) or Python regex search across files.
2. list_dir: Directory inspection respecting ignore lists.
3. read_file: Windowed line reading with 1-based line numbers.
4. find_files: Fast glob / filename pattern discovery.
5. edit_file: Multi-tier SEARCH/REPLACE block application (exact, whitespace-tolerant).
6. run_command: Safe terminal command execution with timeout and output capture.
7. search_symbols: AST symbol search via project_indexer.
8. get_file_outline: File symbol outline via project_indexer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("agent_tools")

_DATA_MAP_DIR = Path(__file__).resolve().parent / "data-map"
if str(_DATA_MAP_DIR) not in sys.path:
    sys.path.insert(0, str(_DATA_MAP_DIR))

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".cache",
    ".acsa",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".venv",
    "venv",
    ".tauri",
    "target",
    "tmp",
}

IGNORED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".lock",
    ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".webm", ".zip",
    ".tar", ".gz", ".wasm", ".pyc", ".bin", ".bak", ".map", ".tmp", ".orig",
}


def _resolve_safe_path(project_root: str, path_str: str) -> Path:
    """Resolve and validate that a path stays inside the project root."""
    root = Path(project_root).resolve()
    cleaned = str(path_str).strip("`'\" \t\n")
    target = (root / cleaned).resolve() if not Path(cleaned).is_absolute() else Path(cleaned).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ValueError(f"Path '{path_str}' is outside project root '{project_root}'")
    return target


def grep_search(
    project_root: str,
    query: str = "",
    path: str = "",
    is_regex: bool = False,
    case_sensitive: bool = False,
    max_results: int = 40,
    **kwargs: Any,
) -> str:
    """Search for matching strings or regex patterns across the codebase."""
    root = Path(project_root).resolve()

    # Handle parameter aliases from various LLMs
    if not query:
        query = str(
            kwargs.get("pattern")
            or kwargs.get("search")
            or kwargs.get("text")
            or kwargs.get("keyword")
            or kwargs.get("term")
            or kwargs.get("find")
            or kwargs.get("q")
            or ""
        )
    if not path:
        path = str(
            kwargs.get("filepath")
            or kwargs.get("file")
            or kwargs.get("dir")
            or kwargs.get("directory")
            or kwargs.get("target")
            or ""
        )
    if not is_regex:
        is_regex = bool(kwargs.get("regex") or kwargs.get("isRegex") or kwargs.get("use_regex") or False)
    if not case_sensitive:
        case_sensitive = bool(kwargs.get("caseSensitive") or kwargs.get("is_case_sensitive") or kwargs.get("case") or False)
    if "max_results" not in kwargs and "limit" in kwargs:
        try:
            max_results = int(kwargs["limit"])
        except Exception:
            pass

    query = query.strip()
    path = path.strip("`'\" \t\n")

    if not query:
        return "Error: query cannot be empty."

    search_dir = _resolve_safe_path(project_root, path) if path else root

    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(query if is_regex else re.escape(query), flags)
    except re.error as err:
        return f"Invalid regex pattern: {err}"

    words = [w for w in re.split(r"[\s_-]+", query) if w and len(w) > 1]
    sub_pats = [re.compile(re.escape(w), flags) for w in words] if len(words) > 1 else []

    # 1. Single-file direct search
    if search_dir.is_file():
        try:
            rel = search_dir.relative_to(root).as_posix()
            content = search_dir.read_text(encoding="utf-8", errors="ignore")
            matches: list[str] = []
            for line_idx, line in enumerate(content.splitlines(), start=1):
                if pattern.search(line):
                    matches.append(f"{rel}:{line_idx}: {line.strip()[:140]}")
                    if len(matches) >= max_results:
                        break
            if matches:
                return f"Found {len(matches)} matches in '{rel}':\n" + "\n".join(matches)

            # Multi-token proximity fallback within the target file
            if sub_pats:
                for line_idx, line in enumerate(content.splitlines(), start=1):
                    if all(p.search(line) for p in sub_pats):
                        matches.append(f"{rel}:{line_idx}: {line.strip()[:140]}")
                        if len(matches) >= max_results:
                            break
            if matches:
                return f"Found {len(matches)} token-match lines in '{rel}':\n" + "\n".join(matches)

            return f"No matches found for query: '{query}' in {rel}"
        except Exception as exc:
            return f"Error searching file '{search_dir.name}': {exc}"

    # 2. Directory search with universal source-first prioritization
    def _rank_file(p: Path) -> tuple[int, int, str]:
        rel_str = p.relative_to(root).as_posix()
        ext = p.suffix.lower()
        tier = 2
        if ext in (".tsx", ".jsx", ".ts", ".js", ".py", ".go", ".rs", ".vue", ".svelte"):
            tier = 0
        elif ext in (".html", ".css", ".scss"):
            tier = 1
        elif ext in (".md", ".txt", ".rst"):
            tier = 3
        p_name = p.name.lower()
        if "test" in p_name or "spec" in p_name or "__tests__" in rel_str:
            tier += 1
        depth = len(p.relative_to(root).parts)
        return (tier, depth, rel_str)

    candidate_files: list[Path] = []
    for current_root, dirs, files in os.walk(search_dir):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        for fname in sorted(files):
            ext = Path(fname).suffix.lower()
            if ext in IGNORED_EXTENSIONS:
                continue
            fpath = Path(current_root) / fname
            try:
                if fpath.stat().st_size <= 1_000_000:
                    candidate_files.append(fpath)
            except Exception:
                pass

    candidate_files.sort(key=_rank_file)

    matches = []
    file_hit_counts: dict[str, int] = {}

    for fpath in candidate_files:
        rel = fpath.relative_to(root).as_posix()
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        is_ui = rel.startswith("src/")
        max_per_file = 15 if is_ui else 2

        for line_idx, line in enumerate(content.splitlines(), start=1):
            matched = pattern.search(line)
            if not matched and sub_pats and is_ui and all(p.search(line) for p in sub_pats):
                matched = True

            if matched:
                file_hit_counts[rel] = file_hit_counts.get(rel, 0) + 1
                if file_hit_counts[rel] <= max_per_file:
                    matches.append(f"{rel}:{line_idx}: {line.strip()[:140]}")
                if len(matches) >= max_results:
                    break
        if len(matches) >= max_results:
            break

    if matches:
        return f"Found {len(matches)} matches (prioritizing active workspace code):\n" + "\n".join(matches)

    return f"No matches found for query: '{query}'"


def list_dir(project_root: str, path: str = "", max_depth: int = 2) -> str:
    """List files and directories within a target directory."""
    root = Path(project_root).resolve()
    target = _resolve_safe_path(project_root, path) if path else root

    if not target.exists():
        return f"Error: directory does not exist: {path}"
    if not target.is_dir():
        return f"Error: path is a file, not a directory: {path}"

    entries: list[str] = []

    def _walk(curr: Path, depth: int):
        if depth > max_depth:
            return
        try:
            items = sorted(curr.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except Exception as exc:
            entries.append(f"{'  ' * depth}[Error reading {curr.name}: {exc}]")
            return

        for item in items:
            if item.name in IGNORED_DIRS:
                continue
            if item.is_dir():
                entries.append(f"{'  ' * depth}📁 {item.name}/")
                _walk(item, depth + 1)
            else:
                if item.suffix.lower() in IGNORED_EXTENSIONS:
                    continue
                size_str = f" ({item.stat().st_size} bytes)" if item.exists() else ""
                entries.append(f"{'  ' * depth}📄 {item.name}{size_str}")

    _walk(target, 0)
    rel_name = target.relative_to(root).as_posix() if target != root else "."
    return f"Directory listing for '{rel_name}':\n" + ("\n".join(entries[:120]) or "(empty directory)")


def read_file(
    project_root: str,
    path: str = "",
    start_line: int = 1,
    end_line: int = 120,
    **kwargs: Any,
) -> str:
    """Read a specific line range from a file with 1-based line numbers."""
    root = Path(project_root).resolve()
    if not path:
        path = str(kwargs.get("file") or kwargs.get("filepath") or kwargs.get("target") or kwargs.get("filename") or "")
    path = path.strip("`'\" \t\n")

    if not path:
        return "Error: path cannot be empty."

    target = _resolve_safe_path(project_root, path)
    if not target.exists():
        parent_dir = target.parent
        if parent_dir.exists() and parent_dir.is_dir():
            existing = [f.name for f in sorted(parent_dir.iterdir()) if not f.name.startswith(".") and f.suffix.lower() not in IGNORED_EXTENSIONS][:10]
            return f"Error: File '{path}' does not exist. Existing files in '{parent_dir.relative_to(root).as_posix()}': {existing}"
        return f"Error: File does not exist: {path}"
    if target.is_dir():
        return f"Error: Target path is a directory: {path}"

    for s_alias in ("start", "from_line", "line_start", "startLine"):
        if s_alias in kwargs and kwargs[s_alias] is not None:
            try:
                start_line = int(kwargs[s_alias])
                break
            except Exception:
                pass

    for e_alias in ("end", "to_line", "line_end", "endLine"):
        if e_alias in kwargs and kwargs[e_alias] is not None:
            try:
                end_line = int(kwargs[e_alias])
                break
            except Exception:
                pass

    try:
        content = target.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:
        return f"Error reading file {path}: {exc}"

    lines = content.splitlines()
    total_lines = len(lines)

    # If query or search term was provided, center around that match
    search_hint = str(kwargs.get("query") or kwargs.get("search") or kwargs.get("find") or "").strip()
    if search_hint and ("start" not in kwargs and "start_line" not in kwargs):
        s_lower = search_hint.lower()
        for idx, l in enumerate(lines, start=1):
            if s_lower in l.lower():
                start_line = max(1, idx - 30)
                end_line = min(total_lines, idx + 50)
                break

    start = max(1, start_line)
    end = min(total_lines, max(start, end_line))

    if (end - start) > 250:
        end = start + 250

    selected = lines[start - 1 : end]
    numbered = [f"{start + i:4d} | {line}" for i, line in enumerate(selected)]

    header = f"=== File: {path} (Lines {start} to {end} of {total_lines} total lines) ==="
    more_notice = ""
    if total_lines > end:
        more_notice = f"\n=== Note: Showing lines {start}-{end} of {total_lines}. Specify start_line and end_line to inspect other sections. ==="
    return f"{header}\n" + "\n".join(numbered) + more_notice


def find_files(project_root: str, pattern: str = "", **kwargs: Any) -> str:
    """Find files matching a glob or substring pattern, with support for multi-word queries."""
    if not pattern:
        pattern = str(kwargs.get("query") or kwargs.get("search") or kwargs.get("name") or kwargs.get("filename") or kwargs.get("glob") or kwargs.get("q") or "")
    pattern = pattern.strip("`'\" \t\n")

    root = Path(project_root).resolve()
    matches: list[str] = []

    clean_pat = pattern.strip()
    if not clean_pat:
        return "Error: pattern cannot be empty."

    # Split multi-word patterns (e.g. "top bar" -> check for "top" and "bar")
    words = [w.lower() for w in re.split(r"[\s_-]+", clean_pat) if w]

    for p in root.rglob("*"):
        if any(ig in p.parts for ig in IGNORED_DIRS):
            continue
        if p.suffix.lower() in IGNORED_EXTENSIONS:
            continue
        try:
            rel = p.relative_to(root).as_posix()
            name_lower = p.name.lower()
            rel_lower = rel.lower()

            # Exact glob match or all words present in filename/path
            matched = False
            if "*" in clean_pat or "?" in clean_pat:
                if p.match(clean_pat):
                    matched = True
            elif len(words) > 1:
                if all(w in rel_lower for w in words):
                    matched = True
                elif any(w in name_lower for w in words):
                    matched = True
            else:
                if clean_pat.lower() in rel_lower:
                    matched = True

            if matched:
                type_tag = "[DIR]" if p.is_dir() else "[FILE]"
                matches.append(f"{type_tag} {rel}")
                if len(matches) >= 50:
                    break
        except Exception:
            continue

    if not matches:
        return f"No files found matching pattern '{pattern}'"
    return f"Found {len(matches)} matches:\n" + "\n".join(matches)


def edit_file(
    project_root: str,
    path: str = "",
    search: str = "",
    replace: str = "",
    **kwargs: Any,
) -> str:
    """Apply a surgical SEARCH/REPLACE block to a target file with multi-tier fuzzy matching."""
    root = Path(project_root).resolve()
    if not path:
        path = str(kwargs.get("file") or kwargs.get("filepath") or kwargs.get("file_path") or kwargs.get("filePath") or kwargs.get("target") or kwargs.get("filename") or kwargs.get("target_file") or kwargs.get("targetFile") or "")
    path = path.strip("`'\" \t\n[]:*#")
    if path.startswith("a/") or path.startswith("b/"):
        path = path[2:]

    if not search:
        search = str(kwargs.get("find") or kwargs.get("old_str") or kwargs.get("old_code") or kwargs.get("original") or kwargs.get("before") or kwargs.get("search_block") or kwargs.get("old") or "")
    if not replace and "replace" not in kwargs:
        replace = str(kwargs.get("new_str") or kwargs.get("new_code") or kwargs.get("replacement") or kwargs.get("after") or kwargs.get("replace_block") or kwargs.get("new") or kwargs.get("new_content") or kwargs.get("newContent") or kwargs.get("content") or "")

    # Check if a unified diff / patch was provided instead of search/replace
    if not search:
        patch_text = str(kwargs.get("patch") or kwargs.get("diff") or kwargs.get("unified_diff") or "")
        if patch_text:
            hunk_count = sum(1 for line in patch_text.splitlines() if line.startswith("@@"))
            if hunk_count > 1:
                return (
                    "Error: Multi-hunk unified diffs are not supported. "
                    "Send one edit_file call per hunk, or use explicit search/replace blocks."
                )
            s_lines = []
            r_lines = []
            for line in patch_text.splitlines():
                if line.startswith(("---", "+++", "index ", "diff ")):
                    continue
                if line.startswith("@@"):
                    continue
                if line.startswith("-"):
                    s_lines.append(line[1:])
                elif line.startswith("+"):
                    r_lines.append(line[1:])
                else:
                    ctx = line[1:] if line.startswith(" ") else line
                    s_lines.append(ctx)
                    r_lines.append(ctx)
            if s_lines or r_lines:
                search = "\n".join(s_lines)
                replace = "\n".join(r_lines)

    if not path:
        return "Error: path cannot be empty."

    target = _resolve_safe_path(project_root, path)
    if not target.exists():
        parent_dir = target.parent
        if parent_dir.exists() and parent_dir.is_dir():
            existing = [f.name for f in sorted(parent_dir.iterdir()) if not f.name.startswith(".") and f.suffix.lower() not in IGNORED_EXTENSIONS][:10]
            return f"Error: File '{path}' does not exist. Existing files in '{parent_dir.relative_to(root).as_posix()}': {existing}"
        return f"Error: File '{path}' does not exist."

    try:
        content = target.read_text(encoding="utf-8")
    except Exception as exc:
        return f"Error reading file '{path}': {exc}"

    # Line-range extraction if search block was not provided directly
    if not search:
        start_line = kwargs.get("start_line") or kwargs.get("startLine") or kwargs.get("start")
        end_line = kwargs.get("end_line") or kwargs.get("endLine") or kwargs.get("end") or start_line
        if start_line is not None:
            try:
                sl = int(start_line)
                el = int(end_line)
                c_lines = content.splitlines(keepends=True)
                if 1 <= sl <= len(c_lines):
                    el = min(max(el, sl), len(c_lines))
                    search = "".join(c_lines[sl - 1 : el])
            except Exception as e:
                logger.warning("Could not extract lines %s-%s: %s", start_line, end_line, e)

    if not search:
        return "Error: search block cannot be empty. Specify exact existing lines to replace or start_line/end_line."

    norm_content = content.replace("\r\n", "\n")
    norm_search = search.replace("\r\n", "\n")
    norm_replace = replace.replace("\r\n", "\n")

    # Tier 1: Exact substring match
    if norm_search in norm_content:
        occurrences = norm_content.count(norm_search)
        if occurrences > 1:
            return (
                f"Error: Search block occurs {occurrences} times in '{path}'. "
                "Please include more surrounding context lines to make the SEARCH block unique."
            )
        new_content = norm_content.replace(norm_search, norm_replace, 1)
        if "\r\n" in content:
            new_content = new_content.replace("\n", "\r\n")

        backup = target.with_suffix(target.suffix + ".bak")
        try:
            backup.write_text(content, encoding="utf-8")
            target.write_text(new_content, encoding="utf-8")
            return f"Success: Successfully updated '{path}' (exact match replaced)."
        except Exception as exc:
            return f"Error writing to '{path}': {exc}"

    # Tier 2: Stripped whitespace line-by-line match
    content_lines = norm_content.splitlines()
    search_lines = norm_search.splitlines()
    search_stripped = [l.strip() for l in search_lines if l.strip()]

    if not search_stripped:
        return "Error: Search block contains only blank lines."

    match_idx = -1
    match_count = 0

    for i in range(len(content_lines) - len(search_lines) + 1):
        window = content_lines[i : i + len(search_lines)]
        window_stripped = [l.strip() for l in window if l.strip()]
        if window_stripped == search_stripped:
            match_idx = i
            match_count += 1

    if match_count == 1:
        orig_indent = ""
        first_orig_line = content_lines[match_idx]
        indent_match = re.match(r"^([ \t]*)", first_orig_line)
        if indent_match:
            orig_indent = indent_match.group(1)

        replace_lines = norm_replace.splitlines()
        adjusted_replace_lines = []
        for rline in replace_lines:
            if rline.strip() and not rline.startswith((" ", "\t")):
                adjusted_replace_lines.append(orig_indent + rline)
            else:
                adjusted_replace_lines.append(rline)

        new_lines = content_lines[:match_idx] + adjusted_replace_lines + content_lines[match_idx + len(search_lines):]
        new_content = "\n".join(new_lines)
        if "\r\n" in content:
            new_content = new_content.replace("\n", "\r\n")

        backup = target.with_suffix(target.suffix + ".bak")
        try:
            backup.write_text(content, encoding="utf-8")
            target.write_text(new_content, encoding="utf-8")
            return f"Success: Successfully updated '{path}' (whitespace-tolerant match replaced)."
        except Exception as exc:
            return f"Error writing to '{path}': {exc}"
    elif match_count > 1:
        return (
            f"Error: Search block matches {match_count} locations in '{path}'. "
            "Please include more surrounding context lines in SEARCH to ensure uniqueness."
        )

    # Tier 3: Whitespace-collapsed token sequence match
    def _norm_ws(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    search_collapsed = _norm_ws(norm_search)
    if search_collapsed:
        t3_matches = []
        for i in range(len(content_lines)):
            for j in range(i + 1, min(len(content_lines) + 1, i + len(search_lines) + 8)):
                window_slice = "\n".join(content_lines[i:j])
                if _norm_ws(window_slice) == search_collapsed:
                    t3_matches.append((i, j))

        if len(t3_matches) == 1:
            i, j = t3_matches[0]
            orig_indent = ""
            indent_match = re.match(r"^([ \t]*)", content_lines[i])
            if indent_match:
                orig_indent = indent_match.group(1)

            replace_lines = norm_replace.splitlines()
            adjusted = []
            for rline in replace_lines:
                if rline.strip() and not rline.startswith((" ", "\t")):
                    adjusted.append(orig_indent + rline)
                else:
                    adjusted.append(rline)

            new_lines = content_lines[:i] + adjusted + content_lines[j:]
            new_content = "\n".join(new_lines)
            if "\r\n" in content:
                new_content = new_content.replace("\n", "\r\n")

            backup = target.with_suffix(target.suffix + ".bak")
            try:
                backup.write_text(content, encoding="utf-8")
                target.write_text(new_content, encoding="utf-8")
                return f"Success: Successfully updated '{path}' (normalized fuzzy match replaced)."
            except Exception as exc:
                return f"Error writing to '{path}': {exc}"
        elif len(t3_matches) > 1:
            return (
                f"Error: Search block matches {len(t3_matches)} locations in '{path}'. "
                "Please include more surrounding context lines in SEARCH to ensure uniqueness."
            )

    return (
        f"Error: Could not locate SEARCH block in '{path}'.\n"
        "Ensure the lines inside SEARCH match the actual file content exactly. "
        "Use read_file to inspect the file around the target location first."
    )


def write_file(
    project_root: str,
    path: str = "",
    content: str = "",
    **kwargs: Any,
) -> str:
    """Create a new file or overwrite an existing file with full content.
    
    Crucial for greenfield development, scaffolding new files, or writing new modules.
    Ensures parent directories exist, writes UTF-8 content, and triggers incremental index sync.
    """
    root = Path(project_root).resolve()
    if not path:
        path = str(kwargs.get("file") or kwargs.get("filepath") or kwargs.get("target") or kwargs.get("filename") or "")
    path = path.strip("`'\" \t\n")
    if not path:
        return "Error: path cannot be empty."

    if "code" in kwargs and not content:
        content = str(kwargs["code"])
    elif "file_content" in kwargs and not content:
        content = str(kwargs["file_content"])
    elif "new_content" in kwargs and not content:
        content = str(kwargs["new_content"])

    try:
        target = _resolve_safe_path(project_root, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

        # Trigger incremental indexing if indexer is present
        try:
            from project_indexer import update_file_incremental
            update_file_incremental(project_root, str(target.relative_to(root)))
        except Exception:
            pass

        return f"Successfully wrote {len(content)} characters to '{target.relative_to(root).as_posix()}'."
    except Exception as exc:
        return f"Error writing file '{path}': {exc}"


_PERMISSION_REQUESTER: Optional[Callable[[str, str], bool]] = None


def set_permission_requester(handler: Optional[Callable[[str, str], bool]]) -> None:
    """Register a permission handler: handler(command, description) -> bool."""
    global _PERMISSION_REQUESTER
    _PERMISSION_REQUESTER = handler


def get_permission_requester() -> Optional[Callable[[str, str], bool]]:
    return _PERMISSION_REQUESTER


PERMANENTLY_PROHIBITED_COMMANDS = [
    re.compile(r"rm\s+-(?:rf?|fr?)\s+[/~]", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bdd\s+if=", re.IGNORECASE),
    re.compile(r":\(\)\s*\{\s*:\|:&\s*\};:"),
]

SENSITIVE_COMMAND_PATTERNS = [
    (re.compile(r"\bgit\s+(?:commit|push|checkout|reset|rebase|clean|stash|branch\s+-[dD]|rm|merge)\b", re.IGNORECASE), "Version control mutation"),
    (re.compile(r"\bgit\s+add\b", re.IGNORECASE), "Staging workspace files"),
    (re.compile(r"\bnpm\s+publish\b", re.IGNORECASE), "Publishing package to npm registry"),
    (re.compile(r"\bpip\s+upload\b", re.IGNORECASE), "Uploading package to PyPI repository"),
    (re.compile(r"\brm\s+", re.IGNORECASE), "File deletion via terminal"),
]

ALLOWED_COMMAND_PREFIXES = ("npm", "npx", "pytest", "cargo", "tsc")
APPROVED_NPM_VERIFICATION_SCRIPTS = {"build", "test", "lint", "typecheck", "check", "verify"}


def _is_allowed_verification_command(argv: list[str]) -> bool:
    command_name = Path(argv[0]).name.lower()
    if command_name in {"pytest", "tsc"} or command_name.startswith(("pytest.", "tsc.")):
        return True
    if command_name == "cargo":
        return len(argv) >= 2 and argv[1] in {"check", "test", "build", "fmt", "clippy", "metadata"}
    if command_name == "npm":
        return len(argv) >= 3 and argv[1] == "run" and argv[2] in APPROVED_NPM_VERIFICATION_SCRIPTS
    if command_name == "npx":
        return len(argv) >= 2 and argv[1] in {"tsc", "eslint", "prettier", "vitest", "jest"}
    return False


def run_command(project_root: str, command: str = "", timeout_seconds: int = 60, **kwargs: Any) -> str:
    """Execute a terminal command inside the project directory and capture output."""
    if not command:
        command = str(kwargs.get("cmd") or kwargs.get("script") or kwargs.get("exec") or kwargs.get("run") or "")
    if "timeout_seconds" not in kwargs and "timeout" in kwargs:
        try:
            timeout_seconds = int(kwargs["timeout"])
        except Exception:
            pass

    root = Path(project_root).resolve()
    clean_cmd = command.strip()

    if not clean_cmd:
        return "Error: command cannot be empty."

    # Tier C: Permanently Prohibited Bombs (destructive system attacks)
    for pat in PERMANENTLY_PROHIBITED_COMMANDS:
        if pat.search(clean_cmd):
            return f"Error: Prohibited destructive command rejected by safety filter: '{clean_cmd}'."

    # Tier B: Sensitive Commands Requiring User Authorization
    matched_reason = None
    for pat, reason in SENSITIVE_COMMAND_PATTERNS:
        if pat.search(clean_cmd):
            matched_reason = reason
            break

    if matched_reason:
        requester = get_permission_requester()
        if requester is not None:
            desc = f"Action: {matched_reason}\nCommand: `{clean_cmd}`"
            approved = requester(clean_cmd, desc)
            if not approved:
                return (
                    f"Command rejected by user: The user declined authorization to run '{clean_cmd}'. "
                    "Do NOT attempt to run this command again. Continue with your remaining work or conclude your response."
                )
            logger.info("User approved execution of sensitive command: %s", clean_cmd)
        else:
            return (
                f"Error: Command requires explicit user authorization: '{clean_cmd}' ({matched_reason}). "
                "No interactive approval channel is active. Please ask the user directly before attempting this action."
            )

    try:
        argv = shlex.split(clean_cmd, posix=os.name != "nt")
    except ValueError as exc:
        return f"Error: Invalid command syntax: {exc}"
    if not argv:
        return "Error: command cannot be empty."
    if not _is_allowed_verification_command(argv):
        requester = get_permission_requester()
        if requester is None:
            return (
                f"Error: Command requires explicit user authorization: '{clean_cmd}'. "
                "Only configured safe command prefixes are allowed without approval."
            )
        if not requester(clean_cmd, f"Action: Execute command outside the safe allowlist\nCommand: `{clean_cmd}`"):
            return f"Command rejected by user: The user declined authorization to run '{clean_cmd}'."

    start_t = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        elapsed = round(time.monotonic() - start_t, 2)
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        output = stdout + ("\n--- STDERR ---\n" + stderr if stderr else "")

        lines = output.splitlines()
        if len(lines) > 200:
            truncated = lines[:50] + [f"\n... [{len(lines) - 150} lines truncated] ...\n"] + lines[-100:]
            output = "\n".join(truncated)

        status_tag = "SUCCESS" if proc.returncode == 0 else f"FAILED (exit code {proc.returncode})"
        return f"Command executed in {elapsed}s: [{status_tag}]\n{output.strip() or '(no output)'}"
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout_seconds} seconds: {clean_cmd}"
    except Exception as exc:
        return f"Error executing command: {exc}"


def locate_concept(project_root: str, concept: str = "", **kwargs: Any) -> str:
    """Resolve high-level UI or architectural concepts using universal dynamic semantic grounding.
    
    Zero hardcoded repository paths. Queries dynamically indexed landmarks, exported AST symbols,
    and semantic component elements.
    """
    if not concept:
        concept = str(kwargs.get("query") or kwargs.get("name") or kwargs.get("target") or kwargs.get("keyword") or kwargs.get("component") or "")
    c_clean = concept.strip()
    if not c_clean:
        return "Error: concept query cannot be empty."

    try:
        from semantic_grounding import resolve_concept as dynamic_resolve
        return dynamic_resolve(project_root, c_clean)
    except Exception as exc:
        sym_res = search_symbols(project_root, concept)
        if "Found" in sym_res:
            return f"Concept '{concept}' found in symbol index:\n" + sym_res
        return f"Could not resolve concept '{concept}': {exc}. Try find_files or grep_search."


def search_symbols(project_root: str, query: str = "", **kwargs: Any) -> str:
    """Search for AST symbols (classes, functions, methods, components) across the project with multi-word support."""
    if not query:
        query = str(kwargs.get("name") or kwargs.get("symbol") or kwargs.get("pattern") or kwargs.get("keyword") or "")
    query = query.strip()
    if not query:
        return "Error: query cannot be empty."

    index_file = Path(project_root) / ".acsa" / "index.json"
    if not index_file.exists():
        return grep_search(project_root, query)

    try:
        data = json.loads(index_file.read_text(encoding="utf-8"))
        symbols_map: dict[str, list[dict[str, Any]]] = data.get("symbols", {})
        q_lower = query.lower()
        q_words = [w for w in re.split(r"[\s_-]+", q_lower) if w]

        matches = []
        for name, sym_list in symbols_map.items():
            name_lower = name.lower()
            matched = False
            if q_lower in name_lower:
                matched = True
            elif q_words and all(w in name_lower for w in q_words):
                matched = True
            elif len(q_words) > 1 and any(w in name_lower for w in q_words):
                matched = True

            if matched:
                for sym in sym_list:
                    rel = sym.get("file_path", "")
                    kind = sym.get("kind", "")
                    sig = sym.get("signature", name)
                    line = sym.get("start_line", 1)
                    matches.append(f"{rel}:{line} [{kind}] {sig}")

        if not matches:
            return f"No AST symbols found matching '{query}'. Try grep_search for text matching."
        return f"Found {len(matches)} matches for '{query}':\n" + "\n".join(matches[:25])
    except Exception as exc:
        return f"Error reading symbol index: {exc}"


def get_file_outline(project_root: str, path: str = "", **kwargs: Any) -> str:
    """Get the AST symbol outline for a specific file."""
    if not path:
        path = str(kwargs.get("file") or kwargs.get("filepath") or kwargs.get("target") or "")
    path = path.strip("`'\" \t\n")
    if not path:
        return "Error: path cannot be empty."

    index_file = Path(project_root) / ".acsa" / "index.json"
    if not index_file.exists():
        return f"Index not generated yet. Use read_file on '{path}'."

    try:
        data = json.loads(index_file.read_text(encoding="utf-8"))
        norm_path = Path(path).as_posix()
        files_data = data.get("files", {})

        target_data = files_data.get(norm_path)
        if not target_data:
            for k, v in files_data.items():
                if k.endswith(norm_path) or norm_path.endswith(k):
                    target_data = v
                    norm_path = k
                    break

        if not target_data:
            return f"No indexed symbols found for '{path}'."

        symbols = target_data.get("symbols", [])
        if not symbols:
            return f"File '{path}' has no exported classes or functions."

        lines = [f"Outline for '{norm_path}':"]
        for s in symbols:
            kind = s.get("kind", "symbol")
            sig = s.get("signature", s.get("name", ""))
            start = s.get("start_line", 1)
            end = s.get("end_line", start)
            lines.append(f"  L{start}-{end} [{kind}] {sig}")

        return "\n".join(lines)
    except Exception as exc:
        return f"Error getting file outline: {exc}"


def normalize_tool_arguments(tool_name: str, raw_args: dict[str, Any]) -> dict[str, Any]:
    """Map common aliases and normalize parameters across different LLM formats."""
    if not isinstance(raw_args, dict):
        return {}
    args = dict(raw_args)

    # 1. Path normalization for any tool taking a file path
    for p_key in ("path", "file", "filepath", "file_path", "filePath", "target", "filename", "target_file", "targetFile", "p"):
        if p_key in args and args[p_key] is not None:
            val = str(args.pop(p_key)).strip("`'\" \t\n")
            args["path"] = val
            break

    # 2. Tool-specific aliases
    if tool_name in ("grep_search", "grep", "rg"):
        for q_key in ("query", "pattern", "search", "text", "keyword", "term", "q", "find"):
            if q_key in args and args[q_key] is not None:
                args["query"] = str(args.pop(q_key)).strip()
                break
        for r_key in ("is_regex", "regex", "isRegex", "use_regex"):
            if r_key in args:
                val = args.pop(r_key)
                if isinstance(val, str):
                    args["is_regex"] = val.strip().lower() in ("true", "1", "yes")
                else:
                    args["is_regex"] = bool(val)
                break
        for c_key in ("case_sensitive", "caseSensitive", "is_case_sensitive", "case"):
            if c_key in args:
                val = args.pop(c_key)
                if isinstance(val, str):
                    args["case_sensitive"] = val.strip().lower() in ("true", "1", "yes")
                else:
                    args["case_sensitive"] = bool(val)
                break
        for m_key in ("max_results", "limit", "max", "maxResults"):
            if m_key in args:
                try:
                    args["max_results"] = int(args.pop(m_key))
                except Exception:
                    pass

    elif tool_name in ("find_files", "find", "find_file"):
        for p_key in ("pattern", "query", "search", "name", "filename", "glob", "q"):
            if p_key in args and args[p_key] is not None:
                args["pattern"] = str(args.pop(p_key)).strip()
                break

    elif tool_name in ("read_file", "view_file", "cat"):
        for s_key in ("start_line", "start", "from_line", "line_start", "startLine"):
            if s_key in args and args[s_key] is not None:
                try:
                    args["start_line"] = int(args.pop(s_key))
                except Exception:
                    pass
                break
        for e_key in ("end_line", "end", "to_line", "line_end", "endLine"):
            if e_key in args and args[e_key] is not None:
                try:
                    args["end_line"] = int(args.pop(e_key))
                except Exception:
                    pass
                break

    elif tool_name in ("edit_file", "patch", "replace_file_content", "modify_file"):
        for s_key in ("search", "find", "old_str", "old_code", "original", "before", "search_block", "target_code", "old"):
            if s_key in args and args[s_key] is not None:
                args["search"] = str(args.pop(s_key))
                break
        for r_key in ("replace", "new_str", "new_code", "replacement", "after", "replace_block", "new", "new_content", "newContent", "content"):
            if r_key in args and args[r_key] is not None:
                args["replace"] = str(args.pop(r_key))
                break
        for sl_key in ("start_line", "startLine", "start", "from_line", "line_start"):
            if sl_key in args and args[sl_key] is not None:
                try:
                    args["start_line"] = int(args.pop(sl_key))
                except Exception:
                    pass
                break
        for el_key in ("end_line", "endLine", "end", "to_line", "line_end"):
            if el_key in args and args[el_key] is not None:
                try:
                    args["end_line"] = int(args.pop(el_key))
                except Exception:
                    pass
                break

    elif tool_name in ("run_command", "bash", "terminal", "command", "exec"):
        for c_key in ("command", "cmd", "script", "exec", "run"):
            if c_key in args and args[c_key] is not None:
                args["command"] = str(args.pop(c_key)).strip()
                break
        for t_key in ("timeout_seconds", "timeout", "timeout_s"):
            if t_key in args and args[t_key] is not None:
                try:
                    args["timeout_seconds"] = int(args.pop(t_key))
                except Exception:
                    pass
                break

    elif tool_name == "locate_concept":
        for c_key in ("concept", "query", "name", "target", "keyword", "component"):
            if c_key in args and args[c_key] is not None:
                args["concept"] = str(args.pop(c_key)).strip()
                break

    elif tool_name == "search_symbols":
        for q_key in ("query", "name", "symbol", "pattern", "keyword"):
            if q_key in args and args[q_key] is not None:
                args["query"] = str(args.pop(q_key)).strip()
                break

    elif tool_name in ("delegate_to_local_worker", "local_worker", "delegate"):
        for f_key in ("target_file", "path", "file", "target", "filePath", "targetFile"):
            if f_key in args and args[f_key] is not None:
                args["target_file"] = str(args.pop(f_key)).strip("`'\" \t\n")
                break
        for i_key in ("instruction", "task", "prompt", "spec", "action"):
            if i_key in args and args[i_key] is not None:
                args["instruction"] = str(args.pop(i_key)).strip()
                break
        for c_key in ("context", "surrounding_code", "contract", "types"):
            if c_key in args and args[c_key] is not None:
                args["context"] = str(args.pop(c_key)).strip()
                break

    return args


try:
    from worker_pool import delegate_to_local_worker
except ImportError:
    delegate_to_local_worker = None  # type: ignore

TOOL_REGISTRY = {
    "locate_concept": locate_concept,
    "grep_search": grep_search,
    "list_dir": list_dir,
    "read_file": read_file,
    "write_file": write_file,
    "find_files": find_files,
    "edit_file": edit_file,
    "run_command": run_command,
    "search_symbols": search_symbols,
    "get_file_outline": get_file_outline,
    # High-utility aliases for LLM compatibility:
    "grep": grep_search,
    "rg": grep_search,
    "find": find_files,
    "find_file": find_files,
    "ls": list_dir,
    "cat": read_file,
    "view_file": read_file,
    "create_file": write_file,
    "new_file": write_file,
    "bash": run_command,
    "terminal": run_command,
    "command": run_command,
    "exec": run_command,
    "patch": edit_file,
    "replace_file_content": edit_file,
    "modify_file": edit_file,
}

if delegate_to_local_worker:
    TOOL_REGISTRY["delegate_to_local_worker"] = delegate_to_local_worker
    TOOL_REGISTRY["local_worker"] = delegate_to_local_worker
    TOOL_REGISTRY["delegate"] = delegate_to_local_worker

TOOL_SCHEMAS = [
    {
        "name": "locate_concept",
        "description": "Resolve high-level UI or architectural concepts (e.g. 'top bar', 'status bar', 'terminal', 'chat', 'user routes', 'database models') to exact target files and line ranges using universal semantic grounding.",
        "parameters": {
            "concept": "The UI or system concept to locate (e.g. 'top bar', 'status bar', 'user routes')",
        },
    },
    {
        "name": "grep_search",
        "description": "Fast ripgrep / text search across codebase files. Use this to locate function definitions, variable usages, button labels, and imports.",
        "parameters": {
            "query": "String or pattern to search for (e.g. 'totalSymbols' or 'syncIndex')",
            "path": "Optional subpath or file to restrict search to",
            "is_regex": "Optional boolean whether query is a regex",
        },
    },
    {
        "name": "find_files",
        "description": "Find files by filename or glob pattern across the project.",
        "parameters": {
            "pattern": "Glob or filename pattern (e.g. '*Chat*.tsx' or 'StatusBar*')",
        },
    },
    {
        "name": "list_dir",
        "description": "List files and subdirectories within a directory path.",
        "parameters": {
            "path": "Relative path to directory (defaults to project root '.' if omitted)",
            "max_depth": "Optional integer max depth (default: 2)",
        },
    },
    {
        "name": "read_file",
        "description": "Read a specific slice of lines from a file with line numbers. Use this to inspect code before editing.",
        "parameters": {
            "path": "Relative file path (e.g. 'src/components/StatusBar.tsx')",
            "start_line": "1-based starting line number (default: 1)",
            "end_line": "1-based ending line number (default: 100)",
        },
    },
    {
        "name": "write_file",
        "description": "Create a new file or completely overwrite a file with new content. Crucial for greenfield development, scaffolding new files, or writing new modules.",
        "parameters": {
            "path": "Relative file path to create/write",
            "content": "Full content to write into the file",
        },
    },
    {
        "name": "edit_file",
        "description": "Surgically edit a file using a SEARCH and REPLACE block or line ranges (start_line, end_line, replace).",
        "parameters": {
            "path": "Relative file path to edit",
            "search": "Exact lines of code currently in the file to be replaced (optional if start_line/end_line specified)",
            "replace": "New lines of code to insert (or empty string to delete)",
            "start_line": "Optional 1-based start line number to replace",
            "end_line": "Optional 1-based end line number to replace",
        },
    },
    {
        "name": "delegate_to_local_worker",
        "description": "Delegate a surgical code implementation or refactoring task to the local offline code worker ($0 token cost). The local worker runs safely in a sequential worker pool (concurrency=1) and returns precision code edits.",
        "parameters": {
            "target_file": "Relative workspace path to the file being edited or created",
            "instruction": "Specific, unambiguous code instructions for the local worker to implement",
            "context": "Optional surrounding lines, interface contracts, or types the worker needs",
        },
    },
    {
        "name": "run_command",
        "description": "Run a verification shell command in the project root (e.g. 'npm run build', 'npx tsc', 'pytest', 'cargo check'). Git mutation and staging commands require explicit user authorization; unauthorized or prohibited staging operations remain blocked by the runtime safety policy.",
        "parameters": {
            "command": "The terminal verification command string to execute",
            "timeout_seconds": "Timeout in seconds (default: 60)",
        },
    },
    {
        "name": "search_symbols",
        "description": "Search for function, class, or component definitions in the AST index.",
        "parameters": {
            "query": "Symbol name or substring to search for",
        },
    },
    {
        "name": "get_file_outline",
        "description": "Get all exported symbols and structural outlines of a file.",
        "parameters": {
            "path": "Relative file path",
        },
    },
]
