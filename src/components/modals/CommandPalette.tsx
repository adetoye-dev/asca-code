/**
 * CommandPalette.tsx — VS Code Command Palette & Quick File Open Modal
 *
 * Implements:
 * 1. Cmd+Shift+P / Ctrl+Shift+P: Fuzzy command runner.
 * 2. Cmd+P / Ctrl+P: Quick Open file search across the project file tree.
 * 3. Keyboard navigation with ArrowUp, ArrowDown, Enter, and Escape.
 */

import { useState, useEffect, useRef } from "react";
import { FileText, Terminal } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { FileNode } from "../../types/workbench";

export interface CommandItem {
  id: string;
  title: string;
  category?: string;
  shortcut?: string;
  icon?: any;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
  files: FileNode[];
  onOpenFile: (file: FileNode) => void;
  initialMode?: "command" | "file";
}

export function CommandPalette({
  isOpen,
  onClose,
  commands,
  files,
  onOpenFile,
  initialMode = "command",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten recursive file tree into list
  const flattenFiles = (nodes: FileNode[]): FileNode[] => {
    let result: FileNode[] = [];
    for (const node of nodes) {
      if (!node.is_dir) result.push(node);
      if (node.children) result = result.concat(flattenFiles(node.children));
    }
    return result;
  };

  const allFiles = flattenFiles(files);

  // Determine mode from query or initialMode: if starts with ">" it's command mode
  const isCommandMode = query.startsWith(">");
  const cleanQuery = isCommandMode ? query.slice(1).trim() : query.trim();

  // Filter items
  const filteredCommands = isCommandMode
    ? commands.filter(
        (c) =>
          c.title.toLowerCase().includes(cleanQuery.toLowerCase()) ||
          (c.category && c.category.toLowerCase().includes(cleanQuery.toLowerCase()))
      )
    : [];

  const filteredFiles = !isCommandMode
    ? allFiles.filter(
        (f) =>
          f.name.toLowerCase().includes(cleanQuery.toLowerCase()) ||
          f.path.toLowerCase().includes(cleanQuery.toLowerCase())
      )
    : [];

  const activeListLength = isCommandMode ? filteredCommands.length : filteredFiles.length;

  useEffect(() => {
    if (isOpen) {
      setQuery(initialMode === "command" ? ">" : "");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, activeListLength));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + activeListLength) % Math.max(1, activeListLength));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isCommandMode && filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      } else if (!isCommandMode && filteredFiles[selectedIndex]) {
        onOpenFile(filteredFiles[selectedIndex]);
        onClose();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-start justify-center pt-[10vh] p-4 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-modal/95 backdrop-blur-xl border border-hairline rounded-modal shadow-elevation-3 overflow-hidden flex flex-col text-xs animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Search Input Bar */}
        <div className="p-2.5 border-b border-[var(--vscode-border)] flex items-center gap-2 bg-[var(--vscode-editor-bg)]">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCommandMode
                ? "Type a command or '>' to run commands..."
                : "Type the name of a file to open..."
            }
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
          />
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-1 bg-[var(--vscode-panel-bg)] space-y-0.5">
          {activeListLength === 0 ? (
            <div className="p-6 text-center text-zinc-500 text-xs">
              No matching {isCommandMode ? "commands" : "files"} found.
            </div>
          ) : isCommandMode ? (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const CmdIcon = cmd.icon || Terminal;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    onClose();
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-sky-600 text-white font-medium"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <CmdIcon className={`w-4 h-4 ${isSelected ? "text-white" : "text-sky-400"}`} />
                    <span className="truncate">
                      {cmd.category && (
                        <span className={isSelected ? "text-sky-200" : "text-zinc-500"}>
                          {cmd.category}:{" "}
                        </span>
                      )}
                      {cmd.title}
                    </span>
                  </div>

                  {cmd.shortcut && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        isSelected
                          ? "border-sky-400/50 bg-sky-700/50 text-sky-100"
                          : "border-zinc-700 bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            filteredFiles.map((file, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={file.path}
                  onClick={() => {
                    onOpenFile(file);
                    onClose();
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-sky-600 text-white font-medium"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon icon={FileText} className={`w-4 h-4 ${isSelected ? "text-white" : "text-sky-400"}`} />
                    <span className="font-medium text-xs truncate">{file.name}</span>
                    <span
                      className={`text-[10px] truncate ${
                        isSelected ? "text-sky-200" : "text-zinc-500"
                      }`}
                    >
                      {file.path}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
