import { describe, expect, it } from "vitest";
import { approvalSummary, countDiffLines, summarizeItemChanges, userInputResponse } from "./usePipeline";

/**
 * The answer half of `request_user_input`.
 *
 * This shape is not a guess: it was read out of the runtime's own protocol
 * schema, generated with `codex app-server generate-json-schema` —
 * `ToolRequestUserInputResponse` is `{"answers": {"<questionId>":
 * ToolRequestUserInputAnswer}}`, and each answer is `{"answers": ["<string>"]}`.
 *
 * The one live request we captured matches it: questions arrive with an `id`, and
 * with `header`, `question`, `isOther`, `isSecret` and `options[{label,description}]`.
 *
 * Worth pinning because the runtime *holds the turn* until it can deserialise
 * this. The approval path already has a scar from exactly that: an earlier
 * `{decision: "approved"}` was not in the runtime's vocabulary, so the reply was
 * unreadable and the turn waited forever.
 */
describe("answering a request_user_input question", () => {
  it("builds the shape the schema requires", () => {
    expect(userInputResponse({ approval: ["Approve — build it (Recommended)"] })).toEqual({
      answers: { approval: { answers: ["Approve — build it (Recommended)"] } },
    });
  });

  it("carries every question, and drops empty answers", () => {
    expect(userInputResponse({ a: ["one"], b: ["", "   "], c: ["two", "three"] })).toEqual({
      answers: { a: { answers: ["one"] }, b: { answers: [] }, c: { answers: ["two", "three"] } },
    });
  });

  it("handles no answers at all without inventing one", () => {
    expect(userInputResponse({})).toEqual({ answers: {} });
  });
});

/**
 * An approval has to say what it is for.
 *
 * The card used to render `pendingApproval.command`, which defaulted to the
 * *method name* — so a file-change approval read "$ item/fileChange/requestApproval"
 * and asked the user to approve something invisible. Only a command approval
 * carries a command; the rest get a sentence.
 */
describe("describing an approval", () => {
  it("names what each request is asking for", () => {
    expect(approvalSummary("item/commandExecution/requestApproval")).toBe("run a command");
    expect(approvalSummary("item/fileChange/requestApproval")).toBe("change files in this project");
    expect(approvalSummary("mcpServer/elicitation/request")).toBe("connect to an MCP server");
  });

  it("falls back to something honest for a method it does not know", () => {
    const summary = approvalSummary("item/brandNew/requestApproval");
    expect(summary).toBe("do something it needs your approval for");
    // Never the raw method: that is what made the card unreadable.
    expect(summary).not.toContain("item/");
  });
});

/**
 * A file-change approval names an item and nothing else, so the paths and the
 * diff have to come from the item the runtime announced first.
 */
describe("summarising a pending file change", () => {
  it("reads paths, kinds and diffs out of the item", () => {
    const item = {
      id: "call_1",
      type: "fileChange",
      status: "pending",
      changes: [
        { path: "/p/src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
        { path: "/p/src/b.ts", kind: "add", diff: "+hello" },
      ],
    };
    expect(summarizeItemChanges(item)).toEqual([
      { path: "/p/src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
      { path: "/p/src/b.ts", kind: "add", diff: "+hello" },
    ]);
  });

  it("returns nothing rather than inventing a change", () => {
    for (const junk of [undefined, null, {}, { changes: null }, { changes: [{}] }, "nope"]) {
      expect(summarizeItemChanges(junk)).toEqual([]);
    }
  });
});

/**
 * The change card's numbers. Counted from the runtime's own diff, so they
 * describe this turn rather than the working tree — and the `+++`/`---` file
 * headers are not changes, which is the easy way to be off by two.
 */
describe("counting a diff", () => {
  it("counts real changes and not the file headers", () => {
    const diff = [
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "-gone",
      "+new",
      "+extra",
    ].join("\n");
    expect(countDiffLines(diff)).toEqual({ added: 2, removed: 1 });
  });

  it("is zero for nothing at all", () => {
    expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("--- a/src/x.ts\n+++ b/src/x.ts")).toEqual({ added: 0, removed: 0 });
  });
});
