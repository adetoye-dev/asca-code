/**
 * IdeLayout.tsx — Production VS Code Workbench Layout for Autonomous IDE
 *
 * Full developer-grade layout integrating:
 * 1. Titlebar: Project picker, Quick Open file search bar, Layout toggles (Sidebar/Panel), Theme picker, Telemetry.
 * 2. Activity Bar: Explorer, Monitoring, Model Manager, Autonomous Agent Dock, Extensions & Themes.
 * 3. Primary Sidebar: Mounts the active activity bar view (toggleable via Cmd+B).
 * 4. Main Stage (Dockview): Multi-tab Monaco editor with split panes & Diff inspector.
 * 5. Dedicated Bottom Panel: Tabbed dock housing Interactive Shell (Xterm.js), Gauntlet Output, and Problems (toggleable via Cmd+J / Ctrl+`).
 * 6. Status Bar: Branch name, encoding, language, theme, and gate status.
 * 7. Command Palette & Quick Open: Triggered by Cmd+Shift+P and Cmd+P.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps,
} from "dockview-react";
import "dockview/dist/styles/dockview.css";

import {
  FolderCode,
  FolderOpen,
  FolderPlus,
  Activity,
  Cpu,
  Sparkles,
  Settings,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  Boxes,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Search,
  Save,
  Terminal,
  Palette,
} from "lucide-react";
import { IdeBrandLogo, ProviderLogo } from "../ui/BrandLogos";

import { MonacoEditorContainer } from "../editor/MonacoEditorContainer";
import { MonacoDiffContainer } from "../editor/MonacoDiffContainer";
import { BottomPanel } from "../panels/BottomPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ExplorerSidebar } from "../sidebar/ExplorerSidebar";
import { SearchSidebar } from "../sidebar/SearchSidebar";
import { SourceControlSidebar } from "../sidebar/SourceControlSidebar";
import { ExtensionsSidebar } from "../sidebar/ExtensionsSidebar";
import { VersionControlDropdown } from "./VersionControlDropdown";
import { CloneModal } from "../modals/CloneModal";
import { ProjectModal } from "../ProjectModal";
import { SettingsModal } from "../SettingsModal";
import { ErrorBoundary } from "../ErrorBoundary";
import { CommandPalette, CommandItem } from "../modals/CommandPalette";
import { PerformanceDashboard } from "../dashboards/PerformanceDashboard";
import { AiManagementDashboard } from "../dashboards/AiManagementDashboard";
import { AiAssistantChat } from "../dashboards/AiAssistantChat";
import { getDefaultProvider } from "../../services/aiModelManager";
import { PRESET_THEMES, applyGlobalWorkbenchTheme } from "../../services/themeManager";
import type { UsePipelineReturn } from "../../hooks/usePipeline";

type SidebarTab = "explorer" | "search" | "sourceControl" | "extensions";

export function IdeLayout(pipeline: UsePipelineReturn) {
  const {
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
    status,
    orchestrationResult,
    activityLog,
    systemMetrics,
    runPipeline,
    cancelPipeline,
    clearLog,
    isTauriAvailable,
  } = pipeline;

  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("explorer");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [activeDockPanelId, setActiveDockPanelId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [gitBranch, setGitBranch] = useState("main");
  const [paletteMode, setPaletteMode] = useState<"command" | "file">("command");
  const [themeId, setThemeId] = useState<string>("vs-dark");
  const [settingsModalTab, setSettingsModalTab] = useState<string>("agents");
  const [searchInitialReplace, setSearchInitialReplace] = useState(false);
  const [targetEditorLine, setTargetEditorLine] = useState<{
    path: string;
    line: number;
    column?: number;
    ts: number;
  } | null>(null);
  const dockviewApiRef = useRef<DockviewApi | null>(null);

  const handleOpenFileAtLocation = useCallback(
    async (filePath: string, lineNumber?: number, column?: number) => {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      await openFile({
        name: fileName,
        path: filePath,
        is_dir: false,
        size_bytes: 0,
      });
      if (lineNumber && lineNumber > 0) {
        setTargetEditorLine({
          path: filePath,
          line: lineNumber,
          column,
          ts: Date.now(),
        });
      }
    },
    [openFile]
  );

  const openThemeEditor = useCallback(() => {
    setSettingsModalTab("appearance");
    setIsSettingsModalOpen(true);
  }, [setIsSettingsModalOpen]);

  const openSettings = useCallback(() => {
    setSettingsModalTab("agents");
    setIsSettingsModalOpen(true);
  }, [setIsSettingsModalOpen]);

  // Apply theme to entire workbench DOM
  useEffect(() => {
    applyGlobalWorkbenchTheme(themeId);
  }, [themeId]);

  const refreshBranch = useCallback(async () => {
    try {
      const res = await fetch("/api/git/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: activeProject.path }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.branch) {
          setGitBranch(data.branch);
        }
      }
    } catch {}
  }, [activeProject.path]);

  useEffect(() => {
    refreshBranch();
  }, [refreshBranch]);

  const handleOpenFolder = async () => {
    const picked = await pickFolder();
    if (picked) {
      await openFolder(picked);
    }
  };

  const handleOpenGitDiff = (filePath: string, originalContent: string, modifiedContent: string, isStaged?: boolean) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panelId = isStaged ? `diff_staged_${filePath}` : `diff_${filePath}`;
    const existing = api.getPanel(panelId);
    if (!existing) {
      api.addPanel({
        id: panelId,
        component: "diff",
        title: `${isStaged ? "Diff (Staged)" : "Diff"}: ${filePath.split("/").pop() || filePath}`,
        params: { filePath, originalContent, modifiedContent, isGit: true },
      });
    } else {
      existing.api.setActive();
    }
  };

  const openMonitorTab = () => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const existing = api.getPanel("dock_monitor");
    if (!existing) {
      api.addPanel({
        id: "dock_monitor",
        component: "monitor",
        title: "Host Health & Performance",
      });
    } else {
      existing.api.setActive();
    }
  };

  const openAiManagerTab = () => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const existing = api.getPanel("dock_ai_manager");
    if (!existing) {
      api.addPanel({
        id: "dock_ai_manager",
        component: "aiManager",
        title: "AI Models & Providers",
      });
    } else {
      existing.api.setActive();
    }
  };

  const openAiChatTab = () => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const existing = api.getPanel("dock_ai_chat");
    if (!existing) {
      api.addPanel({
        id: "dock_ai_chat",
        component: "aiChat",
        title: "AI Assistant",
      });
    } else {
      existing.api.setActive();
    }
  };

  // ── Global Keyboard Shortcuts Engine ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Cmd+Shift+P: Command Palette
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteMode("command");
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Cmd+Shift+F: Find in Files (Search Sidebar)
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchInitialReplace(false);
        setActiveSidebarTab("search");
        setIsSidebarOpen(true);
        return;
      }

      // Cmd+Shift+H: Replace in Files (Search Sidebar with Replace expanded)
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setSearchInitialReplace(true);
        setActiveSidebarTab("search");
        setIsSidebarOpen(true);
        return;
      }

      // Cmd+Shift+G: Source Control
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setActiveSidebarTab("sourceControl");
        setIsSidebarOpen(true);
        return;
      }

      // Cmd+P: Quick Open File
      if (isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteMode("file");
        setIsCommandPaletteOpen(true);
        return;
      }

      // Cmd+B: Toggle Primary Sidebar
      if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      // Cmd+J or Ctrl+`: Toggle Bottom Panel
      if ((isCmdOrCtrl && e.key.toLowerCase() === "j") || (e.ctrlKey && e.key === "`")) {
        e.preventDefault();
        setIsBottomPanelOpen((prev) => !prev);
        return;
      }

      // Cmd+L: Toggle Right AI Assistant Tool Window
      if (isCmdOrCtrl && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setIsRightPanelOpen((prev) => !prev);
        return;
      }

      // Cmd+S: Save active file
      if (isCmdOrCtrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTabPath) {
          saveFile(activeTabPath);
        }
        return;
      }

      // Cmd+,: Open Settings & Appearance
      if (isCmdOrCtrl && e.key === ",") {
        e.preventDefault();
        setIsSettingsModalOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabPath, saveFile]);

  // ── Commands Dictionary for Command Palette ───────────────────────────────
  const commands: CommandItem[] = [
    {
      id: "view.toggleSidebar",
      title: "Toggle Primary Side Bar",
      category: "View",
      shortcut: "⌘B",
      icon: PanelLeft,
      action: () => setIsSidebarOpen((prev) => !prev),
    },
    {
      id: "view.togglePanel",
      title: "Toggle Bottom Panel (Terminal / Output)",
      category: "View",
      shortcut: "⌘J",
      icon: PanelBottom,
      action: () => setIsBottomPanelOpen((prev) => !prev),
    },
    {
      id: "view.toggleRightSideBar",
      title: "Toggle Secondary Side Bar (Right Tool Window)",
      category: "View",
      icon: PanelRight,
      action: () => setIsRightPanelOpen((prev) => !prev),
    },
    {
      id: "ai.toggleChat",
      title: "AI Assistant: Toggle AI Chat Tool Window",
      category: "AI",
      shortcut: "⌘L",
      icon: Sparkles,
      action: () => setIsRightPanelOpen((prev) => !prev),
    },
    {
      id: "preferences.settings",
      title: "Preferences: Open Settings",
      category: "Preferences",
      shortcut: "⌘,",
      icon: Settings,
      action: openSettings,
    },
    {
      id: "preferences.theme",
      title: "Preferences: Color Theme (Theme Editor)",
      category: "Preferences",
      shortcut: "⌘K ⌘T",
      icon: Palette,
      action: openThemeEditor,
    },
    {
      id: "file.save",
      title: "Save Document",
      category: "File",
      shortcut: "⌘S",
      icon: Save,
      action: () => {
        if (activeTabPath) saveFile(activeTabPath);
      },
    },
    {
      id: "file.openFolder",
      title: "Open Folder...",
      category: "File",
      icon: FolderOpen,
      action: handleOpenFolder,
    },
    {
      id: "file.newProject",
      title: "New Project Scaffold...",
      category: "File",
      icon: FolderPlus,
      action: () => setIsProjectModalOpen(true),
    },
    {
      id: "theme.dracula",
      title: "Color Theme: Dracula Official",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("dracula"),
    },
    {
      id: "theme.oneDark",
      title: "Color Theme: One Dark Pro",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("one-dark"),
    },
    {
      id: "theme.githubDark",
      title: "Color Theme: GitHub Dark Default",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("github-dark"),
    },
    {
      id: "theme.catppuccin",
      title: "Color Theme: Catppuccin Mocha",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("catppuccin"),
    },
    {
      id: "theme.vsDark",
      title: "Color Theme: Dark+ (default dark)",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("vs-dark"),
    },
    {
      id: "agent.run",
      title: "Autonomous Agent: Execute & Verify Task",
      category: "Agent",
      icon: Sparkles,
      action: () => runPipeline(),
    },
    {
      id: "view.explorer",
      title: "Show Explorer",
      category: "View",
      icon: FolderCode,
      action: () => {
        setActiveSidebarTab("explorer");
        setIsSidebarOpen(true);
      },
    },
    {
      id: "view.search",
      title: "Find in Files (Workspace Search)",
      category: "Search",
      shortcut: "⇧⌘F",
      icon: Search,
      action: () => {
        setSearchInitialReplace(false);
        setActiveSidebarTab("search");
        setIsSidebarOpen(true);
      },
    },
    {
      id: "view.replace",
      title: "Replace in Files (Workspace Replace)",
      category: "Search",
      shortcut: "⇧⌘H",
      icon: Search,
      action: () => {
        setSearchInitialReplace(true);
        setActiveSidebarTab("search");
        setIsSidebarOpen(true);
      },
    },
    {
      id: "view.sourceControl",
      title: "Show Source Control (Git)",
      category: "View",
      shortcut: "⌃⇧G",
      icon: GitPullRequest,
      action: () => {
        setActiveSidebarTab("sourceControl");
        setIsSidebarOpen(true);
      },
    },
    {
      id: "git.clone",
      title: "Git: Clone Repository...",
      category: "Git",
      icon: GitBranch,
      action: () => setIsCloneModalOpen(true),
    },
    {
      id: "view.openMonitor",
      title: "Host Health: Open Performance & Maintenance Dashboard",
      category: "View",
      icon: Activity,
      action: openMonitorTab,
    },
    {
      id: "view.openAiManager",
      title: "AI: Open Model Management & Providers Dashboard",
      category: "AI",
      icon: Cpu,
      action: openAiManagerTab,
    },
    {
      id: "view.openAiChat",
      title: "AI: Open AI Assistant Chat",
      category: "AI",
      icon: Sparkles,
      action: openAiChatTab,
    },
    {
      id: "view.extensions",
      title: "Show Extensions & Open VSX Marketplace",
      category: "View",
      icon: Boxes,
      action: () => {
        setActiveSidebarTab("extensions");
        setIsSidebarOpen(true);
      },
    },
  ];

  // ── Dockview Components Dictionary ────────────────────────────────────────
  const components = {
    // Monaco Code Editor Tab
    editor: (props: IDockviewPanelProps<{ filePath: string }>) => {
      const tab = openTabs.find((t) => t.path === props.params.filePath);
      if (!tab) {
        return (
          <div className="h-full w-full flex items-center justify-center text-zinc-500 text-xs bg-[var(--vscode-editor-bg)]">
            File closed
          </div>
        );
      }
      return (
        <MonacoEditorContainer
          path={tab.path}
          content={tab.content}
          onChange={(newVal) => updateTabContent(tab.path, newVal)}
          onSave={saveFile}
          aiSettings={aiSettings}
          themeId={themeId}
          targetLine={targetEditorLine?.path === tab.path ? targetEditorLine.line : undefined}
          targetColumn={targetEditorLine?.path === tab.path ? targetEditorLine.column : undefined}
          revealTrigger={targetEditorLine?.path === tab.path ? targetEditorLine.ts : undefined}
        />
      );
    },

    // Monaco Diff Viewer Tab
    diff: (props: IDockviewPanelProps<{ filePath?: string; originalContent?: string; modifiedContent?: string; isGit?: boolean }>) => {
      const isGit = props.params?.isGit;
      const original = isGit ? (props.params?.originalContent ?? "") : "";
      const modified = isGit ? (props.params?.modifiedContent ?? "") : currentDiff;
      const path = isGit ? (props.params?.filePath ?? "git.diff") : "patch.diff";

      return (
        <MonacoDiffContainer
          originalContent={original}
          modifiedContent={modified}
          filePath={path}
          onAccept={async () => {
            if (path && path !== "patch.diff" && path !== "git.diff") {
              try {
                if (isTauriAvailable) {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("write_file_content", {
                    filePath: path,
                    content: modified,
                    projectRoot: activeProject.path,
                  });
                } else {
                  await fetch("/api/fs/write", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      filePath: path,
                      content: modified,
                      projectRoot: activeProject.path,
                    }),
                  });
                }
                applyPatchToTab(path, modified);
              } catch (err) {
                console.error("Failed to write accepted patch to disk:", err);
              }
            }
            props.api.close();
            setCurrentDiff("");
            refreshProjectFiles();
            refreshBranch();
          }}
          onReject={() => {
            props.api.close();
            setCurrentDiff("");
          }}
        />
      );
    },

    // Wide Performance & Host Health Dashboard
    monitor: () => (
      <PerformanceDashboard
        systemMetrics={systemMetrics}
        onRefreshMetrics={refreshBranch}
      />
    ),

    // Multi-Model AI Management Dashboard
    aiManager: () => (
      <AiManagementDashboard
        onModelSettingsChanged={() => {
          const def = getDefaultProvider();
          setAiSettings({
            ...aiSettings,
            provider: def.id as any,
            model: def.selectedModel,
            apiKey: def.apiKey,
            baseUrl: def.baseUrl,
          });
        }}
      />
    ),

    // IntelliJ-Inspired AI Assistant Chat Tab
    aiChat: () => (
      <AiAssistantChat
        prompt={prompt}
        setPrompt={setPrompt}
        status={status}
        activityLog={activityLog}
        onRunPipeline={(override) => {
          if (override) {
            setAiSettings({
              ...aiSettings,
              provider: override.provider as any,
              model: override.model,
            });
          }
          runPipeline();
        }}
        onCancelPipeline={cancelPipeline}
      />
    ),
  };

  // ── Initialize Default Dockview Layout ────────────────────────────────────
  const onReady = useCallback((event: DockviewReadyEvent) => {
    dockviewApiRef.current = event.api;

    // Add initial editor panel if tabs exist
    if (openTabs.length > 0) {
      const first = openTabs[0];
      event.api.addPanel({
        id: first.path,
        component: "editor",
        title: first.name,
        params: { filePath: first.path },
      });
    }

    const specialPanels = ["dock_diff", "diff_", "dock_monitor", "dock_ai_manager", "dock_ai_chat"];

    // Listen to panel active and close events
    event.api.onDidActivePanelChange((e) => {
      const panelId = e.panel?.id;
      setActiveDockPanelId(panelId || null);
      if (panelId && !specialPanels.some((p) => panelId.startsWith(p))) {
        selectTab(panelId);
      }
    });

    event.api.onDidRemovePanel((panel) => {
      if (panel && panel.id && !specialPanels.some((p) => panel.id.startsWith(p))) {
        closeTab(panel.id);
      }
      setActiveDockPanelId((prev) => (prev === panel?.id ? null : prev));
    });
  }, [openTabs, selectTab, closeTab, refreshBranch, refreshProjectFiles]);

  // Synchronize open tabs with Dockview panels
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    // Close any editor panel whose tab is no longer in openTabs
    const editorPanels = api.panels.filter((p) => (p as any).component === "editor");
    for (const panel of editorPanels) {
      if (!openTabs.some((t) => t.path === panel.id)) {
        panel.api.close();
      }
    }

    // Add panels for newly opened tabs
    for (const tab of openTabs) {
      const existing = api.getPanel(tab.path);
      if (!existing) {
        api.addPanel({
          id: tab.path,
          component: "editor",
          title: tab.name,
          params: { filePath: tab.path },
        });
      }
    }

    if (activeTabPath) {
      const panel = api.getPanel(activeTabPath);
      if (panel) {
        panel.api.setActive();
      }
    }
  }, [openTabs, activeTabPath]);

  // Isolate project state: close all previous project tabs & diffs when switching project
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    for (const panel of api.panels) {
      if (
        panel.id.startsWith("diff_") ||
        panel.id === "dock_diff" ||
        (panel as any).component === "editor" ||
        (panel as any).component === "diff"
      ) {
        panel.api.close();
      }
    }
    setCurrentDiff("");
  }, [activeProject.path, setCurrentDiff]);

  // Open Diff tab when agent generates a diff
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api || !currentDiff) return;

    const diffPanel = api.getPanel("dock_diff");
    if (!diffPanel) {
      api.addPanel({
        id: "dock_diff",
        component: "diff",
        title: "Micro-Diff Inspector",
      });
    } else {
      diffPanel.api.setActive();
    }
  }, [currentDiff]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--vscode-sidebar-bg)] text-[var(--vscode-editor-fg)] select-none">
      {/* ── Top IDE Titlebar (Clean, Uncluttered, JetBrains / VS Code Modern UI) ── */}
      <header className="flex items-center justify-between px-3 h-10 border-b border-[var(--vscode-border)] bg-[var(--vscode-titlebar-bg)] shrink-0 text-xs font-sans">
        {/* Left: Sleek Brand & Project Selector */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 pr-1">
            <IdeBrandLogo className="w-5 h-5 shrink-0" />
            <span className="font-semibold tracking-tight text-zinc-100 text-[13px] flex items-center gap-1 font-sans">
              Autonomous <span className="text-sky-400 font-mono text-[11px] font-normal">&lt;IDE/&gt;</span>
            </span>
          </div>

          <div className="w-px h-4 bg-zinc-700/50" />

          {/* Modern IDE Project Switcher Pill & Dropdown */}
          <ProjectSwitcher
            activeProject={activeProject}
            onOpenFolder={handleOpenFolder}
            onNewProject={() => setIsProjectModalOpen(true)}
            onCloneRepo={() => setIsCloneModalOpen(true)}
            onSelectRecentProject={openFolder}
          />

          {/* Real Git Version Control Dropdown */}
          <VersionControlDropdown
            projectCwd={activeProject.path}
            onBranchChanged={() => {
              refreshBranch();
              refreshProjectFiles();
            }}
          />
        </div>

        {/* Center: Quick Search Bar (Cmd+P / Cmd+Shift+P) */}
        <div
          onClick={() => {
            setPaletteMode("file");
            setIsCommandPaletteOpen(true);
          }}
          className="flex-1 max-w-sm mx-4 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--vscode-editor-bg)] border border-[var(--vscode-border)] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 cursor-pointer transition-colors text-xs font-sans"
          title="Search files or commands (Cmd+P)"
        >
          <div className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="truncate">{activeProject.name} — Search files (Cmd+P)</span>
          </div>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            ⌘P
          </kbd>
        </div>

        {/* Right: Layout Toggles, AI Chat Button & Settings */}
        <div className="flex items-center gap-2">
          {/* AI Chat Button (Toggles Right AI Panel) */}
          <button
            type="button"
            onClick={() => setIsRightPanelOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              isRightPanelOpen
                ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                : "text-zinc-300 hover:text-white hover:bg-zinc-800/80 border border-transparent"
            }`}
            title="Toggle AI Assistant Tool Window (Cmd+L)"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>AI Chat</span>
          </button>

          <div className="h-4 w-[1px] bg-zinc-800 mx-0.5" />

          {/* Toggle Primary Sidebar Button */}
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className={`p-1.5 rounded-lg transition-colors ${
              isSidebarOpen
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            }`}
            title="Toggle Primary Side Bar (Cmd+B)"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Bottom Panel Button */}
          <button
            type="button"
            onClick={() => setIsBottomPanelOpen((prev) => !prev)}
            className={`p-1.5 rounded-lg transition-colors ${
              isBottomPanelOpen
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            }`}
            title="Toggle Bottom Panel (Cmd+J / Ctrl+`)"
          >
            <PanelBottom className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Right Tool Window Button */}
          <button
            type="button"
            onClick={() => setIsRightPanelOpen((prev) => !prev)}
            className={`p-1.5 rounded-lg transition-colors ${
              isRightPanelOpen
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            }`}
            title="Toggle AI Assistant Tool Window (Cmd+L)"
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Main Workbench Body ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Activity Bar (VS Code Vertical Strip) */}
        <aside className="w-11 bg-[var(--vscode-activitybar-bg)] border-r border-[var(--vscode-border)] flex flex-col items-center py-2 gap-2.5 shrink-0 z-10">
          {/* Explorer Tab */}
          <button
            type="button"
            title="Explorer (Cmd+Shift+E)"
            onClick={() => {
              if (activeSidebarTab === "explorer" && isSidebarOpen) {
                setIsSidebarOpen(false);
              } else {
                setActiveSidebarTab("explorer");
                setIsSidebarOpen(true);
              }
            }}
            className={`p-2 rounded-lg transition-all ${
              activeSidebarTab === "explorer" && isSidebarOpen
                ? "bg-[var(--vscode-tab-inactive-bg)] text-[var(--vscode-accent)] border-l-2 border-[var(--vscode-accent)] rounded-l-none"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <FolderCode className="w-4 h-4" />
          </button>

          {/* Search Tab */}
          <button
            type="button"
            title="Search (Cmd+Shift+F)"
            onClick={() => {
              if (activeSidebarTab === "search" && isSidebarOpen) {
                setIsSidebarOpen(false);
              } else {
                setSearchInitialReplace(false);
                setActiveSidebarTab("search");
                setIsSidebarOpen(true);
              }
            }}
            className={`p-2 rounded-lg transition-all ${
              activeSidebarTab === "search" && isSidebarOpen
                ? "bg-[var(--vscode-tab-inactive-bg)] text-[var(--vscode-accent)] border-l-2 border-[var(--vscode-accent)] rounded-l-none"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Source Control Tab */}
          <button
            type="button"
            title="Source Control (Ctrl+Shift+G)"
            onClick={() => {
              if (activeSidebarTab === "sourceControl" && isSidebarOpen) {
                setIsSidebarOpen(false);
              } else {
                setActiveSidebarTab("sourceControl");
                setIsSidebarOpen(true);
              }
            }}
            className={`p-2 rounded-lg transition-all ${
              activeSidebarTab === "sourceControl" && isSidebarOpen
                ? "bg-[var(--vscode-tab-inactive-bg)] text-[var(--vscode-accent)] border-l-2 border-[var(--vscode-accent)] rounded-l-none"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <GitPullRequest className="w-4 h-4" />
          </button>



          {/* Verification Gauntlet & Host Telemetry (Opens Full Page Dashboard) */}
          <button
            type="button"
            title="Verification Gauntlet & Host Telemetry (Opens Full Page)"
            onClick={openMonitorTab}
            className={`p-2 rounded-lg transition-all ${
              activeDockPanelId === "dock_monitor"
                ? "bg-[var(--vscode-tab-inactive-bg)] text-emerald-400 border-l-2 border-emerald-400 rounded-l-none"
                : "text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800/60"
            }`}
          >
            <Activity className="w-4 h-4" />
          </button>

          {/* Model Management & Providers (Opens Full Page Dashboard) */}
          <button
            type="button"
            title="AI Models & Providers (Opens Full Page)"
            onClick={openAiManagerTab}
            className={`p-2 rounded-lg transition-all ${
              activeDockPanelId === "dock_ai_manager"
                ? "bg-[var(--vscode-tab-inactive-bg)] text-purple-400 border-l-2 border-purple-400 rounded-l-none"
                : "text-zinc-400 hover:text-purple-400 hover:bg-zinc-800/60"
            }`}
          >
            <Cpu className="w-4 h-4" />
          </button>

          {/* Extensions & Open VSX Marketplace Tab */}
          <button
            type="button"
            title="Extensions & Themes (Cmd+Shift+X)"
            onClick={() => {
              if (activeSidebarTab === "extensions" && isSidebarOpen) {
                setIsSidebarOpen(false);
              } else {
                setActiveSidebarTab("extensions");
                setIsSidebarOpen(true);
              }
            }}
            className={`p-2 rounded-lg transition-all ${
              activeSidebarTab === "extensions" && isSidebarOpen
                ? "bg-[var(--vscode-tab-inactive-bg)] text-[var(--vscode-accent)] border-l-2 border-[var(--vscode-accent)] rounded-l-none"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Boxes className="w-4 h-4" />
          </button>

          <div className="flex-1" />

          {/* Settings Modal Button */}
          <button
            type="button"
            title="Settings (Cmd+,)"
            onClick={openSettings}
            className="p-2 text-zinc-400 hover:text-zinc-100 rounded-lg transition-all mb-1"
          >
            <Settings className="w-4 h-4" />
          </button>
        </aside>

        {/* Primary Sidebar Area */}
        {isSidebarOpen && (
          <aside className="w-72 border-r border-[var(--vscode-border)] bg-[var(--vscode-sidebar-bg)] flex flex-col h-full shrink-0 overflow-hidden">
            {activeSidebarTab === "explorer" && (
              <ExplorerSidebar
                projectName={activeProject.name}
                projectPath={activeProject.path}
                files={projectFiles}
                activeFilePath={activeTabPath}
                onSelectFile={openFile}
                onCreateFile={createFileOrFolder}
                onDeleteFile={deleteFile}
                onRefresh={refreshProjectFiles}
                onOpenFolder={handleOpenFolder}
                touchedPaths={touchedPaths}
              />
            )}

            {activeSidebarTab === "search" && (
              <SearchSidebar
                projectCwd={activeProject.path}
                projectName={activeProject.name}
                onOpenFile={handleOpenFileAtLocation}
                onUpdateTabContent={updateTabContent}
                onRefreshFiles={refreshProjectFiles}
                initialReplaceExpanded={searchInitialReplace}
              />
            )}

            {activeSidebarTab === "sourceControl" && (
              <SourceControlSidebar
                projectCwd={activeProject.path}
                onOpenDiff={handleOpenGitDiff}
                onRefreshFiles={() => {
                  refreshProjectFiles();
                  refreshBranch();
                }}
              />
            )}



            {activeSidebarTab === "extensions" && (
              <ExtensionsSidebar onApplyTheme={setThemeId} activeThemeId={themeId} />
            )}
          </aside>
        )}

        {/* Center Stage: Dockview (Editors) + Dedicated Bottom Panel */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-[var(--vscode-editor-bg)]">
          {/* Dockview Editors & Diff Surface */}
          <div className="flex-1 w-full overflow-hidden">
            <DockviewReact
              components={components}
              onReady={onReady}
              className="dockview-theme-dark h-full w-full"
            />
          </div>

          {/* Dedicated Bottom Panel (Terminal / Output / Problems) */}
          <BottomPanel
            isOpen={isBottomPanelOpen}
            onClose={() => setIsBottomPanelOpen(false)}
            activeProjectCwd={activeProject.path}
            activityLog={activityLog}
            onClearLog={clearLog}
            status={status}
            orchestrationResult={orchestrationResult}
          />
        </div>

        {/* ── Right Secondary Tool Window (IntelliJ-Style AI Assistant Dock) ── */}
        {isRightPanelOpen && (
          <aside className="w-[410px] border-l border-[var(--vscode-border)] bg-[#141416] flex flex-col h-full shrink-0 overflow-hidden z-10 shadow-2xl">
            <AiAssistantChat
              prompt={prompt}
              setPrompt={setPrompt}
              status={status}
              activityLog={activityLog}
              onRunPipeline={(override) => {
                if (override) {
                  setAiSettings({
                    ...aiSettings,
                    provider: override.provider as any,
                    model: override.model,
                  });
                }
                runPipeline();
              }}
              onCancelPipeline={cancelPipeline}
              onClose={() => setIsRightPanelOpen(false)}
              onPopOutWide={openAiChatTab}
              isWide={false}
            />
          </aside>
        )}

      </div>

      {/* ── Bottom VS Code Status Bar ────────────────────────────────────── */}
      <footer className="h-6 bg-[var(--vscode-statusbar-bg)] border-t border-[var(--vscode-border)] text-zinc-300 flex items-center justify-between px-3 text-xs select-none shrink-0 font-sans">
        {/* Left Status Bar Items */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setActiveSidebarTab("sourceControl");
              setIsSidebarOpen(true);
            }}
            className="flex items-center gap-1.5 hover:text-white cursor-pointer transition-colors"
            title="Switch branch or view source control"
          >
            <GitBranch className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-mono">{gitBranch}</span>
          </button>
          <div className="flex items-center gap-1 text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>0 Errors</span>
          </div>
          <button
            type="button"
            onClick={() => setIsBottomPanelOpen((prev) => !prev)}
            className="flex items-center gap-1.5 hover:text-white cursor-pointer transition-colors text-zinc-300"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
        </div>

        {/* Right Status Bar Items */}
        <div className="flex items-center gap-3">
          <span className="text-zinc-400">UTF-8</span>

          {/* Theme Indicator & Direct Theme Editor Opener */}
          <button
            type="button"
            onClick={openThemeEditor}
            className="capitalize hover:text-white cursor-pointer flex items-center gap-1.5 transition-colors text-zinc-300"
            title="Workbench Theme (click to open Theme Editor)"
          >
            <Palette className="w-3.5 h-3.5 text-pink-400" />
            <span>{PRESET_THEMES[themeId]?.name || themeId}</span>
          </button>

          {/* Active AI Model Indicator with authentic brand logo */}
          <button
            type="button"
            onClick={openAiManagerTab}
            className="capitalize hover:text-white cursor-pointer flex items-center gap-1.5 transition-colors text-zinc-300"
            title="Active AI Provider & Model (click to open model management)"
          >
            <ProviderLogo providerId={aiSettings.provider} className="w-3.5 h-3.5" />
            <span>
              {aiSettings.provider === "deterministic"
                ? "Deterministic AST"
                : aiSettings.model || aiSettings.provider}
            </span>
          </button>

          {/* Host Telemetry Indicators */}
          {systemMetrics && (
            <button
              type="button"
              onClick={openMonitorTab}
              className="hover:text-white cursor-pointer flex items-center gap-1.5 transition-colors text-zinc-300"
              title="System Load (click for detailed health metrics)"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>CPU {Math.round(systemMetrics.cpu_usage_percent)}%</span>
              <span className="text-zinc-500">•</span>
              <span>RAM {Math.round(systemMetrics.memory_usage_percent)}%</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Engine Ready</span>
          </div>
        </div>
      </footer>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <CloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        onPickFolder={pickFolder}
        onCloneSuccess={async (clonedPath) => {
          setIsCloneModalOpen(false);
          await openFolder(clonedPath);
          refreshBranch();
        }}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        onCreateProject={createProject}
        onPickFolder={pickFolder}
      />

      <ErrorBoundary
        fallbackTitle="Preferences & Settings Panel"
        onReset={() => setIsSettingsModalOpen(false)}
      >
        {isSettingsModalOpen && (
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            settings={aiSettings}
            onSave={setAiSettings}
            themeId={themeId}
            onApplyTheme={setThemeId}
            initialTab={settingsModalTab}
            projectName={activeProject?.name || "Practice"}
          />
        )}
      </ErrorBoundary>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
        files={projectFiles}
        onOpenFile={openFile}
        initialMode={paletteMode}
      />
    </div>
  );
}

export default IdeLayout;
