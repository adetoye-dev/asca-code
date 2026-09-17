/**
 * IdeLayout.tsx — Production VS Code Workbench Layout for ACSA Code
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

import { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext, lazy, Suspense } from "react";
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps,
  IDockviewPanelHeaderProps,
} from "dockview-react";
import "dockview/dist/styles/dockview.css";
import { Activity, Save, Folder, Search, GitPullRequest, GitFork, Download, PanelBottom, PanelLeft, FolderPlus, Settings, PanelRight, Cpu, MessageSquare, Palette, Package, Bot, GitCompare, X, Network } from "lucide-react";
import { Icon } from "../ui/Icon";
import { FileIcon } from "../ui/FileIcon";
import { IdeBrandLogo } from "../ui/BrandLogos";

import { AssetPreview } from "../editor/AssetPreview";
import { StatusBar } from "./StatusBar";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { DockviewWatermark } from "./DockviewWatermark";
import { ProjectSetupCard } from "./ProjectSetupCard";
import {
  fetchProjectStatus,
  runInProjectTerminal,
  type ProjectStatus,
} from "../../services/projectSetup";
import { ExplorerSidebar } from "../sidebar/ExplorerSidebar";
import { SearchSidebar } from "../sidebar/SearchSidebar";
import { SourceControlSidebar } from "../sidebar/SourceControlSidebar";
import { MarketplaceSidebar } from "../sidebar/MarketplaceSidebar";
import { VersionControlDropdown } from "./VersionControlDropdown";
import { CloneModal } from "../modals/CloneModal";
import { ProjectModal } from "../ProjectModal";
import { SettingsModal } from "../SettingsModal";
import { ErrorBoundary } from "../ErrorBoundary";
import { CommandPalette, CommandItem } from "../modals/CommandPalette";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AiAssistantChat } from "../dashboards/AiAssistantChat";
import { getDefaultProvider } from "../../services/aiModelManager";
import { applyGlobalWorkbenchTheme } from "../../services/themeManager";
import { systemMetricsService } from "../../services/systemMetricsService";
import { openOllamaSetupWizard, EVENT_OPEN_AI_MANAGEMENT, EVENT_START_CODING_WITH_OLLAMA } from "../../services/ollamaSetup";
import type { UsePipelineReturn } from "../../hooks/usePipeline";
import { gitFetch } from "../../services/gitClient";

type SidebarTab = "explorer" | "search" | "sourceControl" | "extensions";

const SPECIAL_PANELS = ["dock_diff", "diff_"];

/* ── Lazily-loaded heavy surfaces ─────────────────────────────────────────
   Monaco (~1.5 MB) and the terminal/graph stacks dominate the bundle but are
   not needed to paint the workbench. Splitting them keeps first paint cheap;
   each defers until the surface is actually opened. */
const MonacoEditorContainer = lazy(() =>
  import("../editor/MonacoEditorContainer").then((m) => ({ default: m.MonacoEditorContainer }))
);
const MonacoDiffContainer = lazy(() =>
  import("../editor/MonacoDiffContainer").then((m) => ({ default: m.MonacoDiffContainer }))
);
const BottomPanel = lazy(() =>
  import("../panels/BottomPanel").then((m) => ({ default: m.BottomPanel }))
);
const PerformanceDashboard = lazy(() =>
  import("../dashboards/PerformanceDashboard").then((m) => ({ default: m.PerformanceDashboard }))
);
const AiManagementDashboard = lazy(() =>
  import("../dashboards/AiManagementDashboard").then((m) => ({ default: m.AiManagementDashboard }))
);
const CodeMapDashboard = lazy(() =>
  import("../dashboards/CodeMapDashboard").then((m) => ({ default: m.CodeMapDashboard }))
);

/** Fallback shown while a lazily-loaded surface chunk arrives. */
const SurfaceFallback = ({ label }: { label: string }) => (
  <div className="h-full w-full flex items-center justify-center text-zinc-500 text-xs bg-[var(--vscode-editor-bg)]">
    Loading {label}…
  </div>
);

/** Full-page surfaces rendered as chrome-free overlays over the editor grid. */
type FullPageId = "monitor" | "aiManager" | "codeMap";

const FULL_PAGE_TITLES: Record<FullPageId, string> = {
  monitor: "Host Health & Performance",
  aiManager: "AI Models & Providers",
  codeMap: "Code Map",
};

const FULL_PAGE_ICONS: Record<FullPageId, typeof Cpu> = {
  monitor: Activity,
  aiManager: Cpu,
  codeMap: Network,
};

