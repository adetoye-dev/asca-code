/**
 * usePipeline.ts — Orchestration & Project Workspace State Hook (100% Real Execution)
 *
 * Connects the desktop IDE directly to real files and real Python processes:
 * 1. Native folder picking (via macOS osascript / Tauri dialog).
 * 2. Real filesystem reading and writing to physical disk via Vite FS bridge or Tauri IPC.
 * 3. Real project template scaffolding on physical disk.
 * 4. Real execution of `python3 core-engine/manager.py` with live stdout/stderr line streaming.
 * 5. Multi-provider AI engine support (Ollama, local sidecar, OpenAI-compatible API, or offline AST synthesizer).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { FileNode } from "../components/FileTree";
import type { OpenFileTab } from "../types/workbench";
import type { AISettings } from "../components/SettingsModal";
import type {
  TelemetryData,
  OrchestrationResult,
  PipelineOutputLine,
  SystemMetrics,
  PipelineStatus,
} from "../components/TelemetryScorecard";
import type { AgentStep } from "../services/aiChatService";
import { systemMetricsService } from "../services/systemMetricsService";
import { loadAllProviders } from "../services/aiModelManager";
import { ensureProvidersHydrated } from "../services/aiModelManager";

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
async function runAgentOnCodex(params: {
  prompt: string;
  projectRoot: string;
  onEvent: (event: any) => void;
  log: (line: string) => void;
}): Promise<"unavailable" | "success" | "failed"> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getActiveSelectedModel, loadAllProviders } = await import("../services/aiModelManager");

  // The pipeline entry point does not receive the provider, so use the saved selection —
  // exactly "what the user chose" — falling back to the default provider.
  const saved = getActiveSelectedModel() as { providerId?: string; model?: string } | null;
  const providers = loadAllProviders() as Record<string, any>;
  const providerId =
    saved?.providerId || (Object.values(providers).find((p: any) => p.isDefault) as any)?.id;
  const provider = providerId ? providers[providerId] : undefined;
  const model = saved?.model || provider?.selectedModel;
  params.log(
    `[agent] codex: provider=${providerId ?? "none"} model=${model ?? "none"} baseUrl=${
      provider?.baseUrl ? "set" : "missing"
    }`,
  );
  if (!providerId || !model || !provider?.baseUrl) return "unavailable";

  // `wire_api` must be "responses": this Codex version rejects "chat" outright. The key
  // name matches what the Rust side sets in the child's environment, so the credential
  // itself never travels over IPC.
  const configToml = [
    `model = "${model}"`,
    `model_provider = "${providerId}"`,
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    "",
    `[model_providers.${providerId}]`,
    `name = "${provider.name || providerId}"`,
    `base_url = "${provider.baseUrl}"`,
    'env_key = "ACSA_CODEX_API_KEY"',
    'wire_api = "responses"',
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
  let finished = false;
  let failed = false;
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
          // Codex reports a missing *model metadata* entry as an `error` item, and that is
          // a warning about capability hints, not a failed task. Counting it as failure
          // marked a run that edited the file correctly as "needs attention".
          const fatal =
            parsed?.item?.type === "error" &&
            !/metadata/i.test(String(parsed?.item?.message ?? ""));
          if (fatal) failed = true;
          params.onEvent(parsed);
        } catch {
          /* a partial or non-JSON line carries nothing to show */
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
        configToml,
        providerId,
        catalogJson,
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
 * Map one Codex stream event onto the progress surfaces the chat already renders.
 * Separate from the runner so the mapping is readable and testable on its own.
 */
