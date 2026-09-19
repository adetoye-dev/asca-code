/**
 * usePipeline.ts — Agent runs and project workspace state.
 *
 * Connects the workbench to real files, real processes and the agent runtime:
 * 1. Native folder picking (via macOS osascript / Tauri dialog).
 * 2. Real filesystem reading and writing to physical disk via Tauri IPC.
 * 3. Real project template scaffolding on physical disk.
 * 4. Agent tasks executed by the Codex runtime, streamed into the chat.
 * 5. Multi-provider AI support (Ollama, OpenAI-compatible APIs, local models).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { FileNode } from "../components/FileTree";
import type { OpenFileTab } from "../types/workbench";
import type { AISettings } from "../components/SettingsModal";
import type { PipelineOutputLine, SystemMetrics, PipelineStatus } from "../types/telemetry";
import { DESKTOP_REQUIRED_MESSAGE } from "../services/engineBridge";
import type { AgentStep } from "../services/aiChatService";
import { systemMetricsService } from "../services/systemMetricsService";
import {
  getActiveSelectedModel,
  isModelVisionCapable,
  loadAllProviders,
} from "../services/aiModelManager";
import {
  AGENT_APPROVAL_MODES,
  DEFAULT_AGENT_APPROVAL_MODE,
  localProviderFor,
  localToolCallingNote,
  resolveApprovalMode,
  type AgentApprovalMode,
  type AgentTransport,
  type ApprovalDecision,
} from "../services/agentApproval";
import { ensureProvidersHydrated } from "../services/aiModelManager";

/**
 * The provider id a local run uses once the tool adapter is in front of it.
 *
 * It cannot be `ollama`: that id is built into the runtime, and a
 * `[model_providers.ollama]` table is a hard config error ("Built-in providers
 * cannot be overridden").
 */
const LOCAL_ADAPTER_PROVIDER_ID = "acsa-local";

/**
 * Start the local-model tool adapter and return its Responses base URL.
 *
 * Best effort by design: a build without the adapter still runs, just without
 * tool calls, and the caller logs which of the two happened.
 */
async function startLocalToolAdapter(providerId: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const url = await invoke<string>("local_adapter_start", { providerId });
    return typeof url === "string" && url.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}


/**
 * Run an agent task on Codex, when its runtime is present.
 *
 * Replaces our own loop, which could not do native tool calling: the model narrated
 * `read_file` in prose and the harness answered with a guard message, so nothing was
 * ever edited. Verified by driving Codex headlessly against a configured provider — it
 * edited a file correctly and streamed `thread`/`turn`/`item` events.
 *
 * Returns true when Codex handled the run (including a mid-run failure, so the caller
 * does not then also run our pipeline and edit the project twice). False means the
 * runtime is absent and the caller should fall back.
 */
