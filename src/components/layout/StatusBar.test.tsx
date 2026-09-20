// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * A stand-in for the real telemetry service: the same subscribe/get shape, plus
 * a way to push a reading and to see how many subscribers are attached.
 */
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let current: Record<string, number> = {
    cpu_usage_percent: 12.4,
    memory_usage_percent: 41.2,
    disk_usage_percent: 63.5,
    cpu_count: 10,
    memory_used_mb: 6600,
    memory_total_mb: 16000,
    disk_used_gb: 590,
    disk_total_gb: 926,
    disk_free_gb: 336,
  };
  return {
    getCurrent: () => current,
    listenerCount: () => listeners.size,
    push(next: Record<string, number>) {
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../../services/systemMetricsService", () => ({
  systemMetricsService: {
    getMetrics: () => store.getCurrent(),
    subscribe: (listener: () => void) => store.subscribe(listener),
  },
}));

const { StatusBar } = await import("./StatusBar");

afterEach(cleanup);

const reading = (cpu: number, ram: number, disk: number) => ({
  cpu_usage_percent: cpu,
  memory_usage_percent: ram,
  disk_usage_percent: disk,
  cpu_count: 10,
  memory_used_mb: 6600,
  memory_total_mb: 16000,
  disk_used_gb: 590,
  disk_total_gb: 926,
  disk_free_gb: 336,
});

describe("the status bar's host readings", () => {
  it("shows what the service is reporting", () => {
    render(<StatusBar gitBranch="dev" />);
    expect(screen.getByText("CPU: 12%")).toBeTruthy();
    expect(screen.getByText("RAM: 41%")).toBeTruthy();
    expect(screen.getByText("Disk: 64%")).toBeTruthy();
  });

  it("follows the service without being re-rendered from above", () => {
    // The reason this component subscribes instead of taking a `metrics` prop:
    // the number has to be able to change without re-rendering the workbench.
    render(<StatusBar gitBranch="dev" />);
    act(() => store.push(reading(88.6, 12.1, 64.9)));
    expect(screen.getByText("CPU: 89%")).toBeTruthy();
    expect(screen.getByText("RAM: 12%")).toBeTruthy();
    expect(screen.getByText("Disk: 65%")).toBeTruthy();
  });

  it("detaches from the service when it goes away", () => {
    const { unmount } = render(<StatusBar gitBranch="dev" />);
    expect(store.listenerCount()).toBe(1);
    unmount();
    expect(store.listenerCount()).toBe(0);
  });
});