function applyCodexEvent(
  event: any,
  update: {
    setSteps: (fn: (prev: any[]) => any[]) => void;
    appendAnswer: (text: string) => void;
    logOutput: (line: any) => void;
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
  refreshProjectFiles: () => Promise<void>;

  // Code Intelligence & Indexer State
  indexStatus: ProjectIndexState;
  isIndexing: boolean;
  syncIndex: () => Promise<void>;

  // Pipeline State & Execution
  prompt: string;
  setPrompt: (p: string) => void;
  sliders?: { budget_vs_scale: string; speed_vs_precision: string; simplicity_vs_futureproof: string };
  setSliders?: (s: any) => void;
  status: PipelineStatus;
  telemetry: TelemetryData | null;
  orchestrationResult: OrchestrationResult | null;
  activityLog: PipelineOutputLine[];
  systemMetrics: SystemMetrics | null;
  activeCenterView: "editor" | "diff";
  setActiveCenterView: (v: "editor" | "diff") => void;

  // Real-time Streaming & Agent Step State
  streamingAnswer: string;
  streamingThought: string;
  agentSteps: AgentStep[];
  pendingPermission: { id: string; command: string; description: string } | null;
  respondToPermission: (id: string, decision: "approved" | "rejected") => Promise<void>;

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

  const setAiSettings = (newSettings: AISettings) => {
    const safeSettings: AISettings = {
      provider: newSettings?.provider || DEFAULT_AI_SETTINGS.provider,
      model: newSettings?.model || "",
      apiKey: newSettings?.apiKey || "",
      baseUrl: newSettings?.baseUrl || "",
      // Editor and terminal preferences live alongside the model selection; the
      // settings dialog writes them through onSave and they are persisted below.
      fontSize: newSettings?.fontSize,
      lineHeight: newSettings?.lineHeight,
      enableLigatures: newSettings?.enableLigatures,
      tabSize: newSettings?.tabSize,
      insertSpaces: newSettings?.insertSpaces,
      wordWrap: newSettings?.wordWrap,
      terminalFontSize: newSettings?.terminalFontSize,
    };
    setAiSettingsState(hydrateAiSettings(safeSettings));
    // Only the non-secret parts are persisted; credentials live in the app
    // database and are resolved server-side.
    const { apiKey: _apiKey, ...persistable } = safeSettings;
    void appStore.setSetting("ai_settings", persistable).catch(() => {});
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
          setAiSettingsState((prev) =>
            hydrateAiSettings({
              ...prev,
              provider: savedAi.provider,
              model: savedAi.model || prev.model,
              apiKey: "",
              baseUrl: savedAi.baseUrl || "",
              fontSize: savedAi.fontSize ?? prev.fontSize,
              lineHeight: savedAi.lineHeight ?? prev.lineHeight,
              enableLigatures: savedAi.enableLigatures ?? prev.enableLigatures,
              tabSize: savedAi.tabSize ?? prev.tabSize,
              insertSpaces: savedAi.insertSpaces ?? prev.insertSpaces,
              wordWrap: savedAi.wordWrap ?? prev.wordWrap,
              terminalFontSize: savedAi.terminalFontSize ?? prev.terminalFontSize,
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
    // The active project is resolved from the app database during hydration
    // (see the bootstrap effect). Until that completes we start on the bundled
    // workbench itself rather than on whatever happens to be left in this
    // browser's localStorage — that pointer used to resurrect an unrelated
    // project on a machine that had ever opened one.
    return { name: "acsa-code", path: "." };
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
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [orchestrationResult, setOrchestrationResult] = useState<OrchestrationResult | null>(null);
  const [activityLog, setActivityLog] = useState<PipelineOutputLine[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [currentDiff, setCurrentDiff] = useState<string>("");
  const [touchedPaths, setTouchedPaths] = useState<string[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState<string>("");
  const [streamingThought, setStreamingThought] = useState<string>("");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [pendingPermission, setPendingPermission] = useState<{
    id: string;
    command: string;
    description: string;
  } | null>(null);

  const respondToPermission = useCallback(async (id: string, decision: "approved" | "rejected") => {
    try {
      await fetch("/api/pipeline/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
    } catch (e) {
      console.error("Failed to respond to permission:", e);
    } finally {
      setPendingPermission(null);
    }
  }, []);

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
  const refreshProjectFiles = useCallback(async () => {
    if (isTauriAvailable) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const nodes = await invoke<FileNode[]>("list_project_files", {
          projectPath: activeProject.path,
        });
        setProjectFiles(nodes);
      } catch (err) {
        console.warn("Tauri list_project_files failed:", err);
      }
    } else {
      try {
        const res = await fetch("/api/fs/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath: activeProject.path }),
        });
        if (res.ok) {
          const data = await res.json();
          setProjectFiles(data.nodes || []);
          if (data.resolvedPath && (activeProject.path === "." || activeProject.path === "./")) {
            const folderName = data.resolvedPath.split("/").filter(Boolean).pop() || activeProject.name;
            setActiveProject({
              name: folderName,
              path: data.resolvedPath,
            });
          }
        }
      } catch (err) {
        console.warn("Vite FS list failed:", err);
      }
    }
  }, [isTauriAvailable, activeProject.path]);

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
      try {
        const res = await fetch("/api/fs/pick-folder", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          return data.path || null;
        }
      } catch (err) {
        console.error("Vite pick-folder failed:", err);
      }
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
        try {
          const res = await fetch("/api/fs/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath: file.path, projectRoot: activeProject.path }),
          });
          if (res.ok) {
            const data = await res.json();
            content = data.content;
          } else {
            content = `# Error reading file from disk`;
          }
        } catch (err) {
          content = `# Failed to read file: ${err}`;
        }
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
        try {
          const res = await fetch("/api/fs/write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath: path, content: tab.content, projectRoot: activeProject.path }),
          });
          if (!res.ok) {
            alert("Failed to write file to disk");
            return;
          }
        } catch (err) {
          alert(`Failed to write file: ${err}`);
          return;
        }
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
          await refreshProjectFiles();
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
        try {
          const res = await fetch("/api/fs/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemPath: targetPath, isDir, projectRoot: activeProject.path }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(`Failed to create: ${data?.error || res.statusText}`);
            return;
          }
          await refreshProjectFiles();
          if (!isDir) {
            openFile({
              name: cleanName.split("/").pop() || cleanName,
              path: data.path || targetPath,
              is_dir: false,
              size_bytes: 0,
            });
          }
        } catch (err) {
          alert(`Failed to create: ${err}`);
        }
      }
    },
    [isTauriAvailable, activeProject.path, refreshProjectFiles, openFile]
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
          await refreshProjectFiles();
        } catch (err) {
          console.error("Delete failed:", err);
        }
      } else {
        try {
          await fetch("/api/fs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetPath: path, projectRoot: activeProject.path }),
          });
          closeTab(path);
          await refreshProjectFiles();
        } catch (err) {
          console.error("Delete failed:", err);
        }
      }
    },
    [isTauriAvailable, activeProject.path, closeTab, refreshProjectFiles]
  );

  const createProject = useCallback(
    async (name: string, template: string, parentDir?: string) => {
      if (isTauriAvailable) {
        try {
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
        } catch (err) {
          alert(`Scaffold failed: ${err}`);
        }
      } else {
        try {
          const res = await fetch("/api/fs/create-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, template, parentDir }),
          });
          if (res.ok) {
            const data = await res.json();
            setActiveProject({ name: data.name, path: data.projectPath });
            setOpenTabs([]);
            setActiveTabPath(null);
            setCurrentDiff("");
          }
        } catch (err) {
          alert(`Scaffold failed: ${err}`);
        }
      }
    },
    [isTauriAvailable, refreshProjectFiles]
  );

  // ── Poll System Metrics via Central Service ──────────────────────────────
  useEffect(() => {
    return systemMetricsService.subscribe((metrics) => {
      setSystemMetrics(metrics);
    });
  }, []);

  // ── Run Pipeline (100% Real Subprocess Execution) ─────────────────────────
  const pipelineAbortRef = useRef<AbortController | null>(null);

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
      const activeAiSettings = modelOverride
        ? {
            ...aiSettings,
            provider: modelOverride.provider,
            model: modelOverride.model,
            apiKey: modelOverride.apiKey !== undefined ? modelOverride.apiKey : aiSettings.apiKey,
            baseUrl: modelOverride.baseUrl !== undefined ? modelOverride.baseUrl : aiSettings.baseUrl,
          }
        : aiSettings;
      if (!activePrompt.trim()) return;

      let detectedLanguage = "typescript";
      if (activeFilePath) {
        const ext = activeFilePath.split(".").pop()?.toLowerCase();
        if (ext === "py") detectedLanguage = "python";
        else if (ext === "rs") detectedLanguage = "rust";
        else if (ext === "go") detectedLanguage = "go";
        else if (ext === "c" || ext === "cpp" || ext === "h") detectedLanguage = "cpp";
        else if (ext === "java") detectedLanguage = "java";
      }

      setStatus("running");
      setActivityLog([]);
      setCurrentDiff("");
      setOrchestrationResult(null);
      setTelemetry(null);
      setStreamingAnswer("");
      setStreamingThought("");
      setAgentSteps([]);
      setPendingPermission(null);

      if (isTauriAvailable) {
        // The engine streams progress on stdout (`@@STEP@@`, `@@THOUGHT@@`,
        // `@@CHUNK@@`) and Rust forwards every line as `pipeline:output` — but nothing
        // consumed it, so the packaged app had no live data and filled the gap with
        // invented spinners, while the dev SSE branch below showed real steps.
        const { listen } = await import("@tauri-apps/api/event");
        const offOutput = await listen<{ content?: string } | string>("pipeline:output", (event) => {
          // Rust emits a `PipelineOutputLine` struct ({line_number, content, stream,
          // is_json}), not a raw line — reading the payload as a string yielded
          // "[object Object]" and the markers never matched, so nothing reached the UI.
          const payload = event.payload;
          const line = typeof payload === "string" ? payload : String(payload?.content ?? "");
          const match = line.match(/^@@(STEP|THOUGHT|CHUNK|PERMISSION)@@([\s\S]*)$/);
          if (!match) return;
          let value: any;
          try {
            value = JSON.parse(match[2]);
          } catch {
            value = match[2];
          }
          if (match[1] === "CHUNK") setStreamingAnswer((prev) => prev + String(value));
          else if (match[1] === "THOUGHT") setStreamingThought((prev) => prev + String(value));
          else if (match[1] === "PERMISSION") setPendingPermission(value);
          else if (match[1] === "STEP" && value && typeof value === "object") {
            setAgentSteps((prev) => {
              const idx = prev.findIndex((s) => s.name === value.name);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...value };
                return next;
              }
              return [...prev, { id: `step-${Date.now()}-${prev.length}`, ...value }];
            });
          }
        });
        // Agent mode runs on Codex when its runtime is present; otherwise our own
        // pipeline runs, so the feature degrades instead of breaking.
        const codexStatus = await runAgentOnCodex({
          prompt: activePrompt,
          projectRoot: activeProject.path,
          onEvent: (event) =>
            applyCodexEvent(event, {
              setSteps: setAgentSteps,
              appendAnswer: (text) => setStreamingAnswer((prev) => prev + text),
              logOutput: (line) => setActivityLog((prev) => [...prev, line]),
            }),
          // Diagnostics go to the OUTPUT panel: this is read by a human when the chat
          // shows nothing, so it says which branch ran and what actually arrived.
          log: (line) =>
            setActivityLog((prev) => [
              ...prev,
              { line_number: prev.length + 1, content: line, stream: "stdout", is_json: false },
            ]),
        });

        // The chat derives its state from `status`, and a Codex run leaves it on
        // "running" unless something clears it — which is why the panel sat on
        // "Working (195s)" after a perfectly good edit.
        if (codexStatus !== "unavailable") setStatus(codexStatus);

        try {
          if (codexStatus === "unavailable") {
          const { invoke } = await import("@tauri-apps/api/core");
          const result: any = await invoke("run_generation_pipeline", {
            prompt: activePrompt,
            sliders,
            projectRoot: activeProject.path,
            language: detectedLanguage,
            skipPerformance: false,
            dryRun: false,
          });

          if (result && result.parsed_result) {
            setOrchestrationResult(result.parsed_result);
            setStatus(result.parsed_result.outcome === "success" ? "success" : "failed");
          }
          }
          await refreshProjectFiles();
        } catch (err: any) {
          setStatus("error");
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content: `Error: ${err?.message || err}`,
              stream: "stderr",
              is_json: false,
            },
          ]);
        } finally {
          offOutput();
        }
      } else {
        // Real Server-Sent Events from local Vite dev backend process
        try {
          const controller = new AbortController();
          pipelineAbortRef.current = controller;
          const response = await fetch("/api/pipeline/run", {
            signal: controller.signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: activePrompt,
              projectRoot: activeProject.path,
              language: detectedLanguage,
              provider: activeAiSettings.provider,
              model: activeAiSettings.model,
              apiKey: activeAiSettings.apiKey,
              baseUrl: activeAiSettings.baseUrl,
              activeFilePath: activeFilePath || undefined,
              selectedCode: selectedCode || undefined,
              conversationHistory: conversationHistory || undefined,
              images: images && images.length > 0 ? images : undefined,
            }),
          });

          if (!response.body) {
            throw new Error("No response body from pipeline process");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() || "";

            for (const ev of events) {
              const lines = ev.split("\n");
              let eventName = "";
              let dataStr = "";

              for (const l of lines) {
                if (l.startsWith("event: ")) eventName = l.slice(7).trim();
                if (l.startsWith("data: ")) dataStr = l.slice(6).trim();
              }

              if (!dataStr) continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (eventName === "chunk") {
                  if (parsed?.text) {
                    setStreamingAnswer((prev) => prev + parsed.text);
                  }
                } else if (eventName === "thought") {
                  if (parsed?.text) {
                    setStreamingThought((prev) => prev + parsed.text);
                  }
                } else if (eventName === "step") {
                  setAgentSteps((prev) => {
                    const idx = prev.findIndex((s) => s.name === parsed.name);
                    if (idx >= 0) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...parsed };
                      return next;
                    }
                    return [...prev, { id: `step-${Date.now()}-${prev.length}`, ...parsed }];
                  });
                } else if (eventName === "permission_request") {
                  setPendingPermission(parsed);
                } else if (eventName === "output") {
                  setActivityLog((prev) => [...prev, parsed]);

                  if (parsed.content.startsWith("---") || parsed.content.startsWith("@@")) {
                    setCurrentDiff((prev) => prev + parsed.content + "\n");
                    setActiveCenterView("diff");
                  }
                  if (parsed.content.startsWith("Written:")) {
                    const writtenPath = parsed.content.slice("Written:".length).trim();
                    if (writtenPath) setTouchedPaths((prev) => prev.includes(writtenPath) ? prev : [...prev, writtenPath]);
                  }
                } else if (eventName === "complete") {
                  setPendingPermission(null);
                  setStatus(parsed.success ? "success" : "failed");
                  if (parsed.parsed_result) {
                    setOrchestrationResult(parsed.parsed_result);
                  }
                  await refreshProjectFiles();
                }
              } catch {}
            }
          }
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          setStatus("error");
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content: `Subprocess error: ${err?.message || err}`,
              stream: "stderr",
              is_json: false,
            },
          ]);
        }
      }
      pipelineAbortRef.current = null;
    },
    [prompt, activeProject.path, aiSettings, sliders, isTauriAvailable, refreshProjectFiles]
  );

  const cancelPipeline = useCallback(async () => {
    pipelineAbortRef.current?.abort();
    pipelineAbortRef.current = null;
    if (isTauriAvailable) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("cancel_generation_pipeline");
      } catch {}
    }
    setPendingPermission(null);
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
    isIndexing,
    syncIndex,
    prompt,
    setPrompt,
    sliders,
    setSliders,
    status,
    telemetry,
    orchestrationResult,
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
    pendingPermission,
    respondToPermission,
  };
}

export default usePipeline;
