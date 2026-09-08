/**
 * SettingsModal.tsx — Authentic IntelliJ IDEA Settings & Preferences Window
 *
 * Implements the IntelliJ IDE settings panel architecture:
 * - macOS traffic light window chrome and project title
 * - Two-column layout with searchable hierarchical category tree
 * - Tools > AI Assistant > Agents (Claude, Codex, Copilot, Junie, Agoragentic, Amp, Auggie CLI)
 * - Tools > AI Assistant > Providers & API keys (with real connection ping testing)
 * - Tools > AI Assistant > Model Context Protocol (MCP) servers
 * - Editor > Font (JetBrains Mono default, size, line spacing, ligatures, live preview)
 * - Editor > Code Style (tab size, spaces, format on save)
 * - Appearance & Behavior > Appearance (theme picker with live preview swatches)
 * - Tools > Terminal & Version Control > Git
 * - Standard IntelliJ footer with [?] Help, [Cancel], [Apply], [OK]
 */

import React, { useState, useEffect, useMemo } from "react";
import { Settings, X, ChevronDown, RefreshCw, AlertCircle, Bot, Search, Layers, ChevronRight, ExternalLink, EyeOff, ArrowRight, Check, Zap, Pin, Cpu, CheckCircle2, HelpCircle, ArrowLeft, Eye } from "lucide-react";
import { PRESET_THEMES } from "../services/themeManager";
import { ProviderLogo } from "./ui/BrandLogos";

export interface AISettings {
  provider: "deterministic" | "ollama" | "local" | "openai";
  model: string;
  apiKey: string;
  baseUrl: string;
  fontSize?: number;
  lineHeight?: number;
  enableLigatures?: boolean;
  tabSize?: number;
  insertSpaces?: boolean;
  formatOnSave?: boolean;
  wordWrap?: boolean;
  shellPath?: string;
  terminalFontSize?: number;
  copyOnSelect?: boolean;
  gitExecutablePath?: string;
  gitDefaultBranch?: string;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (newSettings: AISettings) => void;
  themeId?: string;
  onApplyTheme?: (themeId: string) => void;
  initialTab?: string;
  projectName?: string;
}

interface TreeNode {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  hasExternalBadge?: boolean;
  children?: TreeNode[];
}

const SETTINGS_TREE: TreeNode[] = [
  {
    id: "appearance-group",
    label: "Appearance & Behavior",
    children: [
      { id: "appearance", label: "Appearance" },
      { id: "system-settings", label: "System Settings" },
    ],
  },
  { id: "keymap", label: "Keymap" },
  {
    id: "editor-group",
    label: "Editor",
    children: [
      { id: "editor-font", label: "Font" },
      { id: "editor-code-style", label: "Code Style" },
      { id: "editor-general", label: "General" },
    ],
  },
  { id: "plugins", label: "Plugins" },
  {
    id: "vcs-group",
    label: "Version Control",
    children: [{ id: "git", label: "Git", hasExternalBadge: true }],
  },
  { id: "build-exec", label: "Build, Execution, Deployment" },
  { id: "languages", label: "Languages & Frameworks" },
  {
    id: "tools-group",
    label: "Tools",
    children: [
      { id: "actions-on-save", label: "Actions on Save" },
      {
        id: "ai-assistant-group",
        label: "AI Assistant",
        children: [
          { id: "agents", label: "Agents" },
          { id: "providers", label: "Providers & API keys", hasExternalBadge: true },
          { id: "mcp", label: "Model Context Protocol (MCP)", hasExternalBadge: true },
          { id: "prompt-library", label: "Prompt Library", hasExternalBadge: true },
          { id: "rules", label: "Rules", hasExternalBadge: true },
          { id: "skills", label: "Skills", hasExternalBadge: true },
          { id: "trusted-domains", label: "Trusted Domains" },
        ],
      },
      { id: "terminal", label: "Terminal" },
      { id: "database", label: "Database" },
      { id: "diagrams", label: "Diagrams" },
    ],
  },
];

interface AIAgentItem {
  id: string;
  name: string;
  version: string;
  badge?: string;
  description: string;
  author: string;
  authorLink?: string;
  installed: boolean;
  isCore?: boolean;
}

const INITIAL_AGENTS: AIAgentItem[] = [
  {
    id: "claude-agent",
    name: "Claude Agent",
    version: "v0.73.0",
    badge: "Bundled",
    description: "ACP wrapper for Anthropic's Claude",
    author: "Anthropic +2",
    installed: true,
  },
  {
    id: "codex",
    name: "Codex",
    version: "v1.8.0",
    badge: "Bundled",
    description: "ACP adapter for OpenAI's coding assistant",
    author: "OpenAI +2",
    installed: true,
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    version: "v1.538.0",
    badge: "Bundled",
    description: "GitHub's AI pair programmer",
    author: "GitHub",
    installed: true,
  },
  {
    id: "junie",
    name: "Junie",
    version: "v3123.3.0",
    badge: "Bundled",
    description: "AI Coding Agent by JetBrains",
    author: "JetBrains",
    installed: true,
  },
  {
    id: "agoragentic",
    name: "Agoragentic",
    version: "v1.3.0",
    description:
      "Agent marketplace with 174+ AI capabilities. Browse, invoke, and parse multi-agent pipelines.",
    author: "ACRE / Agoragentic",
    installed: false,
  },
  {
    id: "amp",
    name: "Amp",
    version: "v0.9.0",
    description: "ACP wrapper for Amp - the frontier coding agent",
    author: "tao12345666333",
    installed: false,
  },
  {
    id: "auggie",
    name: "Auggie CLI",
    version: "v0.36.0",
    description:
      "Augment Code's powerful software agent, backed by industry-leading semantic retrieval.",
    author: "Augment Code <support@augmentcode.com>",
    installed: false,
  },
  {
    id: "deterministic-ast",
    name: "Offline AST Engine",
    version: "v2.4.0",
    badge: "Core",
    description:
      "Built-in offline syntax synthesizer & structural diff planner. Zero network latency.",
    author: "ACSA Code Core",
    installed: true,
    isCore: true,
  },
];

