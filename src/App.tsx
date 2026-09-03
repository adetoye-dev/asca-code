/**
 * App.tsx — Autonomous Development Environment Desktop IDE
 *
 * Full developer-grade IDE layout integrating:
 * 1. Titlebar: Native OS folder selector, "+ New Project" physical directory scaffolder, AI engine settings, host telemetry.
 * 2. Activity Bar: Left icon strip toggling Explorer and Agent panels.
 * 3. File Explorer: Recursive project tree with file creation, deletion, and physical path tracking.
 * 4. Main Stage: Multi-tab code editor with line numbers and unified diff inspector.
 * 5. Autonomous Agent Dock: Compact prompt steering with architectural sliders.
 * 6. Gauntlet Drawer: Collapsible bottom console streaming live linter, test, and sandbox logs.
 */

import { useState } from "react";
import {
  FolderCode,
  FolderPlus,
  FolderOpen,
  Play,
  GitCompare,
  Code2,
  Sliders,
  Cpu,
  Flame,
  FileCheck2,
  Settings,
  Sparkles,
} from "lucide-react";
import { usePipeline } from "./hooks/usePipeline";
import { FileTree } from "./components/FileTree";
import { CodeEditor } from "./components/CodeEditor";
import { DiffViewer } from "./components/DiffViewer";
import { ProjectModal } from "./components/ProjectModal";
import { SettingsModal } from "./components/SettingsModal";
import { GauntletDrawer } from "./components/GauntletDrawer";
import { TradeOffSliders } from "./components/TradeOffSliders";

const PRESETS = [
  "Add rate-limiting middleware using token bucket",
  "Implement transactional inventory checkout with rollback",
  "Add JWT bearer authentication with TTL caching",
];

