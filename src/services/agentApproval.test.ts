import { describe, expect, it } from "vitest";
import {
  AGENT_APPROVAL_MODES,
  DEFAULT_AGENT_APPROVAL_MODE,
  DEFAULT_AGENT_TRANSPORT,
  isAgentApprovalMode,
  isAgentTransport,
  localProviderFor,
  localToolCallingNote,
  resolveApprovalMode,
  type ApprovalDecision,
} from "./agentApproval";

/**
 * The vocabulary the runtime accepts, quoted from its own schema.
 *
 * This is the bug these tests exist for: the app used to answer an approval with
 * `{decision: "approved"}`, which is not one of these, so the runtime could not
 * deserialize the reply and the turn waited forever. `tsc --noEmit` runs in
 * `verify`, so the two `@ts-expect-error` lines below fail the build if the
 * vocabulary ever drifts back.
 */
describe("approval decisions", () => {
  it("names exactly the four the runtime accepts", () => {
    const accepted: ApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];
    expect(accepted).toHaveLength(4);

    // @ts-expect-error the old spelling is not a decision the runtime knows
    const approved: ApprovalDecision = "approved";
    // @ts-expect-error neither is a denial object
    const denied: ApprovalDecision = { denied: { rejection: "no" } };
    expect([approved, denied]).toBeDefined();
  });
});

describe("approval modes", () => {
  it("guards values that came from storage", () => {
    expect(isAgentApprovalMode("ask-me")).toBe(true);
    expect(isAgentApprovalMode("approve-for-me")).toBe(true);
    expect(isAgentApprovalMode("yolo")).toBe(false);
    expect(isAgentApprovalMode(undefined)).toBe(false);
  });

  it("keeps ask-me on the transport that can actually ask", () => {
    // `exec` is one-shot with no channel to answer on, so the mode has to move
    // rather than silently become a run that auto-denies everything.
    expect(resolveApprovalMode("ask-me", "app-server")).toBe("ask-me");
    expect(resolveApprovalMode("ask-me", "exec")).toBe(DEFAULT_AGENT_APPROVAL_MODE);
    expect(resolveApprovalMode("full-access", "exec")).toBe("full-access");
  });

  it("defaults to the transport that can ask at all", () => {
    // The affordances that make the agent usable — approve a command, answer a
    // question — exist only on app-server. Defaulting to `exec` meant most
    // installs never saw any of them.
    expect(DEFAULT_AGENT_TRANSPORT).toBe("app-server");
    expect(resolveApprovalMode("ask-me", DEFAULT_AGENT_TRANSPORT)).toBe("ask-me");
  });

  it("maps every mode onto the three settings the runtime takes", () => {
    for (const [name, mode] of Object.entries(AGENT_APPROVAL_MODES)) {
      expect(mode.approvalPolicy, name).toBeTruthy();
      expect(mode.approvalsReviewer, name).toBeTruthy();
      expect(mode.sandboxMode, name).toBeTruthy();
      expect(mode.label, name).toBeTruthy();
    }
  });

  it("pins what each mode actually permits", () => {
    // The UI copy is a claim about these three values, so they are asserted
    // rather than merely present. The one that surprised us: "Ask me" still lets
    // the agent edit and build *inside* the project without a prompt, because the
    // sandbox is `workspace-write` — the mode decides who answers an escalation,
    // not whether in-project work needs one.
    expect(AGENT_APPROVAL_MODES["read-only"].sandboxMode).toBe("read-only");
    expect(AGENT_APPROVAL_MODES["ask-me"].sandboxMode).toBe("workspace-write");
    expect(AGENT_APPROVAL_MODES["full-access"].sandboxMode).toBe("danger-full-access");

    expect(AGENT_APPROVAL_MODES["ask-me"].approvalsReviewer).toBe("user");
    expect(AGENT_APPROVAL_MODES["approve-for-me"].approvalsReviewer).toBe("auto_review");

    expect(AGENT_APPROVAL_MODES["full-access"].approvalPolicy).toBe("never");
    for (const name of ["read-only", "approve-for-me", "ask-me"] as const) {
      expect(AGENT_APPROVAL_MODES[name].approvalPolicy, name).toBe("on-request");
    }
  });

  it("only accepts the two transports the runtime is started with", () => {
    expect(isAgentTransport("exec")).toBe(true);
    expect(isAgentTransport("app-server")).toBe(true);
    expect(isAgentTransport("daemon")).toBe(false);
  });
});

describe("local providers", () => {
  it("recognises the two local runtimes and nothing else", () => {
    expect(localProviderFor("ollama")).toBe("ollama");
    expect(localProviderFor("LMStudio")).toBe("lmstudio");
    expect(localProviderFor("deepseek")).toBeNull();
    expect(localProviderFor(undefined)).toBeNull();
  });

  it("explains a local run that cannot act, and stays quiet otherwise", () => {
    const note = localToolCallingNote("ollama");
    expect(note).toContain("ollama");
    expect(note).toMatch(/Responses API/);
    expect(localToolCallingNote("deepseek")).toBeNull();
  });
});
