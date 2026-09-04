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

const STORAGE_KEY = "autonomous_ide_ai_providers_v2";
const DEFAULT_PROVIDER_KEY = "autonomous_ide_default_provider_v2";

export const INITIAL_PROVIDERS: Record<AIProviderId, AIProviderConfig> = {
  deterministic: {
    id: "deterministic",
    name: "Local Deterministic AST",
    category: "local",
    isConnected: true,
    isDefault: true,
    apiKey: "",
    baseUrl: "local://ast-guard",
    selectedModel: "ast-syntax-engine",
    availableModels: ["ast-syntax-engine", "property-oracle-v2", "atomic-guard"],
    speedBadge: "Offline",
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    category: "local",
    isConnected: false,
    isDefault: false,
    apiKey: "",
    baseUrl: "http://127.0.0.1:11434",
    selectedModel: "llama3.2",
    availableModels: ["llama3.2", "codellama", "deepseek-r1:8b", "qwen2.5-coder:7b"],
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
    selectedModel: "default-gguf",
    availableModels: ["default-gguf", "q4_k_m", "q8_0"],
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
    if (!raw) return cloneInitialProviders();
    const parsed = JSON.parse(raw);
    const defaultId = (localStorage.getItem(DEFAULT_PROVIDER_KEY) || "deterministic") as AIProviderId;

    const merged = cloneInitialProviders();
    for (const key of Object.keys(parsed) as AIProviderId[]) {
      if (merged[key]) {
        merged[key] = {
          ...merged[key],
          ...parsed[key],
          isDefault: key === defaultId,
        };
      }
    }
    return merged;
  } catch {
    return cloneInitialProviders();
  }
}

export function saveProviderConfig(config: AIProviderConfig): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  all[config.id] = { ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return all;
}

export function setDefaultProvider(providerId: AIProviderId): Record<AIProviderId, AIProviderConfig> {
  const all = loadAllProviders();
  for (const id of Object.keys(all) as AIProviderId[]) {
    all[id].isDefault = id === providerId;
  }
  try {
    localStorage.setItem(DEFAULT_PROVIDER_KEY, providerId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return all;
}

export function getDefaultProvider(): AIProviderConfig {
  const all = loadAllProviders();
  const defaultId = (localStorage.getItem(DEFAULT_PROVIDER_KEY) || "deterministic") as AIProviderId;
  return all[defaultId] || all.deterministic;
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
    if (p.category === "local" || p.apiKey || p.isDefault) {
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

  if (!list.some((m) => m.providerId === "deterministic")) {
    list.unshift({
      providerId: "deterministic",
      providerName: "Local Deterministic AST",
      model: "ast-syntax-engine",
      speedBadge: "Offline",
      isDefault: true,
      category: "local",
    });
  }

  return list;
}
