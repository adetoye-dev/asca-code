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

const STORAGE_PREFIX = "acsa_code_chat_history_v1_";
const EVENT_CHAT_UPDATED = "acsa:chat-history-updated";

function getStorageKey(projectRoot?: string): string {
  const clean = (projectRoot || "global").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${STORAGE_PREFIX}${clean}`;
}

/** Load chat messages for the current project from localStorage */
export function loadChatHistory(projectRoot?: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(getStorageKey(projectRoot));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    // Sanitize: any message that was interrupted mid-stream gets marked as completed
    return parsed.map((m) => ({ ...m, isStreaming: false }));
  } catch {
    return [];
  }
}

/** Save chat messages for the current project to localStorage (capped at 100 recent) */
export function saveChatHistory(messages: ChatMessage[], projectRoot?: string): void {
  try {
    const sanitized = messages
      .slice(-100)
      .map((m) => ({ ...m, isStreaming: false }));
    const key = getStorageKey(projectRoot);
    localStorage.setItem(key, JSON.stringify(sanitized));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVENT_CHAT_UPDATED, { detail: { projectRoot, messages: sanitized } })
      );
    }
  } catch {}
}

/** Completely clear chat messages for the current project */
export function clearChatHistory(projectRoot?: string): void {
  try {
    localStorage.removeItem(getStorageKey(projectRoot));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVENT_CHAT_UPDATED, { detail: { projectRoot, messages: [] } })
      );
    }
  } catch {}
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

  const handleStorage = (e: StorageEvent) => {
    if (e.key === getStorageKey(projectRoot)) {
      callback(loadChatHistory(projectRoot));
    }
  };

  window.addEventListener(EVENT_CHAT_UPDATED, handleEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(EVENT_CHAT_UPDATED, handleEvent);
    window.removeEventListener("storage", handleStorage);
  };
}
