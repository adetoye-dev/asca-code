// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/** What the fake engine answers, and what it was asked. */
const engine = vi.hoisted(() => ({
  calls: [] as string[],
  status: {
    isGit: true,
    branch: "dev",
    ahead: 2,
    behind: 1,
    staged: [{ path: "src/a.ts", indexStatus: "M", workTreeStatus: " ", isStaged: true }],
    unstaged: [
      { path: "src/b.ts", indexStatus: " ", workTreeStatus: "M", isStaged: false },
      { path: "src/new.ts", indexStatus: " ", workTreeStatus: "??", isStaged: false },
    ],
  },
  diff: { success: true, originalContent: "before", modifiedContent: "after" },
  commit: { success: true, message: "committed" },
}));

vi.mock("../../services/gitClient", () => ({
  gitFetch: async (path: string) => {
    const action = path.replace("/api/git/", "");
    engine.calls.push(action);
    const body =
      action === "status"
        ? engine.status
        : action === "diff-file"
          ? engine.diff
          : action === "commit"
            ? engine.commit
            : { success: true, output: `${action} ok` };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

// The real one mounts Monaco; what this page hands it is the test's subject.
vi.mock("../editor/MonacoDiffContainer", () => ({
  MonacoDiffContainer: ({ filePath, originalContent, modifiedContent }: any) => (
    <div data-testid="diff-surface">
      <div data-testid="diff-path">{filePath}</div>
      <div data-testid="diff-sides">{`${originalContent} → ${modifiedContent}`}</div>
    </div>
  ),
}));

const { GitDashboard } = await import("./GitDashboard");

beforeEach(() => {
  engine.calls = [];
});
afterEach(cleanup);

describe("the source control page", () => {
  it("shows the branch, its divergence, and both groups of changes", async () => {
    render(<GitDashboard projectCwd="/work/acsa-code" />);
    await waitFor(() => expect(screen.getByText("dev")).toBeTruthy());
    expect(screen.getByTitle("2 ahead of the remote")).toBeTruthy();
    expect(screen.getByTitle("1 behind the remote")).toBeTruthy();
    expect(screen.getByText("Staged changes · 1")).toBeTruthy();
    expect(screen.getByText("Changes · 2")).toBeTruthy();
  });

  it("previews the diff of the file that was chosen", async () => {
    render(<GitDashboard projectCwd="/work/acsa-code" />);
    await waitFor(() => expect(screen.getByText("Changes · 2")).toBeTruthy());

    fireEvent.click(screen.getByTestId("git-file-src/b.ts"));

    await waitFor(() => expect(screen.getByTestId("diff-path").textContent).toBe("src/b.ts"));
    expect(screen.getByTestId("diff-sides").textContent).toBe("before → after");
    // And it asked the engine for the working-tree side, not the staged one.
    expect(engine.calls).toContain("diff-file");
  });

  it("will not commit with nothing staged, or with no message", async () => {
    render(<GitDashboard projectCwd="/work/acsa-code" />);
    await waitFor(() => expect(screen.getByTestId("git-commit")).toBeTruthy());
    // One file is staged, so the message is the only thing missing.
    const commit = screen.getByTestId("git-commit");
    expect(commit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("git-commit-message"), {
      target: { value: "fix: the thing" },
    });
    expect(commit.hasAttribute("disabled")).toBe(false);
  });

  it("commits, then clears the box and the preview", async () => {
    render(<GitDashboard projectCwd="/work/acsa-code" />);
    await waitFor(() => expect(screen.getByText("Staged changes · 1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("git-file-src/a.ts"));
    await waitFor(() => expect(screen.getByTestId("diff-path")).toBeTruthy());

    fireEvent.change(screen.getByTestId("git-commit-message"), { target: { value: "feat: it" } });
    fireEvent.click(screen.getByTestId("git-commit"));

    await waitFor(() => expect(engine.calls).toContain("commit"));
    await waitFor(() =>
      expect((screen.getByTestId("git-commit-message") as HTMLTextAreaElement).value).toBe("")
    );
    expect(screen.queryByTestId("diff-path")).toBeNull();
  });

  it("asks before discarding, and says what will be lost", async () => {
    render(<GitDashboard projectCwd="/work/acsa-code" />);
    await waitFor(() => expect(screen.getByText("Changes · 2")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Discard changes in b.ts"));
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    expect(screen.getByText(/throws away the working-tree changes in b\.ts/)).toBeTruthy();

    // Cancelling must not touch the engine.
    engine.calls = [];
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText("Discard changes?")).toBeNull());
    expect(engine.calls).not.toContain("discard");
  });

  it("says so when the folder is not a repository", async () => {
    engine.status = { ...engine.status, isGit: false };
    render(<GitDashboard projectCwd="/tmp/not-a-repo" />);
    expect(await screen.findByText(/not a git repository/)).toBeTruthy();
    engine.status = { ...engine.status, isGit: true };
  });
});
