/**
 * systemMetricsService.ts — Central System Telemetry Service
 *
 * Single source of truth for host CPU, RAM, and Disk metrics across the IDE.
 * The status bar and the Performance page both read from here, so the two can
 * never disagree about what the machine is doing.
 */

import type { SystemMetrics } from "../types/telemetry";

type MetricsListener = (metrics: SystemMetrics) => void;

class SystemMetricsService {
  private currentMetrics: SystemMetrics | null = null;
  private listeners = new Set<MetricsListener>();
  private timer: any = null;
  private isFetching = false;
  private lastFetchSucceeded = false;

  constructor() {
    this.startPolling(3000);
  }

  private isTauriAvailable(): boolean {
    return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
  }

  public getMetrics(): SystemMetrics | null {
    return this.currentMetrics;
  }

  public isHealthy(): boolean {
    return this.lastFetchSucceeded;
  }

  public subscribe(listener: MetricsListener): () => void {
    this.listeners.add(listener);
    if (this.currentMetrics) {
      try {
        listener(this.currentMetrics);
      } catch (err) {
        console.error("Error in initial metrics listener call:", err);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    if (!this.currentMetrics) return;
    for (const listener of this.listeners) {
      try {
        listener(this.currentMetrics);
      } catch (err) {
        console.error("Error notifying metrics listener:", err);
      }
    }
  }

  public async fetchMetrics(): Promise<SystemMetrics | null> {
    if (this.isFetching) return this.currentMetrics;
    this.isFetching = true;

    try {
      if (this.isTauriAvailable()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const metrics = await invoke<SystemMetrics>("fetch_system_metrics");
          if (metrics) {
            this.currentMetrics = metrics;
            this.lastFetchSucceeded = true;
            this.notify();
            return metrics;
          }
        } catch (tauriErr) {
          console.warn("Tauri fetch_system_metrics failed, falling back to HTTP:", tauriErr);
        }
      }

    } catch (err) {
      this.lastFetchSucceeded = false;
      console.warn("Failed to fetch system metrics:", err);
    } finally {
      this.isFetching = false;
    }

    return this.currentMetrics;
  }

  public startPolling(intervalMs: number = 3000) {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.fetchMetrics();
    this.timer = setInterval(() => {
      this.fetchMetrics();
    }, intervalMs);
  }

  public stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const systemMetricsService = new SystemMetricsService();
