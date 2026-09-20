import { describe, expect, it } from "vitest";
import { fileSignature } from "./usePipeline";
import type { FileNode } from "../components/FileTree";

const file = (path: string, size_bytes: number): FileNode => ({
  name: path.split("/").pop() ?? path,
  path,
  is_dir: false,
  size_bytes,
});

const dir = (path: string, children: FileNode[]): FileNode => ({
  name: path.split("/").pop() ?? path,
  path,
  is_dir: true,
  size_bytes: 0,
  children,
});

/**
 * The signature exists because a run can report confident work and have written
 * nothing — twice observed, both times a skill from the user's personal Codex
 * config telling the agent to present a design and stop. It is what lets the chat
 * say "no files were added, removed or resized" instead of leaving a design and a
 * completed edit looking identical.
 */
describe("the workspace signature", () => {
  it("walks into directories rather than counting them", () => {
    const tree = [dir("/p/src", [file("/p/src/a.ts", 10), file("/p/src/b.ts", 20)])];
    expect(fileSignature(tree)).toBe("/p/src/a.ts:10\n/p/src/b.ts:20");
  });

  it("is stable while nothing changes", () => {
    const tree = [file("/p/a.ts", 10), dir("/p/src", [file("/p/src/b.ts", 5)])];
    expect(fileSignature(tree)).toBe(fileSignature(structuredClone(tree)));
  });

  it("notices an added, removed or resized file", () => {
    const before = fileSignature([file("/p/a.ts", 10)]);
    expect(fileSignature([file("/p/a.ts", 10), file("/p/b.ts", 1)])).not.toBe(before);
    expect(fileSignature([])).not.toBe(before);
    expect(fileSignature([file("/p/a.ts", 11)])).not.toBe(before);
  });
});

describe("reading the runtime's waiting state", () => {
  // `thread/status/changed` carries a struct whose shape moves between releases,
  // so this matches by name rather than by field path. Getting it wrong in the
  // quiet direction is the bad one: a run that stopped to ask would look finished.
  it("finds the status in whatever shape it arrives in", async () => {
    const { waitingStatusIn } = await import("./usePipeline");
    expect(waitingStatusIn({ threadId: "t", status: "waitingOnUserInput" })).toBe("waitingOnUserInput");
    expect(waitingStatusIn({ status: { type: "waitingOnApproval" } })).toBe("waitingOnApproval");
    expect(waitingStatusIn({ status: { kind: "waiting", detail: "waitingOnUserInput" } })).toBe("waitingOnUserInput");
  });

  it("says nothing for the ordinary states", async () => {
    const { waitingStatusIn } = await import("./usePipeline");
    for (const payload of [{ status: "active" }, { status: "complete" }, {}, null, undefined]) {
      expect(waitingStatusIn(payload)).toBe("");
    }
  });
});
