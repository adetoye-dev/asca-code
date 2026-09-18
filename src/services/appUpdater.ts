/**
 * appUpdater.ts — checking for, and installing, a newer build.
 *
 * The policy, stated once so the UI can be dumb:
 *
 *  - **Checking is on by default, and visible.** A security fix nobody receives
 *    is worse than a version ping, but this app's pitch is that nothing leaves
 *    the machine, so the ping is a setting the user can see and turn off rather
 *    than something that happens quietly.
 *  - **Installing always waits for a click.** This app runs long-lived work —
 *    agent turns, terminal sessions, a tool adapter — and restarting under
 *    someone mid-task loses it. Nothing here installs on its own.
 *  - **Only the OS release is offered.** Tauri verifies the artifact against the
 *    public key in `tauri.conf.json`, so a tampered manifest is rejected before
 *    anything touches the disk.
 */

const AUTO_CHECK_KEY = "acsa_update_check_on_launch";
/** Don't re-check more than this often within one session. */
const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string;
  date?: string;
}

let cached: AvailableUpdate | null = null;
let lastCheckAt = 0;

/** Whether the app may look for updates without being asked. */
export function autoCheckEnabled(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_CHECK_KEY);
    // Default on. Compared explicitly rather than truthy, because "0" is a
    // perfectly good stored value and `Boolean("0")` is true.
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

export function setAutoCheck(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_CHECK_KEY, enabled ? "1" : "0");
  } catch {
    /* storage unavailable; the default stands */
  }
}

export function lastKnownUpdate(): AvailableUpdate | null {
  return cached;
}

/**
 * The three things a check can actually conclude.
 *
 * "Failed" is separate from "current" on purpose. Collapsing them is the one
 * outcome that is actively misleading: a manifest that 404s, a permission that
 * was not granted, and a genuinely up-to-date app all used to render as "You are
 * up to date", so a broken update path looked like a healthy one. That is how
 * the label on this very feature was reported as fine while nothing worked.
 */
export type CheckOutcome =
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "current" }
  | { kind: "failed"; detail: string };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** The detailed answer, for a surface that has room to explain itself. */
export async function checkForUpdateDetailed(
  options: { force?: boolean } = {},
): Promise<CheckOutcome> {
  if (!options.force && Date.now() - lastCheckAt < CHECK_COOLDOWN_MS) {
    return cached ? { kind: "available", update: cached } : { kind: "current" };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    lastCheckAt = Date.now();
    if (!update?.available) {
      cached = null;
      return { kind: "current" };
    }
    cached = {
      version: String(update.version),
      currentVersion: String(update.currentVersion),
      notes: String(update.body ?? "").slice(0, 2000),
      date: update.date ? String(update.date) : undefined,
    };
    return { kind: "available", update: cached };
  } catch (error) {
    lastCheckAt = Date.now();
    return { kind: "failed", detail: describe(error) };
  }
}

/**
 * The same question, for the titlebar: an update or nothing.
 *
 * A failure returns `null` here, because a button cannot explain itself — the
 * About pane is where the reason is shown.
 */
export async function checkForUpdate(
  options: { force?: boolean } = {},
): Promise<AvailableUpdate | null> {
  const outcome = await checkForUpdateDetailed(options);
  return outcome.kind === "available" ? outcome.update : null;
}

/**
 * Download and install the update. Resolves when it is on disk and waiting for a
 * restart — this never restarts the app itself.
 */
export async function installUpdate(onProgress?: (percent: number) => void): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update?.available) throw new Error("no update is available");

  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event: any) => {
    if (event?.event === "Started") {
      total = Number(event.data?.contentLength ?? 0);
      onProgress?.(0);
    } else if (event?.event === "Progress") {
      received += Number(event.data?.chunkLength ?? 0);
      onProgress?.(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 50);
    } else if (event?.event === "Finished") {
      onProgress?.(100);
    }
  });
  cached = null;
}

/** Relaunch into the new build. */
export async function restartApp(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("app_restart");
}

/** The running version, for the About row. */
export async function currentVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "unknown";
  }
}
