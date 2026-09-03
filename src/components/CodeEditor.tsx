/**
 * CodeEditor.tsx — Multi-Tab Code Editor Component
 *
 * Provides a developer-grade editing surface:
 * 1. Multi-document tab bar with close buttons and dirty state indicators.
 * 2. Synchronized line-number gutter with active cursor tracking.
 * 3. File saving via keyboard shortcuts (Cmd+S / Ctrl+S) or explicit button.
 * 4. Editor status footer displaying cursor coordinates, encoding, and language.
 */

import { useEffect, useRef, useState } from "react";
import { X, Save, FileCode } from "lucide-react";

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
}

interface CodeEditorProps {
  tabs: OpenFileTab[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, newContent: string) => void;
  onSaveFile: (path: string) => void;
}

export function CodeEditor({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSaveFile,
}: CodeEditorProps) {
  const activeTab = tabs.find((t) => t.path === activeTabPath);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const activeContent = activeTab?.content || "";
  const lines = activeContent.split("\n");
  const lineCount = lines.length;

  // Track cursor coordinates
  const handleCursorMove = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart || 0;
    const textBefore = textarea.value.substring(0, pos);
    const line = (textBefore.match(/\n/g) || []).length + 1;
    const lastNewline = textBefore.lastIndexOf("\n");
    const col = lastNewline === -1 ? pos + 1 : pos - lastNewline;
    setCursorPos({ line, col });
  };

  // Synchronize scroll between textarea and line-number gutter
  const handleScroll = () => {
    if (textareaRef.current && lineGutterRef.current) {
      lineGutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab) {
          onSaveFile(activeTab.path);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, onSaveFile]);

  if (tabs.length === 0 || !activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 select-none p-8">
        <FileCode className="w-12 h-12 text-zinc-700 mb-3" />
        <p className="text-sm font-medium text-zinc-400">No File Open</p>
        <p className="text-xs text-zinc-600 mt-1">
          Select a file from the Explorer on the left, or ask the Autonomous Agent to create one.
        </p>
      </div>
    );
  }

  const getLanguage = (path: string) => {
    if (path.endsWith(".py")) return "Python";
    if (path.endsWith(".ts") || path.endsWith(".tsx")) return "TypeScript";
    if (path.endsWith(".js") || path.endsWith(".jsx")) return "JavaScript";
    if (path.endsWith(".json")) return "JSON";
    if (path.endsWith(".md")) return "Markdown";
    return "Plain Text";
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto select-none no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.path === activeTabPath;
          return (
            <div
              key={tab.path}
              onClick={() => onSelectTab(tab.path)}
              className={`group flex items-center gap-2 px-3 py-2 border-r border-zinc-800 text-xs cursor-pointer transition-colors shrink-0 ${
                isActive
                  ? "bg-zinc-950 text-zinc-100 font-medium border-t-2 border-t-sky-500"
                  : "text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200"
              }`}
            >
              <span className="truncate max-w-[140px]">{tab.name}</span>
              {tab.isDirty && (
                <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" title="Unsaved changes" />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.path);
                }}
                className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 opacity-60 group-hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Save button shortcut */}
        {activeTab.isDirty && (
          <button
            type="button"
            onClick={() => onSaveFile(activeTab.path)}
            className="ml-auto mr-3 flex items-center gap-1.5 px-2 py-1 bg-sky-600/80 hover:bg-sky-500 text-white rounded text-xs font-medium"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        )}
      </div>

      {/* Editor Body with Gutter */}
      <div className="flex-1 flex relative overflow-hidden font-mono text-xs leading-5">
        {/* Line Numbers Gutter */}
        <div
          ref={lineGutterRef}
          className="w-12 py-3 bg-zinc-900/60 border-r border-zinc-800/80 text-zinc-600 select-none text-right pr-3 overflow-hidden shrink-0"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i + 1}
              className={`${
                cursorPos.line === i + 1
                  ? "text-zinc-300 font-bold bg-zinc-800/30 -mr-3 pr-3"
                  : ""
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Editable Area */}
        <div className="flex-1 relative h-full">
          <textarea
            ref={textareaRef}
            value={activeContent}
            onChange={(e) => onContentChange(activeTab.path, e.target.value)}
            onKeyUp={handleCursorMove}
            onClick={handleCursorMove}
            onScroll={handleScroll}
            spellCheck={false}
            className="w-full h-full p-3 bg-transparent text-zinc-200 resize-none outline-none overflow-auto font-mono whitespace-pre tab-4 leading-5 selection:bg-sky-500/30 selection:text-white"
          />
        </div>
      </div>

      {/* Editor Status Footer */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-zinc-800/80 bg-zinc-900/90 text-[11px] text-zinc-500 select-none">
        <div className="flex items-center gap-4">
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span>{lineCount} lines</span>
          <span>{activeContent.length} chars</span>
        </div>
        <div className="flex items-center gap-4">
          <span>{getLanguage(activeTab.path)}</span>
          <span>UTF-8</span>
          {activeTab.isDirty ? (
            <span className="text-amber-400 font-medium">● Modified</span>
          ) : (
            <span className="text-zinc-600">Saved</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default CodeEditor;
