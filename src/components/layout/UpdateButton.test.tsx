// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const available = {
  version: "0.2.0",
  currentVersion: "0.1.0",
  notes: "fixes",
  date: "2026-09-18",
};

vi.mock("../../services/appUpdater", () => ({
  autoCheckEnabled: () => true,
  checkForUpdate: vi.fn(async () => available),
  installUpdate: vi.fn(async (onProgress?: (n: number) => void) => onProgress?.(100)),
  restartApp: vi.fn(async () => undefined),
}));

const { UpdateButton } = await import("./UpdateButton");
const updater = await import("../../services/appUpdater");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The check waits 2.5s after mount so it never competes with the first paint. */
const findButton = () => screen.findByRole("button", { name: /update/i }, { timeout: 5000 });

describe("the titlebar update button", () => {
  it("renders nothing at all when there is no update", async () => {
    vi.mocked(updater.checkForUpdate).mockResolvedValueOnce(null);
    const { container } = render(<UpdateButton />);
    // An up-to-date app should not carry a permanent badge.
    await new Promise((r) => setTimeout(r, 3000));
    expect(container.innerHTML).toBe("");
  });

  it("says Update, not the version number", async () => {
    // It read `0.2.0` once, which looks like *the* version rather than *a newer
    // one is waiting*. This is the assertion that keeps the label honest.
    render(<UpdateButton />);
    const button = await findButton();
    expect(button.textContent?.trim()).toBe("Update");
    expect(button.textContent).not.toContain("0.2.0");
  });

  it("shows the version transition in the panel, where there is room for it", async () => {
    render(<UpdateButton />);
    fireEvent.click(await findButton());
    expect(await screen.findByText("Update available")).toBeTruthy();
    expect(screen.getByText("0.1.0 → 0.2.0")).toBeTruthy();
    expect(screen.getByText("fixes")).toBeTruthy();
  });

  it("installs only on a click, and offers the restart separately", async () => {
    render(<UpdateButton />);
    fireEvent.click(await findButton());

    // Nothing installed until asked.
    expect(updater.installUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /download & install/i }));
    expect(await screen.findByText(/installed\. restart to finish/i)).toBeTruthy();
    expect(updater.installUpdate).toHaveBeenCalledTimes(1);

    // And the restart is its own decision: the install never restarts on its own.
    expect(updater.restartApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /restart now/i }));
    expect(updater.restartApp).toHaveBeenCalledTimes(1);
  });
});
