/**
 * aiModelManager.ts — Multi-Model AI Management & Configuration Service
 *
 * Provides:
 * 1. Multi-provider configuration management (persisted in localStorage).
 * 2. Local-first defaults (Deterministic AST / Ollama / llama.cpp as original default).
 * 3. Default model selection and switching.
 * 4. Model inventory for inline prompt model picker.
 */

import type { AIProviderConfig, AIProviderId } from "../types/workbench";

const STORAGE_KEY = "acsa_code_ai_providers_v4";
const DEFAULT_PROVIDER_KEY = "acsa_code_default_provider_v4";
const PREV_STORAGE_KEY_V3 = "acsa_code_ai_providers_v3";
const LEGACY_STORAGE_KEY = "autonomous_ide_ai_providers_v2";

export const INITIAL_PROVIDERS: Record<AIProviderId, AIProviderConfig> = {
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    category: "local",
    isConnected: true,
    isDefault: true,
    apiKey: "",
    baseUrl: "http://127.0.0.1:11434",
    selectedModel: "qwen2.5-coder:7b",
    availableModels: ["qwen2.5-coder:7b"],
    speedBadge: "Fast",
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp (Local GGUF)",
    category: "local",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "http://127.0.0.1:8080",
    selectedModel: "",
    availableModels: [],
    speedBadge: "Fast",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    selectedModel: "gpt-4o",
    availableModels: ["gpt-4o", "gpt-4o-mini", "o3", "o1", "o1-pro", "gpt-4-turbo"],
    speedBadge: "Fast",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    selectedModel: "claude-3-7-sonnet-latest",
    availableModels: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    speedBadge: "Thinking",
  },
  google: {
    id: "google",
    name: "Google Gemini",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com",
    selectedModel: "gemini-2.0-flash",
    availableModels: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    speedBadge: "Fast",
  },
  groq: {
    id: "groq",
    name: "Groq",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.groq.com/openai/v1",
    selectedModel: "deepseek-r1-distill-llama-70b",
    availableModels: ["deepseek-r1-distill-llama-70b", "llama-3.3-70b-versatile"],
    speedBadge: "Fast",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.mistral.ai/v1",
    selectedModel: "codestral-latest",
    availableModels: ["codestral-latest", "mistral-large-latest", "mistral-small-latest"],
    speedBadge: "Medium",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    selectedModel: "deepseek-reasoner",
    availableModels: ["deepseek-reasoner", "deepseek-chat"],
    speedBadge: "Thinking",
  },
  xai: {
    id: "xai",
    name: "xAI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    selectedModel: "grok-2-latest",
    availableModels: ["grok-2-latest", "grok-2-vision-1212", "grok-beta"],
    speedBadge: "Fast",
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot AI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.moonshot.cn/v1",
    selectedModel: "moonshot-v1-128k",
    availableModels: ["moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
    speedBadge: "Medium",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.cohere.ai/v1",
    selectedModel: "command-r-plus",
    availableModels: ["command-r-plus", "command-r", "c4ai-aya-expanse-32b"],
    speedBadge: "Medium",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity AI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.perplexity.ai",
    selectedModel: "sonar-pro",
    availableModels: ["sonar-pro", "sonar-reasoning-pro", "sonar", "sonar-reasoning"],
    speedBadge: "Fast",
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api-inference.huggingface.co/v1",
    selectedModel: "Qwen/Qwen2.5-Coder-32B-Instruct",
    availableModels: ["Qwen/Qwen2.5-Coder-32B-Instruct", "meta-llama/Llama-3.3-70B-Instruct", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"],
    speedBadge: "Medium",
  },
  together: {
    id: "together",
    name: "Together AI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.together.xyz/v1",
    selectedModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    availableModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    speedBadge: "Fast",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    selectedModel: "anthropic/claude-3.7-sonnet",
    availableModels: ["anthropic/claude-3.7-sonnet", "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-2.0-flash-001", "deepseek/deepseek-r1"],
    speedBadge: "Medium",
  },
};

export const NON_CODE_OR_UTILITY_TERMS = [
  "embed",
  "whisper",
  "transcribe",
  "tts",
  "audio",
  "voice",
  "dall-e",
  "moderation",
  "realtime",
  "guard",
  "sora",
  "video",
  "babbage",
  "davinci",
  "ft:",
  "flux",
  "midjourney",
];

export const NON_CODE_MODALITIES = NON_CODE_OR_UTILITY_TERMS;

export function isCodingChatModel(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  const l = id.toLowerCase().trim();

  // 1. Block non-code utilities, speech, media generation, embeddings, and moderation guards
  if (NON_CODE_OR_UTILITY_TERMS.some((term) => l.includes(term))) return false;

  // 2. Block obsolete / retired legacy models
  if (l.startsWith("gpt-3.5")) return false;
  if (l === "gpt-4" || l.startsWith("gpt-4-0") || l === "gpt-4-32k") return false;
  if (l.startsWith("gpt-4.1")) return false;
  if (l.includes("o1-mini") || l.includes("o3-mini")) return false; // Retired / scheduled for late 2026 retirement
  if (l.startsWith("claude-2") || l.startsWith("claude-1") || l.includes("instant")) return false;
  if (l.includes("bison") || l.includes("palm") || l.includes("aqa") || l.includes("imagen")) return false;
  if (l === "mistral-tiny" || l.includes("embed")) return false;

  // 3. Block dated snapshot aliases (-YYYY-MM-DD, -YYYYMMDD, -MMDD)
  if (/-\d{4}-\d{2}-\d{2}$/.test(l) || /-\d{8}$/.test(l) || /-\d{6}$/.test(l) || /-\d{4}$/.test(l)) {
    return false;
  }

  return true;
}

/**
 * Dynamically scores a model for coding and complex tasks based on its capabilities,
 * architecture tier, and version, rather than rigid name hardcoding.
 */
export function scoreModelForCoding(_providerId: string, modelName: string): number {
  if (!modelName || typeof modelName !== "string") return 0;
  const m = modelName.toLowerCase();
  let score = 0;

  // Coding specialization (Codex, Coder, Dev, Synthesizer)
  if (m.includes("codex") || m.includes("coder") || m.includes("code") || m.includes("dev")) {
    score += 100;
  }
  // Deep reasoning architectures (o3, o1, o4, DeepSeek-R1, Reasoner, Thinking)
  if (m.includes("reason") || m.includes("thinking") || /^o\d/i.test(m) || m.includes("-r1")) {
    score += 90;
  }
  // Flagship / Frontier tiers
  if (m.includes("sonnet") || m.includes("pro") || m.includes("large") || m.includes("ultra") || m.includes("astra")) {
    score += 80;
  } else if (m.includes("plus") || m.includes("turbo") || m.includes("max")) {
    score += 70;
  } else if (m.includes("flash") || m.includes("haiku") || m.includes("mini") || m.includes("small") || m.includes("lite")) {
    score += 65;
  }

  // Version extraction: higher numerical versions automatically outrank older versions (e.g. 3.7 > 3.5 > 2.0 > 1.5)
  const vMatch = m.match(/(?:v|gpt-|claude-|gemini-)?(\d+(?:\.\d+)?)/);
  if (vMatch && vMatch[1]) {
    const v = parseFloat(vMatch[1]);
    if (!isNaN(v) && v < 20) {
      score += v * 5;
    }
  }

  // Snapshot penalization: prefer stable base names over timestamped releases
  if (/-\d{4}-\d{2}-\d{2}$/.test(m) || /-\d{8}$/.test(m) || /-\d{6}$/.test(m) || /-\d{4}$/.test(m)) {
    score -= 30;
  }

  return score;
}

/**
 * Curates models for a provider using dynamic capability and tier scoring,
 * ensuring high-performing models (including all future releases) are ranked at the top.
 */
export function curateProviderModels(providerId: string, rawModels: string[]): string[] {
  if (!Array.isArray(rawModels)) return [];
  const valid = Array.from(new Set(rawModels.filter(Boolean).filter(isCodingChatModel)));

  if (valid.length === 0) {
    // If strict filter removed everything, fallback to raw chat-capable models
    const fallback = rawModels
      .filter(Boolean)
      .filter((m) => !NON_CODE_OR_UTILITY_TERMS.some((term) => m.toLowerCase().includes(term)));
    return fallback.slice(0, 10);
  }

  // Score and sort models dynamically without hardcoded model lists
  const scored = valid.map((m) => ({ model: m, score: scoreModelForCoding(providerId, m) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 12).map((s) => s.model);
}

export function loadAllProviders(): Record<AIProviderId, AIProviderConfig> {
  const cloneInitialProviders = () =>
    Object.fromEntries(
      Object.entries(INITIAL_PROVIDERS).map(([id, provider]) => [id, {
        ...provider,
        availableModels: [...provider.availableModels],
      }])
    ) as Record<AIProviderId, AIProviderConfig>;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Migration from previous or legacy storage keys
    if (!raw) {
      const prevStorage = localStorage.getItem(PREV_STORAGE_KEY_V3) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (prevStorage) {
        try {
          const oldParsed = JSON.parse(prevStorage);
          const migrated = cloneInitialProviders();
          for (const key of Object.keys(oldParsed) as AIProviderId[]) {
            if (migrated[key]) {
              if (migrated[key].category === "cloud") {
                migrated[key].apiKey = oldParsed[key]?.apiKey || "";
                migrated[key].baseUrl = oldParsed[key]?.baseUrl || migrated[key].baseUrl;
                migrated[key].isConnected = !!(oldParsed[key]?.apiKey);
              }
            }
          }
          delete (migrated as any).deterministic;
          migrated.ollama.selectedModel = "qwen2.5-coder:7b";
          migrated.ollama.availableModels = ["qwen2.5-coder:7b"];
          migrated.ollama.isConnected = true;
          migrated.ollama.isDefault = true;
          migrated.llamacpp.isConnected = false;
          migrated.llamacpp.selectedModel = "";
          migrated.llamacpp.availableModels = [];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          localStorage.setItem(DEFAULT_PROVIDER_KEY, "ollama");
          return migrated;
        } catch {}
      }
      const initial = cloneInitialProviders();
      delete (initial as any).deterministic;
      return initial;
    }

    const parsed = JSON.parse(raw);
    let defaultId = (localStorage.getItem(DEFAULT_PROVIDER_KEY) || "ollama") as AIProviderId;
    if (defaultId === ("deterministic" as AIProviderId)) {
      defaultId = "ollama";
      try {
        localStorage.setItem(DEFAULT_PROVIDER_KEY, "ollama");
      } catch {}
    }

    const merged = cloneInitialProviders();
    for (const key of Object.keys(parsed) as AIProviderId[]) {
      if (key === ("deterministic" as AIProviderId)) continue; // Purge deterministic
      if (merged[key]) {
        merged[key] = {
          ...merged[key],
          ...parsed[key],
          isDefault: key === defaultId,
        };
      }
    }
    delete (merged as any).deterministic;

    // Sanitize llamacpp: prevent stale fake connected state from older sessions
    if (merged.llamacpp) {
      if (
        merged.llamacpp.selectedModel === "default-gguf" ||
        merged.llamacpp.availableModels.includes("default-gguf")
      ) {
        merged.llamacpp.selectedModel = "";
        merged.llamacpp.availableModels = [];
        merged.llamacpp.isConnected = false;
      }
    }

    // ── Active Sanitation & Model Refresh for Cloud Models ───────
    let needsCloudResave = false;
    for (const [pId, initConfig] of Object.entries(INITIAL_PROVIDERS) as [AIProviderId, AIProviderConfig][]) {
      if (pId === "ollama" || pId === "llamacpp") continue;
      const current = merged[pId];
      if (current) {
        // If parsed storage has models, curate them to strict code flagships; otherwise seed with initConfig.availableModels
        const savedModels = parsed[pId]?.availableModels;
        if (Array.isArray(savedModels) && savedModels.length > 0) {
          const curated = curateProviderModels(pId, savedModels);
          const savedSelection = parsed[pId]?.selectedModel;
          const preserved = savedSelection && savedModels.includes(savedSelection) && !curated.includes(savedSelection)
            ? [savedSelection, ...curated]
            : curated;
          current.availableModels = preserved.length > 0 ? preserved : [...initConfig.availableModels];
          if (preserved.length !== savedModels.length) {
            needsCloudResave = true;
          }
        } else {
          current.availableModels = [...initConfig.availableModels];
        }
        // Ensure selectedModel is valid and exists in curated models
        if (!current.selectedModel || !current.availableModels.includes(current.selectedModel)) {
          current.selectedModel = current.availableModels[0] || initConfig.selectedModel;
          needsCloudResave = true;
        }
      }
    }

    // Ensure default provider is valid
    if (!merged[defaultId]) {
      merged.ollama.isDefault = true;
      try {
        localStorage.setItem(DEFAULT_PROVIDER_KEY, "ollama");
      } catch {}
    }

    // Resave cleaned storage if deterministic was stripped or models were migrated
    if (parsed.deterministic || parsed.llamacpp?.selectedModel === "default-gguf" || needsCloudResave) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {}
    }

    return merged;
  } catch {
    const initial = cloneInitialProviders();
    delete (initial as any).deterministic;
    return initial;
  }
}

export function saveProviderConfig(config: AIProviderConfig): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  delete (all as any).deterministic;
  all[config.id] = { ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return all;
}

export function setDefaultProvider(providerId: AIProviderId): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  delete (all as any).deterministic;
  const targetId = providerId === ("deterministic" as AIProviderId) ? "ollama" : providerId;
  for (const id of Object.keys(all) as AIProviderId[]) {
    if (all[id]) {
      all[id].isDefault = id === targetId;
    }
  }
  try {
    localStorage.setItem(DEFAULT_PROVIDER_KEY, targetId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return all;
}

export function getDefaultProvider(): AIProviderConfig {
  const all = loadAllProviders();
  const defaultId = (localStorage.getItem(DEFAULT_PROVIDER_KEY) || "ollama") as AIProviderId;
  return all[defaultId] || all.ollama;
}

export const LOCAL_WORKER_KEY = "acsa_local_worker_model";

/**
 * Dynamically scores a local model tag for code synthesis and worker tasks.
 * Evaluates coding tokens, architecture family, version number, and parameter count.
 */
export function scoreLocalModel(modelName: string): number {
  if (!modelName || typeof modelName !== "string") return 0;
  const name = modelName.toLowerCase();
  let score = 0;

  // Coding specialization bonus
  if (name.includes("coder") || name.includes("code") || name.includes("dev") || name.includes("synthes")) {
    score += 50;
  }
  // Reasoning bonus
  if (name.includes("reason") || name.includes("deepseek-r1") || name.includes("thinking")) {
    score += 30;
  }
  // Proven local code architectures
  if (name.includes("qwen")) {
    score += 25;
  } else if (name.includes("deepseek")) {
    score += 24;
  } else if (name.includes("codestral") || name.includes("mistral")) {
    score += 22;
  } else if (name.includes("llama")) {
    score += 20;
  } else if (name.includes("starcoder")) {
    score += 18;
  }

  // Version number bonus (e.g. 3.3 > 3.1 > 2.5 > 2)
  const versionMatch = name.match(/(?:v|version)?(\d+(?:\.\d+)?)/);
  if (versionMatch && versionMatch[1]) {
    const v = parseFloat(versionMatch[1]);
    if (!isNaN(v) && v < 50) {
      score += v * 2;
    }
  }

  // Parameter size bonus (e.g. 32b > 14b > 7b > 3b)
  const sizeMatch = name.match(/(\d+)b/);
  if (sizeMatch && sizeMatch[1]) {
    const size = parseFloat(sizeMatch[1]);
    if (!isNaN(size)) {
      score += Math.min(size, 70) * 0.5;
    }
  }

  return score;
}

export const LOCAL_WORKER_PREFERENCE = [
  "qwen2.5-coder",
  "deepseek-coder",
  "codestral",
  "llama",
  "mistral",
];

export function autoSelectBestLocalWorker(installedModels: string[]): string | null {
  if (!installedModels || installedModels.length === 0) return null;
  const clean = installedModels.filter(Boolean);
  if (clean.length === 0) return null;

  const scored = clean.map((m) => ({ model: m, score: scoreLocalModel(m) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.model || clean[0];
}

export function getAutoSelectedLocalWorker(): string {
  try {
    const stored = localStorage.getItem(LOCAL_WORKER_KEY);
    if (stored) return stored;
  } catch {}
  const all = loadAllProviders();
  if (all.ollama && all.ollama.availableModels && all.ollama.availableModels.length > 0) {
    const best = autoSelectBestLocalWorker(all.ollama.availableModels);
    if (best) return best;
  }
  return "qwen2.5-coder:7b";
}

export function setAutoSelectedLocalWorker(modelName: string): void {
  try {
    localStorage.setItem(LOCAL_WORKER_KEY, modelName);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("acsa:local-worker-updated", { detail: { model: modelName } })
      );
    }
  } catch {}
}

export function addCustomModelToProvider(
  providerId: AIProviderId,
  customModel: string
): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  const trimmed = customModel.trim();
  if (!trimmed || !all[providerId]) return all;

  if (!all[providerId].availableModels.includes(trimmed)) {
    all[providerId].availableModels = [trimmed, ...all[providerId].availableModels];
  }
  all[providerId].selectedModel = trimmed;
  const updated = saveProviderConfig(all[providerId]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("acsa:models-updated"));
  }
  return updated;
}

/**
 * Dynamically synchronizes locally installed Ollama models with the active AI configuration.
 * - Stores ONLY genuinely installed models in availableModels.
 * - Auto-selects the optimal local code worker based on capability ranking.
 * - Dispatches 'acsa:models-updated' event to notify UI components.
 */
export function syncOllamaModels(
  installedModels: string[],
  activeModel?: string
): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  if (all.ollama) {
    const cleanInstalled = Array.from(new Set(installedModels.filter(Boolean)));
    all.ollama.availableModels = cleanInstalled;
    all.ollama.isConnected = cleanInstalled.length > 0;

    const bestWorker = autoSelectBestLocalWorker(cleanInstalled);
    if (bestWorker) {
      setAutoSelectedLocalWorker(bestWorker);
    }

    if (activeModel && cleanInstalled.some((m) => m === activeModel || m.startsWith(`${activeModel}:`))) {
      all.ollama.selectedModel = activeModel;
    } else {
      const current = all.ollama.selectedModel || "";
      const currentExists = cleanInstalled.some(
        (m) =>
          m === current ||
          m === `${current}:latest` ||
          current === `${m}:latest` ||
          m.startsWith(`${current}:`) ||
          current.startsWith(`${m}:`)
      );
      if (currentExists) {
        all.ollama.selectedModel = current;
      } else if (bestWorker) {
        all.ollama.selectedModel = bestWorker;
      } else if (cleanInstalled.length > 0) {
        all.ollama.selectedModel = cleanInstalled[0];
      }
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("acsa:models-updated"));
    }
  } catch {}
  return all;
}

