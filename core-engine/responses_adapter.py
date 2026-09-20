#!/usr/bin/env python3
"""A Responses API -> Ollama /api/chat adapter, so local models can run tools.

Why this exists
───────────────
Codex requires `wire_api = "responses"` for a custom provider ("chat" is a hard
config error on this build). Its Ollama path therefore lands on Ollama's
`/v1/responses`, which accepts `tools` and *ignores* them: a direct POST with a
tool array comes back with the call rendered as plain text and never a
`function_call`, so an agent run reads and replies but never acts.

Ollama's *native* `/api/chat` does support tools. This speaks the Responses API
to Codex and `/api/chat` to Ollama, translating tool calls and results in both
directions, and forwards Ollama's text deltas untouched.

Stdlib only, on purpose: it ships inside the app and must not add a dependency.

Verified, not assumed: with a provider table pointed at this and
`llama3.2:3b` as the model, `codex exec "Run the shell command: echo
adapter-works"` returned
`item.completed command_execution … aggregated_output: "adapter-works\n",
exit_code: 0` — the local model called a tool and the tool ran.

Two shape differences cost the most time, so they are named here:
Ollama's `/api/chat` wants tool-call `arguments` as an **object** (posting the
Responses string is a 400, "Value looks like object, but can't find closing
'}'"), and small models emit `null` for optional numeric fields, which Codex's
own tool schema rejects — so nulls are dropped on the way out.
"""

from __future__ import annotations

import http.client
import http.server
import json
import os
import socketserver
import sys
import time
import uuid

UPSTREAM_HOST = os.environ.get("ACSA_OLLAMA_HOST", "127.0.0.1")
UPSTREAM_PORT = int(os.environ.get("ACSA_OLLAMA_PORT", "11434"))
DEBUG = os.environ.get("ACSA_ADAPTER_DEBUG") == "1"


def log(*parts: object) -> None:
    if DEBUG:
        print("[adapter]", *parts, file=sys.stderr, flush=True)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now() -> int:
    return int(time.time())


# ── Responses -> chat ───────────────────────────────────────────────────────


def chat_tools(tools) -> list:
    """Responses tools are flat (`{type, name, description, parameters}`); chat
    wants them nested under `function`. Accept both so a chat-shaped request is
    not silently double-wrapped."""
    out = []
    for tool in tools or []:
        if not isinstance(tool, dict) or tool.get("type") != "function":
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        name = fn.get("name") or ""
        if not name:
            continue
        out.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": fn.get("description") or "",
                    "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                },
            }
        )
    return out


