/**
 * ollamaSetup.ts — Automatic Ollama Detection & Setup Service
 *
 * Wraps the /api/ollama/* bridge endpoints to:
 * 1. Silently detect whether Ollama is installed and running on startup.
 * 2. Install Ollama via clean passwordless unpack with structured progress streaming.
 * 3. Pull the RAM-appropriate default model with structured progress streaming.
 * 4. Start the Ollama server and wait for it to become healthy.
 * 5. Track first-launch state so the wizard only auto-shows once.
 */

export const OLLAMA_FIRST_LAUNCH_KEY = "acsa_code_ollama_setup_done_v1";

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
  recommendedModel: string;
  totalRamGb: number;
  binaryPath?: string;
  error?: string;
}

export interface OllamaProgressEvent {
  percent: number;
  status: string;
  log?: string;
}

/** Ping the bridge to get Ollama install/running state + RAM-based model recommendation. */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch("/api/ollama/status", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as OllamaStatus;
  } catch (err: any) {
    return {
      installed: false,
      running: false,
      models: [],
      recommendedModel: "qwen2.5-coder:3b",
      totalRamGb: 0,
      error: err.message,
    };
  }
}

/**
 * Stream Ollama installation progress.
 * Calls onProgress with percent (0-100) and status description.
 */
export async function installOllama(onProgress: (evt: OllamaProgressEvent) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch("/api/ollama/install", { method: "POST" })
      .then((res) => {
        if (!res.body) { reject(new Error("No response body")); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        function pump(): void {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return; }
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.replace(/^data: /, "").trim();
              if (!line) continue;
              try {
                const obj = JSON.parse(line) as {
                  percent?: number;
                  status?: string;
                  log?: string;
                  done?: boolean;
                  error?: string;
                };
                if (typeof obj.percent === "number" || obj.status || obj.log) {
                  onProgress({
                    percent: obj.percent ?? 0,
                    status: obj.status || obj.log || "Installing…",
                    log: obj.log || obj.status,
                  });
                }
                if (obj.done) {
                  if (obj.error) { reject(new Error(obj.error)); return; }
                  resolve();
                  return;
                }
              } catch {}
            }
            pump();
          }).catch(reject);
        }
        pump();
      })
      .catch(reject);
  });
}

/**
 * Stream model pull progress.
 * Resolves with the pulled model name when complete.
 */
export async function pullOllamaModel(
  model: string,
  onProgress: (evt: OllamaProgressEvent) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch("/api/ollama/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    })
      .then((res) => {
        if (!res.body) { reject(new Error("No response body")); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        function pump(): void {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(model); return; }
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.replace(/^data: /, "").trim();
              if (!line) continue;
              try {
                const obj = JSON.parse(line) as {
                  percent?: number;
                  status?: string;
                  log?: string;
                  done?: boolean;
                  model?: string;
                  error?: string;
                };
                if (typeof obj.percent === "number" || obj.status || obj.log) {
                  onProgress({
                    percent: obj.percent ?? 0,
                    status: obj.status || obj.log || `Pulling ${model}…`,
                    log: obj.log || obj.status,
                  });
                }
                if (obj.done) {
                  if (obj.error) { reject(new Error(obj.error)); return; }
                  resolve(obj.model || model);
                  return;
                }
              } catch {}
            }
            pump();
          }).catch(reject);
        }
        pump();
      })
      .catch(reject);
  });
}

/** Start the Ollama server and wait for it to become healthy (up to 6s). */
export async function startOllamaServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/ollama/start", { method: "POST" });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data as { ok: boolean }).ok;
  } catch {
    return false;
  }
}

/** Returns true if this is the first time setup needs to run. */
export function isFirstLaunchSetup(): boolean {
  return !localStorage.getItem(OLLAMA_FIRST_LAUNCH_KEY);
}

