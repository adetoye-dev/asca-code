/**
 * FileTree.tsx — Project File Explorer Component
 *
 * Renders an interactive, recursive directory tree for the active project.
 * Supports expanding/collapsing folders, creating files/directories,
 * opening files into editor tabs, and highlighting modified/blast-radius files.
 */

import React, { useState } from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  File,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  activeFilePath: string | null;
  onSelectFile: (file: FileNode) => void;
  onCreateFile: (parentPath: string, name: string, isDir: boolean) => void;
  onDeleteFile: (path: string) => void;
  onRefresh: () => void;
  onOpenFolder?: () => void;
  projectName: string;
  projectPath?: string;
  touchedPaths?: string[];
}

export function FileTree({
  files,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRefresh,
  onOpenFolder,
  projectName,
  projectPath,
  touchedPaths = [],
}: FileTreeProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [newEntryModal, setNewEntryModal] = useState<{
    parentPath: string;
    isDir: boolean;
  } | null>(null);
  const [newEntryName, setNewEntryName] = useState("");

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEntryModal || !newEntryName.trim()) return;
    onCreateFile(newEntryModal.parentPath, newEntryName.trim(), newEntryModal.isDir);
    setNewEntryModal(null);
    setNewEntryName("");
  };

  const getFileIcon = (fileName: string, isDir: boolean, isOpen: boolean) => {
    if (isDir) {
      return isOpen ? (
        <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
      ) : (
        <Folder className="w-4 h-4 text-amber-400 shrink-0" />
      );
    }
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".py")) {
      return <FileCode className="w-4 h-4 text-sky-400 shrink-0" />;
    }
    if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
      return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
    }
    if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      return <FileJson className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (lower.endsWith(".md") || lower.endsWith(".txt")) {
      return <FileText className="w-4 h-4 text-indigo-400 shrink-0" />;
    }
    return <File className="w-4 h-4 text-zinc-400 shrink-0" />;
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isDir = node.is_dir;
    const isExpanded = !collapsedDirs.has(node.path);
    const isActive = activeFilePath === node.path;
    const isTouched = touchedPaths.some((p) => {
      const rel = p.replace(/^\.?\//, "");
      return node.path === rel || node.path.endsWith(`/${rel}`);
    });

    return (
      <div key={node.path} className="select-none text-xs">
        <div
          onClick={() => {
            if (isDir) {
              toggleDir(node.path);
            } else {
              onSelectFile(node);
            }
          }}
          style={{ paddingLeft: `${depth * 12 + 10}px` }}
          className={`group flex items-center justify-between py-1 pr-2 rounded cursor-pointer transition-colors ${
            isActive
              ? "bg-sky-500/20 text-sky-200 font-medium"
              : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {isDir ? (
              <span className="text-zinc-500 hover:text-zinc-300">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                )}
              </span>
            ) : (
              <span className="w-3.5" />
            )}
            {getFileIcon(node.name, isDir, isExpanded)}
            <span className="truncate">{node.name}</span>
            {isTouched && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 ml-1" title="Touched by Gauntlet" />
            )}
          </div>

          {/* Action buttons on hover */}
          <div className="hidden group-hover:flex items-center gap-1">
            {isDir && (
              <>
                <button
                  type="button"
                  title="New File inside folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewEntryModal({ parentPath: node.path, isDir: false });
                  }}
                  className="p-0.5 text-zinc-400 hover:text-zinc-100 rounded"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              type="button"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete ${node.name}?`)) {
                  onDeleteFile(node.path);
                }
              }}
              className="p-0.5 text-zinc-500 hover:text-red-400 rounded"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Render children if directory is expanded */}
        {isDir && isExpanded && node.children && (
          <div>
            {node.children.length === 0 ? (
              <div
                style={{ paddingLeft: `${(depth + 1) * 12 + 18}px` }}
                className="py-0.5 text-[11px] text-zinc-500 italic"
              >
                (empty folder)
              </div>
            ) : (
              node.children.map((child) => renderNode(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/90 border-r border-zinc-800/80 w-64 shrink-0 select-none">
      {/* Explorer Header */}
      <div className="flex flex-col border-b border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center justify-between px-3 py-2 text-zinc-400 text-xs font-semibold uppercase tracking-wider">
          <span className="truncate">{projectName || "EXPLORER"}</span>
          <div className="flex items-center gap-1 text-zinc-400">
            {onOpenFolder && (
              <button
                type="button"
                title="Open Folder on Disk"
                onClick={onOpenFolder}
                className="p-1 hover:text-sky-400 hover:bg-zinc-800 rounded"
              >
                <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
              </button>
            )}
            <button
              type="button"
              title="New File in root"
              onClick={() => setNewEntryModal({ parentPath: "", isDir: false })}
              className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Refresh Explorer"
              onClick={onRefresh}
              className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {projectPath && (
          <div className="px-3 pb-1.5 text-[10px] text-zinc-500 font-mono truncate" title={projectPath}>
            {projectPath}
          </div>
        )}
      </div>

      {/* File Tree List */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {files.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500 space-y-2">
            <div>No files in directory.</div>
            {onOpenFolder && (
              <button
                type="button"
                onClick={onOpenFolder}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-sky-400 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 mx-auto"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open Project Folder</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setNewEntryModal({ parentPath: "", isDir: false })}
              className="mt-1 text-zinc-400 hover:text-white underline block mx-auto text-[11px]"
            >
              + Create main.py
            </button>
          </div>
        ) : (
          files.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* Simple Inline Create Modal */}
      {newEntryModal && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-2 border-t border-zinc-800 bg-zinc-950 flex flex-col gap-1.5 text-xs"
        >
          <div className="text-[11px] text-zinc-400">
            New {newEntryModal.isDir ? "Directory" : "File"}:
          </div>
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              placeholder={newEntryModal.isDir ? "folder_name" : "filename.py"}
              value={newEntryName}
              onChange={(e) => setNewEntryName(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setNewEntryModal(null)}
              className="px-1.5 py-1 text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default FileTree;
