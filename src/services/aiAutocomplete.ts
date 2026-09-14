/**
 * aiAutocomplete.ts — Monaco Inline Completions (Copilot-Style Ghost Text)
 *
 * Implements monaco.languages.registerInlineCompletionsProvider with:
 * 1. Fill-In-The-Middle (FIM) prompt formatting for local models (Qwen2.5-Coder, DeepSeek-Coder, StarCoder).
 * 2. Keystroke debouncing (250ms) and active request abortion via AbortController.
 * 3. Support for Local Ollama, llama.cpp sidecar, Cloud OpenAI-compatible endpoints, and offline heuristic synthesizer.
 */

import type * as MonacoType from "monaco-editor";
import type { AISettings } from "../components/SettingsModal";

let activeAbortController: AbortController | null = null;
let debounceTimer: any = null;
let pendingResolver: ((value: any) => void) | null = null;

export function registerAiInlineCompletions(
  monaco: typeof MonacoType,
  getSettings: () => AISettings
): MonacoType.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider("*", {
    provideInlineCompletions: async (model, position, _context, token) => {
      // Abort previous in-flight completion if user keeps typing
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }

      if (debounceTimer) {
        pendingResolver?.({ items: [] });
        pendingResolver = null;
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      // Check cancellation token
      if (token.isCancellationRequested) {
        return { items: [] };
      }

      const settings = getSettings();

      // Extract context around cursor
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 50),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const textAfterCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 30),
        endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 30)),
      });

      // Avoid suggesting if cursor is on whitespace-only and text before is empty
      if (!textBeforeCursor.trim() && !textAfterCursor.trim()) {
        return { items: [] };
      }

      return new Promise((resolve) => {
        pendingResolver = resolve;
        debounceTimer = setTimeout(async () => {
          pendingResolver = null;
          debounceTimer = null;
          if (token.isCancellationRequested) {
            resolve({ items: [] });
            return;
          }

          const controller = new AbortController();
          activeAbortController = controller;

          try {
            const suggestion = await fetchCompletion({
              prefix: textBeforeCursor,
              suffix: textAfterCursor,
              settings,
              signal: controller.signal,
            });

            if (!suggestion || token.isCancellationRequested) {
              resolve({ items: [] });
              return;
            }

            resolve({
              items: [
                {
                  insertText: suggestion,
                  range: new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column
                  ),
                },
              ],
            });
          } catch (err) {
            resolve({ items: [] });
          } finally {
            if (activeAbortController === controller) {
              activeAbortController = null;
            }
          }
        }, 200);
      });
    },
    disposeInlineCompletions: () => {},
  });
}

interface FetchParams {
  prefix: string;
  suffix: string;
  settings: AISettings;
  signal: AbortSignal;
}

async function fetchCompletion({
  prefix,
  suffix,
  settings,
  signal,
}: FetchParams): Promise<string> {
  const { provider, model, apiKey, baseUrl } = settings;

  // 1. Local Ollama (FIM API or standard generate)
  if (provider === "ollama") {
    const url = (baseUrl || "http://127.0.0.1:11434") + "/api/generate";
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "qwen2.5-coder:7b",
        prompt,
        stream: false,
        options: {
          num_predict: 48,
          temperature: 0.1,
          stop: ["\n\n", "<|file_separator|>", "<|fim_pad|>"],
        },
      }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      return data.response || "";
    }
  }

  // 2. Local llama.cpp Sidecar
  if (provider === "local") {
    const url = (baseUrl || "http://127.0.0.1:8080") + "/completion";
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        n_predict: 48,
        temperature: 0.1,
        stop: ["\n\n"],
      }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      return data.content || "";
    }
  }

  // 3. OpenAI / Cloud API
  if (provider === "openai" && apiKey) {
    const url = (baseUrl || "https://api.openai.com/v1") + "/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an inline code autocomplete engine. Complete the code at the cursor. Output ONLY the code to insert. Do NOT include markdown code blocks or explanations.",
          },
          {
            role: "user",
            content: `Prefix:\n${prefix}\n\nSuffix:\n${suffix}\n\nComplete the code:`,
          },
        ],
        max_tokens: 48,
        temperature: 0.1,
      }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }
  }

  // 4. Deterministic Offline AST / Heuristic Synthesizer Fallback
  return getOfflineSnippetCompletion(prefix);
}

