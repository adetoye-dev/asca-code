/**
 * vite-api-guard.ts — says there is no backend, instead of faking one.
 *
 * The desktop app's backend is the Python engine, reached over Tauri IPC. In a
 * plain browser there is no way to reach it, and this dev server has to answer
 * `/api/*` somehow: without a handler, Vite's SPA fallback returns `index.html`
 * with a 200, so callers see `res.ok === true` and then fail parsing HTML as
 * JSON — a confusing death several frames away from the cause.
 *
 * Returning a 501 with the real reason puts the explanation where the request
 * was made. Which is all that remains of `vite-fs-bridge.ts`: 4,400 lines that
 * reimplemented the entire backend in TypeScript, so the browser looked fully
 * functional and the packaged app kept discovering the differences.
 */
import type { Plugin } from "vite";

export function apiGuardPlugin(): Plugin {
  return {
    name: "acsa-api-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (!path.startsWith("/api/")) {
          next();
          return;
        }
        res.statusCode = 501;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            success: false,
            error:
              "This needs the ACSA Code desktop app. Run `npm run dev:app` (or launch " +
              "the app) — the browser preview has no engine to talk to.",
          }),
        );
      });
    },
  };
}
