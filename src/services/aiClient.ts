/**
 * aiClient.ts — AI calls that have been moved off the dev bridge.
 *
 * Only `test-connection` is migrated so far. The rest (`chat`, `inline-edit`,
 * `review-file`, `usage`) still live in the dev bridge and are passed straight
 * through to `fetch`, because migrating them means choosing which of two AI
 * implementations survives rather than just moving a route — that is a deliberate
 * change, not a transport swap.
 *
 * Once every route is listed here, this file is the whole AI transport.
 */

import { engineCall, hasIpc } from "./engineBridge";

/** Bridge action → engine subcommand action. Empty means "not migrated yet". */
const MIGRATED: Record<string, string> = {
  "test-connection": "test-connection",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function aiFetch(path: string, init?: RequestInit): Promise<Response> {
  const action = path.replace(/^\/api\/ai\//, "").split("?")[0];
  // No IPC, or not migrated yet: keep using whatever the dev bridge provides.
  if (!hasIpc() || !MIGRATED[action]) return fetch(path, init);

  let payload: Record<string, unknown> = {};
  if (init?.body) {
    try {
      payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  try {
    return jsonResponse(await engineCall<unknown>("ai", [MIGRATED[action], JSON.stringify(payload)]));
  } catch (error) {
    const message = String((error as Error)?.message || error);
    return jsonResponse({ ok: false, success: false, latencyMs: 0, error: message }, 500);
  }
}
