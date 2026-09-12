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
    planner_sys = (
        "You are an expert lead software architect. Given the user's objective and repository context, "
        "produce a concise 3-4 step execution plan. Each step must be a single actionable line.\n"
        "Format strictly as a numbered list:\n"
        "1. Step one\n"
        "2. Step two\n"
        "3. Step three\n"
        "Do not include conversational text or explanations."
    )
    plan_prompt = (
        f"Repository Architecture:\n{repo_map[:2000]}\n\n"
        f"User Objective: {user_request}\n\n"
        "Generate a 3-4 step execution plan:"
    )
    try:
        raw_plan = llm_caller(plan_prompt, planner_sys)
        if raw_plan:
            steps = []
            for line in raw_plan.splitlines():
                clean_line = line.strip()
                if re.match(r"^\d+\.\s+", clean_line):
                    steps.append(clean_line)
            if steps:
                return steps[:4]
    except Exception as exc:
        logger.debug("Planner generation skipped/failed: %s", exc)

    return [
        "1. Locate relevant components and code landmarks",
        "2. Read target lines and surrounding context",
        "3. Apply surgical edits to files on disk",
        "4. Run syntax verification and compile checks",
    ]


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


def _parse_all_tool_calls(response_text: str, fallback_file: Optional[str] = None) -> list[tuple[str, dict[str, Any]]]:
    """Extract all tool calls from various model output formats (SEARCH/REPLACE, JSON codeblocks, XML, ReAct)."""
    calls: list[tuple[str, dict[str, Any]]] = []

    # 1. Aider SEARCH/REPLACE blocks
    for sr_match in re.finditer(
        r"(?:^|\n)(?:(?:File|path|Target)?:\s*)?([^\n`<>]+?\.[A-Za-z0-9_]+)\s*\n"
        r"<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n={5,9}\s*\n([\s\S]*?)\n>{5,9}\s*REPLACE",
        response_text,
    ):
        fpath = sr_match.group(1).strip()
        search_chunk = sr_match.group(2)
        replace_chunk = sr_match.group(3)
        if fallback_file and (any(fpath.startswith(pfx) for pfx in ("path/to/", "file.", "example.", "target.", "src/path/to/")) or not fpath):
            fpath = fallback_file
        args = agent_tools.normalize_tool_arguments("edit_file", {"path": fpath, "search": search_chunk, "replace": replace_chunk})
        calls.append(("edit_file", args))

    # 2. <tool_call> ... </tool_call>
    for xml_match in re.finditer(r"<tool_call>([\s\S]*?)(?:</tool_call>|$)", response_text, re.IGNORECASE):
        content = xml_match.group(1).strip()
        try:
            parsed = json.loads(content)
            name = parsed.get("name") or parsed.get("tool")
            raw_args = parsed.get("parameters") or parsed.get("args") or {}
            if name:
                norm_args = agent_tools.normalize_tool_arguments(str(name), raw_args)
                calls.append((str(name), norm_args))
        except Exception:
            pass

    # 3. JSON code blocks and inline JSON objects
    for obj in _extract_json_tool_objects(response_text):
        name = obj.get("tool") or obj.get("name")
        raw_args = obj.get("args") or obj.get("parameters") or {}
        if name:
            norm_args = agent_tools.normalize_tool_arguments(str(name), raw_args)
            calls.append((str(name), norm_args))

    # 4. Action: ... Action Input: ...
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
        w in req_lower for w in ["and fix", "and change", "and remove", "and update", "and replace"]
    ):
        return False

    mutation_keywords = [
        "remove", "delete", "change", "update", "replace", "modify",
        "add", "insert", "create", "fix", "repair", "refactor", "rename",
        "implement", "hide", "show", "display", "set", "switch", "toggle",
        "adjust", "clean", "extract", "move", "sync", "instead of",
    ]
    return any(re.search(r"\b" + re.escape(w) + r"\b", req_lower) for w in mutation_keywords)


