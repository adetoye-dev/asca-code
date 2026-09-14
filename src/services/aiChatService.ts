/**
 * aiChatService.ts — Conversational AI Streaming Service
 *
 * Communicates with the /api/ai/chat bridge endpoint to stream real
 * conversational responses from Ollama, OpenAI, Groq, DeepSeek, or
 * the local Deterministic AST engine.
 */

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