export interface ConfiguredModelItem {
  providerId: AIProviderId;
  providerName: string;
  model: string;
  speedBadge: "Fast" | "Medium" | "Thinking" | "Offline";
  isDefault: boolean;
  category: "local" | "cloud";
}

/**
 * Returns available Orchestrator Brains for user selection.
 * Defaults to configured cloud models only (local models are autonomously managed as workers).
 */
export function getConfiguredModelsList(includeLocal: boolean = false): ConfiguredModelItem[] {
  const all = loadAllProviders();
  const list: ConfiguredModelItem[] = [];

  for (const p of Object.values(all)) {
    // Exclude deterministic AST engine: it is a code-gate compiler, not an LLM chat model
    if ((p.id as string) === "deterministic") continue;

    if (p.category === "cloud") {
      // Cloud providers: only show if user configured an API key
      if (p.apiKey && p.apiKey.trim().length > 3) {
        const rawModels = p.availableModels && p.availableModels.length > 0
          ? p.availableModels
          : [p.selectedModel];
        const cleanModels = curateProviderModels(p.id, rawModels);
        const models = cleanModels.length > 0 ? cleanModels : rawModels;
        for (const m of models) {
          if (!m) continue;
          list.push({
            providerId: p.id,
            providerName: p.name,
            model: m,
            speedBadge: p.speedBadge || "Medium",
            isDefault: p.isDefault && p.selectedModel === m,
            category: p.category,
          });
        }
      }
    } else if (includeLocal) {
      if (p.id === "ollama") {
        if (p.availableModels && p.availableModels.length > 0) {
          for (const m of p.availableModels) {
            list.push({
              providerId: p.id,
              providerName: p.availableModels.length > 1 ? `Ollama (${m})` : "Ollama (Local)",
              model: m,
              speedBadge: p.speedBadge || "Fast",
              isDefault: p.isDefault && p.selectedModel === m,
              category: p.category,
            });
          }
        }
      } else if (p.id === "llamacpp") {
        if (p.isConnected && p.selectedModel) {
          list.push({
            providerId: p.id,
            providerName: p.name,
            model: p.selectedModel,
            speedBadge: p.speedBadge || "Fast",
            isDefault: p.isDefault,
            category: p.category,
          });
        }
      }
    }
  }

  return list;
}