function getOfflineSnippetCompletion(prefix: string): string {
  const lastLine = prefix.split("\n").pop() || "";
  const trimmed = lastLine.trim();

  if (trimmed.startsWith("def ") && trimmed.endsWith(":")) {
    return "\n    \"\"\"Docstring generated by ACSA Code.\"\"\"\n    pass";
  }
  if (trimmed === "import ") {
    return "sys, os, time\nfrom typing import Dict, List, Optional";
  }
  if (trimmed.startsWith("class ") && trimmed.endsWith(":")) {
    return "\n    def __init__(self):\n        super().__init__()";
  }
  if (trimmed.includes("try:") || trimmed === "try:") {
    return "\n    result = True\nexcept Exception as exc:\n    logger.error(exc)";
  }
  if (trimmed.startsWith("if __name__ ==")) {
    return ' "__main__":\n    main()';
  }

  return "";
}

export interface InlineEditResult {
  ok: boolean;
  replacement?: string;
  reason?: string;
}

export async function executeInlineEdit({
  instruction,
  selectedCode,
  surroundingPrefix,
  surroundingSuffix,
  settings,
  signal,
}: {
  instruction: string;
  selectedCode: string;
  surroundingPrefix: string;
  surroundingSuffix: string;
  settings: AISettings;
  signal?: AbortSignal;
}): Promise<InlineEditResult> {
  const { provider, model, apiKey, baseUrl } = settings;
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), 30000);
  const abortRelay = () => timeoutController.abort();
  signal?.addEventListener("abort", abortRelay, { once: true });
  const requestSignal = timeoutController.signal;
  const finish = (result: InlineEditResult) => {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortRelay);
    return result;
  };

  // 1. Try server bridge /api/ai/inline-edit (supports all providers, avoids browser CORS)
  try {
    const res = await fetch("/api/ai/inline-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        instruction,
        selectedCode,
        surroundingPrefix,
        surroundingSuffix,
        baseUrl,
        apiKey,
      }),
      signal: requestSignal,
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.ok && typeof data.replacement === "string" && data.replacement.trim()) {
        return finish({ ok: true, replacement: data.replacement });
      }
      return finish({ ok: false, reason: data.reason || `Inline edit request failed (${res.status})` });
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return finish({ ok: false, reason: "Inline edit request was cancelled or timed out." });
    return finish({ ok: false, reason: `Inline edit request failed: ${err?.message || err}` });
  }

  // 2. Direct client fallback for local Ollama
  if (provider === "ollama") {
    const systemPrompt =
      "You are a precise code editing assistant. Given existing code and user instructions, return ONLY the updated replacement code without commentary, explanations, or markdown fences.";
    const userPrompt = `Context before:\n${surroundingPrefix.slice(-600)}\n\nCode to edit:\n${selectedCode}\n\nContext after:\n${surroundingSuffix.slice(0, 600)}\n\nInstruction: ${instruction}\n\nEmit updated code:`;
    const url = (baseUrl || "http://127.0.0.1:11434") + "/api/generate";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "qwen2.5-coder:7b",
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: { temperature: 0.2, num_predict: 1024 },
        }),
        signal: requestSignal,
      });
      if (res.ok) {
        const data = await res.json();
        let text = (data.response || "").trim();
        if (text.startsWith("```")) {
          text = text.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "");
        }
        return text ? finish({ ok: true, replacement: text }) : finish({ ok: false, reason: "The model returned an empty replacement." });
      }
      return finish({ ok: false, reason: `Ollama request failed (${res.status})` });
    } catch (err: any) {
      return finish({ ok: false, reason: err?.name === "AbortError" ? "Inline edit request was cancelled or timed out." : `Ollama request failed: ${err?.message || err}` });
    }
  }

  return finish({ ok: false, reason: `Inline edits are not supported for provider '${provider}'.` });
}
