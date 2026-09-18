/**
 * crashReporter.ts — where a crash goes when nothing is watching.
 *
 * This app sends no telemetry and has no plan to. So "crash reporting" is the
 * local version: write a record to the app's own data directory, and let the
 * user attach it to a bug report themselves. It makes support possible without
 * making surveillance possible.
 *
 * The redaction lives in the engine, not here — a stack trace or a props dump
 * can carry a credential, and there is one implementation of that rule rather
 * than two that drift.
 */

const MAX_MESSAGE = 600;
const MAX_STACK = 4000;

export interface CrashContext {
  [key: string]: unknown;
}

export interface CrashPayload {
  kind: string;
  message: string;
  stack?: string;
  context?: CrashContext;
}

/** Turn anything thrown into something worth writing down. */
export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: (error.message || error.name || "Error").slice(0, MAX_MESSAGE), stack: error.stack?.slice(0, MAX_STACK) };
  }
  if (typeof error === "string") return { message: error.slice(0, MAX_MESSAGE) };
  try {
    return { message: JSON.stringify(error).slice(0, MAX_MESSAGE) };
  } catch {
    return { message: String(error).slice(0, MAX_MESSAGE) };
  }
}

/**
 * Persist one crash. Best effort by design: reporting must never be the thing
 * that turns a handled error into an unhandled one, so every failure is
 * swallowed — including the engine being unavailable.
 */
export async function reportCrash(kind: string, error: unknown, context?: CrashContext): Promise<void> {
  try {
    const { message, stack } = describeError(error);
    const payload: CrashPayload = { kind, message, stack, context };
    const { engineCall } = await import("./engineBridge");
    await engineCall("crash", ["append", JSON.stringify(payload)]);
  } catch {
    /* the log is a convenience, never a dependency */
  }
}

/** Where the log lives, for a UI that wants to point at it. */
export async function crashLogPath(): Promise<string | null> {
  try {
    const { engineCall } = await import("./engineBridge");
    const data = await engineCall<{ path: string }>("crash", ["path"]);
    return data?.path ?? null;
  } catch {
    return null;
  }
}

let installed = false;

/**
 * Catch the two things React's boundary cannot: errors thrown outside render,
 * and promise rejections nothing handled.
 *
 * Installed once — calling it twice would double every record, and in a dev
 * loop with HMR that is easy to do by accident.
 */
export function installCrashHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    void reportCrash("window", event.error ?? event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportCrash("unhandledrejection", event.reason, {});
  });
}
