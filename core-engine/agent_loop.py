"""agent_loop.py — Autonomous ReAct Tool-Calling Agent Execution Engine

Implements the active Reason-Act-Observe loop (Claude Code / Aider / Cline architecture):
1. Equips the LLM with direct project tools: grep_search, read_file, find_files, list_dir, edit_file, run_command.
2. Streams thoughts and actions in real-time to the IDE via SSE (@@STEP@@, @@THOUGHT@@, @@CHUNK@@).
3. Parses multi-format tool calls (native JSON function calls, <tool_call> XML, and ReAct markdown).
4. Executes tools safely inside the project root and appends observations back into context.
5. Continues autonomously until the model finishes the task or verifies its work.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

# Sibling module imports
_ENGINE_DIR = Path(__file__).resolve().parent
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

import agent_tools

try:
    from gauntlet.syntax_guard import run_syntax_gate
except ImportError:
    try:
        from syntax_guard import run_syntax_gate
    except ImportError:
        run_syntax_gate = None

logger = logging.getLogger("acsa.agent_loop")


@dataclass
class AgentStep:
    name: str
    detail: str
    status: str  # "pending" | "running" | "done" | "failed"
    tool_name: Optional[str] = None
    arguments: Optional[dict[str, Any]] = None
    observation: Optional[str] = None
    elapsed_s: float = 0.0


def generate_execution_plan(
    user_request: str,
    project_root: str,
    repo_map: str,
    llm_caller: Callable[[str, Optional[str]], Optional[str]],
) -> list[str]:
    """Generate a structured milestone checklist before launching the ReAct loop."""
    default_steps = [
        "1. Locate relevant components and code landmarks",
        "2. Read target lines and surrounding context",
        "3. Apply surgical edits to files on disk",
        "4. Run syntax verification and compile checks",
    ]

    req_lower = user_request.lower().strip()
    # If the user request is a focused/conversational tweak or revision, skip the planner call
    is_conversational_or_short = (
        req_lower.startswith(("no", "don't", "stop", "fix", "undo", "remove", "delete", "change", "rename", "update", "just", "replace"))
        or len(user_request.strip()) < 140
    )
    if is_conversational_or_short and not any(kw in req_lower for kw in ("architecture", "microservice", "scaffold", "full-stack", "new project")):
        return default_steps

    planner_sys = (
        "You are an expert lead software architect. Given the user's objective and repository context, "
        "produce a concise 2-3 step execution plan focusing purely on code changes inside the workspace.\n"
        "CRITICAL RULES:\n"
        "- Do NOT include git commit, git push, staging, or version control operations in the plan.\n"
        "- Never propose repo-wide rewrites or repository deletions for specific localized requests.\n"
        "Format strictly as a numbered list:\n"
        "1. Step one\n"
        "2. Step two\n"
        "Do not include conversational text or explanations."
    )
    plan_prompt = (
        f"Repository Architecture:\n{repo_map[:2000]}\n\n"
        f"User Objective: {user_request}\n\n"
        "Generate a 2-3 step execution plan:"
    )
    try:
        raw_plan = llm_caller(plan_prompt, planner_sys)
        if raw_plan:
            steps = []
            for line in raw_plan.splitlines():
                clean_line = line.strip()
                if re.match(r"^\d+\.\s+", clean_line):
                    # Filter out any hallucinated git / version control steps
                    if not any(w in clean_line.lower() for w in ("git", "commit", "push", "stage", "repository-wide")):
                        steps.append(clean_line)
            if steps:
                return steps[:3]
    except Exception as exc:
        logger.debug("Planner generation skipped/failed: %s", exc)

    return default_steps


@dataclass
class AgentResult:
    success: bool
    answer: str
    edited_files: list[str] = field(default_factory=list)
    steps: list[AgentStep] = field(default_factory=list)
    total_rounds: int = 0
    elapsed_s: float = 0.0


def build_repo_map(project_root: str, max_files: int = 45) -> str:
    """Build a concise, token-budgeted Repository Architecture Map from .acsa/index.json or directory scan.
    
    Similar to Aider's Tree-Sitter RepoMap, this gives the model instant visibility into key files,
    their locations, and their exported components and functions so it never needs to blindly
    search or list directories.
    """
    root = Path(project_root).resolve()
    index_file = root / ".acsa" / "index.json"

    if not index_file.exists():
        try:
            from project_indexer import index_entire_project
            index_entire_project(str(root))
        except Exception:
            pass

    lines = ["### REPOSITORY ARCHITECTURE MAP:"]

    if index_file.exists():
        try:
            data = json.loads(index_file.read_text(encoding="utf-8"))
            profile = data.get("profile", {})
            architecture = data.get("architecture", {})
            landmarks = data.get("landmarks", {})
            files_dict = data.get("files", {})

            is_greenfield = profile.get("mode") == "greenfield" or not files_dict
            archetype = profile.get("archetype", "Generic Software Project")
            frameworks = ", ".join(profile.get("frameworks", [])) or "None"

            lines.append(f"- Project Archetype: {archetype}")
            lines.append(f"- Frameworks / Tooling: {frameworks}")

            if is_greenfield:
                lines.append("\n[PROJECT MODE: Greenfield (Blank Directory)]")
                lines.append("- No source files currently exist in this workspace.")
                lines.append("- Recommended Workflow:")
                lines.append("  1. Use `write_file` to scaffold configuration manifests (e.g. package.json or pyproject.toml).")
                lines.append("  2. Use `write_file` to create the application entrypoint.")
                lines.append("  3. As files are written, they will be automatically indexed into the architecture map.")
                return "\n".join(lines)

            # Dynamic Landmarks Guide
            lines.append("\n### DYNAMIC ARCHITECTURAL LANDMARKS:")
            nav_lm = landmarks.get("navigation")
            if nav_lm and isinstance(nav_lm, dict):
                lines.append(f"- Navigation / Header Landmark: {nav_lm.get('file')} (Lines {nav_lm.get('line_range')}) [{nav_lm.get('description')}]")

            foot_lm = landmarks.get("footer_status")
            if foot_lm and isinstance(foot_lm, dict):
                lines.append(f"- Status / Footer Landmark: {foot_lm.get('file')} (Lines {foot_lm.get('line_range')}) [{foot_lm.get('description')}]")

            routing_lm = landmarks.get("routing", [])
            if routing_lm and isinstance(routing_lm, list):
                route_files = [r.get("file") for r in routing_lm[:3] if r.get("file")]
                if route_files:
                    lines.append(f"- Routing & Endpoints: {', '.join(route_files)}")

            state_lm = landmarks.get("state_data", [])
            if state_lm and isinstance(state_lm, list):
                state_files = [s.get("file") for s in state_lm[:3] if s.get("file")]
                if state_files:
                    lines.append(f"- State Stores & Data Models: {', '.join(state_files)}")

            # Universal File Ranking
            entrypoint_files = set(architecture.get("entrypoints", []))

            def sort_key(item):
                p = item[0]
                if p in entrypoint_files:
                    return (0, p)
                ext = Path(p).suffix.lower()
                if ext in (".tsx", ".jsx", ".ts", ".js", ".py", ".go", ".rs", ".vue", ".svelte"):
                    return (1, len(Path(p).parts), p)
                return (2, len(Path(p).parts), p)

            sorted_files = sorted(files_dict.items(), key=sort_key)
            lines.append("\n### KEY FILES & EXPORTED SYMBOLS:")
            count = 0
            for rel_path, file_data in sorted_files:
                if any(ig in rel_path for ig in [".git", "node_modules", "dist", "build", ".venv", "__pycache__"]):
                    continue
                syms = file_data.get("symbols", [])
                sym_names = [s.get("name") for s in syms if s.get("kind") in ("function", "class", "interface", "method", "component") and not s.get("name", "").startswith("_")][:4]
                sym_str = f" -> exports: {', '.join(sym_names)}" if sym_names else ""
                lines.append(f"- {rel_path}{sym_str}")
                count += 1
                if count >= max_files:
                    break
        except Exception as exc:
            lines.append(f"(Error reading architecture index: {exc})")

    return "\n".join(lines)


SYSTEM_PROMPT_TEMPLATE = """You are ACSA Agent, an autonomous expert coding assistant embedded directly inside the user's IDE.
You have DIRECT ACCESS to the user's project workspace through tools.
You do NOT guess file contents or line numbers. You actively inspect, search, read, edit, and verify code using your tools.

