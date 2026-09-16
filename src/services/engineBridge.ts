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

/**
 * True when Tauri IPC is available — which includes `tauri dev`, not just the
 * packaged app, because Tauri injects its API into whatever page it loads.
 *
 * Everything prefers this over the dev bridge, and that is deliberate: `tauri dev`
 * serves the UI from `localhost:5173`, so keying off the URL would keep quietly
 * exercising the bridge and let dev-only endpoints hide again. Preferring IPC
 * makes the normal development loop test the path that actually ships.
 */
export function hasIpc(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  );
}

/** True inside the packaged app: IPC available and no dev-server URL. */
export function isPackagedBuild(): boolean {
  return (
    hasIpc() &&
    typeof window !== "undefined" &&
    !window.location.protocol.startsWith("http")
  );
}

/**
 * True only when there is no IPC and a dev server is serving `/api/*` — i.e. the
 * UI is open in a plain browser. Kept so `npm run dev` keeps working while the
 * bridge is retired; nothing in the app depends on it any more.
 */
export const hasDevBridge =
  !hasIpc() && typeof window !== "undefined" && window.location.protocol.startsWith("http");

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
