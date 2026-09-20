/**
 * chatDraft — the composer's text, held outside React.
 *
 * Why it is not component state and not in `usePipeline`:
 *
 * - In `usePipeline` (the workbench) every character typed re-rendered the whole
 *   app: the layout, the file tree, the editor panels, the transcript.
 * - In `AiAssistantChat` it would be forgotten the moment the panel closed,
 *   because opening and closing the chat mounts and unmounts it.
 *
 * So it lives here: one value for the process, which the composer subscribes to
 * and the command palette can read synchronously when it needs to run "whatever
 * is in the composer". Typing wakes the composer — nothing above it.
 */
import { useSyncExternalStore } from "react";

let draft = "";
const listeners = new Set<() => void>();

export const chatDraft = {
  get: (): string => draft,
  set(next: string): void {
    if (next === draft) return;
    draft = next;
    for (const listener of listeners) listener();
  },
  clear(): void {
    chatDraft.set("");
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The current text, and a re-render when it changes. */
export function useChatDraft(): string {
  return useSyncExternalStore(chatDraft.subscribe, chatDraft.get, chatDraft.get);
}