/**
 * Tab-chrome state shared with dockview's tab headers. Dockview renders tab
 * headers outside the normal React parent chain, so we publish dirtiness and
 * the close-request handler through a context rather than panel params.
 */
interface TabChrome {
  /** Paths of tabs with unsaved in-memory edits. */
  dirty: ReadonlySet<string>;
  /** Close a tab, confirming first when it has unsaved edits. */
  requestClose: (close: () => void, title: string, isDirty: boolean) => void;
}

const TabChromeContext = createContext<TabChrome>({
  dirty: new Set(),
  requestClose: (close) => close(),
});

const DockviewCustomTab = (props: IDockviewPanelHeaderProps & { onPointerDown?: any; onPointerUp?: any; onPointerLeave?: any }) => {
  const { api, onPointerDown, onPointerUp, onPointerLeave } = props;
  const [title, setTitle] = useState(api.title);
  const tabChrome = useContext(TabChromeContext);

  useEffect(() => {
    const disposable = api.onDidTitleChange((event) => setTitle(event.title));
    return () => disposable.dispose();
  }, [api]);

  const filePath = (props.params as any)?.filePath || api.id;
  const isDirty = tabChrome.dirty.has(filePath) || tabChrome.dirty.has(api.id);
  const renderIcon = () => {
    if (api.id.startsWith("diff_") || api.id === "dock_diff") return <Icon icon={GitCompare} className="w-3.5 h-3.5 text-zinc-400 shrink-0 mr-1.5" />;
    return <FileIcon fileName={title || filePath} className="w-3.5 h-3.5 shrink-0 mr-1.5" />;
  };

  return (
    <div data-testid="dockview-dv-default-tab" className={`dv-default-tab group flex items-center h-full px-2 cursor-pointer select-none${isDirty ? " is-dirty" : ""}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}>
      {renderIcon()}
      <span className="dv-default-tab-content truncate text-xs font-medium">{title}</span>
      {isDirty && (
        <span
          className="acsa-tab-dirty ml-1 shrink-0 group-hover:opacity-0"
          title="Unsaved changes"
          aria-label="Unsaved changes"
          data-testid="tab-dirty-indicator"
        />
      )}
      <button
        type="button"
        className="dv-default-tab-action ml-1 p-0.5 rounded hover:bg-white/10"
        aria-label={isDirty ? `Close tab (unsaved changes in ${title})` : "Close tab"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          tabChrome.requestClose(() => api.close(), title || filePath, isDirty);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon icon={X} className="w-3 h-3 text-zinc-400 hover:text-zinc-200" />
      </button>
    </div>
  );
};

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
    indexStatus,
    isIndexing,
    syncIndex,
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
    streamingAnswer,
    streamingThought,
    agentSteps,
  } = pipeline;

  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("explorer");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("acsa_sidebar_width");
      if (saved) {
        const num = parseInt(saved, 10);
        if (!isNaN(num) && num >= 180 && num <= 500) return num;
      }
    } catch {}
    return 240;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const startResizingSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);

    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
      sidebarWidthRef.current = newWidth;
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem("acsa_sidebar_width", sidebarWidthRef.current.toString());
      } catch {}
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  // Full-canvas chat surface ("Open in Center Stage"). Rendered as an overlay
  // over the editor grid so it has no dockview tab chrome of its own.
  const [isCenterChatOpen, setIsCenterChatOpen] = useState(false);
  // Full-page surfaces (Host Health, AI Models, Code Map). Also overlays, for
  // the same reason: a dockview tab would leak tab chrome into a full page.
  const [fullPage, setFullPage] = useState<FullPageId | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [gitBranch, setGitBranch] = useState("main");
  const [paletteMode, setPaletteMode] = useState<"command" | "file">("command");
  const [themeId, setThemeId] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("acsa_ide_theme") || "github-dark" : "github-dark")
  );
  const [settingsModalTab, setSettingsModalTab] = useState<string>("agents");
  const [searchInitialReplace, setSearchInitialReplace] = useState(false);
  const [targetEditorLine, setTargetEditorLine] = useState<{
    path: string;
    line: number;
    column?: number;
    ts: number;
  } | null>(null);
  const [selectedCode, setSelectedCode] = useState("");
  const dockviewApiRef = useRef<DockviewApi | null>(null);

  const handleOpenFileAtLocation = useCallback(
    async (filePath: string, lineNumber?: number, column?: number) => {
      // Leaving the full-canvas chat to look at a file: dismiss the overlay so
      // the editor is actually visible.
      setIsCenterChatOpen(false);
      setFullPage(null);
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

  // Opening a file from the explorer / quick-open while a full-surface overlay
  // is up should reveal the editor instead of loading it behind the overlay.
  const openFileAndExitFullChat = useCallback(
    (file: Parameters<typeof openFile>[0]) => {
      setIsCenterChatOpen(false);
      setFullPage(null);
      return openFile(file);
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
    try {
      localStorage.setItem("acsa_ide_theme", themeId);
    } catch {
      // Ignore localStorage write failures
    }
  }, [themeId]);

  const refreshBranch = useCallback(async () => {
    try {
      const res = await gitFetch("/api/git/status", {
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

  // Full-page surfaces reuse the chrome-free overlay so nothing competes with
  // the editor for tab space. Opening one closes the others.
  const openFullPage = (page: FullPageId) => {
    setIsBottomPanelOpen(false);
    setIsCenterChatOpen(false);
    // A full page wants the whole canvas, so reclaim the side tool window.
    setIsRightPanelOpen(false);
    setFullPage((prev) => (prev === page ? null : page));
  };

  const openMonitorTab = () => openFullPage("monitor");
  const openAiManagerTab = () => openFullPage("aiManager");
  const openCodeMapTab = () => openFullPage("codeMap");

  const openAiChatTab = () => {
    // Mutual exclusivity: close right panel when opening center stage tab
    setIsRightPanelOpen(false);
    // When opening full chat mode, also close the terminal/bottom panel section
    setIsBottomPanelOpen(false);
    setIsCenterChatOpen(true);
  };

  // ── Listen for Programmatic Open AI Manager Requests ──────────────────────
  useEffect(() => {
    const handleOpenAiManager = () => {
      openAiManagerTab();
    };
    window.addEventListener(EVENT_OPEN_AI_MANAGEMENT, handleOpenAiManager);
    return () => window.removeEventListener(EVENT_OPEN_AI_MANAGEMENT, handleOpenAiManager);
  }, []);

  // ── Listen for Programmatic Start Coding with Ollama Requests ─────────────
  useEffect(() => {
    const handleStartCoding = () => {
      setIsCenterChatOpen(false);
      setIsRightPanelOpen(true);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("acsa:focus-ai-chat-input"));
      }, 80);
    };
    window.addEventListener(EVENT_START_CODING_WITH_OLLAMA, handleStartCoding);
    return () => window.removeEventListener(EVENT_START_CODING_WITH_OLLAMA, handleStartCoding);
  }, []);

  // ── Listen for Watermark / Global Quick Action Requests ───────────────────
  useEffect(() => {
    const handleOpenFileSearch = () => {
      setPaletteMode("file");
      setIsCommandPaletteOpen(true);
    };
    const handleOpenCommandPalette = () => {
      setPaletteMode("command");
      setIsCommandPaletteOpen(true);
    };
    const handleToggleSidebar = () => setIsSidebarOpen((prev) => !prev);
    const handleToggleTerminal = () => setIsBottomPanelOpen((prev) => !prev);
    const handleToggleAi = () => {
      // Any "AI Assistant" affordance targets the docked assistant; leaving the
      // full-canvas overlay first keeps the two surfaces from fighting.
      setIsCenterChatOpen(false);
      setIsRightPanelOpen((prev) => !prev);
    };

    window.addEventListener("acsa:open-file-search", handleOpenFileSearch);
    window.addEventListener("acsa:open-command-palette", handleOpenCommandPalette);
    window.addEventListener("acsa:toggle-sidebar", handleToggleSidebar);
    window.addEventListener("acsa:toggle-terminal", handleToggleTerminal);
    window.addEventListener("acsa:toggle-ai", handleToggleAi);

    return () => {
      window.removeEventListener("acsa:open-file-search", handleOpenFileSearch);
      window.removeEventListener("acsa:open-command-palette", handleOpenCommandPalette);
      window.removeEventListener("acsa:toggle-sidebar", handleToggleSidebar);
      window.removeEventListener("acsa:toggle-terminal", handleToggleTerminal);
      window.removeEventListener("acsa:toggle-ai", handleToggleAi);
    };
  }, []);

  // ── Global Keyboard Shortcuts Engine ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Cmd+Shift+P: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteMode("command");
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Cmd+Shift+E: Explorer Sidebar
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setActiveSidebarTab("explorer");
        setIsSidebarOpen(true);
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

      // Cmd+L / Ctrl+L: send the current editor selection to Chat/Ask
      if (isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (isCenterChatOpen) {
          // Full-canvas chat is a focused mode: Cmd+L returns to the side dock.
          setIsCenterChatOpen(false);
          setIsRightPanelOpen(true);
        } else {
          setIsRightPanelOpen((prev) => !prev);
        }
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("acsa:ai-workflow", { detail: "chat" })), 0);
        return;
      }

      // Cmd+I / Ctrl+I or Shift+Cmd+I: prepare an Agent edit from current selection
      if (isCmdOrCtrl && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setIsRightPanelOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("acsa:ai-workflow", { detail: "agent" })), 0);
        return;
      }

      // Alt+Cmd+P / Ctrl+Alt+P: prepare an Architectural Plan / Brainstorm
      if (isCmdOrCtrl && e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setIsRightPanelOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("acsa:ai-workflow", { detail: "plan" })), 0);
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

  // Escape closes the topmost full-surface overlay (chat / full page).
  useEffect(() => {
    if (!isCenterChatOpen && !fullPage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullPage) setFullPage(null);
      else if (isCenterChatOpen) setIsCenterChatOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCenterChatOpen, fullPage]);

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
      id: "view.toggleBottomPanel",
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
      title: "AI Assistant: Toggle Chat Panel (Open/Close)",
      category: "AI",
      shortcut: "⌘L",
      icon: MessageSquare,
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
      icon: Folder,
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
      id: "theme.githubDark",
      title: "Color Theme: GitHub Dark Default",
      category: "Preferences",
      icon: Palette,
      action: () => setThemeId("github-dark"),
    },
    {
      id: "agent.run",
      title: "Autonomous Agent: Execute & Verify Task",
      category: "Agent",
      icon: Bot,
      action: () => runPipeline(),
    },
    {
      id: "view.explorer",
      title: "Show Explorer",
      category: "View",
      icon: Folder,
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
      icon: GitFork,
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
      id: "view.openCodeMap",
      title: "Code Map: Search Symbols & Inspect Dependency Hubs",
      category: "View",
      icon: Network,
      action: openCodeMapTab,
    },
    {
      id: "ai.setupOllama",
      title: "AI: Setup Local AI Engine (Ollama Setup Wizard)",
      category: "AI",
      icon: Cpu,
      action: openOllamaSetupWizard,
    },
    {
      id: "ai.pullModel",
      title: "AI: Pull / Download Local AI Model...",
      category: "AI",
      icon: Download,
      action: openAiManagerTab,
    },
    {
      id: "view.openAiChat",
      title: "AI: Open AI Assistant Chat",
      category: "AI",
      icon: MessageSquare,
      action: openAiChatTab,
    },
    {
      id: "view.extensions",
      title: "Show Marketplace: Skills, Tools & MCP Servers",
      category: "View",
      icon: Package,
      action: () => {
        setActiveSidebarTab("extensions");
        setIsSidebarOpen(true);
      },
    },
  ];

  // ── Full-Canvas Chat Props ────────────────────────────────────────────────
  // Rendered as an overlay above the editor grid (see the center-stage render
  // below), so it is a normal React child and always receives fresh props.
  const centerChatProps = {
    prompt,
    setPrompt,
    status,
    activityLog,
    projectRoot: activeProject.path,
    branch: gitBranch,
    onRunPipeline: (
      request: string,
      override?: { provider: string; model: string; apiKey?: string; baseUrl?: string },
      activePath?: string,
      code?: string,
      history?: Array<{ role: string; content: string }>,
      images?: string[]
    ) => {
      if (override) {
        setAiSettings({
          ...aiSettings,
          provider: override.provider as any,
          model: override.model,
          apiKey: override.apiKey !== undefined ? override.apiKey : aiSettings.apiKey,
          baseUrl: override.baseUrl !== undefined ? override.baseUrl : aiSettings.baseUrl,
        });
      }
      runPipeline(
        request,
        override,
        activePath || activeTabPath || undefined,
        code || selectedCode || undefined,
        history,
        images
      );
    },
    onCancelPipeline: cancelPipeline,
    isWide: true,
    activeAiSettings: aiSettings,
    selectedContext: activeTabPath ? { path: activeTabPath, code: selectedCode } : null,
    failureDetail: orchestrationResult?.error_detail,
    orchestrationResult,
    indexStatus,
    isIndexing,
    onSyncIndex: syncIndex,
    streamingAnswer,
    streamingThought,
    agentSteps,
    onClose: () => setIsCenterChatOpen(false),
    onPopOutWide: () => {
      // Leave full canvas and dock the assistant back to the side tool window.
      setIsCenterChatOpen(false);
      setIsRightPanelOpen(true);
    },
  };

  const components = {
    // Asset Preview Tab
    assetPreview: (props: IDockviewPanelProps<{ filePath: string; isTauri: boolean; projectRoot?: string }>) => (
      <AssetPreview {...props} />
    ),
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
        <Suspense fallback={<SurfaceFallback label="editor" />}>
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
            onSelectionChange={setSelectedCode}
            projectRoot={activeProject.path}
          />
        </Suspense>
      );
    },

    // Monaco Diff Viewer Tab
    diff: (props: IDockviewPanelProps<{ filePath?: string; originalContent?: string; modifiedContent?: string; isGit?: boolean }>) => {
      const isGit = props.params?.isGit;
      const original = isGit ? (props.params?.originalContent ?? "") : "";
      const modified = isGit ? (props.params?.modifiedContent ?? "") : currentDiff;
      const path = isGit ? (props.params?.filePath ?? "git.diff") : "patch.diff";

      return (
        <Suspense fallback={<SurfaceFallback label="diff viewer" />}>
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
        </Suspense>
      );
    },

  };

  // ── Initialize Default Dockview Layout ────────────────────────────────────
  const onReady = useCallback((event: DockviewReadyEvent) => {
    dockviewApiRef.current = event.api;

    // Add initial editor panel if tabs exist
    if (openTabs.length > 0) {
      const first = openTabs[0];
      event.api.addPanel({
        id: first.path,
        component: first.path.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i) ? "assetPreview" : "editor",
        title: first.name,
        params: { filePath: first.path, isTauri: isTauriAvailable, projectRoot: activeProject.path },
      });
    }

    // Listen to panel active and close events
    event.api.onDidActivePanelChange((e) => {
      const panelId = (e as any)?.panel?.id || (e as any)?.id;
      if (panelId && !SPECIAL_PANELS.some((p) => panelId.startsWith(p))) {
        selectTab(panelId);
      }
    });

    event.api.onDidRemovePanel((panel) => {
      if (panel && panel.id && !SPECIAL_PANELS.some((p) => panel.id.startsWith(p))) {
        closeTab(panel.id);
      }
    });
  }, [openTabs, selectTab, closeTab, refreshBranch, refreshProjectFiles]);

  // Synchronize open tabs with Dockview panels
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    // Close any editor panel whose tab is no longer in openTabs
    const editorPanels = api.panels.filter((p) => ["editor", "assetPreview", "diff"].includes((p as any).component));
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
          component: tab.path.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i) ? "assetPreview" : "editor",
          title: tab.name,
          params: { filePath: tab.path, isTauri: isTauriAvailable, projectRoot: activeProject.path },
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
        ["editor", "assetPreview"].includes((panel as any).component) ||
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

  // Publish tab dirtiness + the guarded close handler to the dockview headers.
  const dirtyTabPaths = useMemo(
    () => new Set(openTabs.filter((t) => t.isDirty).map((t) => t.path)),
    [openTabs]
  );
  const [pendingTabClose, setPendingTabClose] = useState<{ title: string } | null>(null);
  const pendingTabCloseFnRef = useRef<null | (() => void)>(null);
  const requestCloseTab = useCallback((close: () => void, title: string, isDirty: boolean) => {
    if (!isDirty) {
      close();
      return;
    }
    pendingTabCloseFnRef.current = close;
    setPendingTabClose({ title });
  }, []);
  const tabChrome = useMemo(
    () => ({ dirty: dirtyTabPaths, requestClose: requestCloseTab }),
    [dirtyTabPaths, requestCloseTab]
  );

  // ── Project readiness (fresh scaffold → dependencies not installed) ───────
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [setupBusyCommand, setSetupBusyCommand] = useState<string | null>(null);

  const refreshProjectStatus = useCallback(async () => {
    const status = await fetchProjectStatus(activeProject.path);
    setProjectStatus(status);
    return status;
  }, [activeProject.path]);

  useEffect(() => {
    void refreshProjectStatus();
  }, [refreshProjectStatus]);

  const runSetupCommand = useCallback(
    async (_label: string, command: string) => {
      setSetupBusyCommand(command);
      setIsBottomPanelOpen(true);
      await runInProjectTerminal(activeProject.path, command);
      // Installing/building is long-running, so poll until the project stops
      // needing setup (or give up) and let the card re-render on its own.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const status = await refreshProjectStatus();
        if (!status || !status.needsInstall) break;
      }
      setSetupBusyCommand(null);
    },
    [activeProject.path, refreshProjectStatus]
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--vscode-sidebar-bg)] text-[var(--vscode-editor-fg)] select-none">
      {/* ── Top IDE Titlebar (Clean, Uncluttered, JetBrains / VS Code Modern UI) ── */}
      <header className="flex items-center justify-between px-3 h-10 border-b border-[var(--vscode-border)] bg-[var(--vscode-titlebar-bg)] shrink-0 text-xs font-sans">
        {/* Left: Sleek Brand & Project Selector */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 pr-1">
            <IdeBrandLogo className="w-5 h-5 shrink-0" />
            <span className="font-semibold tracking-tight text-zinc-100 text-[13px] flex items-center gap-1 font-sans">
              ACSA <span className="text-zinc-400 font-medium">Code</span>
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

        {/* Center: Command Palette / Omnibar Trigger */}
        <div
          onClick={() => setIsCommandPaletteOpen(true)}
          className="flex-1 max-w-xl mx-4 h-7 bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg px-2.5 flex items-center justify-between cursor-pointer transition-colors shadow-sm group"
        >
          <div className="flex items-center gap-2 text-xs text-zinc-400 group-hover:text-zinc-300">
            <Icon icon={Search} className="w-3.5 h-3.5" />
            <span className="truncate">
              {activeProject ? `${activeProject.name} — Search files (Cmd+P)` : "Search files (Cmd+P)"}
            </span>
          </div>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-zinc-800/70 border border-zinc-700/50 rounded">
            ⌘P
          </kbd>
        </div>

        {/* Right: Layout Toggles, AI Chat Button & Settings */}
        <div className="flex items-center gap-2">
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
            <Icon icon={PanelLeft} className="w-3.5 h-3.5" />
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
            <Icon icon={PanelBottom} className="w-3.5 h-3.5" />
          </button>

          {/* AI Chat Button: toggles the docked assistant, or leaves full-canvas chat */}
          <button
            type="button"
            onClick={() => {
              if (isCenterChatOpen) {
                setIsCenterChatOpen(false);
                setIsRightPanelOpen(true);
              } else {
                setIsRightPanelOpen((prev) => !prev);
              }
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              isRightPanelOpen || isCenterChatOpen
                ? "bg-zinc-800 text-zinc-100 border border-zinc-700/60 shadow-sm"
                : "text-zinc-300 hover:text-white hover:bg-zinc-800/80 border border-transparent"
            }`}
            title="Toggle AI Chat Panel (Cmd+L)"
          >
            <Icon icon={MessageSquare} className="w-3.5 h-3.5 text-zinc-300" />
            <span>Chat</span>
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
                ? "bg-white/10 text-white rounded-md"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Icon icon={Folder} className="w-4 h-4" />
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
                ? "bg-white/10 text-white rounded-md"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Icon icon={Search} className="w-4 h-4" />
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
                ? "bg-white/10 text-white rounded-md"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Icon icon={GitPullRequest} className="w-4 h-4" />
          </button>



          {/* Verification Gauntlet & Host Telemetry (Opens Full Page Dashboard) */}
          <button
            type="button"
            title="Verification Gauntlet & Host Telemetry (Opens Full Page)"
            onClick={openMonitorTab}
            className={`p-2 rounded-lg transition-all ${
              fullPage === "monitor"
                ? "bg-white/10 text-emerald-400 rounded-md"
                : "text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800/60"
            }`}
          >
            <Icon icon={Activity} className="w-4 h-4" />
          </button>

          {/* Code Map & Symbol Index (Opens Full Page Dashboard) */}
          <button
            type="button"
            title="Code Map: symbols, dependency hubs & entrypoints (Opens Full Page)"
            onClick={openCodeMapTab}
            className={`p-2 rounded-lg transition-all ${
              fullPage === "codeMap"
                ? "bg-white/10 text-purple-300 rounded-md"
                : "text-zinc-400 hover:text-purple-300 hover:bg-zinc-800/60"
            }`}
          >
            <Icon icon={Network} className="w-4 h-4" />
          </button>

          {/* Model Management & Providers (Opens Full Page Dashboard) */}
          <button
            type="button"
            title="AI Models & Providers (Opens Full Page)"
            onClick={openAiManagerTab}
            className={`p-2 rounded-lg transition-all ${
              fullPage === "aiManager"
                ? "bg-white/10 text-white rounded-md"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            }`}
          >
            <Icon icon={Cpu} className="w-4 h-4" />
          </button>

          {/* Marketplace Tab: Skills, Tools & MCP servers */}
          <button
            type="button"
            title="Marketplace: Skills, Tools & MCP Servers (Cmd+Shift+X)"
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
                ? "bg-white/10 text-white rounded-md"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Icon icon={Package} className="w-4 h-4" />
          </button>

          <div className="flex-1" />

          {/* Settings Modal Button */}
          <button
            type="button"
            title="Settings (Cmd+,)"
            onClick={openSettings}
            className="p-2 text-zinc-400 hover:text-zinc-100 rounded-lg transition-all mb-1"
          >
            <Icon icon={Settings} className="w-4 h-4" />
          </button>
        </aside>

        {/* Primary Sidebar Area */}
        <aside
          style={{ width: isSidebarOpen ? `${sidebarWidth}px` : 0 }}
          className={`relative border-r border-[var(--vscode-border)] bg-[var(--vscode-sidebar-bg)] flex flex-col h-full shrink-0 overflow-hidden ${
            isSidebarOpen ? "" : "hidden"
          }`}
        >
          {activeSidebarTab === "explorer" && (
            <ExplorerSidebar
              projectName={activeProject.name}
              projectPath={activeProject.path}
              files={projectFiles}
              activeFilePath={activeTabPath}
              onSelectFile={openFileAndExitFullChat}
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
            <MarketplaceSidebar projectRoot={activeProject.path} />
          )}

          {/* Draggable Resize Handle */}
          <div
            onMouseDown={startResizingSidebar}
            className={`absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-zinc-600/40 transition-colors z-20 select-none ${
              isResizingSidebar ? "bg-zinc-500" : ""
            }`}
            title="Drag to resize sidebar"
          />
        </aside>

        {/* Center Stage: Dockview (Editors) + Dedicated Bottom Panel */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-[var(--vscode-editor-bg)]">
          {/* Dockview Editors & Diff Surface */}
          <div className="flex-1 w-full overflow-hidden relative">
            <TabChromeContext.Provider value={tabChrome}>
            <DockviewReact
              components={components}
              defaultTabComponent={DockviewCustomTab}
              watermarkComponent={() => (
                <DockviewWatermark
                  onOpenFile={() => {
                    setPaletteMode("file");
                    setIsCommandPaletteOpen(true);
                  }}
                  onOpenCommands={() => {
                    setPaletteMode("command");
                    setIsCommandPaletteOpen(true);
                  }}
                  onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
                  onToggleTerminal={() => setIsBottomPanelOpen((prev) => !prev)}
                  onToggleAi={() => {
                    setIsCenterChatOpen(false);
                    setIsRightPanelOpen((prev) => !prev);
                  }}
                  setupSlot={
                    <ProjectSetupCard
                      status={projectStatus}
                      busyCommand={setupBusyCommand}
                      onRun={runSetupCommand}
                    />
                  }
                />
              )}
              onReady={onReady}
              className="dockview-theme-dark h-full w-full"
            />
            </TabChromeContext.Provider>

            {/* Full-Canvas AI Assistant — a true overlay with no dockview tab
                chrome. Only one assistant surface is ever mounted: opening this
                closes the side dock and vice versa. z-50 keeps it above the
                editor's own floating chrome (Review button etc.); global modals
                render later in the DOM at the same level, so they stay on top. */}
            {isCenterChatOpen && (
              <div className="absolute inset-0 z-50 bg-[#141416]">
                <AiAssistantChat {...centerChatProps} />
              </div>
            )}

            {/* Full-page surfaces (Host Health, AI Models, Code Map). Rendered
                as overlays for the same reason as the chat: no tab chrome. */}
            {fullPage && (
              <div className="absolute inset-0 z-50 bg-[#141416] flex flex-col">
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--vscode-border)] bg-[#18181b] shrink-0">
                  <div className="flex items-center gap-2">
                    <Icon icon={FULL_PAGE_ICONS[fullPage]} className="w-4 h-4 text-zinc-300" />
                    <span className="text-[13px] font-semibold text-zinc-100 tracking-tight">
                      {FULL_PAGE_TITLES[fullPage]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFullPage(null)}
                    title="Close (Esc)"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <Icon icon={X} className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<SurfaceFallback label={FULL_PAGE_TITLES[fullPage]} />}>
                  {fullPage === "monitor" && (
                    <PerformanceDashboard
                      systemMetrics={systemMetrics}
                      projectRoot={activeProject.path}
                      onRefreshMetrics={() => {
                        refreshBranch();
                        systemMetricsService.fetchMetrics();
                      }}
                    />
                  )}
                  {fullPage === "aiManager" && (
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
                  )}
                  {fullPage === "codeMap" && (
                    <CodeMapDashboard
                      projectRoot={activeProject.path}
                      projectName={activeProject.name}
                      aiSettings={aiSettings}
                      onOpenFile={(path, line) => {
                        setFullPage(null);
                        handleOpenFileAtLocation(path, line);
                      }}
                    />
                  )}
                  </Suspense>
                </div>
              </div>
            )}
          </div>

          {/* Dedicated Bottom Panel (Terminal / Output / Problems) */}
          <Suspense fallback={null}>
          <BottomPanel
            isOpen={isBottomPanelOpen}
            onClose={() => setIsBottomPanelOpen(false)}
            activeProjectCwd={activeProject.path}
            activityLog={activityLog}
            onClearLog={clearLog}
            status={status}
            orchestrationResult={orchestrationResult}
            terminalFontSize={aiSettings?.terminalFontSize ?? 13}
          />
          </Suspense>
        </div>

        {/* ── Right Secondary Tool Window (IntelliJ-Style AI Assistant Dock) ── */}
        {isRightPanelOpen && (
          <aside className="w-[410px] border-l border-[var(--vscode-border)] bg-workbench flex flex-col h-full shrink-0 overflow-hidden z-10 shadow-2xl">
            <AiAssistantChat
              prompt={prompt}
              setPrompt={setPrompt}
              status={status}
              activityLog={activityLog}
              projectRoot={activeProject.path}
              branch={gitBranch}
              onRunPipeline={(request, override, activePath, code, history, images) => {
                if (override) {
                  setAiSettings({
                    ...aiSettings,
                    provider: override.provider as any,
                    model: override.model,
                    apiKey: override.apiKey !== undefined ? override.apiKey : aiSettings.apiKey,
                    baseUrl: override.baseUrl !== undefined ? override.baseUrl : aiSettings.baseUrl,
                  });
                }
                runPipeline(request, override, activePath || activeTabPath || undefined, code || selectedCode || undefined, history, images);
              }}
              onCancelPipeline={cancelPipeline}
              onClose={() => setIsRightPanelOpen(false)}
              onPopOutWide={openAiChatTab}
              isWide={false}
              activeAiSettings={aiSettings}
              selectedContext={activeTabPath ? { path: activeTabPath, code: selectedCode } : null}
              failureDetail={orchestrationResult?.error_detail}
              orchestrationResult={orchestrationResult}
              indexStatus={indexStatus}
              isIndexing={isIndexing}
              onSyncIndex={syncIndex}
              streamingAnswer={streamingAnswer}
              streamingThought={streamingThought}
              agentSteps={agentSteps}
            />
          </aside>
        )}

      </div>

      <StatusBar
        gitBranch={gitBranch}
        metrics={systemMetrics}
        indexStatus={indexStatus}
        isIndexing={isIndexing}
        onSyncIndex={syncIndex}
      />

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
            onOpenMarketplace={() => {
              setActiveSidebarTab("extensions");
              setIsSidebarOpen(true);
            }}
          />
        )}
      </ErrorBoundary>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
        files={projectFiles}
        onOpenFile={openFileAndExitFullChat}
        initialMode={paletteMode}
      />

      {/* Closing a tab with unsaved edits asks first — a styled modal rather
          than window.confirm so it never blocks the renderer. */}
      <ConfirmDialog
        isOpen={pendingTabClose !== null}
        title="Close unsaved file?"
        message={
          <>
            <span className="font-medium text-zinc-300">{pendingTabClose?.title}</span> has changes that
            aren't saved to disk. Closing it will discard those changes.
          </>
        }
        confirmText="Discard & close"
        cancelText="Keep editing"
        onConfirm={() => {
          const fn = pendingTabCloseFnRef.current;
          pendingTabCloseFnRef.current = null;
          setPendingTabClose(null);
          fn?.();
        }}
        onCancel={() => {
          pendingTabCloseFnRef.current = null;
          setPendingTabClose(null);
        }}
      />
    </div>
  );
}

export default IdeLayout;