async function runAgent(params: {
  prompt: string;
  projectRoot: string;
  /** Which runtime to use. `exec` is the long-standing path. */
  transport?: AgentTransport;
  /** The runtime wants an answer before it can continue (app-server only). */
  onApproval?: (request: {
    id: unknown;
    method: string;
    params: any;
    changes?: PendingFileChange[];
  }) => void;
  /** The runtime says it is blocked on the human (`thread/status/changed`). */
  onWaitingForUser?: (status: string) => void;
  /** A `request_user_input` question, which needs answers, not a decision. */
  onQuestion?: (request: { id: unknown; questions: AgentQuestion[] }) => void;
  /** Provider/model the user picked for this message; wins over the saved default. */
  selection?: { providerId: string; model: string };
  /** How much the agent may do unattended. Defaults to "approve for me". */
  approvalMode?: AgentApprovalMode;
  onEvent: (event: any) => void;
  log: (line: string) => void;
  /** Something the run itself should say, beyond the model's own messages. */
  note?: (note: { name: string; detail: string; status: "done" | "failed" }) => void;
  /** Continue this thread instead of starting a new one. */
  resumeThreadId?: string;
  /** `data:` URLs from the composer; written to files and passed with `-i`. */
  images?: string[];
  /** Called with the thread that ran, so the caller can resume it next time. */
  onThread?: (threadId: string) => void;
  /** Why the run failed, in words the chat can show. */
  onFailure?: (detail: string) => void;
}): Promise<"unavailable" | "success" | "failed"> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getActiveSelectedModel, loadAllProviders } = await import("../services/aiModelManager");

  // The chat's model picker is per-message, so it is passed in. Without it the agent
  // silently ran on the saved default — which is how a run could use a different model
  // than the one shown in the composer.
  const saved = getActiveSelectedModel() as { providerId?: string; model?: string } | null;
  const providers = loadAllProviders() as Record<string, any>;
  const providerId =
    params.selection?.providerId ||
    saved?.providerId ||
    (Object.values(providers).find((p: any) => p.isDefault) as any)?.id;
  const provider = providerId ? providers[providerId] : undefined;
  const model = params.selection?.model || saved?.model || provider?.selectedModel;
  params.log(
    `[agent] codex: provider=${providerId ?? "none"} model=${model ?? "none"} baseUrl=${
      provider?.baseUrl ? "set" : "missing"
    }`,
  );
  if (!providerId || !model || !provider?.baseUrl) return "unavailable";

  const approval =
    AGENT_APPROVAL_MODES[params.approvalMode ?? DEFAULT_AGENT_APPROVAL_MODE] ??
    AGENT_APPROVAL_MODES[DEFAULT_AGENT_APPROVAL_MODE];

  // `wire_api` must be "responses": this Codex version rejects "chat" outright. The key
  // name matches what the Rust side sets in the child's environment, so the credential
  // itself never travels over IPC.
  //
  // Approvals: `approval_policy = "never"` DENIES tool calls that need approval (the
  // runtime says "requires approval, but approval policy is never"), so the working
  // default routes them through the automatic reviewer instead. Verified against the
  // binary: `on-request` + `auto_review` completes tool calls that `never` refuses.
  //
  // A local runtime needs help that a hosted one does not. Ollama's Responses
  // API accepts `tools` and drops them, so a local model reads and replies and
  // never acts. The adapter speaks Responses to the runtime and Ollama's native
  // `/api/chat` to the model, which is where tool calls actually work.
  const localProvider = localProviderFor(providerId);
  const adapterBaseUrl = localProvider ? await startLocalToolAdapter(providerId) : null;
  if (adapterBaseUrl) {
    params.log(`[agent] local models run through the tool adapter at ${adapterBaseUrl}`);
  } else {
    // No adapter: fall back to the runtime's own local-provider switch, which
    // reaches the model but cannot run tools. Say so rather than let an empty run
    // look like a broken agent.
    const note = localToolCallingNote(providerId);
    if (note) params.log(note);
  }
  // With the adapter the provider is a plain Responses endpoint, so it gets a
  // table like any hosted provider — under a name of its own, because `ollama`
  // is reserved and cannot be overridden.
  const runtimeProviderId = adapterBaseUrl ? LOCAL_ADAPTER_PROVIDER_ID : providerId;
  const runtimeBaseUrl = adapterBaseUrl ?? provider.baseUrl;
  const runtimeProviderName = adapterBaseUrl ? "Local models (ACSA tool adapter)" : provider.name || providerId;
  const configToml = [
    `model = "${model}"`,
    ...(localProvider && !adapterBaseUrl ? [] : [`model_provider = "${runtimeProviderId}"`]),
    `approval_policy = "${approval.approvalPolicy}"`,
    `approvals_reviewer = "${approval.approvalsReviewer}"`,
    `sandbox_mode = "${approval.sandboxMode}"`,
    // Host skills (`~/.agents/skills`) are left alone on purpose.
    //
    // They were the reason a run of "build a small todo app" stopped after a few
    // read-only commands: `superpowers:brainstorming` told the agent to present a
    // design and wait for a human, it did exactly that, and the transcript still
    // read like a completed report. `features.skip_host_skill_discovery = true`
    // was tried and *did not* stop it (the flag is still "under development"
    // upstream), and skipping was the wrong instinct anyway — those skills encode
    // a way of working that is worth having, and they only look broken because
    // this app could not play the other half of the conversation.
    //
    // So the work is to support the interaction, not to suppress the skill: the
    // runtime can ask the user (`ServerRequest::ToolRequestUserInput`, and a
    // thread status of `waitingOnUserInput`), and the app has to answer. See
    // `onWaitingForUser` below for what is wired up so far and what is not.
    //
    // `request_user_input` is gated to specific modes upstream, and the default
    // mode is not one of them — so without this the agent can only ask in prose,
    // which works (the reply resumes the thread) but cannot carry options or
    // block the turn. Turning it on is the difference between the agent
    // *describing* a question and the app being able to *ask* it.
    "features.default_mode_request_user_input = true",
    ...(localProvider && !adapterBaseUrl
      ? []
      : [
          "",
          `[model_providers.${runtimeProviderId}]`,
          `name = "${runtimeProviderName}"`,
          `base_url = "${runtimeBaseUrl}"`,
          // A local runtime has no credential, and `env_key` naming a variable
          // that is not set is a startup failure. Hosted providers still get it.
          ...(adapterBaseUrl ? [] : ['env_key = "ACSA_CODEX_API_KEY"']),
          'wire_api = "responses"',
        ]),
  ].join("\n");

  // Codex ships metadata only for its own models, so without a catalog entry for ours it
  // warns that it is "defaulting to fallback metadata" — the error the UI was showing.
  // Verified against a working Codex install: `model_catalog_json` must point at a FILE
  // (an inline value parses without error and is silently ignored), and this field set
  // mirrors a known-good catalog. Context window is conservative on purpose; too small
  // only compacts earlier.
  const catalogJson = JSON.stringify(
    {
      models: (provider.availableModels?.length ? provider.availableModels : [model]).map(
        (slug: string) => ({
          slug,
          display_name: slug,
          description: `${slug} via ${provider.name || providerId}.`,
          default_reasoning_level: "high",
          supported_reasoning_levels: [
            { effort: "low", description: "Low reasoning" },
            { effort: "high", description: "High reasoning" },
          ],
          shell_type: "shell_command",
          visibility: "list",
          supported_in_api: true,
          priority: 1,
          base_instructions:
            "You are a coding assistant. Help the user complete their task accurately, use available tools, and verify your changes.",
          context_window: 131072,
          max_context_window: 131072,
          effective_context_window_percent: 95,
          truncation_policy: { mode: "tokens", limit: 10000 },
          input_modalities: ["text"],
          apply_patch_tool_type: "freeform",
          support_verbosity: true,
          default_verbosity: "low",
          default_reasoning_summary: "none",
          supports_parallel_tool_calls: true,
          use_responses_lite: false,
          prefer_websockets: false,
          experimental_supported_tools: [],
        }),
      ),
    },
    null,
    2,
  );

  let sawEvent = false;
  // Installed MCP servers, emitted in Codex's own format so what the marketplace installs
  // is actually usable by the agent. Shape taken from a working Codex install:
  // `[mcp_servers.x]` with either `command`+`args` or a streamable-HTTP `url`, and an
  // optional `[mcp_servers.x.env]` table. Read from our registry rather than written into
  // Codex's config by the engine, because this run regenerates that config each time.
  let mcpToml = "";
  try {
    const { marketplaceFetch } = await import("../services/marketplaceClient");
    const res = await marketplaceFetch(
      `/api/mcp/servers?projectRoot=${encodeURIComponent(params.projectRoot)}`,
    );
    const servers = ((await res.json())?.servers ?? {}) as Record<string, any>;
    for (const [id, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== "object") continue;
      if (cfg.url) {
        mcpToml += `\n[mcp_servers.${id}]\nurl = "${cfg.url}"\n`;
        continue;
      }
      if (!cfg.command) continue;
      mcpToml += `\n[mcp_servers.${id}]\ncommand = "${cfg.command}"\n`;
      if (Array.isArray(cfg.args)) {
        mcpToml += `args = [${cfg.args.map((a: any) => `"${String(a)}"`).join(", ")}]\n`;
      }
      if (cfg.env && typeof cfg.env === "object") {
        mcpToml += `\n[mcp_servers.${id}.env]\n`;
        for (const [key, value] of Object.entries(cfg.env)) mcpToml += `${key} = "${value}"\n`;
      }
    }
    if (mcpToml) params.log(`[agent] codex: passing ${Object.keys(servers).length} MCP server(s) to the agent`);
  } catch {
    /* MCP is optional; a registry that cannot be read must not block the run */
  }

  if (params.transport === "app-server") {
    return runAgentOnAppServer({
      prompt: params.prompt,
      projectRoot: params.projectRoot,
      configToml: configToml + mcpToml,
      // Same id the exec path uses, so both transports reach the same provider.
      providerId: runtimeProviderId,
      catalogJson,
      model,
      approvalMode: params.approvalMode ?? DEFAULT_AGENT_APPROVAL_MODE,
      resumeThreadId: params.resumeThreadId,
      onEvent: params.onEvent,
      log: params.log,
      note: params.note,
      onThread: params.onThread,
      onFailure: params.onFailure,
      onApproval: params.onApproval,
      onWaitingForUser: params.onWaitingForUser,
      onQuestion: params.onQuestion,
    });
  }

  let finished = false;
  let failed = false;
  // Did the run actually *do* anything? A model that cannot drive the tool
  // protocol answers in prose — or writes the tool call out as text — and the
  // turn still completes. Observed with a local 7B coder: it emitted
  // `{"name":"spawn_agent",…}` as its message, edited nothing, and the run
  // reported success. Saying so is the difference between a silent no-op and a
  // diagnosable one.
  // Boxed for the same reason as `usageBox` below.
  const toolCallCount = { value: 0 };
  // The id of the thread this run is using, so the caller can resume it.
  const threadIdBox: { value: string } = { value: params.resumeThreadId || "" };
  // Token counts arrive on their own event just before `codex:exit`; the ledger
  // is the only place a run's real cost shows up, so they are worth carrying.
  // Boxed because it is written from a listener closure: a bare `let` would be
  // narrowed to `null` at the read below, since TypeScript cannot see the write.
  const usageBox: { value: { promptTokens: number; completionTokens: number } | null } = {
    value: null,
  };
  const startedAt = Date.now();
  const unlisten: Array<() => void> = [];
  try {
    unlisten.push(
      await listen<{ line?: string } | string>("codex:event", (event) => {
        sawEvent = true;
        // Rust emits `AiFrame { line }` — a struct. Reading the payload as a string
        // yields "[object Object]", so nothing rendered at all. Same shape mistake as
        // the chat and terminal streams; the field is the point.
        const payload = event.payload;
        const line = typeof payload === "string" ? payload : String(payload?.line ?? "");
        if (!sawEvent) params.log(`[agent] codex: first frame — ${line.slice(0, 180)}`);
        try {
          const parsed = JSON.parse(line);
          const itemType = parsed?.item?.type;
          // The stream says plainly whether the turn failed. Error *items* are not
          // failures: Codex emits them for warnings too — a missing model metadata
          // entry, and a `code-mode-host` helper it ships separately. Matching on
          // their prose marked a run that edited the file correctly as "needs
          // attention", and would have done it again for the next warning it adds.
          if (parsed?.type === "turn.failed") failed = true;
          if (itemType === "error") {
            params.log(`[agent] codex warning — ${String(parsed?.item?.message ?? "")}`);
          }
          // Remembered for the next turn: `resume` continues this thread rather
          // than starting from nothing.
          if (parsed?.type === "thread.started" && parsed?.thread_id) {
            threadIdBox.value = String(parsed.thread_id);
          }
          if (
            itemType === "command_execution" ||
            itemType === "file_change" ||
            itemType === "mcp_tool_call" ||
            itemType === "web_search"
          ) {
            toolCallCount.value += 1;
          }
          params.onEvent(parsed);
        } catch {
          /* a partial or non-JSON line carries nothing to show */
        }
      }),
    );
    unlisten.push(
      await listen<{ line?: string } | string>("codex:usage", (event) => {
        const payload = event.payload;
        const line = typeof payload === "string" ? payload : String(payload?.line ?? "");
        try {
          const parsed = JSON.parse(line);
          usageBox.value = {
            promptTokens: Number(parsed?.promptTokens) || 0,
            completionTokens: Number(parsed?.completionTokens) || 0,
          };
        } catch {
          /* no counts to record */
        }
      }),
    );
    unlisten.push(
      await listen<string>("codex:exit", (event) => {
        finished = true;
        const note = String(event.payload ?? "").trim();
        params.log(`[agent] codex: exited${note ? ` — ${note.slice(0, 180)}` : ""}`);
      }),
    );

    try {
      await invoke("codex_exec", {
        prompt: params.prompt,
        projectRoot: params.projectRoot,
        configToml: configToml + mcpToml,
        // The id the *runtime* sees. With the adapter it is a normal Responses
        // provider, so the runtime's own `--oss` local-provider switch must not
        // also fire — `localProvider: null` is what stops it.
        providerId: runtimeProviderId,
        catalogJson,
        model,
        localProvider: adapterBaseUrl ? null : localProvider,
        resumeThreadId: params.resumeThreadId,
        images: params.images ?? [],
      });
      params.log("[agent] codex: runtime started");
    } catch (error) {
      // A missing or unusable runtime has to be visible here — otherwise it is
      // indistinguishable from a run that simply produced no events.
      params.log(`[agent] codex: not started — ${String(error)}`);
      return "unavailable";
    }

    // Wait for the stream to end, so the caller only continues once the run is over.
    for (let i = 0; i < 7200 && !finished; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (threadIdBox.value) params.onThread?.(threadIdBox.value);
    const usage = usageBox.value;
    if (usage) {
      // Fire and forget: a spent ledger row must not delay the chat's own update,
      // and the engine computes the cost from its pricing table.
      const elapsed = Date.now() - startedAt;
      void (async () => {
        try {
          const { engineCall } = await import("../services/engineBridge");
          await engineCall("db", [
            "usage.record",
            JSON.stringify({
              provider: providerId,
              model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              latencyMs: elapsed,
              projectPath: params.projectRoot,
            }),
          ]);
        } catch {
          /* metering is diagnostics; never let it surface as a run failure */
        }
      })();
    }
    if (toolCallCount.value === 0 && !failed) {
      // A run that finished without touching a single tool is either a genuine
      // question or a model that could not act. Both are worth one line, because
      // the second looks identical to the first from the transcript.
      params.note?.({
        name: "No tools used",
        detail:
          "The model replied without running any tool, so nothing in the project changed.",
        status: "done",
      });
      params.log(
        "[agent] no tool calls this run. If you asked for a change, the model could not drive " +
          "tool calling — smaller local models often cannot. Try a cloud model or a larger local one.",
      );
    }
    return failed ? "failed" : "success";
  } catch {
    // A missing runtime is the expected miss and the caller must fall back. Anything
    // thrown after a real event is a mid-run failure, which is ours to report rather
    // than retry underneath — retrying would edit the project twice.
    return sawEvent ? (failed ? "failed" : "success") : "unavailable";
  } finally {
    unlisten.forEach((off) => off());
  }
}