function resolveInitialSection(tab?: string): string {
  if (tab === "appearance") return "appearance";
  if (tab === "ai") return "providers";
  if (tab) return tab;
  return "agents";
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  themeId = "vs-dark",
  onApplyTheme,
  initialTab = "agents",
  projectName = "Practice",
}: SettingsModalProps) {
  // Safe settings fallback to avoid undefined access crashes
  const currentSettings = settings || {
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    apiKey: "",
    baseUrl: "http://127.0.0.1:11434",
  };

  // Navigation & Category Selection
  const [selectedSection, setSelectedSection] = useState<string>(() =>
    resolveInitialSection(initialTab)
  );
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    "appearance-group": true,
    "editor-group": true,
    "tools-group": true,
    "ai-assistant-group": true,
  });
  const [navSearch, setNavSearch] = useState("");
  const [history, setHistory] = useState<string[]>(() => [
    resolveInitialSection(initialTab),
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // AI Settings State
  const [provider, setProvider] = useState<AISettings["provider"]>(
    currentSettings.provider === "deterministic" ? "ollama" : (currentSettings.provider || "ollama")
  );
  const [model, setModel] = useState(currentSettings.model || "");
  const [apiKey, setApiKey] = useState(currentSettings.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(currentSettings.baseUrl || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  // Editor Settings State
  const [fontSize, setFontSize] = useState<number>(13);
  const [lineHeight, setLineHeight] = useState<number>(1.5);
  const [enableLigatures, setEnableLigatures] = useState(true);
  const [tabSize, setTabSize] = useState<number>(2);
  const [insertSpaces, setInsertSpaces] = useState(true);
  const [formatOnSave, setFormatOnSave] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);

  // Agents & MCP state
  const [agents, setAgents] = useState<AIAgentItem[]>(INITIAL_AGENTS);
  const [agentSearch, setAgentSearch] = useState("");
  const [passCustomMcp, setPassCustomMcp] = useState(true);
  const [mcpMode, setMcpMode] = useState("On demand");

  // Terminal state
  const [shellPath, setShellPath] = useState("/bin/zsh");
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [copyOnSelect, setCopyOnSelect] = useState(true);
  const [gitExecutablePath, setGitExecutablePath] = useState("git");
  const [gitDefaultBranch, setGitDefaultBranch] = useState("main");

  // Tree filter logic (unconditional hook)
  const filteredTree = useMemo(() => {
    if (!navSearch?.trim()) return SETTINGS_TREE;
    const query = navSearch.toLowerCase();

    const matchNode = (node: TreeNode): TreeNode | null => {
      const matchLabel = (node.label || "").toLowerCase().includes(query);
      if (node.children) {
        const filteredChildren = node.children
          .map(matchNode)
          .filter(Boolean) as TreeNode[];
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
      }
      return matchLabel ? node : null;
    };

    return (SETTINGS_TREE || []).map(matchNode).filter(Boolean) as TreeNode[];
  }, [navSearch]);

  // Sync with initial props
  useEffect(() => {
    if (!isOpen) return;

    const target = resolveInitialSection(initialTab);
    setSelectedSection(target);
    setHistory([target]);
    setHistoryIndex(0);

    const safeSettings = settings || {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      apiKey: "",
      baseUrl: "http://127.0.0.1:11434",
    };
    setProvider(safeSettings.provider === "deterministic" ? "ollama" : (safeSettings.provider || "ollama"));
    setModel(safeSettings.model || "");
    setApiKey(safeSettings.apiKey || "");
    setBaseUrl(safeSettings.baseUrl || "");
    setFontSize(safeSettings.fontSize ?? 13);
    setLineHeight(safeSettings.lineHeight ?? 1.5);
    setEnableLigatures(safeSettings.enableLigatures ?? true);
    setTabSize(safeSettings.tabSize ?? 2);
    setInsertSpaces(safeSettings.insertSpaces ?? true);
    setFormatOnSave(safeSettings.formatOnSave ?? true);
    setWordWrap(safeSettings.wordWrap ?? false);
    setShellPath(safeSettings.shellPath || "/bin/zsh");
    setTerminalFontSize(safeSettings.terminalFontSize ?? 13);
    setCopyOnSelect(safeSettings.copyOnSelect ?? true);
    setGitExecutablePath(safeSettings.gitExecutablePath || "git");
    setGitDefaultBranch(safeSettings.gitDefaultBranch || "main");
    setTestStatus("idle");
    setTestMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTab]);

  const navigateTo = (sectionId: string) => {
    setSelectedSection(sectionId);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(sectionId);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setSelectedSection(history[historyIndex - 1]);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setSelectedSection(history[historyIndex + 1]);
    }
  };

  const toggleNode = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");

    try {
      const targetUrl =
        provider === "ollama"
          ? (baseUrl || "http://127.0.0.1:11434") + "/api/tags"
          : provider === "local"
          ? (baseUrl || "http://127.0.0.1:8080") + "/health"
          : (baseUrl || "https://api.openai.com/v1") + "/models";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(targetUrl, { method: "GET", headers });
      if (res.ok) {
        setTestStatus("success");
        setTestMessage(`Connection verified! Server responded with HTTP ${res.status}`);
      } else {
        setTestStatus("error");
        setTestMessage(`Server returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestMessage(`Connection failed: ${err.message || String(err)}`);
    }
  };

  const handleApply = () => {
    if (onSave) {
      onSave({
        provider: provider || "ollama",
        model: model || "",
        apiKey: apiKey || "",
        baseUrl: baseUrl || "",
        fontSize,
        lineHeight,
        enableLigatures,
        tabSize,
        insertSpaces,
        formatOnSave,
        wordWrap,
        shellPath,
        terminalFontSize,
        copyOnSelect,
        gitExecutablePath,
        gitDefaultBranch,
      });
    }
  };

  const handleOk = () => {
    if (onSave) {
      onSave({
        provider: provider || "ollama",
        model: model || "",
        apiKey: apiKey || "",
        baseUrl: baseUrl || "",
        fontSize,
        lineHeight,
        enableLigatures,
        tabSize,
        insertSpaces,
        formatOnSave,
        wordWrap,
        shellPath,
        terminalFontSize,
        copyOnSelect,
        gitExecutablePath,
        gitDefaultBranch,
      });
    }
    if (onClose) {
      onClose();
    }
  };

  const toggleAgent = (agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, installed: !a.installed } : a))
    );
  };

  // Breadcrumb path computation
  const getBreadcrumb = (): string[] => {
    switch (selectedSection) {
      case "agents":
        return ["Tools", "AI Assistant", "Agents"];
      case "providers":
        return ["Tools", "AI Assistant", "Providers & API keys"];
      case "mcp":
        return ["Tools", "AI Assistant", "Model Context Protocol (MCP)"];
      case "prompt-library":
        return ["Tools", "AI Assistant", "Prompt Library"];
      case "rules":
        return ["Tools", "AI Assistant", "Rules"];
      case "skills":
        return ["Tools", "AI Assistant", "Skills"];
      case "appearance":
        return ["Appearance & Behavior", "Appearance"];
      case "system-settings":
        return ["Appearance & Behavior", "System Settings"];
      case "editor-font":
        return ["Editor", "Font"];
      case "editor-code-style":
        return ["Editor", "Code Style"];
      case "editor-general":
        return ["Editor", "General"];
      case "plugins":
        return ["Plugins"];
      case "git":
        return ["Version Control", "Git"];
      case "terminal":
        return ["Tools", "Terminal"];
      case "keymap":
        return ["Keymap"];
      default:
        return ["Settings", (selectedSection || "General").replace(/-/g, " ")];
    }
  };

  const breadcrumb = getBreadcrumb() || ["Settings", "General"];

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-[2px] p-4 select-none animate-in fade-in duration-100 font-sans cursor-default"
    >
      {/* Outer Window Frame with Apple Obsidian Glass & Specular Hairlines */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[960px] h-[640px] max-w-[96vw] max-h-[92vh] rounded-modal bg-modal/95 backdrop-blur-xl border border-hairline shadow-elevation-3 overflow-hidden flex flex-col text-zinc-300 relative"
      >
        {/* ── macOS Traffic Light Header Bar ───────────────────────────────── */}
        <div className="h-10 bg-workbench/90 border-b border-hairline px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {/* macOS Window Controls */}
            <button
              type="button"
              onClick={onClose}
              className="w-3 h-3 rounded-full bg-[#ED6A5E] hover:opacity-80 transition cursor-pointer border border-[#D15146]"
              title="Close"
            />
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#F4BF4F] hover:opacity-80 transition border border-[#D7A23A]"
              title="Minimize"
            />
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#61C554] hover:opacity-80 transition border border-[#4EA843]"
              title="Zoom"
            />
          </div>

          <div className="text-[13px] font-medium text-zinc-200 font-sans tracking-tight">
            Settings – {projectName}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-100 rounded-md hover:bg-surface-hover transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Main Two-Column Stage ────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden font-sans">
          {/* Left Column: Navigation Category Tree */}
          <aside className="w-[260px] bg-workbench/80 border-r border-hairline flex flex-col shrink-0">
            {/* Search Settings Input */}
            <div className="p-2.5 border-b border-hairline">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-2.5 text-zinc-400" />
                <input
                  type="text"
                  value={navSearch}
                  onChange={(e) => setNavSearch(e.target.value)}
                  placeholder="Search settings..."
                  className="w-full bg-surface border border-hairline rounded-md pl-8 pr-2.5 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500/60 font-sans"
                />
                {navSearch && (
                  <button
                    type="button"
                    onClick={() => setNavSearch("")}
                    className="absolute right-2 text-zinc-400 hover:text-zinc-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Tree Navigation List */}
            <div className="flex-1 overflow-y-auto py-2 text-xs">
              {filteredTree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedSection={selectedSection}
                  expandedNodes={expandedNodes}
                  onToggleNode={toggleNode}
                  onSelectSection={navigateTo}
                  level={0}
                />
              ))}
            </div>
          </aside>

          {/* Right Column: Configuration Stage */}
          <main className="flex-1 min-w-0 bg-canvas/70 flex flex-col h-full overflow-hidden">
            {/* Stage Top Breadcrumbs Header */}
            <div className="h-10 px-5 border-b border-hairline flex items-center justify-between shrink-0 bg-workbench/40">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-sans">
                {breadcrumb.map((crumb, idx) => (
                  <React.Fragment key={crumb}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                    <span
                      className={
                        idx === breadcrumb.length - 1
                          ? "text-zinc-100 font-semibold"
                          : "text-zinc-400"
                      }
                    >
                      {crumb}
                    </span>
                  </React.Fragment>
                ))}
              </div>

              {/* Top Navigation History / Pin Controls */}
              <div className="flex items-center gap-1 text-zinc-400">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={historyIndex <= 0}
                  className="p-1 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-500 rounded transition"
                  title="Back"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleForward}
                  disabled={historyIndex >= history.length - 1}
                  className="p-1 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-500 rounded transition"
                  title="Forward"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <div className="h-3 w-[1px] bg-zinc-700/60 mx-1" />
                <button
                  type="button"
                  className="p-1 hover:text-zinc-100 rounded transition"
                  title="Pin"
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Stage Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 text-[13px] text-zinc-200 font-sans">
              {/* ── SECTION: AGENTS (media_1788523057455.png reference) ───────── */}
              {selectedSection === "agents" && (
                <div className="space-y-4 max-w-2xl">
                  {/* Agent Search Filter */}
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 absolute left-3 text-zinc-400" />
                    <input
                      type="text"
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      placeholder="Search agents..."
                      className="w-full bg-surface border border-hairline rounded-md pl-8 pr-3 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-sans"
                    />
                  </div>

                  {/* Agents List */}
                  <div className="divide-y divide-hairline border border-hairline rounded-lg bg-surface/50 overflow-hidden">
                    {agents
                      .filter(
                        (a) =>
                           !agentSearch.trim() ||
                          a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
                          a.description.toLowerCase().includes(agentSearch.toLowerCase())
                      )
                      .map((agent) => (
                        <div
                          key={agent.id}
                          className="p-3 flex items-start gap-3 hover:bg-surface-hover transition-colors"
                        >
                          {/* Agent Avatar / Icon */}
                          <div className="w-8 h-8 rounded-lg bg-workbench border border-hairline flex items-center justify-center shrink-0 mt-0.5 text-sky-400">
                            {agent.id.includes("claude") ? (
                              <Bot className="w-4 h-4 text-amber-400" />
                            ) : agent.id.includes("codex") ? (
                              <Bot className="w-4 h-4 text-emerald-400" />
                            ) : agent.id.includes("copilot") ? (
                              <Zap className="w-4 h-4 text-purple-400" />
                            ) : agent.id.includes("junie") ? (
                              <Bot className="w-4 h-4 text-sky-400" />
                            ) : agent.id.includes("deterministic") ? (
                              <Cpu className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <Layers className="w-4 h-4 text-zinc-400" />
                            )}
                          </div>

                          {/* Agent Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[13px] text-zinc-100">
                                {agent.name}
                              </span>
                              <span className="text-[11px] text-zinc-400 font-mono">
                                {agent.version}
                              </span>
                              {agent.badge && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-800 text-zinc-300 font-mono border border-hairline">
                                  {agent.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5 leading-normal">
                              {agent.description}
                            </p>
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 mt-1 cursor-pointer">
                              <span>{agent.author}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </div>
                          </div>

                          {/* Agent Action Button */}
                          <div className="shrink-0">
                            {agent.isCore ? (
                              <span className="px-3 py-1 rounded text-[11px] bg-sky-500/15 text-sky-300 font-medium border border-sky-500/30">
                                Active
                              </span>
                            ) : agent.installed ? (
                              <button
                                type="button"
                                onClick={() => toggleAgent(agent.id)}
                                className="px-3 py-1 rounded text-[11px] bg-surface hover:bg-surface-hover text-zinc-200 border border-hairline transition font-medium cursor-pointer"
                              >
                                Uninstall
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleAgent(agent.id)}
                                className="px-3 py-1 rounded text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition cursor-pointer shadow-sm"
                              >
                                Install
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Bottom Controls (Checked in IntelliJ screenshot) */}
                  <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs border-t border-hairline">
                    <label className="flex items-center gap-2 cursor-pointer text-zinc-200">
                      <input
                        type="checkbox"
                        checked={passCustomMcp}
                        onChange={(e) => setPassCustomMcp(e.target.checked)}
                        className="rounded border-zinc-700 bg-surface text-sky-500 focus:ring-0"
                      />
                      <span>Pass custom MCP servers</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400">Pass IntelliJ MCP server</span>
                      <select
                        value={mcpMode}
                        onChange={(e) => setMcpMode(e.target.value)}
                        className="bg-surface border border-hairline rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-sky-500"
                      >
                        <option value="On demand">On demand</option>
                        <option value="Always">Always</option>
                        <option value="Disabled">Disabled</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: PROVIDERS & API KEYS ────────────────────────────── */}
              {selectedSection === "providers" && (
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      LLM Provider & Engine Configuration
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Configure local or cloud inference engines for code generation, diff synthesis, and chat.
                    </p>
                  </div>

                  {/* Provider Selection Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* Local Ollama */}
                    <div
                      onClick={() => setProvider("ollama")}
                      className={`p-3 rounded-card border cursor-pointer transition ${
                        provider === "ollama"
                          ? "bg-sky-500/15 border-sky-500/50 text-zinc-100 ring-1 ring-sky-500/40 shadow-sm"
                          : "bg-surface border-hairline hover:border-zinc-700 hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ProviderLogo providerId="ollama" className="w-4 h-4" />
                        <span className="font-semibold text-xs text-zinc-100">
                          Local Ollama
                        </span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-400/20 text-amber-300 font-bold">
                          Default
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-tight">
                        Connects to local daemon (Qwen 2.5 Coder, Llama 3.2, DeepSeek).
                      </p>
                    </div>

                    {/* Local llama.cpp Sidecar */}
                    <div
                      onClick={() => setProvider("local")}
                      className={`p-3 rounded-card border cursor-pointer transition ${
                        provider === "local"
                          ? "bg-sky-500/15 border-sky-500/50 text-zinc-100 ring-1 ring-sky-500/40 shadow-sm"
                          : "bg-surface border-hairline hover:border-zinc-700 hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ProviderLogo providerId="llamacpp" className="w-4 h-4" />
                        <span className="font-semibold text-xs text-zinc-100">
                          llama.cpp / LM Studio
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-tight">
                        Hardware-accelerated GGUF local inference server on port 8080.
                      </p>
                    </div>

                    {/* Cloud OpenAI / Anthropic */}
                    <div
                      onClick={() => setProvider("openai")}
                      className={`p-3 rounded-card border cursor-pointer transition ${
                        provider === "openai"
                          ? "bg-sky-500/15 border-sky-500/50 text-zinc-100 ring-1 ring-sky-500/40 shadow-sm"
                          : "bg-surface border-hairline hover:border-zinc-700 hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ProviderLogo providerId="openai" className="w-4 h-4" />
                        <span className="font-semibold text-xs text-zinc-100">
                          Cloud APIs
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-tight">
                        GPT-4o, Claude 3.7 Sonnet, Google Gemini, DeepSeek Cloud.
                      </p>
                    </div>
                  </div>

                  {/* Provider Settings Details */}
                  <div className="space-y-3.5 pt-2 border-t border-hairline">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Model Identifier
                      </label>
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={
                          provider === "ollama"
                            ? "e.g. qwen2.5-coder:7b"
                            : provider === "local"
                            ? "e.g. qwen2.5-coder-7b-instruct.gguf"
                            : "e.g. gpt-4o, claude-3-7-sonnet"
                        }
                        className="w-full bg-workbench/60 border border-hairline rounded-[8px] px-3 py-1.5 text-xs text-zinc-100 font-mono focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder={
                          provider === "ollama"
                            ? "http://127.0.0.1:11434"
                            : provider === "local"
                            ? "http://127.0.0.1:8080"
                            : "https://api.openai.com/v1"
                        }
                        className="w-full bg-workbench/60 border border-hairline rounded-[8px] px-3 py-1.5 text-xs text-zinc-100 font-mono focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 focus:outline-none"
                      />
                    </div>

                    {provider === "openai" && (
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-zinc-200">
                          API Key
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type={showApiKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-workbench/60 border border-hairline rounded-[8px] px-3 py-1.5 pr-8 text-xs text-zinc-100 font-mono focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2.5 text-zinc-400 hover:text-zinc-200"
                          >
                            {showApiKey ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Test Connection Button */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testStatus === "testing"}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-surface hover:bg-surface-hover text-zinc-200 text-xs font-medium transition border border-hairline shadow-elevation-1"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            testStatus === "testing" ? "animate-spin text-sky-400" : ""
                          }`}
                        />
                        <span>Test Connection</span>
                      </button>

                      {testStatus === "success" && (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{testMessage}</span>
                        </span>
                      )}

                      {testStatus === "error" && (
                        <span className="flex items-center gap-1 text-rose-400 text-xs">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>{testMessage}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: MODEL CONTEXT PROTOCOL (MCP) ─────────────────────── */}
              {selectedSection === "mcp" && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Model Context Protocol (MCP) Servers
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Standardized bridges providing AI agents secure access to local tools, databases, and filesystem.
                    </p>
                  </div>

                  <div className="border border-hairline rounded-panel bg-surface/50 overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-hairline bg-workbench/60 text-zinc-400">
                          <th className="p-2.5 font-medium">Server Name</th>
                          <th className="p-2.5 font-medium">Transport</th>
                          <th className="p-2.5 font-medium">Command / Spec</th>
                          <th className="p-2.5 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        <tr>
                          <td className="p-2.5 font-semibold text-zinc-100">Filesystem</td>
                          <td className="p-2.5 text-zinc-400">stdio</td>
                          <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                            npx @modelcontextprotocol/server-filesystem
                          </td>
                          <td className="p-2.5 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                              Connected
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold text-zinc-100">Git Engine</td>
                          <td className="p-2.5 text-zinc-400">stdio</td>
                          <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                            npx @modelcontextprotocol/server-git
                          </td>
                          <td className="p-2.5 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                              Connected
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold text-zinc-100">Web Fetch</td>
                          <td className="p-2.5 text-zinc-400">stdio</td>
                          <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                            npx @modelcontextprotocol/server-fetch
                          </td>
                          <td className="p-2.5 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-sky-950/60 text-sky-400 border border-sky-800/40">
                              Active
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold text-zinc-100">Memory Graph</td>
                          <td className="p-2.5 text-zinc-400">stdio</td>
                          <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                            npx @modelcontextprotocol/server-memory
                          </td>
                          <td className="p-2.5 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-800/80 text-zinc-400 border border-hairline">
                              Idle
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── SECTION: APPEARANCE & THEMES ─────────────────────────────── */}
              {selectedSection === "appearance" && (
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      UI Theme & Workbench Appearance
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Select your preferred IDE theme. Changes take effect across editor, sidebars, tabs, and status bar immediately.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {Object.values(PRESET_THEMES).map((theme) => {
                      const isCurrent = themeId === theme.id;
                      return (
                        <div
                          key={theme.id}
                          onClick={() => onApplyTheme && onApplyTheme(theme.id)}
                          className={`p-3 rounded-card border cursor-pointer transition flex flex-col justify-between ${
                            isCurrent
                              ? "bg-sky-500/15 border-sky-500/50 ring-1 ring-sky-500/40 shadow-sm"
                              : "bg-surface border-hairline hover:border-zinc-700 hover:bg-surface-hover"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-xs text-zinc-100">
                              {theme.name}
                            </span>
                            {isCurrent && (
                              <span className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center text-white">
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </span>
                            )}
                          </div>

                          {/* Theme Swatches */}
                          <div className="flex items-center gap-1.5 p-2 rounded-md bg-workbench border border-hairline">
                            <span
                              className="w-4 h-4 rounded border border-white/10"
                              style={{ backgroundColor: theme.colors.background }}
                              title={`Editor: ${theme.colors.background}`}
                            />
                            <span
                              className="w-4 h-4 rounded border border-white/10"
                              style={{ backgroundColor: theme.colors.sidebarBg }}
                              title={`Sidebar: ${theme.colors.sidebarBg}`}
                            />
                            <span
                              className="w-4 h-4 rounded border border-white/10"
                              style={{ backgroundColor: theme.colors.accent }}
                              title={`Accent: ${theme.colors.accent}`}
                            />
                            <span
                              className="w-4 h-4 rounded border border-white/10"
                              style={{ backgroundColor: theme.colors.statusBarBg }}
                              title={`Status Bar: ${theme.colors.statusBarBg}`}
                            />
                            <span className="text-[10px] font-mono text-zinc-400 ml-auto capitalize">
                              {theme.type}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── SECTION: EDITOR > FONT ───────────────────────────────────── */}
              {selectedSection === "editor-font" && (
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Editor Typography & Font
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Configure typography for code editors and diff viewers. JetBrains Mono is the bundled default across all surfaces.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Font Family
                      </label>
                      <select
                        value="JetBrains Mono"
                        disabled
                        className="w-full rounded-[8px] bg-workbench/60 border border-hairline px-3 py-1.5 text-xs text-zinc-200 font-mono cursor-not-allowed opacity-90"
                      >
                        <option value="JetBrains Mono">JetBrains Mono (Bundled Default)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Font Size: {fontSize}px
                      </label>
                      <input
                        type="range"
                        min={11}
                        max={20}
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="w-full accent-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Line Spacing: {lineHeight}
                      </label>
                      <input
                        type="range"
                        min={1.2}
                        max={2.0}
                        step={0.1}
                        value={lineHeight}
                        onChange={(e) => setLineHeight(Number(e.target.value))}
                        className="w-full accent-sky-500"
                      />
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 cursor-pointer text-zinc-200">
                        <input
                          type="checkbox"
                          checked={enableLigatures}
                          onChange={(e) => setEnableLigatures(e.target.checked)}
                          className="rounded border-hairline text-sky-500 focus:ring-0"
                        />
                        <span>Enable font ligatures (==, !=, =&gt;)</span>
                      </label>
                    </div>
                  </div>

                  {/* Live JetBrains Mono Code Preview Box */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-medium text-zinc-400">
                      Live Font Preview
                    </label>
                    <div
                      className="rounded-panel bg-workbench/80 border border-hairline p-4 font-mono text-zinc-100 overflow-x-auto shadow-elevation-1"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: `${fontSize}px`,
                        lineHeight: lineHeight,
                        fontVariantLigatures: enableLigatures ? "normal" : "none",
                      }}
                    >
                      <div className="text-zinc-500">// JetBrains Mono font sample with ligatures:</div>
                      <div>
                        <span className="text-purple-400">export function</span>{" "}
                        <span className="text-sky-400">evaluateMetric</span>(
                        <span className="text-amber-300">items</span>: Item[]):{" "}
                        <span className="text-teal-400">boolean</span> &#123;
                      </div>
                      <div className="pl-4">
                        <span className="text-purple-400">const</span> isClean = items.length !=={" "}
                        <span className="text-amber-300">0</span> &amp;&amp; items[0].score &gt;={" "}
                        <span className="text-amber-300">95</span>;
                      </div>
                      <div className="pl-4">
                        <span className="text-purple-400">return</span> isClean ==={" "}
                        <span className="text-emerald-400">true</span> ? items.every(i =&gt; i.valid) :{" "}
                        <span className="text-red-400">false</span>;
                      </div>
                      <div>&#125;</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: EDITOR > CODE STYLE ─────────────────────────────── */}
              {selectedSection === "editor-code-style" && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Editor Indentation & Code Style
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Configure tab size, spaces vs tabs, and auto-formatting behavior.
                    </p>
                  </div>

                  <div className="space-y-3 bg-surface border border-hairline rounded-panel p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200">Tab Size</span>
                      <select
                        value={tabSize}
                        onChange={(e) => setTabSize(Number(e.target.value))}
                        className="bg-workbench/80 border border-hairline rounded-[6px] px-2.5 py-1 text-xs text-zinc-200"
                      >
                        <option value={2}>2 spaces</option>
                        <option value={4}>4 spaces</option>
                        <option value={8}>8 spaces</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between border-t border-hairline pt-3">
                      <span className="text-zinc-200">Insert Spaces</span>
                      <input
                        type="checkbox"
                        checked={insertSpaces}
                        onChange={(e) => setInsertSpaces(e.target.checked)}
                        className="rounded border-hairline text-sky-500 focus:ring-0"
                      />
                    </div>

                    <div className="flex items-center justify-between border-t border-hairline pt-3">
                      <span className="text-zinc-200">Format On Save</span>
                      <input
                        type="checkbox"
                        checked={formatOnSave}
                        onChange={(e) => setFormatOnSave(e.target.checked)}
                        className="rounded border-hairline text-sky-500 focus:ring-0"
                      />
                    </div>

                    <div className="flex items-center justify-between border-t border-hairline pt-3">
                      <span className="text-zinc-200">Word Wrap in Editor</span>
                      <input
                        type="checkbox"
                        checked={wordWrap}
                        onChange={(e) => setWordWrap(e.target.checked)}
                        className="rounded border-hairline text-sky-500 focus:ring-0"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: TERMINAL ────────────────────────────────────────── */}
              {selectedSection === "terminal" && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Integrated Terminal Settings
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Configure shell binary path, terminal font, and selection behaviors.
                    </p>
                  </div>

                  <div className="space-y-3 bg-surface border border-hairline rounded-panel p-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Shell Path
                      </label>
                      <input
                        type="text"
                        value={shellPath}
                        onChange={(e) => setShellPath(e.target.value)}
                        placeholder="/bin/zsh"
                        className="w-full rounded-[8px] bg-workbench/80 border border-hairline px-3 py-1.5 text-xs text-zinc-200 font-mono focus:border-sky-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between border-t border-hairline pt-3">
                      <span className="text-zinc-200">Terminal Font Size</span>
                      <select
                        value={terminalFontSize}
                        onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                        className="bg-workbench/80 border border-hairline rounded-[6px] px-2.5 py-1 text-xs text-zinc-200"
                      >
                        <option value={12}>12px</option>
                        <option value={13}>13px (Default)</option>
                        <option value={14}>14px</option>
                        <option value={15}>15px</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between border-t border-hairline pt-3">
                      <span className="text-zinc-200">Copy On Select</span>
                      <input
                        type="checkbox"
                        checked={copyOnSelect}
                        onChange={(e) => setCopyOnSelect(e.target.checked)}
                        className="rounded border-hairline text-sky-500 focus:ring-0"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: GIT & VERSION CONTROL ───────────────────────────── */}
              {selectedSection === "git" && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Version Control & Git
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Git binary configuration and workspace synchronization options.
                    </p>
                  </div>

                  <div className="space-y-3 bg-surface border border-hairline rounded-panel p-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Git Executable Path
                      </label>
                      <input
                        type="text"
                        value={gitExecutablePath}
                        onChange={(e) => setGitExecutablePath(e.target.value)}
                        className="w-full rounded-[8px] bg-workbench/80 border border-hairline px-3 py-1.5 text-xs text-zinc-200 font-mono focus:border-sky-500 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-200">
                        Default Branch Name
                      </label>
                      <input
                        type="text"
                        value={gitDefaultBranch}
                        onChange={(e) => setGitDefaultBranch(e.target.value)}
                        className="w-full rounded-[8px] bg-workbench/80 border border-hairline px-3 py-1.5 text-xs text-zinc-200 font-mono focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: PLUGINS ─────────────────────────────────────────── */}
              {selectedSection === "plugins" && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Plugins & Extensions Marketplace
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Manage installed tools, language servers, and theme packs.
                    </p>
                  </div>

                  <div className="divide-y divide-hairline border border-hairline rounded-panel bg-surface overflow-hidden">
                    {[
                      {
                        name: "TypeScript and JavaScript Language Features",
                        author: "ACSA Code",
                        version: "v1.96.0",
                        status: "Installed",
                      },
                      {
                        name: "Tailwind CSS IntelliSense",
                        author: "Tailwind Labs",
                        version: "v0.12.7",
                        status: "Installed",
                      },
                      {
                        name: "Python & Pylance Language Server",
                        author: "Microsoft",
                        version: "v2024.18.0",
                        status: "Installed",
                      },
                    ].map((p) => (
                      <div key={p.name} className="p-3 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-xs text-zinc-100">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {p.author} • {p.version}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-surface-active text-zinc-300 font-medium border border-hairline">
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fallback for other category sections */}
              {![
                "agents",
                "providers",
                "mcp",
                "appearance",
                "editor-font",
                "editor-code-style",
                "terminal",
                "git",
                "plugins",
              ].includes(selectedSection) && (
                <div className="py-10 text-center text-zinc-400 space-y-2">
                  <div className="w-10 h-10 rounded-full bg-surface border border-hairline flex items-center justify-center mx-auto text-zinc-400">
                    <Settings className="w-5 h-5" />
                  </div>
                  <h4 className="font-semibold text-sm text-zinc-200">
                    {(selectedSection || "General").replace(/-/g, " ").toUpperCase()}
                  </h4>
                  <p className="text-xs max-w-sm mx-auto">
                    Preferences for this section are loaded and active with default IDE settings.
                  </p>
                </div>
              )}
            </div>

            {/* ── Dialog Action Footer Bar ──────────────────────────────────── */}
            <div className="h-12 bg-workbench/90 border-t border-hairline px-5 flex items-center justify-between shrink-0">
              {/* Left Help Button */}
              <button
                type="button"
                className="w-7 h-7 rounded-full bg-surface hover:bg-surface-hover border border-hairline flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition shadow-elevation-1"
                title="Help"
              >
                <HelpCircle className="w-4 h-4" />
              </button>

              {/* Right Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-[8px] bg-surface hover:bg-surface-hover text-zinc-200 text-[13px] font-medium border border-hairline transition cursor-pointer font-sans shadow-elevation-1"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleApply}
                  className="px-4 py-1.5 rounded-[8px] bg-surface hover:bg-surface-hover text-zinc-200 text-[13px] font-medium border border-hairline transition cursor-pointer font-sans shadow-elevation-1"
                >
                  Apply
                </button>

                <button
                  type="button"
                  onClick={handleOk}
                  className="px-5 py-1.5 rounded-[8px] bg-sky-600 hover:bg-sky-500 text-white text-[13px] font-semibold shadow-elevation-1 transition cursor-pointer font-sans"
                >
                  OK
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  selectedSection: string;
  expandedNodes: Record<string, boolean>;
  onToggleNode: (id: string, e: React.MouseEvent) => void;
  onSelectSection: (id: string) => void;
  level: number;
}

function TreeItem({
  node,
  selectedSection,
  expandedNodes,
  onToggleNode,
  onSelectSection,
  level,
}: TreeItemProps) {
  if (!node) return null;
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = Boolean(expandedNodes?.[node.id]);
  const isSelected = selectedSection === node.id;

  const handleClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      onToggleNode(node.id, e);
    } else {
      onSelectSection(node.id);
    }
  };

  return (
    <div className="px-1.5 py-0.5">
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${6 + level * 14}px` }}
        className={`px-2 py-1.5 rounded-[8px] flex items-center justify-between cursor-pointer transition-colors group ${
          isSelected
            ? "bg-sky-500/15 border border-sky-500/30 text-white font-medium shadow-sm"
            : "hover:bg-surface-hover text-zinc-300 hover:text-zinc-100"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 font-sans">
          {hasChildren ? (
            <span
              onClick={(e) => onToggleNode(node.id, e)}
              className="w-3.5 h-3.5 flex items-center justify-center text-zinc-400 hover:text-zinc-200"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
          ) : (
            <span className="w-3.5 h-3.5" />
          )}

          <span className="truncate text-[13px]">{node.label}</span>
        </div>

        {node.hasExternalBadge && (
          <span className="w-2.5 h-2.5 rounded-sm border border-hairline text-zinc-400 group-hover:text-zinc-200 flex items-center justify-center text-[8px] opacity-70">
            ▫
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              selectedSection={selectedSection}
              expandedNodes={expandedNodes}
              onToggleNode={onToggleNode}
              onSelectSection={onSelectSection}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SettingsModal;