{repo_map}

### AVAILABLE TOOLS
{tool_schemas_json}

### TOOL CALL PROTOCOL
To use a tool, output a single tool call block using either of these formats:

Format A (XML tag - Recommended):
<tool_call>
<invoke name="tool_name">
<parameter name="arg1">val1</parameter>
</invoke>
</tool_call>

Or with JSON inside <tool_call>:
<tool_call>
{{"name": "tool_name", "parameters": {{"arg1": "val1"}}}}
</tool_call>

Format B (JSON block):
```json
{{"tool": "tool_name", "args": {{"arg1": "val1"}}}}
```

### OPERATIONAL RULES
1. INVESTIGATE FIRST: Check the REPOSITORY ARCHITECTURE MAP and LANDMARKS GUIDE above. Use `locate_concept` or `grep_search` to locate relevant code before attempting edits.
2. READ BEFORE EDITING: Call `read_file` to view the exact lines surrounding your intended change.
3. SURGICAL EDITS: When calling `edit_file`, ensure your `search` block matches the exact existing lines (including indentation and newlines) found via `read_file`.
4. CHECK ALL OCCURRENCES: If the user requests a change across the project (e.g. renaming a variable, endpoint, or component), search for all occurrences to maintain consistency across the codebase.
5. DESCRIPTIVE LABELS: When rendering counts, metrics, or telemetry in UI components, always include clear contextual labels or units (e.g. 'Total: {{count}}' or '{{count}} items') rather than rendering an isolated number.
6. VERIFY: After making edits, call `run_command` with the appropriate build or test command (e.g. `npm test`, `cargo check`, `pytest`, or build commands) to verify that code compiles cleanly.
7. COMPLETION: Once all edits are complete and verified, output your final explanation to the user WITHOUT any further tool calls.
8. DO NOT REPEAT YOURSELF: If your tool call fails or you see "Error:", read the error carefully. Do not repeat the exact same tool call again. Stop and adjust your approach.
9. COMPLETE DELETION VS. PLACEHOLDER SUBSTITUTION:
When instructed to remove, delete, drop, or omit a code element, text, attribute, or function:
- Completely excise the target construct from the source code.
- NEVER substitute placeholder text, dummy variables, or generic renamed strings. "Remove" means complete elimination, not renaming or placeholder substitution.
- Preserve container hierarchy: when excising a target entity situated inside a parent container alongside sibling nodes, preserve the parent container and adjacent siblings intact, removing only the targeted entity.
- When instructed to remove one item while keeping another that already exists, excise only the designated item without re-adding or duplicating existing elements.
10. DO NOT CYCLE READ/LOCATE TOOLS:
Once you have called `read_file` and see the target code in your context, DO NOT call `read_file` or `locate_concept` again. Your immediate next action MUST be to call `edit_file` to execute the modification on disk.
11. SENSITIVE COMMANDS & USER PERMISSION:
Commands that alter version control (git commit, git push, git add, git checkout, git reset) or publish packages require interactive user authorization. When you invoke these operations, the IDE will prompt the developer to Approve & Run or Reject the action. If the user declines permission, respect their decision immediately and continue with your analysis or final explanation without re-invoking the command.
12. HYBRID FOREMAN-TRADESMAN DELEGATION:
When orchestrating multi-file refactors or complex code generation, you may call `delegate_to_local_worker` with `target_file`, `instruction`, and optional contract `context`. The local tradesman worker executes the surgical edit in an isolated, hardware-safe environment ($0 token cost) and returns the verified edit.
13. AUTONOMOUS ACTION (NO PASSIVE CONFIRMATION):
You are an autonomous execution agent with full pre-approval to inspect and edit files in the workspace to fulfill the user's objective.
NEVER say "Please confirm and I will make the change now", "Let me know if you would like me to proceed", or ask the user for permission to proceed with code edits.
PROCEED IMMEDIATELY to inspect target files with `read_file` or `locate_concept`, and execute the requested modifications directly on disk using `edit_file`.