export function App() {
  const {
    activeProject,
    projectFiles,
    openTabs,
    activeTabPath,
    currentDiff,
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
  } = usePipeline();

  const [showExplorer, setShowExplorer] = useState(true);
  const [showAgentDock, setShowAgentDock] = useState(true);

  const isRunning = status === "running";

  const handleOpenFolder = async () => {
    const picked = await pickFolder();
    if (picked) {
      await openFolder(picked);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 select-none">
      {/* ── Top IDE Titlebar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-11 border-b border-zinc-800 bg-zinc-900/90 shrink-0 text-xs">
        {/* Brand & Project Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center font-black text-white text-xs shadow-md">
              A
            </div>
            <span className="font-bold tracking-tight text-zinc-200">
              AUTONOMOUS IDE
            </span>
          </div>

          <div className="w-px h-4 bg-zinc-800" />

          {/* Active Project Dropdown, Open Folder, & Scaffold */}
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 font-medium max-w-[200px]"
              title={activeProject.path}
            >
              <FolderCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">{activeProject.name}</span>
            </div>

            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-750 border border-zinc-700/50 text-zinc-300 hover:text-white transition-colors"
              title="Open any local directory on disk"
            >
              <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
              <span>Open Folder...</span>
            </button>

            <button
              type="button"
              onClick={() => setIsProjectModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-750 border border-zinc-700/50 text-zinc-300 hover:text-white transition-colors"
              title="Create new project on disk"
            >
              <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>New Project</span>
            </button>
          </div>
        </div>

        {/* Center Stage Switcher: Code Editor vs Micro-Diff */}
        <div className="flex items-center p-0.5 rounded-lg bg-zinc-950 border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveCenterView("editor")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeCenterView === "editor"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Code Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCenterView("diff")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeCenterView === "diff"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <GitCompare className="w-3.5 h-3.5 text-purple-400" />
            <span>Micro-Diff Inspector</span>
            {currentDiff && (
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Right Hardware Telemetry & AI Settings */}
        <div className="flex items-center gap-2.5">
          {/* AI Provider Button */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-750 border border-zinc-700/70 text-zinc-300 hover:text-white transition-colors text-[11px]"
            title="Configure AI Engine / LLM Provider"
          >
            <Settings className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-semibold text-zinc-300">
              {aiSettings.provider === "deterministic"
                ? "Offline Synthesizer"
                : aiSettings.provider === "ollama"
                ? `Ollama (${aiSettings.model || "default"})`
                : aiSettings.provider === "openai"
                ? `Cloud (${aiSettings.model || "API"})`
                : "llama.cpp"}
            </span>
          </button>

          {systemMetrics && (
            <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-750 text-[11px]">
              <div className="flex items-center gap-1">
                <Cpu className="w-3 h-3 text-zinc-400" />
                <span className="font-mono text-zinc-300">
                  {systemMetrics.cpu_usage_percent.toFixed(0)}%
                </span>
              </div>
              <div className="w-px h-2.5 bg-zinc-700" />
              <div className="flex items-center gap-1 font-mono text-zinc-300">
                <span>
                  {systemMetrics.memory_used_mb > 1024
                    ? `${(systemMetrics.memory_used_mb / 1024).toFixed(1)}GB`
                    : `${systemMetrics.memory_used_mb.toFixed(0)}MB`}
                </span>
              </div>
              {systemMetrics.is_thermal_risk && (
                <span className="flex items-center gap-0.5 text-amber-400 font-bold animate-pulse">
                  <Flame className="w-3 h-3" />
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Main IDE Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Activity Bar Strip */}
        <aside className="w-12 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-3 gap-3 shrink-0">
          <button
            type="button"
            title="Toggle Explorer"
            onClick={() => setShowExplorer(!showExplorer)}
            className={`p-2 rounded-xl transition-all ${
              showExplorer
                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <FolderCode className="w-5 h-5" />
          </button>

          <button
            type="button"
            title="Toggle Autonomous Agent Dock"
            onClick={() => setShowAgentDock(!showAgentDock)}
            className={`p-2 rounded-xl transition-all ${
              showAgentDock
                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Sliders className="w-5 h-5" />
          </button>

          <div className="flex-1" />

          <button
            type="button"
            title="AI Engine Settings"
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 text-zinc-500 hover:text-zinc-300 rounded-xl transition-all"
          >
            <Settings className="w-5 h-5" />
          </button>
        </aside>

        {/* File Explorer Sidebar */}
        {showExplorer && (
          <FileTree
            files={projectFiles}
            activeFilePath={activeTabPath}
            onSelectFile={openFile}
            onCreateFile={createFileOrFolder}
            onDeleteFile={deleteFile}
            onRefresh={refreshProjectFiles}
            onOpenFolder={handleOpenFolder}
            projectName={activeProject.name}
            projectPath={activeProject.path}
            touchedPaths={touchedPaths}
          />
        )}

        {/* Center Workspace & Bottom Gauntlet Drawer */}
        <main className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* Main Stage: Editor or Diff Viewer */}
          <div className="flex-1 overflow-hidden">
            {activeCenterView === "editor" ? (
              <CodeEditor
                tabs={openTabs}
                activeTabPath={activeTabPath}
                onSelectTab={selectTab}
                onCloseTab={closeTab}
                onContentChange={updateTabContent}
                onSaveFile={saveFile}
              />
            ) : (
              <DiffViewer
                diffText={currentDiff}
                isVerified={status === "success"}
              />
            )}
          </div>

          {/* Bottom Gauntlet Drawer Console */}
          <GauntletDrawer
            activityLog={activityLog}
            telemetry={telemetry}
            orchestrationResult={orchestrationResult}
            pipelineStatus={status}
            systemMetrics={systemMetrics}
            sliderScale={sliders.budget_vs_scale}
            onClearLog={clearLog}
          />
        </main>

        {/* Right Autonomous Agent Steering Dock */}
        {showAgentDock && (
          <aside className="w-80 border-l border-zinc-800 bg-zinc-900/95 flex flex-col h-full shrink-0 overflow-y-auto">
            {/* Dock Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-zinc-200">
                  Autonomous Code Agent
                </span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                Self-Healing
              </span>
            </div>

            {/* Prompt & Sliders Form */}
            <div className="p-4 space-y-4 flex-1">
              {/* Task Prompt Area */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Feature / Refactor Task
                </label>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the feature or fix (e.g. 'Add sliding window token bucket rate limiter to protect public endpoints')..."
                  className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500 resize-none font-sans"
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-400">
                  Quick Tasks:
                </div>
                <div className="flex flex-col gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPrompt(p)}
                      className="text-left text-[11px] px-2.5 py-1.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors truncate"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Architectural Trade-Off Sliders (Compact) */}
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
                <TradeOffSliders
                  initialConfig={sliders}
                  onChange={setSliders}
                  compact={true}
                />
              </div>

              {/* Touched Files / Blast Radius */}
              {touchedPaths.length > 0 && (
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1">
                  <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                    <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Affected Blast Radius:</span>
                  </div>
                  {touchedPaths.map((p) => (
                    <div key={p} className="text-[11px] font-mono text-zinc-300 truncate">
                      • {p}
                    </div>
                  ))}
                </div>
              )}

              {/* Action Trigger */}
              <div className="pt-2">
                {!isRunning ? (
                  <button
                    type="button"
                    onClick={() => runPipeline()}
                    disabled={!prompt.trim()}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                      prompt.trim()
                        ? "bg-gradient-to-r from-sky-500 to-emerald-500 hover:opacity-95 shadow-sky-500/20 cursor-pointer"
                        : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Execute & Verify</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled
                      className="w-full py-2.5 px-3 rounded-xl font-bold text-xs bg-zinc-800 border border-zinc-700 text-sky-400 flex items-center justify-center gap-2 cursor-wait"
                    >
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                      <span>Running Gauntlet...</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelPipeline}
                      className="w-full py-1.5 text-center text-xs font-semibold text-red-400 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        onCreateProject={createProject}
        onPickFolder={pickFolder}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={aiSettings}
        onSave={setAiSettings}
      />
    </div>
  );
}

export default App;
