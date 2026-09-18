import { beforeEach, describe, expect, it, vi } from "vitest";

/** A localStorage stand-in: the real one does not exist under the node runner. */
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

let nextCheck: () => Promise<any> = async () => null;

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => nextCheck(),
}));

const updater = await import("./appUpdater");

describe("the check-on-launch preference", () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new FakeStorage();
  });

  it("is on when nothing has been chosen", () => {
    // Default on deliberately: a security fix nobody receives is worse than a
    // version ping. It is a visible setting, not a hidden one.
    expect(updater.autoCheckEnabled()).toBe(true);
  });

  it("survives being turned off and on again", () => {
    updater.setAutoCheck(false);
    // `Boolean("0")` is true, so a truthiness check here would silently ignore
    // the setting — which is exactly the bug this asserts against.
    expect(updater.autoCheckEnabled()).toBe(false);
    updater.setAutoCheck(true);
    expect(updater.autoCheckEnabled()).toBe(true);
  });

  it("falls back to on when storage is unavailable", () => {
    delete (globalThis as any).localStorage;
    expect(updater.autoCheckEnabled()).toBe(true);
    expect(() => updater.setAutoCheck(false)).not.toThrow();
  });
});

describe("checking for an update", () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new FakeStorage();
  });

  it("describes what the plugin reported", async () => {
    nextCheck = async () => ({
      available: true,
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "fixes",
      date: "2026-09-18",
    });
    const found = await updater.checkForUpdate({ force: true });
    expect(found).toEqual({
      version: "0.2.0",
      currentVersion: "0.1.0",
      notes: "fixes",
      date: "2026-09-18",
    });
    expect(updater.lastKnownUpdate()).toEqual(found);
  });

  it("reports nothing when the app is current", async () => {
    nextCheck = async () => ({ available: false, version: "0.1.0", currentVersion: "0.1.0" });
    expect(await updater.checkForUpdate({ force: true })).toBeNull();
  });

  it("treats an unreachable release page as 'nothing to say'", async () => {
    // No manifest published yet, or the network is down. A failed update check
    // must never surface as an app error — there is nothing the user can do.
    nextCheck = async () => {
      throw new Error("404");
    };
    await expect(updater.checkForUpdate({ force: true })).resolves.toBeNull();
  });
});
