// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

type Outcome = { kind: "available"; update: any } | { kind: "current" } | { kind: "failed"; detail: string };
let outcome: Outcome = { kind: "current" };

vi.mock("../../services/appUpdater", () => ({
  autoCheckEnabled: () => true,
  setAutoCheck: vi.fn(),
  currentVersion: async () => "0.2.0",
  checkForUpdateDetailed: async () => outcome,
  installUpdate: vi.fn(async (onProgress?: (n: number) => void) => onProgress?.(100)),
  restartApp: vi.fn(async () => undefined),
}));

const { AboutPane } = await import("./AboutPane");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the About pane", () => {
  it("shows the running version", async () => {
    render(<AboutPane />);
    expect(await screen.findByText("0.2.0")).toBeTruthy();
  });

  it("says up to date only when the check actually said so", async () => {
    outcome = { kind: "current" };
    render(<AboutPane />);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    expect(await screen.findByText(/you are up to date/i)).toBeTruthy();
  });

  it("says why when the check fails, instead of claiming everything is fine", async () => {
    // This is the bug worth pinning: "up to date", "no manifest published" and
    // "the request failed" all used to render as "You are up to date", so a
    // broken update path looked like a healthy one.
    outcome = { kind: "failed", detail: "404 not found" };
    render(<AboutPane />);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    expect(await screen.findByText(/404 not found/)).toBeTruthy();
    expect(screen.queryByText(/you are up to date/i)).toBeNull();
  });
});

describe("acting on the update from this pane", () => {
  it("offers the install button here, rather than pointing at the titlebar", async () => {
    // Reported: "it says update available and instead of giving me an update
    // button, it's referring me back to the home page button which also doesn't
    // come up until the app is restarted." Finding an update is the moment the
    // user wants to act on it, and this is where they are standing.
    outcome = { kind: "available", update: { version: "0.2.9", currentVersion: "0.2.7", notes: "" } };
    render(<AboutPane />);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));

    const install = await screen.findByRole("button", { name: /download & install 0\.2\.9/i });
    expect(install).toBeTruthy();

    fireEvent.click(install);
    // And once it is on disk, the last step is still the user's to take.
    expect(await screen.findByRole("button", { name: /restart to finish/i })).toBeTruthy();
  });
});
