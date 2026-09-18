import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ subcommand: string; args: string[] }> = [];
let failNext = false;

vi.mock("./engineBridge", () => ({
  engineCall: async (subcommand: string, args: string[]) => {
    calls.push({ subcommand, args });
    if (failNext) throw new Error("engine unavailable");
    return { path: "/tmp/crashes.log" };
  },
}));

const { describeError, reportCrash, crashLogPath } = await import("./crashReporter");

describe("describing an error", () => {
  it("keeps the message and the stack for a real Error", () => {
    const described = describeError(new Error("boom"));
    expect(described.message).toBe("boom");
    expect(described.stack).toContain("boom");
  });

  it("copes with a rejection that is not an Error", () => {
    expect(describeError("just a string").message).toBe("just a string");
    expect(describeError({ code: 500 }).message).toContain("500");
  });

  it("truncates rather than writing something unbounded", () => {
    const described = describeError(new Error("x".repeat(5000)));
    expect(described.message.length).toBeLessThanOrEqual(600);
    expect(described.stack!.length).toBeLessThanOrEqual(4000);
  });

  it("survives a value that cannot be stringified", () => {
    const circular: any = {};
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
  });
});

describe("reporting a crash", () => {
  beforeEach(() => {
    calls.length = 0;
    failNext = false;
  });

  it("sends a redactable payload to the engine", async () => {
    await reportCrash("render", new Error("bad props"), { componentStack: "at Foo" });
    expect(calls).toHaveLength(1);
    expect(calls[0].subcommand).toBe("crash");
    expect(calls[0].args[0]).toBe("append");
    const payload = JSON.parse(calls[0].args[1]);
    expect(payload.kind).toBe("render");
    expect(payload.message).toBe("bad props");
    expect(payload.context.componentStack).toBe("at Foo");
  });

  it("never turns a handled error into an unhandled one", async () => {
    // If the engine is down, reporting must fail silently — the alternative is
    // that the reporting path becomes the crash.
    failNext = true;
    await expect(reportCrash("render", new Error("boom"))).resolves.toBeUndefined();
  });

  it("exposes the log path, and nothing at all when it cannot", async () => {
    expect(await crashLogPath()).toBe("/tmp/crashes.log");
    failNext = true;
    expect(await crashLogPath()).toBeNull();
  });
});

describe("installing the global handlers", () => {
  it("registers once, however many times it is called", async () => {
    const added: Record<string, number> = {};
    (globalThis as any).window = {
      addEventListener: (type: string) => {
        added[type] = (added[type] ?? 0) + 1;
      },
    };
    // A fresh module, because the guard is module state — and in a dev loop with
    // HMR this is exactly how it gets called twice.
    vi.resetModules();
    const fresh = await import("./crashReporter");
    fresh.installCrashHandlers();
    fresh.installCrashHandlers();
    expect(added.error).toBe(1);
    expect(added.unhandledrejection).toBe(1);
    delete (globalThis as any).window;
  });
});