Project Root: {project_root}
{active_file_info}
"""


def _extract_json_tool_objects(text: str) -> list[dict[str, Any]]:
    """Robustly extract JSON objects containing 'tool' or 'name' using standard json decoder."""
    decoder = json.JSONDecoder()
    objects = []
    idx = 0
    while idx < len(text):
        if text[idx] == "{":
            try:
                obj, end = decoder.raw_decode(text[idx:])
                if isinstance(obj, dict) and ("tool" in obj or "name" in obj):
                    objects.append(obj)
                    idx += end
                    continue
            except Exception:
                pass
        idx += 1
    return objects


def _clean_extracted_path(raw: str) -> str:
    """Robustly clean file paths extracted from LLM output (strip brackets, markdown, colons)."""
    if not raw:
        return ""
    p = raw.strip()
    p = re.sub(r"^[#*`\s]+", "", p)
    p = re.sub(r"[#*`:\s]+$", "", p)
    if p.startswith("[") and p.endswith("]"):
        p = p[1:-1].strip()
    p = p.strip("`'\" \t\n[]:*#")
    if p.startswith("a/") or p.startswith("b/"):
        p = p[2:]
    return p.strip()


def _parse_xml_param_value(val_str: str, param_name: str = "") -> Any:
    """Safely coerce parameter values from XML strings."""
    if param_name in ("search", "replace", "patch", "content", "code"):
        val = val_str
        if val.startswith("\n") and val.endswith("\n") and len(val) > 2:
            val = val[1:-1]
        return val

    s = val_str.strip()
    cdata_match = re.match(r"^<!\[CDATA\[([\s\S]*?)\]\]>$", s)
    if cdata_match:
        s = cdata_match.group(1).strip()

    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    if s.lower() in ("null", "none"):
        return None

    if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
        try:
            return json.loads(s)
        except Exception:
            pass

    if re.fullmatch(r"-?\d+", s):
        try:
            return int(s)
        except Exception:
            pass
    elif re.fullmatch(r"-?\d+\.\d+", s):
        try:
            return float(s)
        except Exception:
            pass

    return s


def _extract_params_from_xml_body(body: str) -> dict[str, Any]:
    """Extract tool arguments from an XML tool invoke body."""
    params: dict[str, Any] = {}
    stripped = body.strip()

    # 1. Embedded JSON candidate
    json_candidate = stripped
    if json_candidate.startswith("```"):
        json_candidate = re.sub(r"^```(?:json)?\s*", "", json_candidate)
        json_candidate = re.sub(r"\s*```$", "", json_candidate)
    if json_candidate.startswith("{") and json_candidate.endswith("}"):
        try:
            parsed = json.loads(json_candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    # 2. <parameter name="key">value</parameter> or <arg name="key">value</arg>
    param_tag_pattern = re.compile(
        r"<(?:parameter|arg|argument)\s+name=[\"']?([A-Za-z0-9_]+)[\"']?\s*>([\s\S]*?)(?:</(?:parameter|arg|argument)>|$)",
        re.IGNORECASE,
    )
    for m in param_tag_pattern.finditer(body):
        pname = m.group(1).strip()
        pval = _parse_xml_param_value(m.group(2), param_name=pname)
        params[pname] = pval

    if params:
        return params

    # 3. Scope to <parameters> or <arguments> container if present
    container_match = re.search(r"<(?:parameters|arguments)>([\s\S]*?)</(?:parameters|arguments)>", body, re.IGNORECASE)
    search_scope = container_match.group(1) if container_match else body

    # 4. Direct child tags: <key>value</key>
    child_pattern = re.compile(r"<([A-Za-z0-9_]+)>([\s\S]*?)</\1>", re.IGNORECASE)
    reserved_tags = {
        "parameters", "arguments", "invoke", "function_call", "call", "action", "tool_call",
        "name", "tool_name", "tool", "thought", "thinking"
    }
    for m in child_pattern.finditer(search_scope):
        tag = m.group(1).strip()
        if tag.lower() not in reserved_tags:
            params[tag] = _parse_xml_param_value(m.group(2), param_name=tag)

    return params


def _parse_xml_invoke_blocks(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse XML tool calls across Anthropic, DeepSeek, Qwen, and Hermes patterns."""
    calls: list[tuple[str, dict[str, Any]]] = []

    # Pattern A: <invoke name="...">, <function_call name="...">, <call name="...">, <action name="...">
    invoke_pattern = re.compile(
        r"<(?:invoke|function_call|call|action|tool)\s+name=[\"']?([A-Za-z0-9_]+)[\"']?\s*>([\s\S]*?)(?:</(?:invoke|function_call|call|action|tool)>|$)",
        re.IGNORECASE,
    )
    for m in invoke_pattern.finditer(text):
        tool_name = m.group(1).strip()
        raw_args = _extract_params_from_xml_body(m.group(2))
        norm_args = agent_tools.normalize_tool_arguments(tool_name, raw_args)
        calls.append((tool_name, norm_args))

    # Pattern B: <tool_call name="...">...</tool_call>
    tool_call_named = re.compile(
        r"<tool_call\s+name=[\"']?([A-Za-z0-9_]+)[\"']?\s*>([\s\S]*?)(?:</tool_call>|$)",
        re.IGNORECASE,
    )
    for m in tool_call_named.finditer(text):
        tool_name = m.group(1).strip()
        raw_args = _extract_params_from_xml_body(m.group(2))
        norm_args = agent_tools.normalize_tool_arguments(tool_name, raw_args)
        calls.append((tool_name, norm_args))

    # Pattern C: <tool_call><tool_name>name</tool_name>...</tool_call>
    child_named = re.compile(
        r"<(?:tool_call|invoke|function_call)>\s*<(?:tool_name|name|tool)>([A-Za-z0-9_]+)</(?:tool_name|name|tool)>([\s\S]*?)(?:</(?:tool_call|invoke|function_call)>|$)",
        re.IGNORECASE,
    )
    for m in child_named.finditer(text):
        tool_name = m.group(1).strip()
        raw_args = _extract_params_from_xml_body(body=m.group(2))
        norm_args = agent_tools.normalize_tool_arguments(tool_name, raw_args)
        calls.append((tool_name, norm_args))

    # Pattern D: <tool_call><grep_search><query>...</query></grep_search></tool_call>
    for tc_match in re.finditer(r"<tool_call>([\s\S]*?)(?:</tool_call>|$)", text, re.IGNORECASE):
        tc_body = tc_match.group(1).strip()
        for reg_tool in agent_tools.TOOL_REGISTRY.keys():
            tool_tag_match = re.search(rf"<{reg_tool}\b[^>]*>([\s\S]*?)(?:</{reg_tool}>|$)", tc_body, re.IGNORECASE)
            if tool_tag_match:
                raw_args = _extract_params_from_xml_body(tool_tag_match.group(1))
                norm_args = agent_tools.normalize_tool_arguments(reg_tool, raw_args)
                calls.append((reg_tool, norm_args))

    return calls


