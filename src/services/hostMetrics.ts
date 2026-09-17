/**
 * hostMetrics.ts — disk, process and cleanup reads for the Performance page.
 *
 * Same shape as `systemMetricsService`: prefer the desktop shell, fall back to
 * the dev bridge for a plain browser. The desktop commands are the real
 * implementation — the bridge's process list was hardcoded (it still listed the
 * deleted gauntlet as a running process), and neither path worked in a bundle
 * because the page called `/api/system/*` directly and nothing served it.
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
    const res = await fetch(
      `/api/system/storage?projectRoot=${encodeURIComponent(projectRoot || "")}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as StorageMetrics;
  } catch {
    return null;
  }
}

export async function fetchRunningProcesses(): Promise<RunningProcessItem[] | null> {
  try {
    if (hasIpc()) {
      return await invokeTauri<RunningProcessItem[]>("fetch_system_processes");
    }
    const res = await fetch("/api/system/processes");
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.processes) ? (data.processes as RunningProcessItem[]) : null;
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
    const res = await fetch("/api/system/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { reclaimedMb: number; message: string };
  } catch {
    return null;
  }
}
