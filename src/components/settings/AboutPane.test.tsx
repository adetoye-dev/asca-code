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