def _parse_all_tool_calls(response_text: str, fallback_file: Optional[str] = None) -> list[tuple[str, dict[str, Any]]]:
    """Extract all tool calls from various model output formats (SEARCH/REPLACE, Unified Diffs, JSON codeblocks, XML, ReAct)."""
    calls: list[tuple[str, dict[str, Any]]] = []

    # 1. Multi-format SEARCH/REPLACE blocks (handles [path], path:, **path**, `path`, File: path, etc.)
    sr_pattern = re.compile(
        r"(?:^|\n)(?:[#*`\s]*)(?:(?:File|path|Target)?:\s*)?\[?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+)\]?[:*#`\s]*\n"
        r"<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n={5,9}\s*\n([\s\S]*?)\n>{5,9}\s*REPLACE"
    )
    for sr_match in sr_pattern.finditer(response_text):
        fpath = _clean_extracted_path(sr_match.group(1))
        search_chunk = sr_match.group(2)
        replace_chunk = sr_match.group(3)
        if fallback_file and (any(fpath.startswith(pfx) for pfx in ("path/to/", "file.", "example.", "target.", "src/path/to/")) or not fpath):
            fpath = fallback_file
        args = agent_tools.normalize_tool_arguments("edit_file", {"path": fpath, "search": search_chunk, "replace": replace_chunk})
        calls.append(("edit_file", args))

    # 2. Unified Git Diffs (diff --git a/... b/... or --- a/... +++ b/...)
    diff_pattern = re.compile(
        r"(?:^|\n)diff\s+--git\s+[ab]/(\S+)\s+[ab]/(\S+)\n"
        r"(?:index\s+[0-9a-fA-F.]+\s*\n)?"
        r"(?:---\s+(?:[ab]/)?(.+?)\n)?"
        r"(?:\+\+\+\s+(?:[ab]/)?(.+?)\n)?"
        r"([\s\S]+?)"
        r"(?=\n\s*(?:diff\s+--git|\[|<{5,9})|\Z)"
    )
    for diff_match in diff_pattern.finditer(response_text):
        fpath = _clean_extracted_path(diff_match.group(2) or diff_match.group(1))
        diff_body = diff_match.group(5)
        raw_patch = f"--- a/{fpath}\n+++ b/{fpath}\n{diff_body}"
        args = agent_tools.normalize_tool_arguments("edit_file", {"path": fpath, "patch": raw_patch})
        calls.append(("edit_file", args))

    # 3. Native XML Tool Calls & Invokes (<invoke name="...">, <function_call>, <tool_call name="...">)
    calls.extend(_parse_xml_invoke_blocks(response_text))

    # 4. XML Tool Calls: <tool_call> ... </tool_call> with JSON body
    for xml_match in re.finditer(r"<tool_call>([\s\S]*?)(?:</tool_call>|$)", response_text, re.IGNORECASE):
        content = xml_match.group(1).strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        try:
            parsed = json.loads(content)
            name = parsed.get("name") or parsed.get("tool")
            raw_args = parsed.get("parameters") or parsed.get("args") or {}
            if name:
                norm_args = agent_tools.normalize_tool_arguments(str(name), raw_args)
                calls.append((str(name), norm_args))
        except Exception:
            pass

    # 5. JSON code blocks and inline JSON objects
    for obj in _extract_json_tool_objects(response_text):
        name = obj.get("tool") or obj.get("name")
        raw_args = obj.get("args") or obj.get("parameters") or {}
        if name:
            norm_args = agent_tools.normalize_tool_arguments(str(name), raw_args)
            calls.append((str(name), norm_args))

    # 6. Action: ... Action Input: ...
    for react_match in re.finditer(r"Action:\s*([A-Za-z0-9_]+)\s*\nAction Input:\s*(\{[\s\S]*?\})", response_text):
        name = react_match.group(1).strip()
        try:
            raw_args = json.loads(react_match.group(2).strip())
            norm_args = agent_tools.normalize_tool_arguments(name, raw_args)
            calls.append((name, norm_args))
        except Exception:
            pass

    # Deduplicate while preserving execution order
    seen = set()
    unique_calls: list[tuple[str, dict[str, Any]]] = []
    for name, args in calls:
        try:
            sig = (name, json.dumps(args, sort_keys=True))
        except Exception:
            sig = (name, str(args))
        if sig not in seen:
            seen.add(sig)
            unique_calls.append((name, args))

    return unique_calls


