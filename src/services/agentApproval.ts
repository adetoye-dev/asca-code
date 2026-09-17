/**
 * agentApproval.ts — how much the agent may do without asking.
 *
 * Mapped onto the agent runtime's own three settings. Every value here was
 * checked against the shipped binary rather than assumed:
 *
 *   - `approval_policy` accepts `untrusted` | `on-failure` | `on-request` |
 *     `granular` | `never`, but `untrusted` is refused at *runtime* ("no longer
 *     supported"), so "read only" is expressed through the sandbox instead.
 *   - `approvals_reviewer` accepts `user` | `auto_review` | `guardian_subagent`.
 *   - `sandbox_mode` accepts `read-only` | `workspace-write` | `danger-full-access`.
 *
 * A rejected value is a config error that stops the run before it starts, so
 * these three combinations were each loaded with `--strict-config` and confirmed
 * to reach the provider.
 */

export const AGENT_APPROVAL_MODES = {
  "read-only": {
    label: "Read only",
    description: "The agent can read and search, but cannot change files or run commands.",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxMode: "read-only",
  },
  "approve-for-me": {
    label: "Approve for me",
    description:
      "Safe edits and commands run on their own; anything risky is reviewed before it runs.",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxMode: "workspace-write",
  },
  "full-access": {
    label: "Full access",
    description: "No review at all. The agent can run anything, anywhere.",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxMode: "danger-full-access",
  },
} as const;

export type AgentApprovalMode = keyof typeof AGENT_APPROVAL_MODES;

export const DEFAULT_AGENT_APPROVAL_MODE: AgentApprovalMode = "approve-for-me";

/** Guard for values that came out of storage, which may be stale or hand-edited. */
export function isAgentApprovalMode(value: unknown): value is AgentApprovalMode {
  return typeof value === "string" && value in AGENT_APPROVAL_MODES;
}
