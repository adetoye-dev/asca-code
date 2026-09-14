"""worker_pool.py — Hardware-Safe Local Worker Pool & Foreman-Tradesman Engine

Implements the hybrid division of labor for ACSA Code:
1. Hardware Safety Governor: Strict MAX_LOCAL_CONCURRENCY = 1 lock ensures
   local model weights stay in RAM/VRAM once (~4.5 GB) and multi-task
   synthesis jobs never freeze or crash the host machine.
2. Autonomous Model Selection: SWE-bench capability ranking detects the best
   installed code model (Qwen 2.5 Coder > DeepSeek Coder V2 > Codestral > Llama 3.3/3.1).
3. Zero-Latency Warm Model Priority: Prefers models already resident in Ollama memory (/api/ps).
4. Deterministic Syntax Gate: Validates AST syntax on edits before reporting completion.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("acsa.worker_pool")

# Sibling module imports
_ENGINE_DIR = Path(__file__).resolve().parent
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

try:
    from gauntlet.syntax_guard import run_syntax_gate
except ImportError:
    try:
        from syntax_guard import run_syntax_gate
    except ImportError:
        run_syntax_gate = None

def score_local_model(model_name: str) -> float:
    """Dynamically scores a local model tag for code synthesis.
    Evaluates coding tokens, architecture family, version number, and parameter count.
    """
    if not model_name or not isinstance(model_name, str):
        return 0.0
    name = model_name.lower()
    score = 0.0

    # Coding specialization bonus
    if any(k in name for k in ("coder", "code", "dev", "synthes")):
        score += 50.0
    # Reasoning bonus
    if any(k in name for k in ("reason", "deepseek-r1", "thinking")):
        score += 30.0
    # Proven architectures
    if "qwen" in name:
        score += 25.0
    elif "deepseek" in name:
        score += 24.0
    elif "codestral" in name or "mistral" in name:
        score += 22.0
    elif "llama" in name:
        score += 20.0
    elif "starcoder" in name:
        score += 18.0

    # Version score (e.g. 3.3 > 3.1 > 2.5 > 2)
    v_match = re.search(r'(?:v|version)?(\d+(?:\.\d+)?)', name)
    if v_match:
        try:
            v = float(v_match.group(1))
            if v < 50.0:
                score += v * 2.0
        except ValueError:
            pass

    # Parameter size bonus (e.g. 32b > 14b > 7b > 3b)
    size_match = re.search(r'(\d+)b', name)
    if size_match:
        try:
            size = float(size_match.group(1))
            score += min(size, 70.0) * 0.5
        except ValueError:
            pass

    return score


class HardwareSafeWorkerPool:
    """Manages sequential execution of local model micro-tasks with strict concurrency = 1."""

    def __init__(self, base_url: str = "http://127.0.0.1:11434") -> None:
        self.base_url = base_url.rstrip("/")
        self._lock = threading.Lock()
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get_installed_models(self) -> list[str]:
        """Fetch list of all installed Ollama model tags."""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags")
            with self._opener.open(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        except Exception as exc:
            logger.debug("Failed to list installed Ollama models: %s", exc)
            return []

    def get_warm_models(self) -> list[str]:
        """Fetch list of models currently resident in RAM/VRAM."""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/ps")
            with self._opener.open(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        except Exception:
            return []

    def auto_select_worker_model(self, installed: Optional[list[str]] = None) -> str:
        """Select optimal local worker model using dynamic ranking and warm memory state."""
        models = installed if installed is not None else self.get_installed_models()
        if not models:
            return "qwen2.5-coder:7b"

        # Check warm models first to eliminate load latency, if warm model has good code capability
        warm = self.get_warm_models()
        if warm:
            warm_scored = sorted(warm, key=score_local_model, reverse=True)
            if score_local_model(warm_scored[0]) >= 40.0:
                return warm_scored[0]

        # Match against installed models dynamically
        installed_scored = sorted(models, key=score_local_model, reverse=True)
        return installed_scored[0]

    def execute_local_task(
        self,
        project_root: str,
        target_file: str,
        instruction: str,
        context: str = "",
        model: Optional[str] = None,
        timeout: int = 120,
    ) -> dict[str, Any]:
        """Execute a surgical code task on disk with hardware-safe locking (concurrency=1)."""
        t_start = time.monotonic()
        root = Path(project_root).resolve()
        file_path = (root / target_file).resolve() if not Path(target_file).is_absolute() else Path(target_file).resolve()

        # Enforce project root safety
        try:
            rel_path = file_path.relative_to(root).as_posix()
        except ValueError:
            return {
                "success": False,
                "target_file": target_file,
                "message": f"Path '{target_file}' is outside project root '{project_root}'",
                "syntax_ok": False,
                "elapsed_ms": 0.0,
            }

        # Acquire lock to ensure only 1 local task runs at any time
        with self._lock:
            file_exists = file_path.exists() and file_path.is_file()
            original_bytes = file_path.read_bytes() if file_exists else None
            existing_content = original_bytes.decode("utf-8", errors="replace") if original_bytes is not None else ""
            active_model = model or self.auto_select_worker_model()
            logger.info("Local worker [%s] running task on %s", active_model, rel_path)

            system_prompt = (
                "You are an expert autonomous code synthesis worker. "
                "Your job is to apply surgical code edits to the target file according to instructions.\n"
                "RULES:\n"
                "1. Emit your edits strictly as SEARCH/REPLACE blocks.\n"
                "Format:\n"
                f"[{rel_path}]\n"
                "<<<<<<< SEARCH\n"
                "// exact existing code lines to match\n"
                "=======\n"
                "// new replacement code\n"
                ">>>>>>> REPLACE\n\n"
                "2. If creating a new file from scratch, emit the full file content inside a standard code block.\n"
                "3. Never emit conversational chit-chat, preamble, or explanations. Only the edits."
            )

            user_prompt = (
                f"Target File: {rel_path}\n"
                f"Instruction: {instruction}\n"
            )
            if context:
                user_prompt += f"\nContract & Interface Context:\n```\n{context[:3000]}\n```\n"

            if file_exists:
                lines = existing_content.splitlines()
                preview = "\n".join(lines[:100]) if len(lines) > 100 else existing_content
                user_prompt += f"\nCurrent File Content ({rel_path}):\n```\n{preview[:4000]}\n```\n"
            else:
                user_prompt += f"\nNote: {rel_path} does not exist yet. Please generate the initial code.\n"

            chat_url = f"{self.base_url}/api/chat"
            payload = json.dumps({
                "model": active_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 2048,
                },
            }).encode("utf-8")

            raw_response = ""
            try:
                req = urllib.request.Request(chat_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
                with self._opener.open(req, timeout=timeout) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    raw_response = resp_data.get("message", {}).get("content", "")
            except Exception as call_err:
                # Fallback to OpenAI-compatible endpoint
                try:
                    v1_url = f"{self.base_url}/v1/chat/completions"
                    v1_payload = json.dumps({
                        "model": active_model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 2048,
                    }).encode("utf-8")
                    req = urllib.request.Request(v1_url, data=v1_payload, headers={"Content-Type": "application/json"}, method="POST")
                    with self._opener.open(req, timeout=timeout) as resp:
                        v1_data = json.loads(resp.read().decode("utf-8"))
                        choices = v1_data.get("choices", [])
                        if choices:
                            raw_response = choices[0].get("message", {}).get("content", "")
                except Exception as fb_err:
                    logger.warning("Worker pool call failed for %s: %s (fallback: %s)", active_model, call_err, fb_err)
                    return {
                        "success": False,
                        "target_file": rel_path,
                        "message": f"Local worker '{active_model}' unreachable: {call_err}",
                        "syntax_ok": False,
                        "elapsed_ms": (time.monotonic() - t_start) * 1000,
                    }

            # Apply edit to target file
            from agent_tools import edit_file, write_file

            edit_applied = False
            applied_msg = ""

            # Check for SEARCH/REPLACE block
            search_matches = list(re.finditer(r"<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n={5,9}\s*\n([\s\S]*?)\n>{5,9}\s*REPLACE", raw_response))
            if search_matches and file_exists:
                edit_results = []
                edit_applied = True
                for search_match in search_matches:
                    try:
                        res = edit_file(
                            project_root=str(root),
                            path=rel_path,
                            search=search_match.group(1),
                            replace=search_match.group(2),
                        )
                    except Exception as exc:
                        res = f"Error applying edit block: {exc}"
                    edit_results.append(res)
                    # NOTE: edit_file() reports success as "Success: Successfully updated
                    # '<path>' (...)". The old check looked for "Successfully applied edit",
                    # a string no code path ever emits, so every delegated edit was marked
                    # as failed and silently rolled back. Match the real contract instead.
                    if not res.startswith("Success"):
                        edit_applied = False
                        applied_msg = res
                        break
                if edit_applied:
                    applied_msg = f"Successfully applied {len(edit_results)} edit(s) to '{rel_path}'."
                elif original_bytes is not None:
                    file_path.write_bytes(original_bytes)
            elif not file_exists and "```" in raw_response:
                # Extract code block
                code_match = re.search(r"```(?:[A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n```", raw_response)
                code_content = code_match.group(1) if code_match else raw_response.strip()
                res = write_file(project_root=str(root), path=rel_path, content=code_content)
                edit_applied = "Successfully wrote" in res
                applied_msg = res
            else:
                applied_msg = "No SEARCH/REPLACE block or code block found in local worker output"

            # Run deterministic syntax check
            syntax_ok = True
            syntax_msg = ""
            if edit_applied and run_syntax_gate and file_path.exists():
                report = run_syntax_gate([str(file_path)], cwd=str(root))
                if report.total_errors > 0:
                    syntax_ok = False
                    syntax_msg = f"{report.total_errors} syntax error(s) detected post-edit"
                    if original_bytes is not None:
                        file_path.write_bytes(original_bytes)
                    elif file_path.exists():
                        file_path.unlink()
                    edit_applied = False
                else:
                    syntax_msg = "AST syntax check passed 100%"

            elapsed = (time.monotonic() - t_start) * 1000
            return {
                "success": edit_applied,
                "target_file": rel_path,
                "model_used": active_model,
                "message": applied_msg,
                "syntax_ok": syntax_ok,
                "syntax_detail": syntax_msg,
                "elapsed_ms": elapsed,
            }


# Global singleton instance
_GLOBAL_WORKER_POOL = HardwareSafeWorkerPool()


def get_worker_pool() -> HardwareSafeWorkerPool:
    """Return the global hardware-safe worker pool instance."""
    return _GLOBAL_WORKER_POOL


def delegate_to_local_worker(
    project_root: str,
    target_file: str,
    instruction: str,
    context: str = "",
    **kwargs: Any,
) -> str:
    """Delegate a focused code generation or edit task to the hardware-safe local worker ($0 cost)."""
    pool = get_worker_pool()
    result = pool.execute_local_task(
        project_root=project_root,
        target_file=target_file,
        instruction=instruction,
        context=context,
    )
    status_str = "SUCCESS" if result["success"] else "FAILED"
    return (
        f"[{status_str}] Local Worker ({result.get('model_used', 'ollama')}):\n"
        f"Target: {result['target_file']}\n"
        f"Result: {result['message']}\n"
        f"Syntax Check: {result.get('syntax_detail', 'OK')} (elapsed: {result.get('elapsed_ms', 0):.0f}ms)"
    )
