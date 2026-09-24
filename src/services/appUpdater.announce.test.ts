// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateAnnouncement } from "./appUpdater";

/**
 * A check has to be *announced*, not just remembered.
 *
 * The reported bug: Settings → About said "0.2.8 is available — the button is in
 * the titlebar" while no button existed, because the titlebar only looked on
 * mount. The result lived in a module variable that no component can observe
 * changing, so finding an update in one place was invisible everywhere else.
 *
 * This is the sending end; `UpdateButton.test.tsx` is the receiving one.
 */

let nextCheck: () => Promise<any> = async () => null;

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => nextCheck(),
}));

const updater = await import("./appUpdater");

function collect(): UpdateAnnouncement[] {
  const seen: UpdateAnnouncement[] = [];
  window.addEventListener(updater.UPDATE_ANNOUNCEMENT, (event) => {
    seen.push((event as CustomEvent<UpdateAnnouncement>).detail);
  });
  return seen;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("what a check tells the rest of the app", () => {
  it("announces the version when one is available", async () => {
    nextCheck = async () => ({
      available: true,
      version: "0.2.9",
      currentVersion: "0.2.7",
      body: "notes",
    });
    const seen = collect();

    const outcome = await updater.checkForUpdateDetailed({ force: true });

    expect(outcome.kind).toBe("available");
    expect(seen).toEqual([
      { kind: "available", update: { version: "0.2.9", currentVersion: "0.2.7", notes: "notes", date: undefined } },
    ]);
  });

  it("announces nothing rather than staying quiet when the app is current", async () => {
    // Silence would leave a stale button up after a release is withdrawn, so the
    // up-to-date case is announced too.
    nextCheck = async () => ({ available: false });
    const seen = collect();

    await updater.checkForUpdateDetailed({ force: true });

    expect(seen).toEqual([{ kind: "none" }]);
  });

  it("does not throw when the check fails", async () => {
    nextCheck = async () => {
      throw new Error("manifest 404");
    };
    const seen = collect();

    const outcome = await updater.checkForUpdateDetailed({ force: true });

    expect(outcome.kind).toBe("failed");
    // The pane explains the failure; there is nothing to announce about a version.
    expect(seen).toEqual([]);
  });
});
