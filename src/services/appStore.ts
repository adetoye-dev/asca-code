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

import { desktopRequired, engineCall, hasIpc } from "./engineBridge";

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
  total_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  total_latency_ms: number;
  by_model: Array<{
    provider: string;
    model: string;
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    latency_ms: number;
  }>;
  daily: Array<{
    date: string;
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  }>;
  recent: Array<{
    ts: number;
    provider: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    latency_ms: number;
    cost_usd: number;
    project_path: string | null;
  }>;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

/**
 * The dev bridge exposes this store as REST; a packaged build has no server, so
 * the same calls go to the engine over IPC. Each entry maps one onto the other —
 * this table is the entire difference between the two transports, because every
 * method below funnels through `request()`.
 */
type EngineRoute = {
  command: string;
  payload?: (ctx: {
    body: any;
    query: URLSearchParams;
    headers: Record<string, string>;
  }) => Record<string, unknown>;
};

const ENGINE_ROUTES: Record<string, EngineRoute> = {
  "GET /api/app/settings": { command: "settings.get" },
  "POST /api/app/settings": {
    command: "settings.set",
    payload: ({ body }) => ({ key: body.key, value: body.value }),
  },
  "GET /api/app/providers": { command: "providers.get" },
  "POST /api/app/providers": {
    command: "providers.upsert",
    payload: ({ body }) => ({
      id: body.id,
      baseUrl: body.baseUrl,
      selectedModel: body.selectedModel,
      availableModels: body.availableModels,
    }),
  },
  "GET /api/app/secrets": { command: "secrets.list" },
  "POST /api/app/secrets": {
    command: "secrets.set",
    payload: ({ body }) => ({ name: body.name, value: body.value ?? "" }),
  },
  "DELETE /api/app/secrets": {
    command: "secrets.delete",
    payload: ({ query }) => ({ name: query.get("name") }),
  },
  "GET /api/app/projects": {
    command: "projects.list",
    payload: ({ query }) => ({ limit: Number(query.get("limit")) || 10 }),
  },
  "POST /api/app/projects": {
    command: "projects.touch",
    payload: ({ body }) => ({ path: body.path, name: body.name }),
  },
  "POST /api/app/projects/forget": {
    command: "projects.forget",
    payload: ({ body }) => ({ path: body.path }),
  },
  "GET /api/app/projects/active": { command: "projects.active" },
  "GET /api/app/chat": {
    command: "chat.load",
    payload: ({ query }) => ({ projectPath: query.get("projectRoot") || "" }),
  },
  "POST /api/app/chat": {
    command: "chat.save",
    payload: ({ body }) => ({ projectPath: body.projectRoot, messages: body.messages }),
  },
  "POST /api/app/chat/clear": {
    command: "chat.clear",
    payload: ({ body }) => ({ projectPath: body.projectRoot }),
  },
  "GET /api/app/usage": {
    command: "usage.summary",
    payload: ({ query }) => ({
      projectPath: query.get("projectRoot") || undefined,
      sinceTs: Number(query.get("sinceTs")) || 0,
    }),
  },
  "POST /api/app/auth/register": { command: "auth.register", payload: ({ body }) => body },
  "POST /api/app/auth/login": { command: "auth.login", payload: ({ body }) => body },
  "POST /api/app/auth/logout": {
    command: "auth.logout",
    payload: ({ body }) => ({ token: body.token }),
  },
  "GET /api/app/auth/me": {
    command: "auth.me",
    payload: ({ headers }) => ({ token: headers["x-acsa-session"] || "" }),
  },
};

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const [rawPath, search] = path.split("?");
  const query = new URLSearchParams(search || "");

  // IPC whenever it exists — the packaged app and `tauri dev` both take this
  // path, so the transport that ships is the one under test.
  if (hasIpc()) {
    const route = ENGINE_ROUTES[`${method} ${rawPath}`];
    if (!route) throw new Error(`no engine route for ${method} ${rawPath}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const payload = route.payload
      ? route.payload({ body, query, headers: normalizeHeaders(init?.headers) })
      : {};
    return engineCall<T>("db", [route.command, JSON.stringify(payload)]);
  }

  // No desktop shell: the database lives behind the engine and there is no other
  // route to it. Nothing here pretends to work in a browser.
  throw desktopRequired("App settings and history");
}

export const appStore = {
  /** True only inside the desktop shell, where the engine is reachable. */
  available: hasIpc(),

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
