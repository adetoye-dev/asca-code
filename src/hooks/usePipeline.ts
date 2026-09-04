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
import type { SliderConfig } from "../components/TradeOffSliders";
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

export interface ProjectMeta {
  name: string;
  path: string;
}

export interface UsePipelineReturn {
  // Project & Files
  activeProject: ProjectMeta;
  projectFiles: FileNode[];
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

  // Pipeline State & Execution
  prompt: string;
  setPrompt: (p: string) => void;
  sliders: SliderConfig;
  setSliders: (s: SliderConfig) => void;
  status: PipelineStatus;
  telemetry: TelemetryData | null;
  orchestrationResult: OrchestrationResult | null;
  activityLog: PipelineOutputLine[];
  systemMetrics: SystemMetrics | null;
  activeCenterView: "editor" | "diff";
  setActiveCenterView: (v: "editor" | "diff") => void;

  // Pipeline Actions
  runPipeline: (customPrompt?: string) => Promise<void>;
  cancelPipeline: () => void;
  clearLog: () => void;
  isTauriAvailable: boolean;
}

const DEFAULT_SLIDERS: SliderConfig = {
  budget_vs_scale: "medium",
  speed_vs_precision: "medium",
  simplicity_vs_futureproof: "medium",
};

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "deterministic",
  model: "",
  apiKey: "",
  baseUrl: "",
};

export function usePipeline(): UsePipelineReturn {
  const isTauriAvailable = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // AI settings
  const [aiSettings, setAiSettingsState] = useState<AISettings>(() => {
    try {
      const saved =
        localStorage.getItem("aide_ai_settings") ||
        localStorage.getItem("ide_ai_settings");
      if (!saved) return DEFAULT_AI_SETTINGS;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        return {
          provider: parsed.provider || DEFAULT_AI_SETTINGS.provider,
          model: parsed.model || DEFAULT_AI_SETTINGS.model,
          apiKey: parsed.apiKey || DEFAULT_AI_SETTINGS.apiKey,
          baseUrl: parsed.baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
        };
      }
      return DEFAULT_AI_SETTINGS;
    } catch {
      return DEFAULT_AI_SETTINGS;
    }
  });

  const setAiSettings = (newSettings: AISettings) => {
    const safeSettings: AISettings = {
      provider: newSettings?.provider || DEFAULT_AI_SETTINGS.provider,
      model: newSettings?.model || "",
      apiKey: newSettings?.apiKey || "",
      baseUrl: newSettings?.baseUrl || "",
    };
    setAiSettingsState(safeSettings);
    try {
      const { provider, model, baseUrl } = safeSettings;
      localStorage.setItem("aide_ai_settings", JSON.stringify({ provider, model, baseUrl }));
    } catch {}
  };

  // Active project state
  const [activeProject, setActiveProjectState] = useState<ProjectMeta>(() => {
    try {
      const saved = localStorage.getItem("aide_active_project");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.path && parsed.path !== "." && parsed.path !== "./") {
          return parsed;
        }
      }
      return { name: "acsa-code", path: "." };
    } catch {
      return { name: "acsa-code", path: "." };
    }
  });

  const setActiveProject = (proj: ProjectMeta) => {
    setActiveProjectState(proj);
    try {
      localStorage.setItem("aide_active_project", JSON.stringify(proj));
    } catch {}
  };

  const [projectFiles, setProjectFiles] = useState<FileNode[]>([]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Editor tabs state
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [activeCenterView, setActiveCenterView] = useState<"editor" | "diff">("editor");

  // Pipeline & AI state
  const [prompt, setPrompt] = useState<string>("");
  const [sliders, setSliders] = useState<SliderConfig>(DEFAULT_SLIDERS);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [orchestrationResult, setOrchestrationResult] = useState<OrchestrationResult | null>(null);
  const [activityLog, setActivityLog] = useState<PipelineOutputLine[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [currentDiff, setCurrentDiff] = useState<string>("");
  const [touchedPaths, setTouchedPaths] = useState<string[]>([]);

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
    },
    []
  );

  // ── File Operations ───────────────────────────────────────────────────────
  const openFile = useCallback(
    async (file: FileNode) => {
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

  // ── Poll System Metrics ───────────────────────────────────────────────────
  useEffect(() => {
    let timer: any = null;

    const poll = async () => {
      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const metrics = await invoke<SystemMetrics>("fetch_system_metrics");
          setSystemMetrics(metrics);
        } catch {}
      } else {
        try {
          const res = await fetch("/api/system/metrics");
          if (res.ok) {
            const metrics = await res.json();
            setSystemMetrics(metrics);
          }
        } catch {}
      }
    };

    poll();
    timer = setInterval(poll, 3000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isTauriAvailable]);

  // ── Run Pipeline (100% Real Subprocess Execution) ─────────────────────────
  const pipelineAbortRef = useRef<AbortController | null>(null);

  const runPipeline = useCallback(
    async (customPrompt?: string) => {
      const activePrompt = customPrompt ?? prompt;
      if (!activePrompt.trim()) return;

      setStatus("running");
      setActivityLog([]);
      setCurrentDiff("");
      setOrchestrationResult(null);
      setTelemetry(null);

      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const result: any = await invoke("run_generation_pipeline", {
            prompt: activePrompt,
            sliders,
            projectRoot: activeProject.path,
            language: "python",
            skipPerformance: false,
            dryRun: false,
          });

          if (result && result.parsed_result) {
            setOrchestrationResult(result.parsed_result);
            setStatus(result.parsed_result.outcome === "success" ? "success" : "failed");
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
              sliders,
              projectRoot: activeProject.path,
              language: "python",
              provider: aiSettings.provider,
              model: aiSettings.model,
              apiKey: aiSettings.apiKey,
              baseUrl: aiSettings.baseUrl,
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
                if (eventName === "output") {
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
    [prompt, sliders, activeProject.path, aiSettings, isTauriAvailable, refreshProjectFiles]
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
    setStatus("idle");
  }, [isTauriAvailable]);

  const clearLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  return {
    activeProject,
    projectFiles,
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
  };
}

export default usePipeline;
