// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Outcome =
  | { kind: "done"; path: string; detail?: string }
  | { kind: "cancelled" }
  | { kind: "failed"; detail: string };

let exportOutcome: Outcome = { kind: "done", path: "/tmp/backup.db", detail: "without API keys" };
let supportOutcome: Outcome = { kind: "done", path: "/tmp/support.json" };
let revealOutcome: Outcome = { kind: "done", path: "/data/dir" };
let folder: { dataDir: string; dbPath: string } | null = {
  dataDir: "/data/dir",
  dbPath: "/data/dir/app.db",
};

const calls: string[] = [];

vi.mock("../../services/backupRestore", () => ({
  dataFolderInfo: async () => folder,
  exportBackup: async () => {
    calls.push("export");
    return exportOutcome;
  },
  importBackup: async () => {
    calls.push("import");
    return { kind: "done", path: "/tmp/old.db", detail: "Restart ACSA Code to load the restored data." };
  },
  createSupportBundle: async () => {
    calls.push("support");
    return supportOutcome;
  },
  revealDataFolder: async () => {
    calls.push("reveal");
    return revealOutcome;
  },
}));

const { DataPane } = await import("./DataPane");

beforeEach(() => {
  calls.length = 0;
  exportOutcome = { kind: "done", path: "/tmp/backup.db", detail: "without API keys" };
  supportOutcome = { kind: "done", path: "/tmp/support.json" };
  revealOutcome = { kind: "done", path: "/data/dir" };
  folder = { dataDir: "/data/dir", dbPath: "/data/dir/app.db" };
});

afterEach(cleanup);

describe("the Data pane", () => {
  it("shows where the data lives instead of making the user find it", async () => {
    render(<DataPane />);
    expect(await screen.findByText("/data/dir")).toBeTruthy();
  });

  it("reports a successful export with the file it wrote", async () => {
    render(<DataPane />);
    fireEvent.click(screen.getByRole("button", { name: /export backup/i }));
    expect(await screen.findByText(/without API keys/)).toBeTruthy();
    expect(screen.getByText("backup.db")).toBeTruthy();
  });

  it("shows failures rather than a silent no-op", async () => {
    exportOutcome = { kind: "failed", detail: "disk is full" };
    render(<DataPane />);
    fireEvent.click(screen.getByRole("button", { name: /export backup/i }));
    expect(await screen.findByText(/disk is full/)).toBeTruthy();
  });

  it("leaves no trace when the user cancels the picker", async () => {
    exportOutcome = { kind: "cancelled" };
    render(<DataPane />);
    fireEvent.click(screen.getByRole("button", { name: /export backup/i }));
    await waitFor(() => expect(calls).toContain("export"));
    expect(screen.queryByText(/disk/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /export backup/i })).not.toBeNull();
  });

  it("sends support through its own action, and says what it leaves out", async () => {
    render(<DataPane />);
    fireEvent.click(screen.getByRole("button", { name: /create support bundle/i }));
    await waitFor(() => expect(calls).toContain("support"));
    expect(screen.getByText(/never your API keys or chat history/i)).toBeTruthy();
  });

  it("warns that a backup leaves API keys behind", async () => {
    render(<DataPane />);
    expect(screen.getByText(/API keys are/i)).toBeTruthy();
  });
});
