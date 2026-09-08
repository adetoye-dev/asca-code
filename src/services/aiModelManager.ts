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

const STORAGE_KEY = "acsa_code_ai_providers_v3";
const DEFAULT_PROVIDER_KEY = "acsa_code_default_provider_v3";
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
    availableModels: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1", "gpt-5.2"],
    speedBadge: "Medium",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    selectedModel: "claude-3-7-sonnet",
    availableModels: ["claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku"],
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
    selectedModel: "gemini-2.5-flash",
    availableModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.8-flash"],
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
    selectedModel: "llama-3.3-70b-versatile",
    availableModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"],
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
    selectedModel: "deepseek-chat",
    availableModels: ["deepseek-chat", "deepseek-reasoner"],
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
    availableModels: ["grok-2-latest", "grok-beta"],
    speedBadge: "Thinking",
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot AI",
    category: "cloud",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "https://api.moonshot.cn/v1",
    selectedModel: "moonshot-v1-8k",
    availableModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    speedBadge: "Medium",
  },
};

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
    // Migration from legacy storage key
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        try {
          const oldParsed = JSON.parse(legacy);
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

    // Ensure default provider is valid
    if (!merged[defaultId]) {
      merged.ollama.isDefault = true;
      try {
        localStorage.setItem(DEFAULT_PROVIDER_KEY, "ollama");
      } catch {}
    }

    // Resave cleaned storage if deterministic was stripped
    if (parsed.deterministic || parsed.llamacpp?.selectedModel === "default-gguf") {
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

/**
 * Dynamically synchronizes locally installed Ollama models with the active AI configuration.
 * - Stores ONLY genuinely installed models in availableModels.
 * - Ensures selectedModel points to an existing, valid downloaded model.
 * - Dispatches 'acsa:models-updated' event to notify UI components.
 */
export function syncOllamaModels(
  installedModels: string[],
  activeModel?: string
): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  if (all.ollama) {
    const cleanInstalled = Array.from(new Set(installedModels.filter(Boolean)));
    // STRICT: Only genuinely downloaded models are available
    all.ollama.availableModels = cleanInstalled;
    all.ollama.isConnected = cleanInstalled.length > 0;

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
      if (!currentExists && cleanInstalled.length > 0) {
        all.ollama.selectedModel = cleanInstalled[0];
      }
    }

    // Default to Ollama when models are installed
    if (cleanInstalled.length > 0) {
      all.ollama.isDefault = true;
      try {
        localStorage.setItem(DEFAULT_PROVIDER_KEY, "ollama");
      } catch {}
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

export function getConfiguredModelsList(): ConfiguredModelItem[] {
  const all = loadAllProviders();
  const list: ConfiguredModelItem[] = [];

  for (const p of Object.values(all)) {
    // Exclude deterministic AST engine: it is a code-gate compiler, not an LLM chat model
    if ((p.id as string) === "deterministic") continue;

    if (p.id === "ollama") {
      // List ONLY models that are actually installed and available
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
      // Only include llama.cpp if actually connected and has a model loaded
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
    } else if (p.category === "cloud") {
      // Cloud providers: only show if user configured an API key
      if (p.apiKey && p.apiKey.trim().length > 3) {
        list.push({
          providerId: p.id,
          providerName: p.name,
          model: p.selectedModel,
          speedBadge: p.speedBadge || "Medium",
          isDefault: p.isDefault,
          category: p.category,
        });
      }
    }
  }

  return list;
}