/** Mark setup as completed so wizard doesn't auto-pop on next launch. */
export function markSetupComplete(): void {
  localStorage.setItem(OLLAMA_FIRST_LAUNCH_KEY, "1");
}

/** Delete an installed Ollama model to free disk space. */
export async function deleteOllamaModel(model: string): Promise<boolean> {
  try {
    const res = await fetch("/api/ollama/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return !!data.ok;
  } catch {
    return false;
  }
}

export interface CuratedOllamaModel {
  tag: string;
  name: string;
  category: string;
  size: string;
  recommendedRam: string;
  description: string;
  isPopular?: boolean;
}

export const CURATED_OLLAMA_MODELS: CuratedOllamaModel[] = [
  {
    tag: "qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder 7B",
    category: "Coding & Agents",
    size: "4.7 GB",
    recommendedRam: "16 GB+ RAM",
    description: "Flagship local coding model. Exceptional reasoning, refactoring, and AST-aware code generation.",
    isPopular: true,
  },
  {
    tag: "qwen2.5-coder:3b",
    name: "Qwen 2.5 Coder 3B",
    category: "Coding & Agents",
    size: "1.9 GB",
    recommendedRam: "8 GB RAM",
    description: "Optimal balance of performance and low memory footprint. Fast chat, generation, and syntax fixes.",
    isPopular: true,
  },
  {
    tag: "qwen2.5-coder:1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    category: "Autocomplete",
    size: "986 MB",
    recommendedRam: "4-8 GB RAM",
    description: "Ultra-fast lightweight model. Ideal for inline ghost completions and rapid code hints.",
    isPopular: true,
  },
  {
    tag: "llama3.2:3b",
    name: "Llama 3.2 3B",
    category: "General & Chat",
    size: "2.0 GB",
    recommendedRam: "8 GB RAM",
    description: "Meta's lightweight instruction-tuned model for conversational programming assistance.",
    isPopular: true,
  },
  {
    tag: "llama3.2:1b",
    name: "Llama 3.2 1B",
    category: "Ultra-Lightweight",
    size: "1.3 GB",
    recommendedRam: "4 GB RAM",
    description: "Smallest Meta Llama 3.2 release. Extremely quick responses on constrained devices.",
  },
  {
    tag: "deepseek-coder:6.7b",
    name: "DeepSeek Coder 6.7B",
    category: "Code Specialist",
    size: "3.8 GB",
    recommendedRam: "16 GB RAM",
    description: "Pre-trained on 2T code tokens. Highly capable at complex multi-file logic and debugging.",
  },
  {
    tag: "codellama:7b",
    name: "Code Llama 7B",
    category: "Code Specialist",
    size: "3.8 GB",
    recommendedRam: "16 GB RAM",
    description: "Meta's code-specialized model built specifically for software engineering workflows.",
  },
  {
    tag: "mistral:7b",
    name: "Mistral 7B",
    category: "General & Reasoning",
    size: "4.1 GB",
    recommendedRam: "16 GB RAM",
    description: "Strong general reasoning, summarization, and instruction-following capabilities.",
  },
];

export const EVENT_OPEN_OLLAMA_WIZARD = "acsa:open-ollama-wizard";
export const EVENT_OPEN_AI_MANAGEMENT = "acsa:open-ai-management";
export const EVENT_START_CODING_WITH_OLLAMA = "acsa:start-coding-with-ollama";

/** Programmatically open the Ollama setup wizard modal from anywhere in the app. */
export function openOllamaSetupWizard(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_OPEN_OLLAMA_WIZARD));
  }
}

/** Programmatically open the AI Models & Providers Management Dashboard from anywhere. */
export function openAiManagementDashboard(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_OPEN_AI_MANAGEMENT));
  }
}

/** Programmatically open AI Assistant Chat and focus input to start coding with Ollama immediately. */
export function startCodingWithOllama(model?: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_START_CODING_WITH_OLLAMA, { detail: { model } }));
  }
}

