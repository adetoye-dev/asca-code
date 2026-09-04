/**
 * BottomPanel.tsx — Production VS Code Bottom Panel with Tabs & Resize
 *
 * Provides:
 * 1. Tabbed navigation: TERMINAL, OUTPUT (Gauntlet), and PROBLEMS (Syntax/AST).
 * 2. Draggable top border to resize panel height (140px to 600px).
 * 3. Maximize / Restore height toggle.
 * 4. Close panel button (X) and status indicators.
 */

import { useState, useRef } from "react";
import {
  Terminal,
  FileText,
  AlertCircle,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { XtermTerminal, type XtermTerminalHandle } from "../terminal/XtermTerminal";
import { ConsolePanel } from "./ConsolePanel";
import type { PipelineOutputLine, OrchestrationResult } from "../TelemetryScorecard";

type PanelTab = "terminal" | "output" | "problems";

interface BottomPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeProjectCwd: string;
  activityLog: PipelineOutputLine[];
  onClearLog: () => void;
  status: string;
  orchestrationResult: OrchestrationResult | null;
}

export function BottomPanel({
  isOpen,
  onClose,
  activeProjectCwd,
  activityLog,
  onClearLog,
  status,
  orchestrationResult,
}: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("terminal");
  const [panelHeight, setPanelHeight] = useState<number>(240);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTerminalConnected, setIsTerminalConnected] = useState(false);
  const terminalRef = useRef<XtermTerminalHandle>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(240);

  // Resize drag handling
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - moveEvent.clientY;
      const newHeight = Math.min(650, Math.max(140, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  if (!isOpen) return null;

  // Extract problems from activityLog / orchestrationResult
  const errorLines = activityLog.filter(
    (l) => l.stream === "stderr" || l.content.includes("ERROR") || l.content.includes("FAILED")
  );

  return (
    <div
      style={{ height: isMaximized ? "75vh" : `${panelHeight}px` }}
      className="w-full flex flex-col border-t border-[var(--vscode-border)] bg-[var(--vscode-panel-bg)] text-xs select-none relative shrink-0 transition-all duration-75"
    >
      {/* Draggable Top Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-sky-500/50 transition-colors z-20"
        title="Drag to resize bottom panel"
      />

      {/* Panel Tab Header */}
      <div className="flex items-center justify-between px-3 h-8 bg-[var(--vscode-titlebar-bg)] border-b border-[var(--vscode-border)] text-zinc-400 shrink-0 text-[11px] font-sans">
        {/* Left Tabs */}
        <div className="flex items-center gap-1 h-full">
          <button
            type="button"
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-1.5 px-2.5 h-full border-b-2 transition-colors uppercase tracking-wider ${
              activeTab === "terminal"
                ? "border-sky-400 text-zinc-100 font-semibold bg-[var(--vscode-tab-active-bg)]"
                : "border-transparent text-zinc-400 hover:text-zinc-200 font-medium"
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>TERMINAL</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("output")}
            className={`flex items-center gap-1.5 px-2.5 h-full border-b-2 transition-colors uppercase tracking-wider ${
              activeTab === "output"
                ? "border-sky-400 text-zinc-100 font-semibold bg-[var(--vscode-tab-active-bg)]"
                : "border-transparent text-zinc-400 hover:text-zinc-200 font-medium"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>OUTPUT (GAUNTLET)</span>
            {status === "running" && (
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("problems")}
            className={`flex items-center gap-1.5 px-2.5 h-full border-b-2 transition-colors uppercase tracking-wider ${
              activeTab === "problems"
                ? "border-sky-400 text-zinc-100 font-semibold bg-[var(--vscode-tab-active-bg)]"
                : "border-transparent text-zinc-400 hover:text-zinc-200 font-medium"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>PROBLEMS</span>
            {errorLines.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold font-mono">
                {errorLines.length}
              </span>
            )}
          </button>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1">
          {activeTab === "terminal" && (
            <div className="flex items-center gap-1.5 mr-2">
              <span className="flex items-center gap-1.5 text-zinc-400 font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/50">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isTerminalConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                  }`}
                  title={isTerminalConnected ? "PTY Shell Connected" : "Connecting..."}
                />
                <span className="truncate max-w-[120px]">
                  {activeProjectCwd ? activeProjectCwd.split("/").filter(Boolean).slice(-1)[0] : "zsh"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => terminalRef.current?.restart()}
                className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                title="Restart Interactive Shell (PTY)"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => terminalRef.current?.clear()}
                className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                title="Clear Terminal Buffer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeTab === "output" && (
            <div className="flex items-center gap-1.5 mr-1">
              {status === "running" && (
                <span className="flex items-center gap-1 text-sky-400 font-mono text-[10px] px-1.5 py-0.5 rounded bg-sky-950/40 border border-sky-800/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                  <span>Streaming...</span>
                </span>
              )}
              <button
                type="button"
                onClick={onClearLog}
                className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                title="Clear Output Console"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Maximize / Restore Toggle */}
          <button
            type="button"
            onClick={toggleMaximize}
            className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title={isMaximized ? "Restore Panel Size" : "Maximize Panel"}
          >
            {isMaximized ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Close Panel Button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="Close Panel (Cmd+J / Ctrl+`)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab Content Body */}
      <div className="flex-1 w-full overflow-hidden relative">
        <div className={activeTab === "terminal" ? "h-full w-full" : "hidden"}>
          <XtermTerminal
            ref={terminalRef}
            cwd={activeProjectCwd}
            isVisible={activeTab === "terminal"}
            onConnectionChange={setIsTerminalConnected}
          />
        </div>

        {activeTab === "output" && (
          <ConsolePanel activityLog={activityLog} onClear={onClearLog} status={status} />
        )}

        {activeTab === "problems" && (
          <div className="h-full w-full overflow-y-auto p-3 space-y-1.5 font-mono text-xs bg-[var(--vscode-editor-bg)]">
            {orchestrationResult && orchestrationResult.outcome !== "success" && (
              <div className="flex items-center gap-2 p-2 rounded bg-red-950/40 border border-red-800 text-red-200 mb-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>
                  Gauntlet Verification Failed: {orchestrationResult.outcome.toUpperCase()} (Total rounds: {orchestrationResult.total_rounds})
                </span>
              </div>
            )}

            {errorLines.length === 0 && (!orchestrationResult || orchestrationResult.outcome === "success") ? (
              <div className="flex items-center gap-2 text-zinc-400 py-6 justify-center font-sans text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>No problems detected in workspace or compiler syntax guard.</span>
              </div>
            ) : (
              errorLines.map((line, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-1.5 rounded bg-red-950/20 border border-red-900/40 text-red-300 font-mono text-xs"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-red-200">[Syntax/Runtime Error]</span>{" "}
                    <span className="text-zinc-200">{line.content}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BottomPanel;
