/**
 * appStore.ts — the workbench's own state, backed by the app database.

 * Everything here used to live in browser `localStorage`: the provider registry
 * with API keys in it, chat history, recent projects, the active-project pointer
 * and assorted flags. That state is per-browser, invisible to the engine, and —
 * for credentials — exactly the wrong place. It now lives in one SQLite database
 * owned by `core-engine/app_db.py`, reached through the bridge.

 * Credentials are write-only across this boundary: you can set or clear a key
 * and ask whether one is configured, but the value never comes back to the page.
 */

export interface StoredProvider {
  baseUrl: string;
  selectedModel: string;
  availableModels: string[];
  hasApiKey: boolean;
}

export interface StoredProject {
  path: string;
  name: string;
  last_opened_at: number;
  is_active: number;
}

export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  provider?: string | null;
  model?: string | null;
  error?: boolean;
  timestamp: number;
}

export interface UsageSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  byModel: Array<{ provider: string; model: string; calls: number; cost_usd: number; tokens: number }>;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

/** True when the bridge (dev) owns the database; false in a packaged build. */
const hasBridge = typeof window !== "undefined" && window.location.protocol.startsWith("http");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || `${path} failed (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export const appStore = {
  available: hasBridge,

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => request<Record<string, unknown>>("/api/app/settings"),
  setSetting: (key: string, value: unknown) =>
    request<{ ok: true }>("/api/app/settings", {
      method: "POST",
      body: JSON.stringify({ key, value }),
    }),

  // ── Providers (never includes credentials) ────────────────────────────────
  getProviders: () => request<Record<string, StoredProvider>>("/api/app/providers"),
  upsertProvider: (provider: {
    id: string;
    baseUrl?: string;
    selectedModel?: string;
    availableModels?: string[];
  }) => request<{ ok: true }>("/api/app/providers", { method: "POST", body: JSON.stringify(provider) }),

  // ── Credentials (write-only) ──────────────────────────────────────────────
  listSecretNames: () => request<string[]>("/api/app/secrets"),
  setSecret: (name: string, value: string) =>
    request<{ ok: true }>("/api/app/secrets", { method: "POST", body: JSON.stringify({ name, value }) }),
  clearSecret: (name: string) =>
    request<{ ok: true }>(`/api/app/secrets?name=${encodeURIComponent(name)}`, { method: "DELETE" }),

  // ── Projects ──────────────────────────────────────────────────────────────
  listProjects: (limit = 10) => request<StoredProject[]>(`/api/app/projects?limit=${limit}`),
  touchProject: (path: string, name: string) =>
    request<{ ok: true }>("/api/app/projects", { method: "POST", body: JSON.stringify({ path, name }) }),
  forgetProject: (path: string) =>
    request<{ ok: true }>("/api/app/projects/forget", { method: "POST", body: JSON.stringify({ path }) }),
  getActiveProject: () =>
    request<{ path: string; name: string } | null>("/api/app/projects/active"),

  // ── Chat history ──────────────────────────────────────────────────────────
  loadChat: (projectRoot: string) =>
    request<StoredMessage[]>(`/api/app/chat?projectRoot=${encodeURIComponent(projectRoot)}`),
  saveChat: (projectRoot: string, messages: StoredMessage[]) =>
    request<{ ok: true }>("/api/app/chat", {
      method: "POST",
      body: JSON.stringify({ projectRoot, messages }),
    }),
  clearChat: (projectRoot: string) =>
    request<{ ok: true }>("/api/app/chat/clear", {
      method: "POST",
      body: JSON.stringify({ projectRoot }),
    }),

  // ── Usage ─────────────────────────────────────────────────────────────────
  usageSummary: (projectRoot?: string) =>
    request<UsageSummary>(
      `/api/app/usage${projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : ""}`
    ),

  // ── Accounts ──────────────────────────────────────────────────────────────
  register: (email: string, password: string, displayName?: string) =>
    request<Account>("/api/app/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),
  login: (email: string, password: string) =>
    request<{ account: Account; token: string }>("/api/app/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: (token: string) =>
    request<{ ok: true }>("/api/app/auth/logout", { method: "POST", body: JSON.stringify({ token }) }),
  me: (token: string) =>
    request<Account | null>("/api/app/auth/me", { headers: { "x-acsa-session": token } }),
};

// ── Session token ───────────────────────────────────────────────────────────
// The token is a bearer credential for this local install, so it is kept in
// sessionStorage rather than localStorage: it does not outlive the window.

const SESSION_TOKEN_KEY = "acsa_session_token";

export function getSessionToken(): string {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setSessionToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    else sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* storage disabled */
  }
}

export default appStore;
