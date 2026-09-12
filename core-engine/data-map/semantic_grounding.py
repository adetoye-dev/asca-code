#!/usr/bin/env python3
"""
semantic_grounding.py — Universal Semantic Intent & Architecture Grounding Engine

Connects natural language concepts and arbitrary human vocabulary to codebase
architecture, AST symbols, and dynamic landmarks with ZERO hardcoded project paths.

Zero external dependencies (pure Python 3 stdlib).
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("SemanticGrounding")

# Standard stop words to ignore in concept tokenization
STOP_WORDS = {
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or",
    "is", "are", "was", "were", "it", "this", "that", "these", "those",
    "with", "from", "by", "as", "into", "through", "during", "before",
    "after", "above", "below", "between", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how",
    "all", "any", "both", "each", "few", "more", "most", "other", "some",
    "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
    "very", "can", "will", "just", "should", "now", "i", "we", "you",
    "remove", "delete", "change", "update", "modify", "add", "retain", "leave",
}

# Universal semantic role associations
ROLE_SYNONYMS: dict[str, list[str]] = {
    "navigation": [
        "nav", "navbar", "navigation", "topbar", "top bar", "header",
        "titlebar", "title bar", "appbar", "app bar", "toolbar", "tool bar",
        "ribbon", "upper", "brand", "logo", "branding", "brand title", "brand logo"
    ],
    "footer_status": [
        "footer", "statusbar", "status bar", "bottombar", "bottom bar",
        "bottom panel", "dock", "metrics", "breadcrumbs"
    ],
    "entrypoint": [
        "main", "entry", "entrypoint", "root", "app", "index", "bootstrap", "init"
    ],
    "routing": [
        "route", "routes", "router", "routing", "url", "urls", "endpoint",
        "endpoints", "api", "controller", "controllers", "view", "views"
    ],
    "state_data": [
        "store", "stores", "state", "reducer", "reducers", "model", "models",
        "schema", "schemas", "entity", "entities", "db", "database"
    ],
    "editor_canvas": [
        "editor", "monaco", "canvas", "diff", "viewer", "staging"
    ],
    "terminal_shell": [
        "terminal", "shell", "console", "pty", "xterm", "exec"
    ],
    "sidebar_explorer": [
        "sidebar", "explorer", "tree", "file tree", "file list", "navigation pane"
    ],
}


def _tokenize(text: str) -> list[str]:
    """Extract lowercase alphanumeric tokens, filtering stop words."""
    raw_tokens = re.findall(r"[A-Za-z0-9_-]+", text.lower())
    clean: list[str] = []
    for t in raw_tokens:
        sub = re.split(r"[-_]+", t)
        for s in sub:
            s_stripped = s.strip()
            if len(s_stripped) >= 2 and s_stripped not in STOP_WORDS:
                clean.append(s_stripped)
    return clean


def load_project_index(project_root: str | Path) -> dict[str, Any]:
    """Load .acsa/index.json from project root, or empty dict if not found."""
    root = Path(project_root).resolve()
    idx_path = root / ".acsa" / "index.json"
    if idx_path.exists():
        try:
            return json.loads(idx_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.debug("Failed to parse .acsa/index.json: %s", exc)
    return {}


def get_project_landmarks(project_root: str | Path) -> dict[str, Any]:
    """Get dynamically discovered landmarks from the project index."""
    idx = load_project_index(project_root)
    return idx.get("landmarks", {})


def get_project_architecture(project_root: str | Path) -> dict[str, Any]:
    """Get dynamic architecture summary and archetype from project index."""
    idx = load_project_index(project_root)
    return idx.get("architecture", {})


def resolve_concept(project_root: str | Path, concept: str) -> str:
    """Universal semantic resolver: maps user terminology to exact code locations.
    
    Uses zero hardcoded repository paths. Evaluates:
    1. Dynamically indexed architectural landmarks
    2. Exported AST symbols & signatures
    3. Content semantics (JSX elements, route decorators, store definitions)
    4. File path topology
    """
    root = Path(project_root).resolve()
    c_clean = concept.strip().lower()
    if not c_clean:
        return "Error: concept query cannot be empty."

    tokens = _tokenize(c_clean)
    index = load_project_index(root)
    landmarks = index.get("landmarks", {})
    files_dict = index.get("files", {})
    symbols_map = index.get("symbols", {})

    # 1. Match against dynamic landmarks
    best_landmark: Optional[tuple[str, dict[str, Any], int]] = None
    for role, syns in ROLE_SYNONYMS.items():
        role_score = 0
        for syn in syns:
            if syn == c_clean:
                role_score += 15
            elif syn in c_clean:
                role_score += 8
            elif any(t == syn for t in tokens):
                role_score += 5
            elif any(t in syn.split() for t in tokens if len(t) > 3):
                role_score += 2

        if role_score > 0 and role in landmarks and landmarks[role]:
            lm_entry = landmarks[role]
            bonus_score = 0
            if isinstance(lm_entry, list):
                if lm_entry:
                    best_sub = lm_entry[0]
                    best_sub_score = -1
                    for sub in lm_entry:
                        sub_file = sub.get("file", "").lower()
                        sub_desc = sub.get("description", "").lower()
                        sub_score = sum(4 for t in tokens if t in sub_file) + sum(1 for t in tokens if t in sub_desc)
                        if sub_score > best_sub_score:
                            best_sub_score = sub_score
                            best_sub = sub
                    lm_entry = best_sub
                    bonus_score = max(0, best_sub_score)
                else:
                    continue
            total_score = role_score + bonus_score
            if not best_landmark or total_score > best_landmark[2]:
                best_landmark = (role, lm_entry, total_score)

    if best_landmark:
        role, lm_info, score = best_landmark
        f_path = lm_info.get("file", "")
        lines = lm_info.get("line_range", "1-100")
        desc = lm_info.get("description", role)
        elems = lm_info.get("elements", [])
        elems_str = f" [elements: {', '.join(elems[:4])}]" if elems else ""
        return (
            f"Resolved concept '{concept}' (dynamic landmark: {role}):\n"
            f"• Target File: {f_path} (Lines {lines})\n"
            f"• Description: {desc}{elems_str}\n"
            f"Use read_file with path='{f_path}' (start_line={lines.split('-')[0]}, end_line={lines.split('-')[-1]}) to inspect before editing."
        )

    # 2. Match against AST symbols
    symbol_matches: list[tuple[str, dict[str, Any], int]] = []
    for sym_name, sym_list in symbols_map.items():
        sym_lower = sym_name.lower()
        score = 0
        for t in tokens:
            if t == sym_lower:
                score += 5
            elif t in sym_lower:
                score += 2
        if score > 0:
            for s in sym_list:
                symbol_matches.append((sym_name, s, score))

    if symbol_matches:
        symbol_matches.sort(key=lambda x: x[2], reverse=True)
        top = symbol_matches[0]
        s_name, s_info, _ = top
        f_path = s_info.get("file_path", "")
        start_l = s_info.get("start_line", 1)
        end_l = s_info.get("end_line", start_l + 30)
        kind = s_info.get("kind", "symbol")
        sig = s_info.get("signature", s_name)
        return (
            f"Resolved concept '{concept}' via AST symbol '{s_name}' [{kind}]:\n"
            f"• Target File: {f_path} (Lines {start_l}-{end_l})\n"
            f"• Signature: {sig}\n"
            f"Use read_file with path='{f_path}', start_line={start_l}, end_line={end_l}."
        )

    # 3. Match against file paths & directory topology
    path_matches: list[tuple[str, int]] = []
    for f_rel in files_dict.keys():
        f_lower = f_rel.lower()
        score = 0
        for t in tokens:
            if t in f_lower:
                score += 3
        if score > 0:
            path_matches.append((f_rel, score))

    if path_matches:
        path_matches.sort(key=lambda x: x[1], reverse=True)
        top_f = path_matches[0][0]
        return (
            f"Resolved concept '{concept}' to candidate file:\n"
            f"• Target File: {top_f}\n"
            f"Use read_file with path='{top_f}' to inspect this file."
        )

    return f"Could not resolve concept '{concept}'. Try find_files or grep_search with specific keywords."
