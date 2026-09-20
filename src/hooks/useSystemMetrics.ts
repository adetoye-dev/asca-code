/**
 * useSystemMetrics — the host's live CPU/RAM/disk numbers, read where they are
 * shown.
 *
 * These used to ride along in `usePipeline`'s return value, so every poll — every
 * three seconds, for the life of the window — produced a new pipeline object and
 * re-rendered the entire workbench: the layout, every dockview panel, the file
 * tree, the chat transcript. A CPU percentage changing has nothing to do with any
 * of those.
 *
 * Subscribing in the components that display it keeps the update local. The
 * service remains the single source of truth, so the status bar and the
 * performance page still cannot disagree about what the machine is doing.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { SystemMetrics } from "../types/telemetry";
import { systemMetricsService } from "../services/systemMetricsService";

export function useSystemMetrics(): SystemMetrics | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => systemMetricsService.subscribe(() => onStoreChange()),
    []
  );
  // The service replaces the object rather than mutating it, so identity is
  // exactly the comparison useSyncExternalStore needs — and it is stable between
  // polls, which is what stops this from looping.
  const getSnapshot = useCallback(() => systemMetricsService.getMetrics(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