/**
 * Run an agent task over the app-server protocol.
 *
 * The difference from `exec` is not the transport so much as what the runtime
 * can do once it is a live session: it streams the answer as it is written,
 * it can be interrupted mid-turn, and — the reason for the whole exercise — it
 * can *ask* before running something, which `exec` has no channel for.
 *
 * Requests and replies are matched by id on the Rust side; this only maps
 * notifications onto the progress surfaces the chat already renders.
 */
async function runAgentOnAppServer(params: {
  prompt: string;
  projectRoot: string;
  configToml: string;
  providerId: string;
  catalogJson: string;
  model: string;
  approvalMode: AgentApprovalMode;
  resumeThreadId?: string;
  onEvent: (event: any) => void;
  log: (line: string) => void;
  note?: (note: { name: string; detail: string; status: "done" | "failed" }) => void;
  onThread?: (threadId: string) => void;
  onFailure?: (detail: string) => void;
  /** A request the runtime needs an answer to before it can continue. */
  onApproval?: (request: {
    id: unknown;
    method: string;
    params: any;
    changes?: PendingFileChange[];
  }) => void;
  /**
   * The runtime says it is blocked on the human — `waitingOnUserInput` after a
   * skill asked a question, `waitingOnApproval` before running something.
   *
   * Nothing consumed `thread/status/changed` before this, so an agent that had
   * stopped to ask looked exactly like one that had finished.
   */
  onWaitingForUser?: (status: string) => void;
  /** A `request_user_input` question, which needs answers, not a decision. */
  onQuestion?: (request: { id: unknown; questions: AgentQuestion[] }) => void;
}): Promise<"unavailable" | "success" | "failed"> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const approval =
    AGENT_APPROVAL_MODES[params.approvalMode] ?? AGENT_APPROVAL_MODES[DEFAULT_AGENT_APPROVAL_MODE];

  let finished = false;
  let failed = false;
  // Set by turn/completed or turn/failed — the only signals that end a turn.
  const turnFinished = { value: false };
  const failureBox: { value: string } = { value: "" };
  const unlisten: Array<() => void> = [];
  const startedAt = Date.now();

  // Thread items the runtime has announced, by id. A file-change approval names
  // only an `itemId`, so the announced item is the only place the paths and the
  // diff exist. Bounded: a long turn announces a lot of items and only the recent
  // ones can still be waiting on an answer.
  const announcedItems = new Map<string, unknown>();

  try {
    unlisten.push(
      await listen<{ line?: string } | string>("agent:event", (event) => {
        const payload = event.payload;
        const line = typeof payload === "string" ? payload : String(payload?.line ?? "");
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        const method = String(parsed?.method ?? "");

        // A message with an id *and* a method is a request from the runtime —
        // an approval. It blocks the turn until answered, so it goes straight to
        // the UI rather than into the transcript.
        if (method && parsed?.id !== undefined) {
          // A question's payload is not a secret, and its shape is exactly what an
          // answer has to match — so it is the one request worth showing in full
          // when someone is working out why a turn is holding.
          const detail =
            method === "item/tool/requestUserInput"
              ? ` ${JSON.stringify(parsed.params ?? {}).slice(0, 600)}`
              : "";
          params.log(`[agent] the runtime is asking: ${method}${detail}`);
          if (method === "item/tool/requestUserInput") {
            params.onQuestion?.({
              id: parsed.id,
              questions: Array.isArray(parsed.params?.questions)
                ? (parsed.params.questions as AgentQuestion[])
                : [],
            });
          } else {
            const itemId = String(parsed.params?.itemId ?? "");
            params.onApproval?.({
              id: parsed.id,
              method,
              params: parsed.params,
              changes: summarizeItemChanges(announcedItems.get(itemId)),
            });
          }
          return;
        }

        // Remember the item itself, so an approval that arrives later can say
        // what it is about to change.
        if (method === "item/started" || method === "item/completed") {
          const item = parsed?.params?.item;
          const itemId = String(item?.id ?? "");
          if (itemId) {
            announcedItems.set(itemId, item);
            if (announcedItems.size > 50) {
              const oldest = announcedItems.keys().next().value;
              if (oldest !== undefined) announcedItems.delete(oldest);
            }
          }
        }

        if (method === "turn/completed" || method === "turn/failed") {
          turnFinished.value = true;
        }

        // The runtime narrates its own state, including the two that mean it is
        // blocked on a person. Set on *every* status change, not only a waiting
        // one: an approval that gets answered moves the thread on, and a flag
        // that is only ever raised leaves a finished run claiming to be waiting.
        if (method === "thread/status/changed") {
          params.onWaitingForUser?.(waitingStatusIn(parsed?.params));
        }

        if (method === "turn/failed") {
          failed = true;
          const detail = String(
            parsed?.params?.error?.message ??
              parsed?.params?.error ??
              "the agent turn failed",
          );
          failureBox.value = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
        }
        params.onEvent(parsed);
      }),
    );
    unlisten.push(
      // The runtime's own warnings and errors. Worth surfacing: a missing model
      // entry or an unsupported feature shows up here and nowhere else.
      await listen<{ line?: string } | string>("agent:stderr", (event) => {
        const payload = event.payload;
        const line = (typeof payload === "string" ? payload : String(payload?.line ?? "")).trim();
        if (line) params.log(`[agent] runtime: ${line.slice(0, 200)}`);
      }),
    );
    unlisten.push(
      await listen<{ line?: string } | string>("agent:exit", (event) => {
        // Emitted when the runtime's stdout reaches EOF — the real exit. It no
        // longer fires when stderr closes, which the runtime does early while
        // staying alive.
        finished = true;
        turnFinished.value = true;
        // Same frame as the other two agent channels; unwrap it the same way, or
        // the note prints as "[object Object]".
        const payload = event.payload;
        const note = (typeof payload === "string" ? payload : String(payload?.line ?? "")).trim();
        params.log(`[agent] app-server exited${note ? ` — ${note.slice(0, 180)}` : ""}`);
      }),
    );

    let threadId: string;
    // Same reason as the exec path: a local provider cannot run tools on this
    // transport either, and a silent run is worse than a stated one.
    {
      const note = localToolCallingNote(params.providerId);
      if (note) params.log(note);
    }
    try {
      threadId = await invoke<string>("agent_start", {
        projectRoot: params.projectRoot,
        configToml: params.configToml,
        providerId: params.providerId,
        catalogJson: params.catalogJson,
        model: params.model,
        resumeThreadId: params.resumeThreadId ?? null,
        // The mode decides this, not the transport: `ask-me` is the whole point
        // of being on app-server.
        approvalPolicy: approval.approvalPolicy,
        approvalsReviewer: approval.approvalsReviewer,
        sandboxMode: approval.sandboxMode,
      });
    } catch (error) {
      params.log(`[agent] app-server: not started — ${String(error)}`);
      return "unavailable";
    }
    if (threadId) params.onThread?.(threadId);
    params.log(`[agent] app-server: thread ${threadId.slice(0, 8)}`);

    try {
      await invoke("agent_turn", { text: params.prompt });
    } catch (error) {
      params.log(`[agent] app-server: turn rejected — ${String(error)}`);
      return "unavailable";
    }

    // Wait for the turn to end. The ceiling matches the run budget; a live
    // session means "still running" is visible, so this is only a backstop.
    const deadline = Date.now() + 3600_000;
    while (!finished && !failed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (turnFinished.value) break;
    }

    if (failed && failureBox.value) params.onFailure?.(failureBox.value);
    params.log(`[agent] app-server: turn finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    return failed ? "failed" : "success";
  } catch (error) {
    params.log(`[agent] app-server: ${String(error)}`);
    return "unavailable";
  } finally {
    unlisten.forEach((off) => off());
  }
}

/**
 * Map one app-server notification onto the chat's progress surfaces.
 *
 * The vocabulary differs from `exec`'s: camelCase item types, a dedicated delta
 * channel for the answer, and usage as its own notification rather than a field
 * on the turn event.
 */
function applyAppServerEvent(
  event: any,
  update: {
    setSteps: (fn: (prev: any[]) => any[]) => void;
    appendAnswer: (text: string) => void;
    setAnswer: (text: string) => void;
    logOutput: (line: any) => void;
    markTouched: (paths: string[]) => void;
    fail: (detail: string) => void;
  },
): void {
  const method = String(event?.method ?? "");
  const p = event?.params ?? {};

  // The runtime reports transport trouble as its own notification — "Reconnecting…
  // waiting for network", with a retry delay. Without this it retried silently
  // for minutes and the run looked like it had simply stopped.
  if (method === "error") {
    const message = String(p.error?.message ?? p.message ?? "the runtime reported an error");
    const retrying = p.willRetry ? " (retrying)" : "";
    update.logOutput({
      line_number: 0,
      content: `${message}${retrying}`,
      stream: p.willRetry ? "stdout" : "stderr",
      is_json: false,
    });
    // An error the runtime will not retry is the end of the turn. Without this
    // the run finished instantly and reported success — which is how a missing
    // API key looked like "Task completed."
    if (!p.willRetry) {
      update.fail?.(message);
    }
    return;
  }

  if (method === "item/agentMessage/delta" && typeof p.delta === "string") {
    update.appendAnswer(p.delta);
    return;
  }

  if (method !== "item/completed" || !p.item) return;
  const item = p.item;

  if (item.type === "agentMessage" && typeof item.text === "string") {
    // Authoritative: the streamed deltas are a preview of exactly this.
    update.setAnswer(item.text);
    return;
  }
  if (item.type === "commandExecution") {
    update.setSteps((prev) => {
      const step = {
        id: item.id || `as-${Date.now()}-${prev.length}`,
        name: "Run Command",
        detail: String(item.command || "").slice(0, 120),
        status: item.exitCode === 0 || item.exitCode === undefined ? "done" : "failed",
      };
      const idx = prev.findIndex((s: any) => s.id === step.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...step };
        return next;
      }
      return [...prev, step];
    });
    return;
  }
  if (item.type === "fileChange") {
    const changed: string[] = Array.isArray(item.changes)
      ? item.changes
          .map((c: any) => String(c?.path ?? ""))
          .filter((path: string) => path.length > 0)
      : [];
    if (changed.length > 0) {
      update.markTouched(changed);
      update.setSteps((prev) => [
        ...prev,
        {
          id: `as-edit-${changed.join("|").slice(0, 60)}`,
          name: "Edit Files",
          detail: changed.map((path) => path.split(/[\\/]/).pop()).join(", ").slice(0, 120),
          status: "done",
        },
      ]);
    }
  }
}

/**
 * Compose the single string the agent runtime receives.
 *
 * The runtime is a one-shot process, so everything the user attached to the
 * message has to travel inside the prompt: the file they are looking at, the
 * code they selected, and the recent turns. Dropping these silently is how
 * "can you fix this?" arrived with no subject.
 */
function buildAgentPrompt(
  request: string,
  activeFilePath?: string,
  selectedCode?: string,
  history?: Array<{ role: string; content: string }>,
): string {
  const parts: string[] = [];
  if (activeFilePath) parts.push(`Active file: ${activeFilePath}`);
  if (selectedCode) {
    parts.push(
      [
        "The user selected this code in the editor. Treat it as the subject of the request:",
        "```",
        selectedCode,
        "```",
      ].join("\n"),
    );
  }
  parts.push(request);
  if (history && history.length > 0) {
    const transcript = history
      .filter((m) => m && m.content)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    if (transcript) {
      parts.push(`Earlier in this conversation:\n\n${transcript}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Map one Codex stream event onto the progress surfaces the chat already renders.
 * Separate from the runner so the mapping is readable and testable on its own.
 */
function applyCodexEvent(
  event: any,
  update: {
    setSteps: (fn: (prev: any[]) => any[]) => void;
    appendAnswer: (text: string) => void;
    logOutput: (line: any) => void;
    markTouched: (paths: string[]) => void;
  },
): void {
  if (event?.type === "thread.started") {
    update.setSteps(() => []);
    return;
  }
  const item = event?.item;
  if (event?.type !== "item.completed" || !item) return;

  if (item.type === "agent_message" && item.text) {
    update.appendAnswer(String(item.text));
    return;
  }
  if (item.type === "command_execution") {
    update.setSteps((prev) => {
      const step = {
        id: item.id || `codex-${Date.now()}-${prev.length}`,
        name: "Run Command",
        detail: String(item.command || "").slice(0, 120),
        status: item.exit_code === 0 || item.exit_code === undefined ? "done" : "failed",
      };
      const idx = prev.findIndex((s: any) => s.id === step.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...step };
        return next;
      }
      return [...prev, step];
    });
    return;
  }
  if (item.type === "file_change") {
    // Codex reports each edited file here. Surfacing them marks the file tree, so a
    // run that touched six files is visible without reading the transcript.
    const changed: string[] = Array.isArray(item.changes)
      ? item.changes
          .map((c: any) => String(c?.path ?? c?.file ?? ""))
          .filter((p: string) => p.length > 0)
      : [];
    if (changed.length > 0) {
      update.markTouched(changed);
      update.setSteps((prev) => {
        const step = {
          id: `codex-edit-${changed.join("|").slice(0, 80)}`,
          name: "Edit Files",
          detail: changed.map((p) => p.split(/[\\/]/).pop()).join(", ").slice(0, 120),
          status: "done",
        };
        const idx = prev.findIndex((s: any) => s.id === step.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...step };
          return next;
        }
        return [...prev, step];
      });
    }
    return;
  }
  if (item.type === "error") {
    update.logOutput({
      line_number: 0,
      content: String(item.message || "Agent error"),
      stream: "stderr",
      is_json: false,
    });
  }
}
import { hydrateChatHistory } from "../services/aiChatPersistence";
import { appStore } from "../services/appStore";
import {
  syncProjectIndex,
  getIndexStatus,
  type ProjectIndexProfile,
} from "../services/agentHarness";

export interface ProjectMeta {
  path: string;
  name: string;
}

/**
 * A cheap "did anything change on disk" signature: every file's path and size.
 *
 * Exists because a run can report confident, well-written work and have written
 * nothing at all — watched happening twice, both times because a skill from the
 * user's personal Codex config told the agent to stop and present a design. The
 * transcript read like a report; `git status` was empty.
 *
 * It is a signature, not a hash: an edit that keeps the byte count identical
 * would slip through. That is why the wording it drives says what was measured
 * rather than asserting "nothing changed".
 */
export function fileSignature(nodes: FileNode[]): string {
  const parts: string[] = [];
  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (node.is_dir) {
        walk(node.children ?? []);
      } else {
        parts.push(`${node.path}:${node.size_bytes}`);
      }
    }
  };
  walk(nodes);
  return parts.sort().join("\n");
}

/**
 * Which "the runtime is blocked on the human" status, if any, this payload
 * carries — its own name (`waitingOnUserInput` / `waitingOnApproval`) or "".
 *
 * Matched by substring rather than by field path on purpose: `thread/status/changed`
 * carries a struct that moves between releases, and the failure mode of reading it
 * too cleverly is a paused run that still looks finished. Unknown extra fields are
 * harmless, a missed status is not.
 */
export function waitingStatusIn(payload: unknown): string {
  const serialised = JSON.stringify(payload ?? {});
  for (const status of ["waitingOnUserInput", "waitingOnApproval"]) {
    if (serialised.includes(status)) return status;
  }
  return "";
}

/**
 * One `request_user_input` question, exactly as the runtime sends it
 * (`ToolRequestUserInputQuestion` in its own schema).
 */
export type AgentQuestion = {
  id: string;
  header: string;
  question: string;
  /** Free text is allowed in addition to the options. */
  isOther?: boolean;
  isSecret?: boolean;
  options?: { label: string; description: string }[] | null;
};

/**
 * The answer payload the runtime expects, built from question ids → option
 * labels (or free text).
 *
 * Shape read from the runtime's own schema rather than inferred: the response is
 * `{"answers": {"<questionId>": {"answers": ["<string>", …]}}}`
 * (`ToolRequestUserInputResponse` / `ToolRequestUserInputAnswer`, which were
 * generated with `codex app-server generate-json-schema`). Getting this wrong
 * leaves the turn holding forever — the same failure as the old
 * `{decision: "approved"}` on the approval path.
 */
export function userInputResponse(answers: Record<string, string[]>): {
  answers: Record<string, { answers: string[] }>;
} {
  return {
    answers: Object.fromEntries(
      Object.entries(answers).map(([questionId, values]) => [
        questionId,
        { answers: values.filter((value) => value.trim().length > 0) },
      ]),
    ),
  };
}

/**
 * What an approval request is actually asking for, in a sentence.
 *
 * The runtime sends a method and, for a command, the command; for a file change
 * it sends only an `itemId` (`FileChangeRequestApprovalParams` has no paths), so
 * there is nothing to show but a description. Without this the card rendered the
 * raw method as the "command" — literally `$ item/fileChange/requestApproval` —
 * which asks the user to approve something they cannot see.
 */
export function approvalSummary(method: string): string {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "run a command";
    case "item/fileChange/requestApproval":
      return "change files in this project";
    case "item/permissions/requestApproval":
      return "use permissions it does not have yet";
    case "mcpServer/elicitation/request":
      return "connect to an MCP server";
    default:
      return "do something it needs your approval for";
  }
}

/** One file a pending approval would change, with the runtime's own diff. */
export type PendingFileChange = { path: string; kind: string; diff: string };

/**
 * Pull the changed files out of a `fileChange` thread item.
 *
 * The approval request itself carries only an `itemId` — no paths, no diff — so
 * on its own it asks the user to approve something they cannot see. The item is
 * announced first (`item/started` includes `changes[{path, kind, diff}]`, and
 * `changes` is required on the item), which is what makes showing it possible.
 */
export function summarizeItemChanges(item: unknown): PendingFileChange[] {
  const changes = (item as { changes?: unknown } | undefined)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes
    .map((change) => {
      const c = (change ?? {}) as { path?: unknown; kind?: unknown; diff?: unknown };
      return {
        path: String(c.path ?? ""),
        kind: String(c.kind ?? "update"),
        // Long enough to judge, short enough to render in a card.
        diff: typeof c.diff === "string" ? c.diff.slice(0, 4000) : "",
      };
    })
    .filter((change) => change.path.length > 0);
}

export interface ProjectIndexState {
  indexed: boolean;
  totalSymbols: number;
  profile: ProjectIndexProfile | null;
}

export interface UsePipelineReturn {
  // Project & Files
  activeProject: ProjectMeta;
  projectFiles: FileNode[];
  selectedFile: FileNode | null;
  setSelectedFile: (file: FileNode | null) => void;
  openTabs: OpenFileTab[];
  activeTabPath: string | null;
  currentDiff: string;
  setCurrentDiff: (diff: string) => void;
  applyPatchToTab: (path: string, newContent: string) => void;
  touchedPaths: string[];
  isProjectModalOpen: boolean;
  setIsProjectModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  aiSettings: AISettings;
  setAiSettings: (settings: AISettings) => void;

  // Folder & File Actions
  pickFolder: () => Promise<string | null>;
  openFolder: (folderPath: string) => Promise<void>;
  openFile: (file: FileNode) => Promise<void>;
  closeTab: (path: string) => void;
  selectTab: (path: string) => void;
  updateTabContent: (path: string, newContent: string) => void;
  saveFile: (path: string) => Promise<void>;
  createFileOrFolder: (parentPath: string, name: string, isDir: boolean) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  createProject: (name: string, template: string, parentDir?: string) => Promise<void>;
  refreshProjectFiles: () => Promise<FileNode[]>;

  // Code Intelligence & Indexer State
  indexStatus: ProjectIndexState;
  /** A finished run that left every file's path and size untouched. */
  noFileChanges: boolean;
  /**
   * The runtime's own name for a state where it is blocked on the human —
   * `waitingOnUserInput` after a skill asked a question, `waitingOnApproval`
   * before running something. Empty when it is not waiting.
   */
  waitingForUser: string;
  isIndexing: boolean;
  syncIndex: () => Promise<void>;

  // Pipeline State & Execution
  prompt: string;
  setPrompt: (p: string) => void;
  sliders?: { budget_vs_scale: string; speed_vs_precision: string; simplicity_vs_futureproof: string };
  setSliders?: (s: any) => void;
  status: PipelineStatus;
  activityLog: PipelineOutputLine[];
  systemMetrics: SystemMetrics | null;
  activeCenterView: "editor" | "diff";
  setActiveCenterView: (v: "editor" | "diff") => void;

  // Real-time Streaming & Agent Step State
  streamingAnswer: string;
  streamingThought: string;
  agentSteps: AgentStep[];
  /** Why the last agent run failed, for the chat to show in place of a generic line. */
  failureDetail: string;
  /** A request the agent is blocked on, if it is waiting for one. */
  pendingApproval: { id: unknown; method: string; command: string; reason: string } | null;
  /** A `request_user_input` question the runtime is holding the turn for. */
  pendingQuestion: { id: unknown; questions: AgentQuestion[] } | null;
  respondToQuestion: (answers: Record<string, string[]>) => Promise<void>;
  respondToApproval: (decision: ApprovalDecision) => Promise<void>;

  runPipeline: (
    customPrompt?: string,
    modelOverride?: { provider: string; model: string; apiKey?: string; baseUrl?: string },
    activeFilePath?: string,
    selectedCode?: string,
    conversationHistory?: Array<{ role: string; content: string }>,
    images?: string[]
  ) => Promise<void>;
  cancelPipeline: () => void;
  clearLog: () => void;
  isTauriAvailable: boolean;
}

const DEFAULT_SLIDERS = {
  budget_vs_scale: "medium",
  speed_vs_precision: "medium",
  simplicity_vs_futureproof: "medium",
};

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "ollama",
  model: "qwen2.5-coder:7b",
  apiKey: "",
  baseUrl: "http://127.0.0.1:11434",
  approvalMode: DEFAULT_AGENT_APPROVAL_MODE,
};

/**
 * The "AI Models & Providers" page is the single source of truth for API keys,
 * while `aide_ai_settings` only persists provider/model/baseUrl (secrets are
 * deliberately not duplicated there). Hydrate the key, base URL and model from
 * the provider registry so editor AI and the pipeline always see the
 * credentials the user actually configured.
 */
function hydrateAiSettings(settings: AISettings): AISettings {
  try {
    const providers = loadAllProviders() as Record<string, any>;
    const cfg = providers?.[settings.provider];
    if (!cfg) return settings;
    return {
      ...settings,
      model: settings.model || cfg.selectedModel || "",
      apiKey: cfg.apiKey ?? settings.apiKey ?? "",
      baseUrl: cfg.baseUrl ?? settings.baseUrl ?? "",
    };
  } catch {
    return settings;
  }
}

export function usePipeline(): UsePipelineReturn {
  const isTauriAvailable = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // AI settings
  // The database is the source of truth; this is the first-paint default until
  // the bootstrap effect below restores the saved selection.
  const [aiSettings, setAiSettingsState] = useState<AISettings>(() =>
    hydrateAiSettings(DEFAULT_AI_SETTINGS)
  );

  /**
   * Merge settings in, rather than rebuilding the record from the fields this
   * function happens to know about.
   *
   * The old version enumerated every field, which meant any caller passing a
   * partial object silently reset the ones it did not mention. Two separate
   * bugs came from that: the approval mode and the agent engine were dropped
   * from the persisted record on the next save, so both pickers reverted to
   * their defaults and looked like they did nothing.
   *
   * Fields the caller leaves `undefined` are simply not part of the merge, so a
   * partial update is a partial update.
   */
  const setAiSettings = (newSettings: AISettings) => {
    setAiSettingsState((prev) => {
      const incoming = Object.fromEntries(
        Object.entries(newSettings ?? {}).filter(([, value]) => value !== undefined),
      ) as AISettings;
      const merged = hydrateAiSettings({
        ...prev,
        ...incoming,
        // Secrets never live in this record; the provider registry owns them.
        apiKey: incoming.apiKey ?? prev.apiKey ?? "",
      });
      // Only the non-secret parts are persisted; credentials live in the app
      // database and are resolved server-side.
      const { apiKey: _apiKey, ...persistable } = merged;
      void appStore.setSetting("ai_settings", persistable).catch(() => {});
      return merged;
    });
  };

  /**
   * Bootstrap the app's own state from the database.
   *
   * Runs once: hydrating the provider registry (which also performs the one-time
   * migration of any registry left in localStorage, credentials included),
   * restoring the last-opened project, and loading that project's transcript.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureProvidersHydrated();
        const [settings, active] = await Promise.all([
          appStore.getSettings(),
          appStore.getActiveProject(),
        ]);
        if (cancelled) return;

        // Threads the agent ran in, so a follow-up after a relaunch still
        // continues the same conversation instead of starting from nothing.
        const storedThreads = settings["agent_threads"];
        if (storedThreads && typeof storedThreads === "object" && !cancelled) {
          for (const [key, id] of Object.entries(storedThreads as Record<string, unknown>)) {
            if (typeof id === "string" && id) agentThreadsRef.current.set(key, id);
          }
        }

        // One-time migration of the pre-database settings blob.
        let savedAi = settings["ai_settings"] as AISettings | undefined;
        if (!savedAi) {
          try {
            const legacy =
              localStorage.getItem("aide_ai_settings") || localStorage.getItem("ide_ai_settings");
            if (legacy) {
              const parsed = JSON.parse(legacy);
              if (parsed && typeof parsed === "object" && parsed.provider) {
                savedAi = { provider: parsed.provider, model: parsed.model || "", apiKey: "", baseUrl: parsed.baseUrl || "" };
                void appStore
                  .setSetting("ai_settings", {
                    provider: savedAi.provider,
                    model: savedAi.model,
                    baseUrl: savedAi.baseUrl,
                  })
                  .catch(() => {});
              }
              localStorage.removeItem("aide_ai_settings");
              localStorage.removeItem("ide_ai_settings");
            }
          } catch {
            /* storage disabled */
          }
        }
        if (savedAi?.provider) {
          // Every saved field is restored, by spreading them in rather than
          // listing them. The list is what broke this: it silently dropped each
          // field added after it was written, so the approval mode and the agent
          // engine — both saved correctly — reverted to their defaults on every
          // launch, and the pickers looked like they did nothing.
          setAiSettingsState((prev) =>
            hydrateAiSettings({
              ...prev,
              ...savedAi,
              apiKey: "",
            })
          );
        }

        if (active?.path && active.path !== "." && active.path !== "./") {
          setActiveProjectState({ name: active.name, path: active.path });
          void hydrateChatHistory(active.path);
        }
        // The active project lives in the database now; drop the old browser
        // pointer so it cannot resurrect an unrelated project later.
        try {
          localStorage.removeItem("aide_active_project");
        } catch {
          /* storage disabled */
        }
      } catch {
        // Database unavailable: the defaults above keep the app usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-hydrate keys/base URLs whenever the AI Models & Providers page saves,
  // or another tab changes storage, so editor AI never runs with a stale key.
  useEffect(() => {
    const refresh = () => setAiSettingsState((prev: any) => hydrateAiSettings(prev));
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("ai_providers") || e.key.includes("ai_settings")) refresh();
    };
    window.addEventListener("acsa:models-updated", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("acsa:models-updated", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Active project state
  const [activeProject, setActiveProjectState] = useState<ProjectMeta>(() => {
    // No project until hydration says which one (see the bootstrap effect).
    //
    // This used to be `"."`, which is resolved against the process working
    // directory — for an app launched from Finder that is `/`, so a cold start
    // listed the whole filesystem in the Explorer until the database answered,
    // and an agent run started before hydration would have run there. A blank
    // path renders the "open a folder" empty state instead, and the guards
    // below refuse to touch the filesystem without one.
    return { name: "", path: "" };
  });

  const setActiveProject = (proj: ProjectMeta) => {
    setActiveProjectState(proj);
    void appStore.touchProject(proj.path, proj.name).catch(() => {});
  };

  const [projectFiles, setProjectFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Editor tabs state
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [activeCenterView, setActiveCenterView] = useState<"editor" | "diff">("editor");

  // Pipeline & AI state
  const [prompt, setPrompt] = useState<string>("");
  const [sliders, setSliders] = useState<any>(DEFAULT_SLIDERS);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [activityLog, setActivityLog] = useState<PipelineOutputLine[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [currentDiff, setCurrentDiff] = useState<string>("");
  const [touchedPaths, setTouchedPaths] = useState<string[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState<string>("");
  const [streamingThought, setStreamingThought] = useState<string>("");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  // The reason a run failed, in the runtime's own words. The chat used to get
  // this from the orchestration result; when that was removed nothing filled it
  // in, so every failure fell through to "the task needs attention".
  const [failureDetail, setFailureDetail] = useState("");
  // True when a finished run left every file's path and size exactly as it found
  // them. The chat says so, because otherwise a design-first reply and a
  // completed edit look identical in the transcript.
  const [noFileChanges, setNoFileChanges] = useState(false);
  // Non-empty when the runtime says it is blocked on the human. Holds the
  // runtime's own status name (`waitingOnUserInput` / `waitingOnApproval`).
  const [waitingForUser, setWaitingForUser] = useState("");
  // Code Intelligence & Symbol Graph Indexer state
  const [indexStatus, setIndexStatus] = useState<ProjectIndexState>({
    indexed: false,
    totalSymbols: 0,
    profile: null,
  });
  const [isIndexing, setIsIndexing] = useState<boolean>(false);

  const syncIndex = useCallback(async () => {
    if (!activeProject?.path) return;
    setIsIndexing(true);
    try {
      const res = await syncProjectIndex(activeProject.path);
      if (res) {
        setIndexStatus({
          indexed: true,
          totalSymbols: res.totalSymbols,
          profile: res.profile,
        });
      }
    } finally {
      setIsIndexing(false);
    }
  }, [activeProject.path]);

  // Initial index probe when project path is ready
  useEffect(() => {
    if (activeProject?.path) {
      if (!activeProject.path) return;
      getIndexStatus(activeProject.path).then((stat) => {
        setIndexStatus({
          indexed: stat.indexed,
          totalSymbols: stat.totalSymbols,
          profile: stat.profile,
        });
        if (!stat.indexed && activeProject.path !== ".") {
          void syncIndex();
        }
      });
    }
  }, [activeProject.path, syncIndex]);

  // ── File Tree Loading ─────────────────────────────────────────────────────
  const refreshProjectFiles = useCallback(async (): Promise<FileNode[]> => {
    if (!activeProject.path) {
      setProjectFiles([]);
      return [];
    }
    if (isTauriAvailable) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const nodes = await invoke<FileNode[]>("list_project_files", {
          projectPath: activeProject.path,
        });
        setProjectFiles(nodes);
        return nodes;
      } catch (err) {
        console.warn("Tauri list_project_files failed:", err);
      }
    } else {
      console.warn(DESKTOP_REQUIRED_MESSAGE);
    }
    return [];
  }, [isTauriAvailable, activeProject.path]);

  /**
   * Something changed the files on disk: bring the tree *and* the symbol index
   * back in step with it.
   *
   * `refreshProjectFiles` alone was the whole story, so the Code Map, symbol
   * search and the agent's structural context kept describing the project as it
   * was before the turn. Watching it happen: the status bar read "3 files
   * synced" before a run that created two new `.tsx` files, and still read 3
   * afterwards, until someone clicked "re-index" by hand.
   *
   * Re-indexing is a full walk, but a cheap one — measured through the frozen
   * engine, 123 files/1011 symbols took 0.28s and 172 files/60k LOC took 0.39s —
   * so it is affordable to do on every write rather than trying to guess whether
   * a write was interesting.
   */
  const refreshWorkspace = useCallback(async (): Promise<FileNode[]> => {
    const nodes = await refreshProjectFiles();
    try {
      await syncIndex();
    } catch {
      // Keep the previous index. It is stale, which the status bar already says,
      // and a failed re-index must not turn into a failed save or a failed turn.
    }
    return nodes;
  }, [refreshProjectFiles, syncIndex]);

  // Initial load
  useEffect(() => {
    refreshProjectFiles();
  }, [refreshProjectFiles]);

  // ── Native Folder Selection ───────────────────────────────────────────────
  const pickFolder = useCallback(async (): Promise<string | null> => {
    if (isTauriAvailable) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const picked = await invoke<string | null>("pick_folder");
        return picked;
      } catch (err) {
        console.error("pick_folder failed:", err);
        return null;
      }
    } else {
      console.warn(DESKTOP_REQUIRED_MESSAGE);
      return null;
    }
  }, [isTauriAvailable]);

  const openFolder = useCallback(
    async (folderPath: string) => {
      const cleanPath = folderPath.trim();
      if (!cleanPath) return;

      const folderName = cleanPath.split(/[/\\]/).filter(Boolean).pop() || "project";
      setActiveProject({ name: folderName, path: cleanPath });
      setOpenTabs([]);
      setActiveTabPath(null);
      setCurrentDiff("");

      // Automatically trigger AST Symbol Graph indexing
      setIsIndexing(true);
      try {
        const syncRes = await syncProjectIndex(cleanPath);
        if (syncRes) {
          setIndexStatus({
            indexed: true,
            totalSymbols: syncRes.totalSymbols,
            profile: syncRes.profile,
          });
        }
      } finally {
        setIsIndexing(false);
      }
    },
    []
  );

  // ── File Operations ───────────────────────────────────────────────────────
  const openFile = useCallback(
    async (file: FileNode) => {
      setSelectedFile(file);
      if (file.is_dir) return;

      const existing = openTabs.find((t) => t.path === file.path);
      if (existing) {
        setActiveTabPath(file.path);
        setActiveCenterView("editor");
        return;
      }

      let content = "";
      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          content = await invoke<string>("read_file_content", {
            filePath: file.path,
            projectRoot: activeProject.path,
          });
        } catch (err) {
          content = `# Error reading file: ${err}`;
        }
      } else {
        // Shown in the editor rather than thrown: a browser preview should say why
        // the file is missing, not look like the file is empty.
        content = `# ${DESKTOP_REQUIRED_MESSAGE}`;
      }

      const newTab: OpenFileTab = {
        path: file.path,
        name: file.name,
        content,
        originalContent: content,
        isDirty: false,
      };

      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabPath(file.path);
      setActiveCenterView("editor");
    },
    [isTauriAvailable, openTabs, activeProject.path]
  );

  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.path !== path);
        if (activeTabPath === path) {
          const nextActive = next.length > 0 ? next[next.length - 1].path : null;
          setActiveTabPath(nextActive);
        }
        return next;
      });
    },
    [activeTabPath]
  );

  const selectTab = useCallback((path: string) => {
    setActiveTabPath(path);
    setActiveCenterView("editor");
  }, []);

  const updateTabContent = useCallback((path: string, newContent: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path === path) {
          return {
            ...tab,
            content: newContent,
            isDirty: newContent !== tab.originalContent,
          };
        }
        return tab;
      })
    );
  }, []);

  const applyPatchToTab = useCallback((path: string, newContent: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path === path) {
          return {
            ...tab,
            content: newContent,
            originalContent: newContent,
            isDirty: false,
          };
        }
        return tab;
      })
    );
  }, []);

  const saveFile = useCallback(
    async (path: string) => {
      const tab = openTabs.find((t) => t.path === path);
      if (!tab) return;

      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("write_file_content", {
            filePath: path,
            content: tab.content,
            projectRoot: activeProject.path,
          });
        } catch (err) {
          alert(`Failed to save: ${err}`);
          return;
        }
      } else {
        alert(DESKTOP_REQUIRED_MESSAGE);
        return;
      }

      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? { ...t, originalContent: t.content, isDirty: false }
            : t
        )
      );
    },
    [isTauriAvailable, openTabs, activeProject.path]
  );

  const createFileOrFolder = useCallback(
    async (parentPath: string, name: string, isDir: boolean) => {
      const cleanName = name.trim().replace(/^[/\\]+/, "");
      if (!cleanName) return;

      let targetPath: string;
      if (parentPath && parentPath !== activeProject.path) {
        targetPath = `${parentPath}/${cleanName}`;
      } else {
        targetPath = `${activeProject.path}/${cleanName}`;
      }

      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("create_file_or_folder", {
            path: targetPath,
            isDir,
            projectRoot: activeProject.path,
          });
          await refreshWorkspace();
          if (!isDir) {
            openFile({
              name: cleanName.split("/").pop() || cleanName,
              path: targetPath,
              is_dir: false,
              size_bytes: 0,
            });
          }
        } catch (err) {
          alert(`Failed to create: ${err}`);
        }
      } else {
        alert(DESKTOP_REQUIRED_MESSAGE);
      }
    },
    [isTauriAvailable, activeProject.path, refreshWorkspace, openFile]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("delete_project_file", {
            path,
            projectRoot: activeProject.path,
          });
          closeTab(path);
          await refreshWorkspace();
        } catch (err) {
          console.error("Delete failed:", err);
        }
      } else {
        console.warn(DESKTOP_REQUIRED_MESSAGE);
      }
    },
    [isTauriAvailable, activeProject.path, closeTab, refreshWorkspace]
  );

  const createProject = useCallback(
    async (name: string, template: string, parentDir?: string) => {
      if (!isTauriAvailable) {
        throw new Error(DESKTOP_REQUIRED_MESSAGE);
      }
      // Deliberately uncaught: the caller owns the dialog the user is looking
      // at, and it is the only place a message ends up next to the field that
      // caused it. Swallowing it here meant the dialog had already closed by the
      // time the user was told anything.
      const { invoke } = await import("@tauri-apps/api/core");
      const createdPath = await invoke<string>("create_project_template", {
        name,
        template,
        parentDir: parentDir || null,
      });
      setActiveProject({ name, path: createdPath });
      setOpenTabs([]);
      setActiveTabPath(null);
      setCurrentDiff("");
    },
    [isTauriAvailable]
  );

  // ── Poll System Metrics via Central Service ──────────────────────────────
  useEffect(() => {
    return systemMetricsService.subscribe((metrics) => {
      setSystemMetrics(metrics);
    });
  }, []);

  // ── Run Pipeline (100% Real Subprocess Execution) ─────────────────────────
  const pipelineAbortRef = useRef<AbortController | null>(null);

  /**
   * Live agent threads, keyed by everything that would invalidate one.
   *
   * A follow-up turn resumes the thread the previous turn ran in, so the agent
   * still has what it read and did — instead of being handed a fresh process and
   * a pasted-in transcript. Changing the model, provider or approval mode starts
   * a new thread, because resuming across those is not the same conversation.
   * Held in memory on purpose: a relaunch starts clean, like the CLI does.
   */
  const agentThreadsRef = useRef<Map<string, string>>(new Map());

  /**
   * A request the runtime is blocked on.
   *
   * Only the `ask-me` mode produces one, and only on the app-server transport —
   * `exec` is one-shot with no channel to answer on, so a request there is
   * auto-denied rather than shown. That is the whole reason the transport exists.
   */
  const [pendingApproval, setPendingApproval] = useState<{
    id: unknown;
    method: string;
    command: string;
    reason: string;
    /** Files this would change, when the runtime has announced the item. */
    changes?: PendingFileChange[];
  } | null>(null);
  const pendingApprovalRef = useRef(pendingApproval);
  pendingApprovalRef.current = pendingApproval;

  // A `request_user_input` question is a different thing from an approval: it
  // carries its own options and expects answers keyed by question id, so it gets
  // its own state rather than being squeezed into the approval card. Rendered as
  // an approval it read "APPROVAL NEEDED … $ item/tool/requestUserInput", which
  // is what a paused run looked like before this existed.
  const [pendingQuestion, setPendingQuestion] = useState<{
    id: unknown;
    questions: AgentQuestion[];
  } | null>(null);
  const pendingQuestionRef = useRef(pendingQuestion);
  pendingQuestionRef.current = pendingQuestion;

  const respondToQuestion = useCallback(async (answers: Record<string, string[]>) => {
    const request = pendingQuestionRef.current;
    if (!request) return;
    setPendingQuestion(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("agent_respond", {
        requestId: request.id,
        decision: userInputResponse(answers),
      });
    } catch (error) {
      setActivityLog((prev) => [
        ...prev,
        {
          line_number: prev.length + 1,
          content: `[agent] could not answer the question: ${String(error)}`,
          stream: "stderr",
          is_json: false,
        },
      ]);
    }
  }, []);

  const respondToApproval = useCallback(async (decision: ApprovalDecision) => {
    const request = pendingApprovalRef.current;
    if (!request) return;
    setPendingApproval(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // The runtime's own vocabulary, sent as-is. Its schema wants a decision
      // *string* — `accept` / `acceptForSession` / `decline` / `cancel` — and
      // rejects anything else, which is how an earlier `{decision: "approved"}`
      // left the turn waiting for an answer it never got.
      await invoke("agent_respond", {
        requestId: request.id,
        decision: { decision },
      });
    } catch (error) {
      setActivityLog((prev) => [
        ...prev,
        {
          line_number: prev.length + 1,
          content: `[agent] could not answer the approval: ${String(error)}`,
          stream: "stderr",
          is_json: false,
        },
      ]);
    }
  }, []);

  /**
   * Write the thread map back to the database.
   *
   * Small and infrequent — one entry per project + model + approval mode — so it
   * is written whole rather than patched. Best-effort: losing the pointers only
   * costs a fresh thread on the next turn, which is what the caller already
   * copes with when a resume fails.
   */
  const persistAgentThreads = useCallback(() => {
    const entries = Array.from(agentThreadsRef.current.entries());
    // Keep the map from growing without bound across projects and models.
    const trimmed = Object.fromEntries(entries.slice(-40));
    void appStore.setSetting("agent_threads", trimmed).catch(() => {});
  }, []);

  const runPipeline = useCallback(
    async (
      customPrompt?: string,
      modelOverride?: { provider: string; model: string; apiKey?: string; baseUrl?: string },
      activeFilePath?: string,
      selectedCode?: string,
      conversationHistory?: Array<{ role: string; content: string }>,
      images?: string[]
    ) => {
      const activePrompt = customPrompt ?? prompt;
      if (!activePrompt.trim()) return;
      if (!activeProject.path) {
        setStatus("failed");
        setFailureDetail("No project is open. Open a folder first — the agent runs inside it.");
        setAgentSteps([]);
        setActivityLog([
          {
            line_number: 1,
            content:
              "[agent] No project is open. Open a folder first — the agent runs inside it.",
            stream: "stderr",
            is_json: false,
          },
        ]);
        return;
      }

      setStatus("running");
      setPendingApproval(null);
      setPendingQuestion(null);
      setFailureDetail("");
      setNoFileChanges(false);
      setWaitingForUser("");
      setActivityLog([]);
      setCurrentDiff("");
      // The pre-run snapshot. `projectFiles` is the last list we loaded, and
      // nothing else refreshes it mid-run, so this is what the workspace looked
      // like when the agent started.
      const before = fileSignature(projectFiles);
      setStreamingAnswer("");
      setStreamingThought("");
      setAgentSteps([]);
      setTouchedPaths([]);

      // The thread key must reflect what the run will actually use, so resolve
      // the model the same way `runAgentOnCodex` does before asking for a thread.
      const activeSelection = getActiveSelectedModel() as
        | { providerId?: string; model?: string }
        | null;
      const threadProvider = modelOverride?.provider || activeSelection?.providerId || "";
      const threadModel = modelOverride?.model || activeSelection?.model || "";
      const threadKey = [
        activeProject.path,
        threadProvider,
        threadModel,
        aiSettings.approvalMode ?? "approve-for-me",
      ].join("\u0000");
      const resumeThreadId = agentThreadsRef.current.get(threadKey);

      const agentPrompt = buildAgentPrompt(
        activePrompt,
        activeFilePath,
        selectedCode,
        // A resumed thread already holds the earlier turns; re-sending them would
        // duplicate the conversation inside its own context.
        resumeThreadId ? undefined : conversationHistory,
      );
      if (resumeThreadId) {
        setActivityLog((prev) => [
          ...prev,
          {
            line_number: prev.length + 1,
            content: `[agent] continuing thread ${resumeThreadId.slice(0, 8)}`,
            stream: "stdout",
            is_json: false,
          },
        ]);
      }
      // The runtime will happily hand an image to a model that cannot read one,
      // and the provider answers 400 "Multimodal data provided, but model does
      // not support multimodal requests" — which the runtime retries five times
      // and then reports as a failed turn. Verified. So the check happens here:
      // an image the model cannot use is a warning, not a dead run.
      const visionCapable = isModelVisionCapable(threadProvider, threadModel);
      const usableImages = visionCapable ? images : undefined;
      if (images && images.length > 0) {
        setActivityLog((prev) => [
          ...prev,
          {
            line_number: prev.length + 1,
            content: visionCapable
              ? `[agent] attaching ${images.length} image(s)`
              : `[agent] ${images.length} image(s) not attached: ${threadModel || "this model"} does not take image input. Pick a vision model, or say what is in the image.`,
            stream: visionCapable ? "stdout" : "stderr",
            is_json: false,
          },
        ]);
      }

      if (isTauriAvailable) {
        const transport: AgentTransport =
          aiSettings.agentTransport === "app-server" ? "app-server" : "exec";
        const approvalMode = resolveApprovalMode(
          aiSettings.approvalMode ?? DEFAULT_AGENT_APPROVAL_MODE,
          transport,
        );
        if (transport === "app-server" && approvalMode === "ask-me") {
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content: "[agent] the runtime will ask before running anything risky",
              stream: "stdout",
              is_json: false,
            },
          ]);
        }

        // The two transports speak different event vocabularies, so the mapping
        // lives here and the runner stays transport-agnostic.
        const agentUpdate = {
          setSteps: setAgentSteps,
          appendAnswer: (text: string) => setStreamingAnswer((prev) => prev + text),
          logOutput: (line: any) => setActivityLog((prev) => [...prev, line]),
          markTouched: (paths: string[]) =>
            setTouchedPaths((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))]),
        };
        const onAgentEvent = (event: any) =>
          transport === "app-server"
            ? applyAppServerEvent(event, {
                ...agentUpdate,
                setAnswer: (text: string) => setStreamingAnswer(text),
                fail: (detail) => {
                  setFailureDetail(detail);
                  setStatus("failed");
                },
              })
            : applyCodexEvent(event, agentUpdate);

        const runOnce = (resume?: string) =>
          runAgent({
            prompt: agentPrompt,
            transport,
            approvalMode,
            onApproval: (request) => {
              const p = request.params ?? {};
              setPendingApproval({
                id: request.id,
                method: request.method,
                // Empty when there is no command to show. The old fallback was
                // the method name, which put `$ item/fileChange/requestApproval`
                // where a command belongs.
                command: String(p.command ?? p.path ?? ""),
                reason: String(p.reason ?? ""),
                changes: request.changes ?? [],
              });
            },
            onWaitingForUser: setWaitingForUser,
            onQuestion: setPendingQuestion,
            onEvent: onAgentEvent,
            resumeThreadId: resume,
            images: usableImages,
            onThread: (id) => {
              agentThreadsRef.current.set(threadKey, id);
              persistAgentThreads();
            },
            onFailure: setFailureDetail,
            projectRoot: activeProject.path,
          selection: modelOverride
            ? { providerId: modelOverride.provider, model: modelOverride.model }
            : undefined,
          // Diagnostics go to the OUTPUT panel: this is read by a human when the chat
          // shows nothing, so it says which branch ran and what actually arrived.
          log: (line) =>
            setActivityLog((prev) => [
              ...prev,
              { line_number: prev.length + 1, content: line, stream: "stdout", is_json: false },
            ]),
          note: (note) =>
            setAgentSteps((prev) => {
              const step = { id: `note-${note.name}`, ...note };
              const idx = prev.findIndex((s) => s.id === step.id);
              if (idx < 0) return [...prev, step];
              const next = [...prev];
              next[idx] = { ...next[idx], ...step };
              return next;
            }),
          });

        let codexStatus = await runOnce(resumeThreadId);

        // A resumed thread can be gone — a cleared session directory, a stale id.
        // That fails before the model sees anything, so starting over is safe and
        // is not the "two edits" risk a mid-run retry would be.
        if (codexStatus === "unavailable" && resumeThreadId) {
          agentThreadsRef.current.delete(threadKey);
          persistAgentThreads();
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content: "[agent] that thread could not be resumed; starting a fresh one.",
              stream: "stdout",
              is_json: false,
            },
          ]);
          codexStatus = await runOnce(undefined);
        }

        // No fallback to our own loop. It narrated tool calls in prose and answered
        // refusals with a guard message, editing nothing — degrading to it silently is
        // worse than failing. If the runtime is missing, say so and how to fix it.
        // Measured *before* the terminal status is set. The chat builds its
        // message from `status`, so a flag set afterwards is a flag the message
        // never sees — which is how the first version of this shipped invisible.
        const after = await refreshWorkspace();
        setNoFileChanges(fileSignature(after) === before);

        if (codexStatus === "unavailable") {
          setStatus("failed");
          setFailureDetail(
            "The agent runtime is unavailable. Run scripts/fetch_codex_sidecar.sh, then relaunch the app.",
          );
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content:
                "[agent] The Codex runtime is unavailable. Run scripts/fetch_codex_sidecar.sh and relaunch the app.",
              stream: "stderr",
              is_json: false,
            },
          ]);
        } else {
          // The chat derives its state from `status`, and a finished run leaves it on
          // "running" unless something clears it — which is why the panel once sat on
          // "Working (195s)" after a perfectly good edit.
          setStatus(codexStatus);
        }

      } else {
        // Agent runs need the desktop shell: the runtime, the engine and the
        // project live behind Tauri IPC. There is no browser fallback — the dev
        // bridge used to spawn the Python orchestrator here, and that whole
        // pipeline is gone. Say so instead of pretending to run.
        setStatus("failed");
        setActivityLog((prev) => [
          ...prev,
          {
            line_number: prev.length + 1,
            content:
              "[agent] Agent runs require the desktop app. Launch it with `npm run dev:app`.",
            stream: "stderr",
            is_json: false,
          },
        ]);
      }
      pipelineAbortRef.current = null;
    },
    [
      prompt,
      activeProject.path,
      aiSettings,
      isTauriAvailable,
      refreshWorkspace,
      persistAgentThreads,
      projectFiles,
    ]
  );

  const cancelPipeline = useCallback(async () => {
    pipelineAbortRef.current?.abort();
    pipelineAbortRef.current = null;
    if (isTauriAvailable) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("chat_cancel");
      } catch {}
    }
    setStatus("idle");
  }, [isTauriAvailable]);

  const clearLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  return {
    activeProject,
    projectFiles,
    selectedFile,
    setSelectedFile,
    openTabs,
    activeTabPath,
    currentDiff,
    setCurrentDiff,
    applyPatchToTab,
    touchedPaths,
    isProjectModalOpen,
    setIsProjectModalOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    aiSettings,
    setAiSettings,
    pickFolder,
    openFolder,
    openFile,
    closeTab,
    selectTab,
    updateTabContent,
    saveFile,
    createFileOrFolder,
    deleteFile,
    createProject,
    refreshProjectFiles,
    indexStatus,
    noFileChanges,
    waitingForUser,
    isIndexing,
    syncIndex,
    prompt,
    setPrompt,
    sliders,
    setSliders,
    status,
    activityLog,
    systemMetrics,
    activeCenterView,
    setActiveCenterView,
    runPipeline,
    cancelPipeline,
    clearLog,
    isTauriAvailable,
    streamingAnswer,
    streamingThought,
    agentSteps,
    failureDetail,
    pendingApproval,
    pendingQuestion,
    respondToQuestion,
    respondToApproval,
  };
}

export default usePipeline;
