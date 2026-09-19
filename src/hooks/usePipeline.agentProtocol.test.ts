import { describe, expect, it } from "vitest";
import { approvalSummary, userInputResponse } from "./usePipeline";

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
