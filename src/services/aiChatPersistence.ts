/**
 * aiChatPersistence.ts — Persistent Chat History Service
 *
 * Persists conversational AI chat messages across:
 * 1. Side panel open / close
 * 2. Editor tab switching (dockview tab vs right sidebar)
 * 3. Page reloads & browser restarts
 * 4. Project workspace changes (scoped by projectRoot)
 */

import type { ChatMessage } from "./aiChatService";
import { appStore } from "./appStore";

const STORAGE_PREFIX = "acsa_code_chat_history_v1_";
const EVENT_CHAT_UPDATED = "acsa:chat-history-updated";

function getStorageKey(projectRoot?: string): string {
  const clean = (projectRoot || "global").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${STORAGE_PREFIX}${clean}`;
}

/** Load chat messages for the current project from localStorage */
/**
 * Two chat panels can mount at once (side dock and centre stage), so the cache is
 * keyed per project and reads stay synchronous — the database write is
 * fire-and-forget and the in-memory value is this page's source of truth.
 */
const chatCache = new Map<string, ChatMessage[]>();

function cacheKey(projectRoot?: string): string {
  return projectRoot || "global";
}

function publish(projectRoot: string | undefined, messages: ChatMessage[]): void {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVENT_CHAT_UPDATED, { detail: { projectRoot, messages } })
      );
    }
  } catch {
    /* no window */
  }
}

/**
 * Load a project's transcript from the app database into the cache.
 *
 * Also the one-time migration off `localStorage`: a transcript left by an older
 * build is written to the database and then removed, so the browser stops
 * holding conversation history.
 */
export async function hydrateChatHistory(projectRoot?: string): Promise<ChatMessage[]> {
  let messages: ChatMessage[] = [];
  try {
    const stored = await appStore.loadChat(projectRoot || "");
    messages = stored.map((m) => ({ ...m, isStreaming: false })) as ChatMessage[];
  } catch {
    messages = [];
  }

  let legacy: ChatMessage[] | null = null;
  try {
    const raw = localStorage.getItem(getStorageKey(projectRoot));
    if (raw) legacy = JSON.parse(raw) as ChatMessage[];
  } catch {
    legacy = null;
  }

  if (Array.isArray(legacy) && legacy.length > 0 && messages.length === 0) {
    messages = legacy.map((m) => ({ ...m, isStreaming: false }));
    void appStore.saveChat(projectRoot || "", messages as any).catch(() => {});
    try {
      localStorage.removeItem(getStorageKey(projectRoot));
    } catch {
      /* storage disabled */
    }
  }

  chatCache.set(cacheKey(projectRoot), messages);
  publish(projectRoot, messages);
  return messages;
}

/** Chat messages for the current project. Synchronous: reads the hydrated cache. */
export function loadChatHistory(projectRoot?: string): ChatMessage[] {
  const cached = chatCache.get(cacheKey(projectRoot));
  if (cached) return cached;
  // Not hydrated yet (first paint): kick off the load and render empty for now.
  void hydrateChatHistory(projectRoot);
  return [];
}

/** Save chat messages for the current project to the database (last 100 kept). */
export function saveChatHistory(messages: ChatMessage[], projectRoot?: string): void {
  const sanitized = messages
    .slice(-100)
    .map((m) => ({ ...m, isStreaming: false }));
  chatCache.set(cacheKey(projectRoot), sanitized);
  publish(projectRoot, sanitized);
  void appStore.saveChat(projectRoot || "", sanitized as any).catch(() => {});
}

/** Completely clear chat messages for the current project */
export function clearChatHistory(projectRoot?: string): void {
  chatCache.set(cacheKey(projectRoot), []);
  publish(projectRoot, []);
  void appStore.clearChat(projectRoot || "").catch(() => {});
}
/** Subscribe to chat updates from other views or tabs */
export function subscribeChatHistory(
  projectRoot: string | undefined,
  callback: (messages: ChatMessage[]) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleEvent = (e: Event) => {
    const custom = e as CustomEvent<{ projectRoot?: string; messages: ChatMessage[] }>;
    if (!custom.detail || custom.detail.projectRoot === projectRoot) {
      callback(custom.detail?.messages ?? loadChatHistory(projectRoot));
    }
  };

  window.addEventListener(EVENT_CHAT_UPDATED, handleEvent);

  return () => {
    window.removeEventListener(EVENT_CHAT_UPDATED, handleEvent);
  };
}
