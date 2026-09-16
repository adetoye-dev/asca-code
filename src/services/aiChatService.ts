/**
 * aiChatService.ts — Conversational AI Streaming Service
 *
 * Communicates with the /api/ai/chat bridge endpoint to stream real
 * conversational responses from Ollama, OpenAI, Groq, DeepSeek, or
 * the local Deterministic AST engine.
 */

import { hasIpc } from "./engineBridge";

/**
 * Stream a reply through the app's own IPC channel.
 *
 * The engine writes NDJSON frames (`{delta}` … `{done}`) and the Rust side forwards
 * each line as an `ai:frame` event, so the three payload shapes the SSE reader
 * handled below are unchanged — only the transport differs.
 */
async function streamViaIpc(params: any): Promise<void> {
  const { provider, model, messages, images, projectRoot, baseUrl, apiKey, signal, onDelta, onDone, onError } = params;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  let finished = false;
  let unlisten: Array<() => void> = [];
  const cleanup = () => {
    unlisten.forEach((off) => off());
    unlisten = [];
  };
  const abort = () => {
    if (!finished) invoke("chat_cancel").catch(() => {});
  };
  signal?.addEventListener?.("abort", abort);

  try {
    unlisten.push(
      await listen<string>("ai:exit", (event) => {
        if (finished) return;
        finished = true;
        // The engine always sends its own final frame on success, so reaching here
        // first means it died — and stderr is the only explanation available.
        if (event.payload) onError(String(event.payload));
        else onDone({ aborted: signal?.aborted ?? false });
        cleanup();
      }),
    );
    unlisten.push(
      await listen<{ line: string }>("ai:frame", (event) => {
        if (finished) return;
        try {
          const frame = JSON.parse(event.payload.line);
          if (frame.error) {
            finished = true;
            onError(frame.error);
            cleanup();
            return;
          }
          if (frame.delta) onDelta(frame.delta);
          if (frame.done) {
            finished = true;
            onDone(frame);
            cleanup();
          }
        } catch {
          /* a partial or non-JSON line carries nothing to show */
        }
      }),
    );

    await invoke("chat_stream", {
      payload: JSON.stringify({ provider, model, messages, images, projectRoot, baseUrl, apiKey }),
    });
  } catch (err: any) {
    if (!finished) {
      finished = true;
      onError(err?.message || "Failed to communicate with the assistant.");
    }
    cleanup();
  } finally {
    signal?.removeEventListener?.("abort", abort);
  }
}

export interface AgentStep {
  id?: string;
  name: string;
  detail?: string;
  status: "running" | "done" | "failed" | "success";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  timestamp: number;
  provider?: string;
  model?: string;
  isStreaming?: boolean;
  thinking?: string;
  steps?: AgentStep[];
  error?: boolean;
  errorType?: "offline" | "timeout" | "syntax" | "api" | "general";
  diffPreview?: string;
}

export interface StreamChatParams {
  provider: string;
  model: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  images?: string[];
  projectRoot?: string;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  onDelta: (deltaText: string) => void;
  onDone: (metadata?: any) => void;
  onError: (errorMessage: string) => void;
}

export async function streamChatCompletion({
  provider,
  model,
  messages,
  images,
  projectRoot = "",
  baseUrl = "",
  apiKey = "",
  signal,
  onDelta,
  onDone,
  onError,
}: StreamChatParams): Promise<void> {
  // The packaged app has no dev server; prefer the app's own channel when it exists.
  if (hasIpc()) {
    await streamViaIpc({ provider, model, messages, images, projectRoot, baseUrl, apiKey, signal, onDelta, onDone, onError });
    return;
  }

  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        messages,
        images,
        projectRoot,
        baseUrl,
        apiKey,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      onError(`Server returned HTTP ${res.status}: ${errText || res.statusText}`);
      return;
    }

    if (!res.body) {
      onError("No response stream body received.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.replace(/^data: /, "").trim();
        if (!line) continue;
        try {
          const payload = JSON.parse(line) as {
            delta?: string;
            done?: boolean;
            error?: string;
            [key: string]: any;
          };

          if (payload.error) {
            onError(payload.error);
            return;
          }

          if (payload.delta) {
            onDelta(payload.delta);
          }

          if (payload.done) {
            onDone(payload);
            return;
          }
        } catch {}
      }
    }

    onDone();
  } catch (err: any) {
    if (err.name === "AbortError") {
      onDone({ aborted: true });
      return;
    }
    onError(err.message || "Failed to communicate with AI chat service.");
  }
}
