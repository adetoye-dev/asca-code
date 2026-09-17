/**
 * projectSetup.ts — first-run project readiness.
 *
 * A scaffolded project ships source and a manifest but no node_modules, so
 * nothing runs until dependencies are installed. Previously nothing in the UI
 * said so, and a user who had never run `npm install` had no way to find out.
 *
 * The engine answers this (`project status`), because it is the only component
 * both the dev bridge and the packaged app can reach. The exact install, dev,
 * build and test commands come back from it too, so the card does not have to
 * assume npm.
 */

import { engineCall, hasIpc } from "./engineBridge";

export interface ProjectStatus {
  projectRoot: string;
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  needsInstall: boolean;
  /** Lockfile-detected package manager: npm, yarn, pnpm or bun. */
  manager: string;
  installCommand: string;
  devCommand: string;
  buildCommand: string;
  testCommand: string;
  scripts: Record<string, string>;
}

export async function fetchProjectStatus(projectRoot: string): Promise<ProjectStatus | null> {
  if (!projectRoot) return null;
  try {
    if (hasIpc()) {
      return await engineCall<ProjectStatus>("project", [
        "status",
        JSON.stringify({ projectRoot }),
      ]);
    }
    const res = await fetch(`/api/project/status?projectRoot=${encodeURIComponent(projectRoot)}`);
    if (!res.ok) return null;
    return (await res.json()) as ProjectStatus;
  } catch {
    return null;
  }
}

/**
 * Run a command in the project's terminal.
 *
 * Deliberately routed through the interactive shell rather than a hidden
 * subprocess: the user watches the install/build happen, sees any error, and
 * gets a shell afterwards to keep working in.
 */
export async function runInProjectTerminal(projectRoot: string, command: string): Promise<void> {
  if (hasIpc()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<number>("terminal_spawn", { cwd: projectRoot, cols: 100, rows: 30 }).catch(
      () => 0,
    );
    // The shell needs a moment to exist before it will accept input.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await invoke("terminal_input", { data: `${command}\n` }).catch(() => {});
    return;
  }
  await fetch("/api/terminal/spawn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: projectRoot }),
  }).catch(() => {});
  await fetch("/api/terminal/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: `${command}\n` }),
  }).catch(() => {});
}
