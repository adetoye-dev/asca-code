/**
 * hostMetrics.ts — disk, process and cleanup reads for the Performance page.
 *
 * Desktop-only: disk, processes and cleanup come from the shell's own
 * `sysinfo` calls. In a browser there is nothing to read and the Performance
 * page says so rather than showing invented numbers — the old bridge returned a
 * hardcoded process list, complete with a row for a gauntlet this app deleted.
 */

import { hasIpc } from "./engineBridge";
import type { StorageMetrics, RunningProcessItem } from "../types/workbench";

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function fetchStorageMetrics(projectRoot: string): Promise<StorageMetrics | null> {
  try {
    if (hasIpc()) {
      return await invokeTauri<StorageMetrics>("fetch_system_storage", { projectRoot });
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchRunningProcesses(): Promise<RunningProcessItem[] | null> {
  try {
    if (hasIpc()) {
      return await invokeTauri<RunningProcessItem[]>("fetch_system_processes");
    }
    return null;
  } catch {
    return null;
  }
}

export async function runSafeCleanup(
  projectRoot: string,
): Promise<{ reclaimedMb: number; message: string } | null> {
  try {
    if (hasIpc()) {
      return await invokeTauri<{ reclaimedMb: number; message: string }>("system_cleanup", {
        projectRoot,
      });
    }
    return null;
  } catch {
    return null;
  }
}