export const SELECTED_MODEL_KEY = "acsa_active_selected_model_v2";

export interface StoredSelectedModel {
  providerId: AIProviderId;
  model: string;
}

/**
 * Persists the user's explicitly selected model across reloads, panel open/closes, and sessions.
 * Chat models are strictly Cloud Brain models; local models are managed by the background orchestrator.
 */
export function saveActiveSelectedModel(providerId: AIProviderId, model: string): void {
  if (!providerId || !model) return;
  try {
    const all = loadAllProviders();
    if (all[providerId]?.category === "local" || providerId === "ollama" || providerId === "llamacpp") {
      // Local models are background workers and must never be saved as the chat model selector choice
      return;
    }
    localStorage.setItem(SELECTED_MODEL_KEY, JSON.stringify({ providerId, model }));
    if (all[providerId]) {
      all[providerId].selectedModel = model;
      saveProviderConfig(all[providerId]);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("acsa:selected-model-changed", { detail: { providerId, model } })
      );
    }
  } catch {}
}

/**
 * Retrieves the user's previously selected model from persistent storage.
 */
export function getActiveSelectedModel(): StoredSelectedModel | null {
  try {
    const raw = localStorage.getItem(SELECTED_MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.providerId && parsed.model) {
      const pid = parsed.providerId as AIProviderId;
      const all = loadAllProviders();
      // Purge any legacy local model from persistent storage so it never pollutes the chat selector
      if (all[pid]?.category === "local" || pid === "ollama" || pid === "llamacpp") {
        localStorage.removeItem(SELECTED_MODEL_KEY);
        return null;
      }
      return parsed as StoredSelectedModel;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the active model item, guaranteeing that user-selected models persist across page reloads.
 * By default (includeLocal = false), only cloud models are considered.
 */
export function resolveInitialSelectedModel(includeLocal: boolean = false): ConfiguredModelItem | null {
  const list = getConfiguredModelsList(includeLocal);
  const saved = getActiveSelectedModel();

  if (saved) {
    // 1. Try finding in current configured list
    const exact = list.find((m) => m.providerId === saved.providerId && m.model === saved.model);
    if (exact) return exact;

    // 2. Fallback to model name match in configured list
    const byName = list.find((m) => m.model === saved.model);
    if (byName) return byName;
  }

  // 3. Fallback to default configured item
  const defaultItem = list.find((m) => m.isDefault);
  if (defaultItem) return defaultItem;

  // 4. Fallback to first available model in list
  return list[0] || null;
}

export interface ModelDownloadState {
  modelName: string;
  progressPercentage: number;
  downloadedBytes: number;
  totalBytes: number;
  status: "downloading" | "paused" | "interrupted" | "completed";
}

const DOWNLOAD_STATE_KEY = "acsa_code_model_downloads_v1";

export function saveModelDownloadState(state: ModelDownloadState): void {
  try {
    const raw = localStorage.getItem(DOWNLOAD_STATE_KEY) || "{}";
    const states = JSON.parse(raw);
    states[state.modelName] = state;
    localStorage.setItem(DOWNLOAD_STATE_KEY, JSON.stringify(states));
  } catch {}
}

export function getModelDownloadState(modelName: string): ModelDownloadState | null {
  try {
    const raw = localStorage.getItem(DOWNLOAD_STATE_KEY);
    if (!raw) return null;
    const states = JSON.parse(raw);
    return states[modelName] || null;
  } catch {
    return null;
  }
}

export function clearModelDownloadState(modelName: string): void {
  try {
    const raw = localStorage.getItem(DOWNLOAD_STATE_KEY);
    if (!raw) return;
    const states = JSON.parse(raw);
    delete states[modelName];
    localStorage.setItem(DOWNLOAD_STATE_KEY, JSON.stringify(states));
  } catch {}
}

import { ModelCapability } from "../types/workbench";

export function routeTaskToBestModel(
  taskType: ModelCapability,
  providers: Record<AIProviderId, AIProviderConfig>
): AIProviderConfig | null {
  for (const p of Object.values(providers)) {
    if (p.isConnected && p.capabilities?.includes(taskType)) {
      return p;
    }
  }
  return null;
}

/**
 * Determines whether a model supports multimodal vision/image inputs.
 * Uses semantic capability indicators and permissive frontier defaults rather than brittle whitelists.
 */
export function isModelVisionCapable(providerId: string, modelName: string): boolean {
  const p = (providerId || "").toLowerCase();
  const m = (modelName || "").toLowerCase();

  // 1. Explicit semantic vision keywords or architecture tags across any provider
  if (
    m.includes("vision") ||
    m.includes("vl-") ||
    m.includes("-vl") ||
    m.includes("_vl") ||
    m.includes("pixtral") ||
    m.includes("llava") ||
    m.includes("minicpm") ||
    m.includes("moondream") ||
    m.includes("bakllava") ||
    m.includes("cogvlm") ||
    m.includes("internvl") ||
    m.includes("omni") ||
    m.includes("4o")
  ) {
    return true;
  }

  // 2. Explicit pure-text or non-vision utility models are never vision-capable
  if (
    m.includes("embed") ||
    m.includes("whisper") ||
    m.includes("tts") ||
    m.includes("transcribe") ||
    m.includes("moderation") ||
    m.startsWith("gpt-3.5") ||
    m.startsWith("claude-2") ||
    m.startsWith("claude-1") ||
    m === "gpt-4" ||
    m.startsWith("gpt-4-0") ||
    m === "gpt-4-32k"
  ) {
    return false;
  }

  // 3. Frontier cloud providers: multimodality is standard for modern/future generative models
  if (p === "google" || p === "anthropic" || p === "openai" || p === "openrouter") {
    return true;
  }

  // 4. Local engines (Ollama, llama.cpp): default to false unless explicit vision weights are indicated
  if (p === "ollama" || p === "llamacpp") {
    return false;
  }

  // 5. Other cloud providers (Groq, Mistral, DeepSeek, xAI, etc.):
  // If unrecognized, default to permissive (runtime self-healing will catch API 400s)
  return true;
}

/**
 * Finds the best active vision model available among configured providers using dynamic scoring.
 */
export function findBestAvailableVisionModel(
  providers?: Record<AIProviderId, AIProviderConfig>,
  includeLocal: boolean = false
): ConfiguredModelItem | null {
  const activeProviders = providers || loadAllProviders();
  const configuredModels = getConfiguredModelsList(includeLocal);

  // Filter only vision-capable configured models
  const visionModels = configuredModels.filter((item) =>
    isModelVisionCapable(item.providerId, item.model)
  );

  if (visionModels.length === 0) {
    // If not in configured list, check active cloud providers directly
    for (const [pId, pConfig] of Object.entries(activeProviders)) {
      if (
        pConfig &&
        (includeLocal || pConfig.category === "cloud") &&
        (pConfig.isConnected || (pConfig.apiKey && pConfig.apiKey.trim().length > 4))
      ) {
        const rawModels = pConfig.availableModels && pConfig.availableModels.length > 0
          ? pConfig.availableModels
          : [pConfig.selectedModel];
        const visionModel = rawModels.find((m) => m && isModelVisionCapable(pId as AIProviderId, m));
        if (visionModel) {
          return {
            providerId: pId as AIProviderId,
            providerName: pConfig.name,
            model: visionModel,
            speedBadge: pConfig.speedBadge || "Fast",
            isDefault: pConfig.isDefault || false,
            category: pConfig.category || "cloud",
          };
        }
      }
    }
    return null;
  }

  // Score vision models dynamically: prefer fast/cost-effective models for quick vision queries
  const scored = visionModels.map((item) => {
    let score = 0;
    const m = item.model.toLowerCase();
    if (item.speedBadge === "Fast") score += 30;
    if (m.includes("flash") || m.includes("haiku") || m.includes("mini")) score += 25;
    if (item.category === "cloud") score += 20;
    if (item.providerId === "google" || item.providerId === "openai" || item.providerId === "anthropic") score += 15;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || visionModels[0];
}