def as_object(raw):
    """A tool-call argument blob as an object, for the chat direction."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


# JSON Schema type name -> the Python type an instance must have to be valid.
_SCHEMA_TYPES = {
    "array": list,
    "object": dict,
    "string": str,
    "boolean": bool,
    "integer": int,
    "number": (int, float),
}


def clean_arguments(raw, schema=None) -> str:
    """Tool arguments as a JSON string, with the model's guesses removed.

    Small local models do not leave optional fields alone. They fill them with
    something shaped like a value, and Codex's own tool schemas are strict, so the
    call is rejected outright before anything runs:

        "yield_time_ms": null        -> "invalid type: null, expected u64"
        "prefix_rule": ""            -> "invalid type: string \"\", expected a sequence"

    Both are the model saying "use the default" in a way the schema cannot accept.
    The tool's own `parameters` is right here in the request, so an argument that
    cannot possibly be valid for its declared type is dropped rather than passed
    on to fail — that is what the model meant. Anything unparseable is left
    untouched so the real error stays visible.
    """
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return raw
    elif raw is None:
        return "{}"
    else:
        parsed = raw
    if not isinstance(parsed, dict):
        return json.dumps(parsed)

    schema = schema if isinstance(schema, dict) else {}
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    strict = schema.get("additionalProperties") is False

    cleaned = {}
    for key, value in parsed.items():
        if value is None:
            continue
        declared = properties.get(key)
        if declared is None:
            # Not in the schema: only dropped when the schema says extras are not
            # allowed, which is exactly when it would fail.
            if not strict:
                cleaned[key] = value
            continue
        declared_type = declared.get("type") if isinstance(declared, dict) else None
        # Codex writes nullable fields as `["array", "null"]`; the non-null arm is
        # the one that says what a value would have to look like.
        if isinstance(declared_type, list):
            declared_type = next((part for part in declared_type if part != "null"), None)
        want = _SCHEMA_TYPES.get(declared_type) if isinstance(declared_type, str) else None
        if want is not None:
            # `True` is an `int` in Python; a boolean where a number was asked for
            # is a guess, not a number.
            if isinstance(value, bool) and want is not bool:
                continue
            if not isinstance(value, want):
                continue
        cleaned[key] = value
    return json.dumps(cleaned)


def _might_be_a_tool_call(text: str) -> bool:
    """Hold this text back: it could still turn out to be a tool call.

    Only the opening decides. A prose answer streams the moment it is recognisable
    as prose, so holding costs nothing in the normal case.
    """
    stripped = text.lstrip()
    if not stripped:
        return True
    if stripped[0] in "{[":
        return True
    if stripped.startswith("```"):
        rest = stripped[3:].lstrip()
        # ```json / ```{ / ```[ / a bare fence still being typed. "```python" is
        # an answer, not a tool call, and streams straight away.
        return rest[:1] in ("", "{", "[", "j", "J")
    return False


def _json_objects(text: str):
    """Every balanced `{...}` span, outermost first.

    Brace matching with a string/escape guard, so a `}` inside a command string
    does not end the object early.
    """
    depth = 0
    start = None
    in_string = False
    escaped = False
    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    yield text[start : index + 1]
                    start = None


def tool_call_from_text(text: str, schemas: dict):
    """Recover a tool call that a model wrote as text.

    Not every local model can emit native tool calls. `qwen2.5-coder` and
    `deepseek-coder` answer with the call as JSON in the message body — and often
    with a sentence in front of it, "Here is the command you should run:" — which
    the runtime then shows as prose and never executes. Measured, both ways.

    So any balanced JSON object in the answer is a candidate, and it counts only
    if it names a tool this request actually offered with an object of arguments.
    That gate is what makes searching the whole answer safe: the name has to be
    one of a handful of tools the runtime just advertised, so prose that merely
    mentions a tool is not rewritten into one.
    """
    if not schemas:
        return None
    for candidate in _json_objects(text):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue

        inner = parsed.get("function") if isinstance(parsed.get("function"), dict) else {}
        name = parsed.get("name") or inner.get("name") or parsed.get("tool")
        if not isinstance(name, str) or name not in schemas:
            continue

        arguments = parsed.get("arguments")
        if arguments is None:
            arguments = inner.get("arguments")
        if arguments is None:
            arguments = parsed.get("parameters")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                continue
        if not isinstance(arguments, dict):
            continue
        return name, arguments
    return None


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks = []
        for part in content:
            if isinstance(part, dict):
                chunks.append(str(part.get("text") or ""))
            elif isinstance(part, str):
                chunks.append(part)
        return "".join(chunks)
    return ""


def chat_messages(body: dict) -> list:
    messages = []
    instructions = body.get("instructions")
    if instructions:
        messages.append({"role": "system", "content": str(instructions)})
    incoming = body.get("input")
    if isinstance(incoming, str):
        messages.append({"role": "user", "content": incoming})
        return messages
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind == "message":
            role = item.get("role") or "user"
            if role == "developer":
                role = "system"
            messages.append({"role": role, "content": text_of(item.get("content"))})
        elif kind == "function_call":
            # The model's earlier tool call, replayed as history. Ollama wants
            # `arguments` as an object here; the Responses API carries it as a
            # string. Posting the string is a 400: "Value looks like object, but
            # can't find closing '}'".
            messages.append(
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "function": {
                                "name": item.get("name") or "",
                                "arguments": as_object(item.get("arguments")),
                            }
                        }
                    ],
                }
            )
        elif kind == "function_call_output":
            messages.append(
                {
                    "role": "tool",
                    "content": item.get("output") if isinstance(item.get("output"), str) else text_of(item.get("output")),
                    "tool_name": item.get("name") or "",
                }
            )
        elif kind == "reasoning":
            continue
        else:
            log("unhandled input item type:", kind)
    return messages


# ── The Responses envelope (field-for-field what Ollama emits) ───────────────


def envelope(resp_id: str, model: str, status: str, output, usage=None) -> dict:
    return {
        "background": False,
        "completed_at": now() if status == "completed" else None,
        "created_at": now(),
        "error": None,
        "frequency_penalty": 0,
        "id": resp_id,
        "incomplete_details": None,
        "instructions": None,
        "max_output_tokens": None,
        "max_tool_calls": None,
        "metadata": {},
        "model": model,
        "object": "response",
        "output": output,
        "parallel_tool_calls": True,
        "presence_penalty": 0,
        "previous_response_id": None,
        "prompt_cache_key": None,
        "reasoning": None,
        "safety_identifier": None,
        "service_tier": "default",
        "status": status,
        "store": False,
        "temperature": 1,
        "text": {"format": {"type": "text"}},
        "tool_choice": "auto",
        "tools": [],
        "top_logprobs": 0,
        "top_p": 1,
        "truncation": "disabled",
        "usage": usage,
    }


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # quiet
        pass

    def _chunk(self, payload: bytes) -> None:
        self.wfile.write(b"%x\r\n" % len(payload) + payload + b"\r\n")
        self.wfile.flush()

    def _sse(self, event: str, data: dict) -> None:
        self._chunk(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/v1/health", ""):
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not self.path.rstrip("/").endswith("/responses"):
            self.send_error(404, "only /v1/responses is implemented")
            return
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as error:
            self.send_error(400, f"bad json: {error}")
            return

        if DEBUG:
            with open(os.environ.get("ACSA_ADAPTER_DUMP", "/tmp/resp-adapter/last-request.json"), "w") as fh:
                json.dump(body, fh, indent=1)

        model = body.get("model") or "llama3.2:3b"
        stream = bool(body.get("stream", True))
        # name -> declared parameters, so a tool call can be checked against the
        # schema the model was actually given.
        schemas = {
            tool.get("name"): tool.get("parameters")
            for tool in (body.get("tools") or [])
            if isinstance(tool, dict) and tool.get("type") == "function" and tool.get("name")
        }
        chat_body = {
            "model": model,
            "messages": chat_messages(body),
            "stream": True,
        }
        tools = chat_tools(body.get("tools"))
        if tools:
            chat_body["tools"] = tools
        log("request", model, len(chat_body["messages"]), "messages,", len(tools), "tools")

        if not stream:
            self._respond_once(chat_body, model, schemas)
            return
        self._respond_stream(chat_body, model, schemas)

    # ── non-streaming ───────────────────────────────────────────────────────
    def _respond_once(self, chat_body: dict, model: str, schemas: dict) -> None:
        payload = dict(chat_body, stream=False)
        try:
            result = self._ollama_chat(payload, stream=False)
        except Exception as error:  # noqa: BLE001 - reported to the client
            self.send_error(502, f"upstream: {error}")
            return
        resp_id = new_id("resp")
        message = (result or {}).get("message") or {}
        output, _ = self._output_items(message, resp_id, 0, schemas)
        body = json.dumps(envelope(resp_id, model, "completed", output)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── streaming ───────────────────────────────────────────────────────────
    def _respond_stream(self, chat_body: dict, model: str, schemas: dict) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        resp_id = new_id("resp")
        item_id = new_id("msg")
        self._pending_calls = []
        seq = 0

        def send(event: str, data: dict) -> None:
            data.setdefault("type", event)
            nonlocal seq
            data["sequence_number"] = seq
            seq += 1
            self._sse(event, data)

        send("response.created", {"response": envelope(resp_id, model, "in_progress", [])})
        send("response.in_progress", {"response": envelope(resp_id, model, "in_progress", [])})
        send(
            "response.output_item.added",
            {"output_index": 0, "item": {"content": [], "id": item_id, "role": "assistant", "status": "in_progress", "type": "message"}},
        )
        send(
            "response.content_part.added",
            {
                "content_index": 0,
                "item_id": item_id,
                "output_index": 0,
                "part": {"annotations": [], "logprobs": [], "text": "", "type": "output_text"},
            },
        )

        text = ""
        # Text not yet sent, while it could still be a tool call.
        held = ""
        streaming = False
        prompt_tokens = 0
        output_tokens = 0
        try:
            for chunk in self._ollama_chat_stream(chat_body):
                if isinstance(chunk.get("prompt_eval_count"), int):
                    prompt_tokens = chunk["prompt_eval_count"]
                if isinstance(chunk.get("eval_count"), int):
                    output_tokens = chunk["eval_count"]
                message = chunk.get("message") or {}
                delta = message.get("content") or ""
                if delta:
                    text += delta
                    if streaming:
                        send(
                            "response.output_text.delta",
                            {"content_index": 0, "delta": delta, "item_id": item_id, "logprobs": [], "output_index": 0},
                        )
                    else:
                        held += delta
                        if not _might_be_a_tool_call(held):
                            streaming = True
                            send(
                                "response.output_text.delta",
                                {"content_index": 0, "delta": held, "item_id": item_id, "logprobs": [], "output_index": 0},
                            )
                            held = ""
                calls = message.get("tool_calls") or []
                if calls:
                    self._emit_tool_calls(calls, output_index=1, send=send, resp_id=resp_id, schemas=schemas)
        except Exception as error:  # noqa: BLE001 - surfaced as a failed response
            log("stream failed:", error)
            send("response.failed", {"response": envelope(resp_id, model, "failed", [])})
            self._chunk(b"")
            return

        # Nothing streamed, so decide now what the held text was.
        recovered = None
        if held and not streaming:
            recovered = tool_call_from_text(held, schemas)
            if recovered:
                log("recovered a tool call the model wrote as text:", recovered[0], json.dumps(recovered[1])[:200])
                self._emit_tool_calls(
                    [
                        {
                            "id": new_id("call"),
                            "function": {"name": recovered[0], "arguments": json.dumps(recovered[1])},
                        }
                    ],
                    output_index=1,
                    send=send,
                    resp_id=resp_id,
                    schemas=schemas,
                )
            else:
                streaming = True
                send(
                    "response.output_text.delta",
                    {"content_index": 0, "delta": held, "item_id": item_id, "logprobs": [], "output_index": 0},
                )
            held = ""

        # A recovered call is not also an answer: the message item stays empty, so
        # the chat does not show `{"name": …}` as prose beside the tool it drove.
        message_text = "" if recovered else text

        if message_text:
            send(
                "response.output_text.done",
                {"content_index": 0, "item_id": item_id, "logprobs": [], "output_index": 0, "text": message_text},
            )
            send(
                "response.content_part.done",
                {
                    "content_index": 0,
                    "item_id": item_id,
                    "output_index": 0,
                    "part": {"annotations": [], "logprobs": [], "text": message_text, "type": "output_text"},
                },
            )
            send(
                "response.output_item.done",
                {
                    "output_index": 0,
                    "item": {
                        "content": [{"annotations": [], "logprobs": [], "text": message_text, "type": "output_text"}],
                        "id": item_id,
                        "role": "assistant",
                        "status": "completed",
                        "type": "message",
                    },
                },
            )
        else:
            send(
                "response.output_item.done",
                {"output_index": 0, "item": {"content": [], "id": item_id, "role": "assistant", "status": "completed", "type": "message"}},
            )

        finished = []
        if message_text:
            finished.append(
                {
                    "content": [{"annotations": [], "logprobs": [], "text": message_text, "type": "output_text"}],
                    "id": item_id,
                    "role": "assistant",
                    "status": "completed",
                    "type": "message",
                }
            )
        finished.extend(self._pending_calls)
        # Report the counters Ollama gives us, so the app's usage ledger and cost
        # page show real numbers for local runs instead of zeros.
        usage = None
        if prompt_tokens or output_tokens:
            usage = {
                "input_tokens": prompt_tokens,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens": output_tokens,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": prompt_tokens + output_tokens,
            }
        send("response.completed", {"response": envelope(resp_id, model, "completed", finished, usage)})
        self._chunk(b"")

    def _emit_tool_calls(self, calls, output_index: int, send, resp_id: str, schemas: dict) -> None:
        for call in calls:
            fn = call.get("function") or {}
            name = fn.get("name") or ""
            arguments = clean_arguments(fn.get("arguments"), schemas.get(name))
            call_id = call.get("id") or new_id("call")
            item_id = new_id("fc")
            send(
                "response.output_item.added",
                {
                    "output_index": output_index,
                    "item": {
                        "arguments": "",
                        "call_id": call_id,
                        "id": item_id,
                        "name": name,
                        "status": "in_progress",
                        "type": "function_call",
                    },
                },
            )
            send(
                "response.function_call_arguments.delta",
                {"delta": arguments, "item_id": item_id, "output_index": output_index},
            )
            send(
                "response.function_call_arguments.done",
                {"arguments": arguments, "item_id": item_id, "output_index": output_index},
            )
            done = {
                "arguments": arguments,
                "call_id": call_id,
                "id": item_id,
                "name": name,
                "status": "completed",
                "type": "function_call",
            }
            send("response.output_item.done", {"output_index": output_index, "item": done})
            self._pending_calls.append(done)
            output_index += 1

    def _output_items(self, message: dict, resp_id: str, index: int, schemas: dict):
        items = []
        text = message.get("content") or ""
        if text:
            items.append(
                {
                    "content": [{"annotations": [], "logprobs": [], "text": text, "type": "output_text"}],
                    "id": new_id("msg"),
                    "role": "assistant",
                    "status": "completed",
                    "type": "message",
                }
            )
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            args = clean_arguments(fn.get("arguments"), schemas.get(fn.get("name")))
            items.append(
                {
                    "arguments": args,
                    "call_id": call.get("id") or new_id("call"),
                    "id": new_id("fc"),
                    "name": fn.get("name") or "",
                    "status": "completed",
                    "type": "function_call",
                }
            )
        return items, index

    # ── upstream ────────────────────────────────────────────────────────────
    def _ollama_chat(self, payload: dict, stream: bool) -> dict:
        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=600)
        conn.request(
            "POST",
            "/api/chat",
            body=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        if response.status != 200:
            raise RuntimeError(f"ollama {response.status}: {raw[:200]!r}")
        return json.loads(raw)

    def _ollama_chat_stream(self, payload: dict):
        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=600)
        conn.request(
            "POST",
            "/api/chat",
            body=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        if response.status != 200:
            raw = response.read()
            conn.close()
            raise RuntimeError(f"ollama {response.status}: {raw[:200]!r}")
        decoder = response
        buffer = b""
        while True:
            block = decoder.read(1)
            if not block:
                break
            buffer += block
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
        conn.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    """Run the adapter. Reached as `acsa-engine adapter`, or directly.

    The caller chooses the port and waits for `/health`, so startup order is not
    a race and no port is guessed.
    """
    global UPSTREAM_HOST, UPSTREAM_PORT
    args = sys.argv[1:]
    port = int(os.environ.get("ACSA_ADAPTER_PORT", "11500"))
    host = "127.0.0.1"
    for index, arg in enumerate(args):
        nxt = args[index + 1] if index + 1 < len(args) else ""
        if arg == "--port" and nxt:
            port = int(nxt)
        elif arg == "--host" and nxt:
            host = nxt
        elif arg == "--ollama-host" and nxt:
            UPSTREAM_HOST = nxt
        elif arg == "--ollama-port" and nxt:
            UPSTREAM_PORT = int(nxt)
    with Server((host, port), Handler) as server:
        log(f"listening on {host}:{port} -> ollama {UPSTREAM_HOST}:{UPSTREAM_PORT}")
        server.serve_forever()


if __name__ == "__main__":
    main()
