/**
 * gitClient.ts — one transport for source control.
 *
 * These calls used to `fetch` the dev bridge's `/api/git/*` routes directly, and
 * those routes only exist under `npm run dev`, so the packaged app had no source
 * control at all. They now go to the engine over IPC whenever IPC is available
 * and to the bridge otherwise.
 *
 * A real `Response` is returned on purpose: every call site checks `res.ok` and
 * reads `res.json()`, so none of them had to change.
 */

import { engineCall, hasIpc } from "./engineBridge";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function gitFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!hasIpc()) return fetch(path, init);

  const action = path.replace(/^\/api\/git\//, "");
  let payload: Record<string, unknown> = {};
  if (init?.body) {
    try {
      payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  try {
    return jsonResponse(await engineCall<unknown>("git", [action, JSON.stringify(payload)]));
  } catch (error) {
    // Callers branch on `res.ok` and surface `data.error`, so a transport failure
    // has to arrive as a failed response rather than a rejected promise.
    const message = String((error as Error)?.message || error);
    return jsonResponse({ success: false, error: message }, 500);
  }
}