def _clean_thought_text(raw_text: str) -> str:
    """Strip out <tool_call> and code blocks to leave only thinking / explanation text."""
    cleaned = re.sub(r"<tool_call>[\s\S]*?(?:</tool_call>|$)", "", raw_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```(?:json)?\s*\{\s*\"(?:tool|name)\"[\s\S]*?\}\s*```", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"Action:\s*[A-Za-z0-9_]+\s*\nAction Input:\s*\{[\s\S]*?\}", "", cleaned)
    cleaned = re.sub(r"(?:^|\n)(?:(?:File|path|Target)?:\s*)?[^\n`<>]+?\.[A-Za-z0-9_]+\s*\n<{5,9}\s*SEARCH[\s\S]*?>{5,9}\s*REPLACE", "", cleaned)
    return cleaned.strip()


def run_agent_loop(
    user_request: str,
    project_root: str,
    llm_caller: Callable[[str, Optional[str]], Optional[str]],
    active_file: Optional[str] = None,
    reporter: Optional[Callable[[str, str, str], None]] = None,
    chunk_streamer: Optional[Callable[[str], None]] = None,
    max_iterations: int = 8,
    conversation_history: Optional[list[dict[str, str]]] = None,
    initial_context: Optional[dict[str, str]] = None,
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
    plan_summary = " -> ".join([re.sub(r"^\d+\.\s*", "", s) for s in plan_steps[:3]])
    report("Architect Plan", plan_summary, "done")

    # Prepare initial task prompt, augmenting with any pre-loaded file contexts and plan
    plan_text = "\n".join(plan_steps)
    task_content = f"Task: {user_request}\n\n### ACTIVE EXECUTION PLAN:\n{plan_text}\n"
    if initial_context:
        ctx_lines = ["\n[Pre-loaded Relevant File Contexts]:"]
        for cpath, ctext in list(initial_context.items())[:3]:
            ctx_lines.append(f"File: {cpath}\n```\n{ctext[:1500]}\n```")
        task_content += "\n" + "\n".join(ctx_lines)

    history.append({"role": "user", "content": task_content})

    steps: list[AgentStep] = []
    edited_files: set[str] = set()
    final_answer = ""
    recent_read_path: Optional[str] = None
    executed_read_calls: dict[str, int] = {}

    report("Agent Setup", "Initialized autonomous workspace agent with RepoMap and multi-turn memory", "done")

    for round_idx in range(1, max_iterations + 1):
        # Build prompt from conversation history
        prompt_parts = ["Below is the conversation history and observations:\n"]
        for msg in history:
            role = msg["role"].upper()
            content = msg["content"]
            prompt_parts.append(f"\n--- {role} ---\n{content}\n")

        prompt_parts.append("\n--- ASSISTANT ---\n")
        full_prompt = "".join(prompt_parts)

        report("Model Reasoning", f"Analyzing task & deciding next action (turn {round_idx}/{max_iterations})...", "running")

        # Call LLM
        response = llm_caller(full_prompt, system_prompt)
        if not response:
            report("Model Reasoning", "Provider returned empty response", "failed")
            break

        thought_text = _clean_thought_text(response)
        tool_calls = _parse_all_tool_calls(response, fallback_file=recent_read_path)

        # Emit model reasoning and always complete step
        if thought_text:
            first_line = thought_text.splitlines()[0][:80]
            report("Model Reasoning", first_line, "done")
            stream(thought_text + "\n\n")
        elif tool_calls:
            tool_names = ", ".join(t[0] for t in tool_calls)
            report("Model Reasoning", f"Decided tool actions: {tool_names}", "done")
        else:
            report("Model Reasoning", "Completed reasoning for turn", "done")

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

                # If this is an edit tool and the file was already confirmed missing in this turn, skip it
                if tool_name in ("edit_file", "patch", "replace_file_content", "modify_file") and target_p and target_p in missing_paths_in_turn:
                    obs = f"Skipped {tool_name} on '{target_p}': Target file was confirmed not to exist. Please review the directory/landmark guidance above and call edit_file on the correct file."
                    round_observations.append(obs)
                    report(f"Tool: {tool_name}", f"Skipped (missing: {target_p})", "failed")
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

                step_name = f"Tool: {tool_name}"
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
                if tool_name in ("edit_file", "patch", "replace_file_content", "modify_file") and "Success" in observation:
                    target_p = norm_args.get("path", "")
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
            # No tool call made -> Check if user requested code mutation but no files were edited
            if is_mutation_request(user_request) and len(edited_files) == 0 and round_idx < max_iterations:
                report("Agent Guidance", "No file edits applied yet. Prompting agent to execute edits on disk...", "running")
                history.append({"role": "assistant", "content": response})
                history.append({
                    "role": "user",
                    "content": (
                        "Observation:\n"
                        "You explained the changes or steps, but NO files were actually edited on disk!\n"
                        "As an autonomous coding agent, you must execute the file modifications directly.\n"
                        "Please call the `edit_file` tool now (with path, search, and replace blocks) "
                        "to apply the modifications directly to the file on disk."
                    ),
                })
                continue
            else:
                final_answer = thought_text or response
                report("Agent Completed", f"Finished in {round_idx} turn(s). Edited {len(edited_files)} file(s).", "done")
                break

    if not final_answer:
        if edited_files:
            final_answer = f"Agent successfully modified {len(edited_files)} file(s): {', '.join(sorted(edited_files))}."
        elif steps:
            final_answer = f"Completed {len(steps)} steps across {round_idx} turn(s)."
        report("Agent Completed", f"Finished in {round_idx} turn(s). Edited {len(edited_files)} file(s).", "done")

    elapsed_total = round(time.monotonic() - start_time, 2)
    return AgentResult(
        success=bool(final_answer or edited_files),
        answer=final_answer,
        edited_files=list(edited_files),
        steps=steps,
        total_rounds=round_idx,
        elapsed_s=elapsed_total,
    )
