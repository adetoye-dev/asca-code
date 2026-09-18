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
      "Edits and commands run inside your project without asking. Anything reaching past it is reviewed automatically, so a run does not stop to interrupt you.",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxMode: "workspace-write",
  },
  "ask-me": {
    label: "Ask me",
    description:
      // Says what the sandbox actually does, because the honest answer surprised
      // us too: `workspace-write` lets the agent edit and build inside the project
      // *without* asking, so "Ask me" is not "approve every change" — it is
      // "I answer the escalations, not an automatic reviewer". Verified by running
      // a multi-file refactor under this mode: no prompt appeared.
      "Edits and commands run inside your project without asking. Anything reaching past it — the network, other folders, destructive commands — waits for your approval in the chat. Needs the app-server engine below.",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
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

/**
 * The runtime's answers to an approval request, verbatim from its schema.
 *
 * `CommandExecutionRequestApprovalResponse.decision` is one of these strings.
 * It is not a boolean and not `{denied: {...}}`: an unrecognized value fails the
 * runtime's deserialization, so the request is never really answered and the
 * turn waits forever. Generating the protocol schema is what settled this.
 */
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

/**
 * Provider ids that are a local runtime rather than an OpenAI-compatible API.
 *
 * These have to be handed to the agent runtime through its own local-provider
 * switch. A custom `model_providers` entry cannot reach them: that path is
 * OpenAI-compatible HTTP and is configured with `wire_api = "responses"`, which
 * Ollama does not implement, so the run fails before its first token.
 */
export const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "local"]);

export function localProviderFor(providerId: string | undefined): string | null {
  const id = (providerId || "").toLowerCase();
  if (id === "ollama") return "ollama";
  if (id === "lmstudio") return "lmstudio";
  return null;
}

/**
 * Why an agent run on a local model does nothing — for the OUTPUT panel.
 *
 * Measured, not guessed: the runtime sends its tools to `/v1/responses`
 * (`exec_command`, `write_stdin`, … — captured on the wire), and Ollama 0.34.1
 * answers with the tool call as *plain text* rather than a `function_call`, so
 * no action is ever executed. Ollama's native `/api/chat` does support tools,
 * and the runtime will not use it (`wire_api = "chat"` is rejected), so this is
 * the Responses shim. Reported once at run start so a run that reads and replies
 * but changes nothing explains itself instead of looking broken.
 */
export function localToolCallingNote(providerId: string | undefined): string | null {
  const local = localProviderFor(providerId);
  if (!local) return null;
  return `[agent] ${local} is reachable but cannot run tools: its Responses API drops tool definitions, so this run can read and reply but will not edit files or run commands. Use a hosted provider for agent mode.`;
}

/**
 * How much of the agent can run unattended.
 *
 * `ask-me` is the one mode that needs the app-server transport: `codex exec` is
 * one-shot with no channel to answer an approval request on, so a request under
 * `approvalsReviewer = "user"` would be auto-denied rather than shown.
 */
export type AgentTransport = "exec" | "app-server";

export const AGENT_TRANSPORTS = {
  exec: {
    label: "Codex exec",
    description:
      "One process per turn. Proven, but cannot ask for approval, cannot be steered mid-run, and reports the answer only once it is whole.",
  },
  "app-server": {
    label: "App-server",
    description:
      "A live session: streams the answer as it is written, can be interrupted, and can ask you before running something risky.",
  },
} as const;

export const DEFAULT_AGENT_TRANSPORT: AgentTransport = "exec";

export function isAgentTransport(value: unknown): value is AgentTransport {
  return value === "exec" || value === "app-server";
}

/** Whether a mode can be honoured on a transport, and what to use if not. */
export function resolveApprovalMode(
  mode: AgentApprovalMode,
  transport: AgentTransport,
): AgentApprovalMode {
  if (mode === "ask-me" && transport !== "app-server") return DEFAULT_AGENT_APPROVAL_MODE;
  return mode;
}
