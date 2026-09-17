/**
 * fileAccess.ts — read and write project files through whichever transport exists.
 *
 * The portable rule for this codebase: prefer the desktop shell, fall back to
 * the dev bridge for a plain browser. Call sites that skip it look fine under
 * `npm run dev` and silently do nothing in a packaged build — which is how the
 * asset preview, the TypeScript ambient libs and the code map's file summaries
 * all stopped working once the app was bundled.
 */

import { hasIpc } from "./engineBridge";

async function invokeTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** Read a text file from the project. Throws when the file cannot be read. */
export async function readTextFile(filePath: string, projectRoot: string): Promise<string> {
  if (hasIpc()) {
    return invokeTauri<string>("read_file_content", { filePath, projectRoot });
  }
  const res = await fetch("/api/fs/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, projectRoot }),
  });
  if (!res.ok) throw new Error(`Could not read ${filePath} (HTTP ${res.status})`);
  const data = await res.json();
  if (typeof data?.content !== "string") throw new Error(`Could not read ${filePath}`);
  return data.content;
}

/** Read any file as a `data:` URL, for previewing images, video and audio. */
export async function readFileAsDataUrl(filePath: string, projectRoot: string): Promise<string> {
  if (hasIpc()) {
    return invokeTauri<string>("read_file_base64", { filePath, projectRoot });
  }
  const res = await fetch("/api/fs/read-base64", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, projectRoot }),
  });
  if (!res.ok) throw new Error(`Could not read ${filePath} (HTTP ${res.status})`);
  const data = await res.json();
  if (typeof data?.dataUrl !== "string") throw new Error(`Could not read ${filePath}`);
  return data.dataUrl;
}

export async function writeTextFile(
  filePath: string,
  content: string,
  projectRoot: string,
): Promise<void> {
  if (hasIpc()) {
    await invokeTauri<void>("write_file_content", { filePath, content, projectRoot });
    return;
  }
  const res = await fetch("/api/fs/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, content, projectRoot }),
  });
  if (!res.ok) throw new Error(`Could not write ${filePath} (HTTP ${res.status})`);
}