def is_mutation_request(user_request: str) -> bool:
    """Determine if user's prompt is requesting code changes / file modifications."""
    req_lower = user_request.lower().strip()
    pure_qa_prefixes = (
        "what is", "where is", "where are", "how does", "why does", "explain",
        "describe", "tell me about", "can you explain", "who is",
    )
    if any(req_lower.startswith(prefix) for prefix in pure_qa_prefixes) and not any(
        w in req_lower for w in ["and fix", "and change", "and remove", "and update", "and replace", "and move"]
    ):
        return False

    mutation_keywords = [
        "remove", "delete", "change", "update", "replace", "modify",
        "add", "insert", "create", "fix", "repair", "refactor", "rename",
        "implement", "hide", "show", "display", "set", "switch", "toggle",
        "adjust", "clean", "extract", "move", "sync", "instead of",
        "limit", "bound", "restrict", "clamp", "put", "place",
        "align", "relocate", "reposition", "style", "wire", "hook",
    ]
    if any(re.search(r"\b" + re.escape(w) + r"\b", req_lower) for w in mutation_keywords):
        return True

    # Normative and directional phrasing
    normative_patterns = [
        r"should\s+be",
        r"needs?\s+to(?:\s+be)?",
        r"must\s+be",
        r"ought\s+to",
        r"instead\s+of",
        r"not\s+above",
        r"under\s+(?:the\s+)?message",
        r"below\s+(?:the\s+)?message",
        r"under\s+not\s+above",
    ]
    return any(re.search(pat, req_lower) for pat in normative_patterns)


