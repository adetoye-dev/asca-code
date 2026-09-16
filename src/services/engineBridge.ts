/**
 * engineBridge.ts — reach the bundled engine from a packaged build.
 *
 * In development, backend calls are served by `vite-fs-bridge.ts`, a Vite
 * dev-server middleware. `configureServer()` only runs for `npm run dev`, so none
 * of its `/api/*` endpoints exist in a packaged app — there, the only channel is
 * Tauri IPC. That difference is invisible until you run the built app, which is
 * how the provider registry, chat history, recent projects and Ollama detection
 * all silently reverted to built-in defaults in the bundle.
 *
 * `engine_call` runs the same engine the dev bridge runs, so a caller can ask for
 * an engine subcommand instead of an HTTP path and get identical data.
 */

export type EngineEnvelope<T> = { ok: boolean; data?: T; error?: string };

/** True when the Vite dev bridge is serving `/api/*` (development only). */
export const hasDevBridge =
  typeof window !== "undefined" && window.location.protocol.startsWith("http");

/** True when running inside the packaged Tauri webview. */
export function isPackagedBuild(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  );
}

/**
 * Run an engine subcommand over IPC and unwrap its `{ok, data}` envelope.
 *
 * Throws with the engine's own message, so a failure surfaces as a failure
 * instead of being mistaken for an empty result.
 */
export async function engineCall<T>(subcommand: string, args: string[] = []): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("engine_call", { subcommand, args });

  let parsed: EngineEnvelope<T>;
  try {
    parsed = JSON.parse(raw) as EngineEnvelope<T>;
  } catch {
    throw new Error(`engine ${subcommand} returned no JSON`);
  }
  if (!parsed?.ok) throw new Error(parsed?.error || `engine ${subcommand} failed`);
  return parsed.data as T;
}
