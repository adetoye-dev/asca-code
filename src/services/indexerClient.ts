/**
 * indexerClient.ts — one transport for the code map and symbol index.
 *
 * These calls used to hit the dev bridge's `/api/indexer/*` routes directly, so in
 * the packaged app the Code Map surface and the structural context the agent uses
 * were both unavailable — despite the indexer living in the engine and having
 * already written `.acsa/index.json`.
 *
 * Returns a real `Response` so the existing call sites, which check `res.ok` and
 * read `res.json()`, are unchanged apart from the call name.
 */

import { desktopRequiredResponse, engineCall, hasIpc } from "./engineBridge";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function indexerFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!hasIpc()) return desktopRequiredResponse("The code index");

  const [rawPath, search] = path.split("?");
  const action = rawPath.replace(/^\/api\/indexer\//, "");

  let payload: Record<string, unknown> = {};
  if (init?.body) {
    try {
      payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (search) {
    // `status` and `map` are GETs with the project root in the query string.
    payload = Object.fromEntries(new URLSearchParams(search).entries()) as Record<string, unknown>;
  }

  try {
    return jsonResponse(await engineCall<unknown>("indexer", [action, JSON.stringify(payload)]));
  } catch (error) {
    const message = String((error as Error)?.message || error);
    return jsonResponse({ indexed: false, success: false, error: message }, 500);
  }
}
