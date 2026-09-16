/**
 * marketplaceClient.ts — one transport for skills and MCP servers.
 *
 * Both lived in the dev bridge, so the packaged app had no skills and no MCP.
 * Skills now go through the engine's existing `skill_loader` (the bridge used to
 * re-scan the same directories in JavaScript), and MCP tool calls go through
 * `mcp_client` in-process rather than spawning a second interpreter.
 *
 * Returns a real `Response` so the existing call sites are unchanged.
 */

import { engineCall, hasIpc } from "./engineBridge";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function marketplaceFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!hasIpc()) return fetch(path, init);

  const [rawPath, search] = path.split("?");
  const method = (init?.method || "GET").toUpperCase();

  let subcommand: string;
  let action: string;
  if (rawPath.startsWith("/api/skills/")) {
    subcommand = "skills";
    action = rawPath.slice("/api/skills/".length);
  } else {
    subcommand = "mcp";
    action = rawPath.slice("/api/mcp/".length);
  }

  let payload: Record<string, unknown> = {};
  if (init?.body) {
    try {
      payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (search) {
    payload = Object.fromEntries(new URLSearchParams(search).entries()) as Record<string, unknown>;
  }
  // `POST /api/mcp/servers` is the "add a server" case of the same route.
  if (subcommand === "mcp" && action === "servers" && method === "POST") {
    payload = { ...payload, action: "add" };
  }

  try {
    return jsonResponse(await engineCall<unknown>(subcommand, [action, JSON.stringify(payload)]));
  } catch (error) {
    const message = String((error as Error)?.message || error);
    return jsonResponse({ ok: false, error: message, skills: [], tools: [] }, 500);
  }
}
