/**
 * projectSetup.ts — first-run project readiness.

 * A scaffolded project ships source and a package.json but no node_modules, so
 * nothing runs until dependencies are installed. Nothing in the UI said so, and
 * a user who has never run `npm install` had no way to find out. These helpers
 * let the workbench surface the step and run it in the visible terminal.
 */

export interface ProjectStatus {
  projectRoot: string;
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  needsInstall: boolean;
  scripts: Record<string, string>;
}

export async function fetchProjectStatus(projectRoot: string): Promise<ProjectStatus | null> {
  if (!projectRoot) return null;
  try {
    const res = await fetch(`/api/project/status?projectRoot=${encodeURIComponent(projectRoot)}`);
    if (!res.ok) return null;
    return (await res.json()) as ProjectStatus;
  } catch {
    return null;
  }
}

/**
 * Run a command in the project's terminal.

 * Deliberately routed through the interactive shell rather than a hidden
 * subprocess: the user watches the install/build happen, sees any error, and
 * gets a shell afterwards to keep working in.
 */
export async function runInProjectTerminal(projectRoot: string, command: string): Promise<void> {
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