def _clean_thought_text(raw_text: str) -> str:
    """Strip out <tool_call>, diff blocks, and SEARCH/REPLACE blocks to leave only thinking / explanation text."""
    # 1. Strip <think>...</think> blocks (used by DeepSeek / Qwen reasoning models)
    cleaned = re.sub(r"<think>[\s\S]*?(?:</think>|$)", "", raw_text, flags=re.IGNORECASE)
    # 2. Strip <tool_call>...</tool_call>
    cleaned = re.sub(r"<tool_call>[\s\S]*?(?:</tool_call>|$)", "", cleaned, flags=re.IGNORECASE)
    # 3. Strip loose <invoke>...</invoke>, <function_call>...</function_call>, <call>, <action>, etc.
    cleaned = re.sub(r"<(?:invoke|function_call|call|action|tool)\b[\s\S]*?(?:</(?:invoke|function_call|call|action|tool)>|$)", "", cleaned, flags=re.IGNORECASE)
    # 4. Strip loose <parameter> tags
    cleaned = re.sub(r"<(?:parameter|arg|argument)\b[\s\S]*?(?:</(?:parameter|arg|argument)>|$)", "", cleaned, flags=re.IGNORECASE)
    # 5. Strip JSON tool codeblocks
    cleaned = re.sub(r"```(?:json)?\s*\{\s*\"(?:tool|name)\"[\s\S]*?\}\s*```", "", cleaned, flags=re.IGNORECASE)
    # 6. Strip Action: / Action Input:
    cleaned = re.sub(r"Action:\s*[A-Za-z0-9_]+\s*\nAction Input:\s*\{[\s\S]*?\}", "", cleaned)
    # 7. Strip SEARCH/REPLACE blocks (including bracketed [path], etc.)
    cleaned = re.sub(
        r"(?:^|\n)(?:[#*`\s]*)(?:(?:File|path|Target)?:\s*)?\[?[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+\]?[:*#`\s]*\n"
        r"<{5,9}\s*SEARCH[\s\S]*?>{5,9}\s*REPLACE",
        "",
        cleaned,
    )
    # 8. Strip unified git diff blocks
    cleaned = re.sub(
        r"(?:^|\n)diff\s+--git[\s\S]*?(?=\n(?:[A-Z#*`]|diff\s+--git|$|\Z))",
        "",
        cleaned,
    )
    # 9. Clean dangling closing tags
    cleaned = re.sub(r"</(?:tool_call|invoke|function_call|call|action|parameter|arg|argument|think)>", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def run_agent_loop(
    user_request: str,
    project_root: str,
    llm_caller: Callable[..., Optional[str]],
    active_file: Optional[str] = None,
    reporter: Optional[Callable[[str, str, str], None]] = None,
    chunk_streamer: Optional[Callable[[str], None]] = None,
    max_iterations: int = 8,
    conversation_history: Optional[list[dict[str, str]]] = None,
    initial_context: Optional[dict[str, str]] = None,
    images: Optional[list[str]] = None,
) -> AgentResult:
    """Execute the autonomous ReAct agent loop with direct tools and multi-turn memory."""
    start_time = time.monotonic()
    report = reporter or (lambda name, detail, status: None)
    stream = chunk_streamer or (lambda chunk: None)

    active_file_info = f"Currently Open/Focused File in Editor: {active_file}" if active_file else ""
    repo_map = build_repo_map(project_root)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        repo_map=repo_map,
        tool_schemas_json=json.dumps(agent_tools.TOOL_SCHEMAS, indent=2),
        project_root=project_root,
        active_file_info=active_file_info,
    )

    history: list[dict[str, str]] = []

    # Seed with multi-turn conversation memory if available
    if conversation_history:
        for prev_msg in conversation_history:
            role = prev_msg.get("role", "user")
            content = prev_msg.get("content", "")
            if content and role in ("user", "assistant"):
                history.append({"role": role, "content": content})

    # Generate execution plan for the objective
    plan_steps = generate_execution_plan(user_request, project_root, repo_map, llm_caller)

    # Prepare initial task prompt, augmenting with any pre-loaded file contexts, image notice, and plan
    plan_text = "\n".join(plan_steps)
    task_content = f"Task: {user_request}\n\n### ACTIVE EXECUTION PLAN:\n{plan_text}\n"
    if images:
        task_content += f"\n[Visual Context: User attached {len(images)} reference image(s)/screenshot(s) to this request]\n"
    if initial_context:
        ctx_lines = ["\n[Pre-loaded Relevant File Contexts]:"]
        for cpath, ctext in list(initial_context.items())[:3]:
            if cpath.startswith("[Git"):
                continue
            ctx_lines.append(f"File: {cpath}\n```\n{ctext[:1500]}\n```")
        if len(ctx_lines) > 1:
            task_content += "\n" + "\n".join(ctx_lines)

    history.append({"role": "user", "content": task_content})

    steps: list[AgentStep] = []
    edited_files: set[str] = set()
    final_answer = ""
    recent_read_path: Optional[str] = None
    executed_read_calls: dict[str, int] = {}

    for round_idx in range(1, max_iterations + 1):
        # Build prompt from conversation history
        prompt_parts = ["Below is the conversation history and observations:\n"]
        for msg in history:
            role = msg["role"].upper()
            content = msg["content"]
            prompt_parts.append(f"\n--- {role} ---\n{content}\n")

        prompt_parts.append("\n--- ASSISTANT ---\n")
        full_prompt = "".join(prompt_parts)

        # Call LLM (forward images on turn 1 if present)
        round_images = images if (round_idx == 1 and images) else None
        try:
            if round_images:
                response = llm_caller(full_prompt, system_prompt, imgs=round_images)
            else:
                response = llm_caller(full_prompt, system_prompt)
        except TypeError:
            try:
                response = llm_caller(full_prompt, system_prompt, round_images)
            except TypeError:
                response = llm_caller(full_prompt, system_prompt)
        if not response:
            break

        thought_text = _clean_thought_text(response)
        tool_calls = _parse_all_tool_calls(response, fallback_file=recent_read_path)

        # Stream clean model thought to reasoning accordion if present
        if thought_text:
            try:
                sys.stdout.write(f"@@THOUGHT@@{json.dumps(thought_text + '\n\n')}\n")
                sys.stdout.flush()
            except Exception:
                pass
        else:
            try:
                sys.stdout.write(f"@@THOUGHT@@{json.dumps('\n\n')}\n")
                sys.stdout.flush()
            except Exception:
                pass

        # Check if model wants to call tools
        if tool_calls:
            round_observations: list[str] = []
            missing_paths_in_turn: set[str] = set()

            for tool_name, tool_args in tool_calls:
                # Normalize arguments
                norm_args = agent_tools.normalize_tool_arguments(tool_name, tool_args)
                tool_func = agent_tools.TOOL_REGISTRY.get(tool_name)

                if not tool_func:
                    obs = f"Error: Tool '{tool_name}' does not exist. Available tools: {list(agent_tools.TOOL_REGISTRY.keys())}"
                    round_observations.append(obs)
                    continue

                target_p = str(norm_args.get("path") or norm_args.get("file") or "").strip()

                # Auto-resolve placeholder/unfound path for edit tools if a file was recently read
                if tool_name in ("edit_file", "patch", "replace_file_content", "modify_file"):
                    if (any(target_p.startswith(pfx) for pfx in ("path/to/", "file.", "example.", "target.", "src/path/to/")) or not (Path(project_root) / target_p).exists()) and recent_read_path and (Path(project_root) / recent_read_path).exists():
                        logger.info("Auto-resolving placeholder edit path '%s' to recently read file '%s'", target_p, recent_read_path)
                        target_p = recent_read_path
                        norm_args["path"] = recent_read_path

                TOOL_DISPLAY_NAMES = {
                    "read_file": "Read File",
                    "edit_file": "Edit File",
                    "write_file": "Write File",
                    "patch": "Edit File",
                    "replace_file_content": "Edit File",
                    "modify_file": "Edit File",
                    "grep_search": "Search Codebase",
                    "find_files": "Find Files",
                    "list_dir": "List Directory",
                    "execute_command": "Run Command",
                    "locate_concept": "Locate Symbol",
                    "delegate_to_local_worker": "Delegate to Worker",
                }
                display_name = TOOL_DISPLAY_NAMES.get(tool_name, tool_name.replace('_', ' ').title())

                # If this is an edit tool and the file was already confirmed missing in this turn, skip it
                if tool_name in ("edit_file", "patch", "replace_file_content", "modify_file") and target_p and target_p in missing_paths_in_turn:
                    obs = f"Skipped {tool_name} on '{target_p}': Target file was confirmed not to exist. Please review the directory/landmark guidance above and call edit_file on the correct file."
                    round_observations.append(obs)
                    report(display_name, f"Skipped (missing: {target_p})", "failed")
                    continue

                # Format human-friendly step detail
                arg_summary = ""
                if "query" in norm_args:
                    arg_summary = f"Searching for '{norm_args['query']}'"
                elif "path" in norm_args:
                    arg_summary = f"{norm_args['path']}"
                    if "start_line" in norm_args and "end_line" in norm_args:
                        arg_summary += f":{norm_args['start_line']}-{norm_args['end_line']}"
                elif "pattern" in norm_args:
                    arg_summary = f"Glob '{norm_args['pattern']}'"
                elif "command" in norm_args:
                    arg_summary = f"`{norm_args['command']}`"
                elif "concept" in norm_args:
                    arg_summary = f"Locating '{norm_args['concept']}'"
                else:
                    arg_summary = str(norm_args)[:60]

                step_name = display_name
                report(step_name, arg_summary, "running")

                # Global duplicate call prevention (prevents alternating ping-pong loops)
                call_sig = f"{tool_name}:{json.dumps(norm_args, sort_keys=True)}"
                is_duplicate = False

                if tool_name in ("read_file", "locate_concept", "grep_search", "list_dir", "find_files"):
                    if call_sig in executed_read_calls:
                        is_duplicate = True
                    else:
                        executed_read_calls[call_sig] = round_idx
                elif len(steps) > 0 and steps[-1].tool_name == tool_name and steps[-1].arguments == norm_args:
                    is_duplicate = True

                tool_start = time.monotonic()
                if is_duplicate:
                    prev_round = executed_read_calls.get(call_sig, max(1, round_idx - 1))
                    observation = (
                        f"[DUPLICATE TOOL CALL PREVENTED]: You already executed `{tool_name}` with these exact parameters in turn {prev_round}.\n"
                        f"The requested code and context are ALREADY in your context history above!\n"
                        f"DO NOT repeat read or locate calls. Your next required action is to call `edit_file` to execute your modifications directly on disk."
                    )
                else:
                    try:
                        observation = tool_func(project_root=project_root, **norm_args)
                    except TypeError:
                        try:
                            observation = tool_func(project_root, **norm_args)
                        except Exception as exc:
                            observation = f"Error calling {tool_name}: {exc}"
                    except Exception as exc:
                        observation = f"Error executing {tool_name}: {exc}"

                if "does not exist" in observation and target_p:
                    missing_paths_in_turn.add(target_p)

                tool_elapsed = round(time.monotonic() - tool_start, 2)

                # Record edited files & run In-Loop Syntax Verification (Reflexion)
                if (
                    (tool_name in ("edit_file", "patch", "replace_file_content", "modify_file") and "Success" in observation)
                    or (tool_name in ("write_file", "create_file", "new_file") and "Successfully wrote" in observation)
                    or (tool_name in ("delegate_to_local_worker", "local_worker", "delegate") and "[SUCCESS]" in observation)
                ):
                    target_p = norm_args.get("path") or norm_args.get("target_file") or ""
                    if target_p:
                        edited_files.add(target_p)
                        target_abs = str((Path(project_root) / target_p).resolve())
                        if run_syntax_gate and Path(target_abs).exists():
                            try:
                                gate_rep = run_syntax_gate([target_abs], cwd=project_root)
                                if gate_rep.total_errors > 0:
                                    all_diags = []
                                    for lr in gate_rep.linter_results:
                                        all_diags.extend(lr.diagnostics)
                                    diag_lines = [
                                        f"  - L{d.line}:{d.column} [{d.severity.value if hasattr(d.severity, 'value') else d.severity}]: {d.message} ({d.source})"
                                        for d in all_diags[:6]
                                    ]
                                    observation += (
                                        f"\n\n[SYNTAX VERIFICATION WARNING]: File updated, but {gate_rep.total_errors} syntax error(s) were detected:\n"
                                        + "\n".join(diag_lines)
                                        + "\nYou MUST fix these syntax errors before completing the task. Call edit_file to correct the code."
                                    )
                                    report("Syntax Gate", f"Detected {gate_rep.total_errors} error(s) in {target_p} — requesting correction", "failed")
                                else:
                                    observation += "\n[SYNTAX VERIFICATION PASSED]: 0 syntax errors detected."
                                    report("Syntax Gate", f"PASSED — 0 syntax errors in {target_p}", "done")
                            except Exception as g_err:
                                logger.warning("In-loop syntax gate check error: %s", g_err)

                # Status determination
                is_err = observation.startswith("Error") or "FAILED" in observation or "[SYNTAX VERIFICATION WARNING]" in observation
                status = "failed" if is_err else "done"
                status_desc = f"Completed in {tool_elapsed}s" if not is_err else "Failed"
                report(step_name, f"{arg_summary} ({status_desc})", status)

                steps.append(
                    AgentStep(
                        name=step_name,
                        detail=arg_summary,
                        status=status,
                        tool_name=tool_name,
                        arguments=norm_args,
                        observation=observation[:500],
                        elapsed_s=tool_elapsed,
                    )
                )

                # Append guidance to observation for proactive model orientation
                if tool_name == "read_file" and not is_err:
                    recent_read_path = target_p
                    if is_mutation_request(user_request):
                        observation += (
                            f"\n\n[Harness Guidance]: Target lines loaded above from '{target_p}'. "
                            f"Proceed immediately to invoke `edit_file` on '{target_p}' with exact 'search' lines from above and your desired 'replace' lines (or empty if deleting)."
                        )
                elif tool_name == "locate_concept" and not is_err and is_mutation_request(user_request):
                    observation += (
                        f"\n\n[Harness Guidance]: Landmark located. Next call `read_file` to inspect the exact lines around the target, then apply surgical edits with `edit_file`."
                    )

                round_observations.append(f"Observation from {tool_name}:\n{observation}")

            # Append assistant message and combined observations to history
            history.append({"role": "assistant", "content": response})
            combined_obs = "\n\n".join(round_observations)

            # If all tools in the turn were read-only and mutations are needed, inject a clear forward directive
            if is_mutation_request(user_request) and len(edited_files) == 0:
                all_read = all(t[0] in ("read_file", "locate_concept", "grep_search", "find_files", "list_dir") for t in tool_calls)
                if all_read:
                    combined_obs += (
                        "\n\n[CRITICAL DIRECTIVE]: You have completed the read/investigation phase. "
                        "In your next turn, you MUST call `edit_file` to execute the necessary file modifications on disk. "
                        "Do NOT call read or locate tools again."
                    )

            capped_obs = combined_obs if len(combined_obs) <= 4000 else combined_obs[:3800] + "\n... [truncated]"
            history.append({"role": "user", "content": capped_obs})

        else:
            # No tool call made
            has_unparsed_tool_markup = bool(
                re.search(r"<(?:tool_call|invoke|function_call|call|action)\b", response, re.IGNORECASE)
                or re.search(r"<{5,9}\s*SEARCH", response)
                or re.search(r"Action:\s*[A-Za-z0-9_]+\s*\nAction Input:", response)
            )

            is_passive_refusal = any(
                w in response.lower() for w in (
                    "please confirm", "let me know if you", "confirm and i", "would you like me to",
                    "shall i proceed", "do you want me to", "if you'd like me to", "before making changes",
                    "let me know if this sounds good", "would you like me to go ahead",
                )
            )

            # If the model attempted an unparseable tool call, give it an opportunity to fix it
            if has_unparsed_tool_markup and round_idx < max_iterations:
                history.append({"role": "assistant", "content": response})
                history.append({
                    "role": "user",
                    "content": (
                        "Observation:\n"
                        "Your tool invocation could not be parsed or was incomplete.\n"
                        "Please call the tool using either:\n"
                        "<tool_call>\n"
                        '<invoke name="tool_name">\n'
                        '<parameter name="arg1">value1</parameter>\n'
                        '</invoke>\n'
                        "</tool_call>\n"
                        "or provide your final answer directly."
                    ),
                })
                continue

            # If user requested a code change or model asks for permission, but no files were edited
            if (is_mutation_request(user_request) or is_passive_refusal) and len(edited_files) == 0 and round_idx < max_iterations:
                history.append({"role": "assistant", "content": response})
                history.append({
                    "role": "user",
                    "content": (
                        "Observation:\n"
                        "You discussed the changes or asked for confirmation, but NO files were edited on disk!\n"
                        "As an autonomous coding agent, you have full pre-approval to edit files. Do NOT ask for confirmation.\n"
                        "Please call the `edit_file` tool now (or `read_file` first to view the exact lines) "
                        "to apply the modifications directly on disk."
                    ),
                })
                continue
            else:
                cleaned_resp = _clean_thought_text(response)
                if edited_files:
                    is_monologue_or_passive = (
                        not cleaned_resp
                        or is_passive_refusal
                        or any(cleaned_resp.lower().startswith(p) for p in ("i will", "let me", "looking at", "i need to", "reading"))
                        or bool(re.search(r"<\s*/?\s*(?:tool_call|invoke|function_call|parameter)\b", cleaned_resp, re.IGNORECASE))
                        or len(cleaned_resp.strip()) < 15
                    )
                    if is_monologue_or_passive:
                        file_bullets = "\n".join(f"- `{f}`" for f in sorted(edited_files))
                        final_answer = (
                            f"Successfully applied the requested changes to the workspace:\n\n"
                            f"{file_bullets}\n\n"
                            f"All modifications were verified and written to disk."
                        )
                    else:
                        final_answer = cleaned_resp
                else:
                    # Pure inquiry or read-only answer
                    if cleaned_resp and not has_unparsed_tool_markup:
                        final_answer = cleaned_resp
                    elif not has_unparsed_tool_markup and response.strip():
                        final_answer = response.strip()
                    else:
                        final_answer = cleaned_resp or ""

                if not final_answer:
                    if steps:
                        final_answer = f"Completed {len(steps)} steps across {round_idx} turn(s)."
                    else:
                        final_answer = "Analysis complete."

                stream(final_answer)
                break

    if not final_answer:
        if edited_files:
            file_bullets = "\n".join(f"- `{f}`" for f in sorted(edited_files))
            final_answer = (
                f"Successfully updated {len(edited_files)} file(s):\n\n"
                f"{file_bullets}\n\n"
                f"All requested modifications have been applied and verified on disk."
            )
        elif steps:
            final_answer = f"Completed {len(steps)} steps across {round_idx} turn(s)."
        else:
            final_answer = "Analysis complete."
        stream(final_answer)

    elapsed_total = round(time.monotonic() - start_time, 2)
    return AgentResult(
        success=bool(final_answer or edited_files),
        answer=final_answer,
        edited_files=list(edited_files),
        steps=steps,
        total_rounds=round_idx,
        elapsed_s=elapsed_total,
    )
