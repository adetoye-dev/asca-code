/**
 * FileTree.tsx — Project File Explorer Component
 *
 * Renders an interactive, recursive directory tree for the active project.
 * Supports expanding/collapsing folders, creating files/directories,
 * opening files into editor tabs, and highlighting modified/blast-radius files.
 */

import { useState, useMemo } from "react";
import { Trash2, Plus, ChevronRight, FolderPlus, ChevronDown, RefreshCw, Folder, X } from "lucide-react";
import { Icon } from "./ui/Icon";
import { ConfirmDialog } from './ui/ConfirmDialog';

import { FileIcon } from "./ui/FileIcon";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  children?: FileNode[];
}

export interface FolderOption {
  path: string;
  label: string;
}

export function collectFolders(nodes: FileNode[], baseProjectDir?: string): FolderOption[] {
  const list: FolderOption[] = [{ path: "", label: "/ (Project Root)" }];

  function traverse(items: FileNode[]) {
    for (const item of items) {
      if (item.is_dir) {
        let rel = item.path;
        if (baseProjectDir && rel.startsWith(baseProjectDir)) {
          rel = rel.slice(baseProjectDir.length).replace(/^[/\\]+/, "");
        }
        list.push({
          path: item.path,
          label: rel ? `/${rel}` : item.name,
        });
        if (item.children && item.children.length > 0) {
          traverse(item.children);
        }
      }
    }
  }

  traverse(nodes);
  return list;
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
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [newEntryName, setNewEntryName] = useState("");

  const folderOptions = useMemo(() => {
    return collectFolders(files, projectPath);
  }, [files, projectPath]);

  const getDefaultParentPath = (): string => {
    if (activeFilePath) {
      const lastSlash = Math.max(activeFilePath.lastIndexOf("/"), activeFilePath.lastIndexOf("\\"));
      if (lastSlash > 0) {
        return activeFilePath.slice(0, lastSlash);
      }
    }
    return "";
  };

  const getPreviewPath = (parentPath: string, name: string) => {
    const cleanName = name.replace(/^[/\\]+/, "");
    if (!parentPath) return `/${cleanName}`;
    let rel = parentPath;
    if (projectPath && rel.startsWith(projectPath)) {
      rel = rel.slice(projectPath.length).replace(/^[/\\]+/, "");
    }
    return rel ? `/${rel}/${cleanName}` : `/${cleanName}`;
  };

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

    let targetParent = newEntryModal.parentPath;
    let targetName = newEntryName.trim();

    if (targetName.startsWith("/")) {
      targetParent = "";
      targetName = targetName.slice(1);
    }

    onCreateFile(targetParent, targetName, newEntryModal.isDir);
    setNewEntryModal(null);
    setNewEntryName("");
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
      <div key={node.path} className="select-none text-[13px] font-sans">
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
              : "text-zinc-200 hover:bg-zinc-800/70 hover:text-white"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {isDir ? (
              <span className="text-zinc-400 hover:text-zinc-200">
                {isExpanded ? (
                  <Icon icon={ChevronDown} className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Icon icon={ChevronRight} className="w-3.5 h-3.5 shrink-0" />
                )}
              </span>
            ) : (
              <span className="w-3.5" />
            )}
            <FileIcon fileName={node.name} isDir={isDir} isOpen={isExpanded} className="w-4 h-4 shrink-0" />
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
                  title="New File inside this folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewEntryModal({ parentPath: node.path, isDir: false });
                    setNewEntryName("");
                  }}
                  className="p-0.5 text-zinc-400 hover:text-sky-300 rounded"
                >
                  <Icon icon={Plus} className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="New Folder inside this folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewEntryModal({ parentPath: node.path, isDir: true });
                    setNewEntryName("");
                  }}
                  className="p-0.5 text-zinc-400 hover:text-amber-300 rounded"
                >
                  <Icon icon={FolderPlus} className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeletePath(node.path);
              }}
              className="p-0.5 text-zinc-400 hover:text-red-400 rounded"
            >
              <Icon icon={Trash2} className="w-3.5 h-3.5" />
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
    <div className="flex flex-col h-full bg-zinc-900/90 border-r border-zinc-800/80 w-full shrink-0 select-none font-sans">
      {/* Explorer Header */}
      <div className="flex flex-col border-b border-zinc-800/80 bg-zinc-950/40">
        <div className="flex items-center justify-between px-3 py-2 text-zinc-300 text-[11px] font-semibold uppercase tracking-wider">
          <span className="truncate" title={projectPath && projectPath !== "." ? projectPath : projectName}>
            {projectName || "EXPLORER"}
          </span>
          <div className="flex items-center gap-1 text-zinc-400">
            <button
              type="button"
              title="New Folder... (Cmd+Shift+N)"
              onClick={() => {
                setNewEntryModal({ parentPath: getDefaultParentPath(), isDir: true });
                setNewEntryName("");
              }}
              className="p-1 hover:text-amber-300 hover:bg-zinc-800 rounded transition-colors"
            >
              <Icon icon={FolderPlus} className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="New File... (Cmd+N)"
              onClick={() => {
                setNewEntryModal({ parentPath: getDefaultParentPath(), isDir: false });
                setNewEntryName("");
              }}
              className="p-1 hover:text-sky-300 hover:bg-zinc-800 rounded transition-colors"
            >
              <Icon icon={Plus} className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Refresh Explorer"
              onClick={onRefresh}
              className="p-1 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            >
              <Icon icon={RefreshCw} className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Project-Scoped File / Folder Creation Panel ──────────────────────── */}
      {newEntryModal && (
        <div className="border-b border-zinc-700/80 bg-workbench p-3 shadow-lg text-[13px] animate-in fade-in slide-in-from-top-2 duration-150 shrink-0 font-sans">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
              {newEntryModal.isDir ? (
                <Icon icon={FolderPlus} className="w-4 h-4 text-amber-400" />
              ) : (
                <Icon icon={Plus} className="w-4 h-4 text-sky-400" />
              )}
              <span>New {newEntryModal.isDir ? "Folder" : "File"} in Project</span>
            </div>
            <button
              type="button"
              onClick={() => setNewEntryModal(null)}
              className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded hover:bg-zinc-800"
              title="Cancel (Esc)"
            >
              <Icon icon={X} className="w-3.5 h-3.5" />
            </button>
          </div>

          <form onSubmit={handleCreateSubmit} className="space-y-2.5">
            {/* Target Location / Destination Folder Dropdown */}
            <div>
              <label className="text-xs text-zinc-300 font-medium block mb-1">
                Destination Folder:
              </label>
              <select
                value={newEntryModal.parentPath}
                onChange={(e) =>
                  setNewEntryModal((prev) => (prev ? { ...prev, parentPath: e.target.value } : null))
                }
                className="w-full bg-workbench border border-zinc-700 hover:border-zinc-500 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-100 focus:outline-none focus:border-sky-500 font-sans cursor-pointer transition-colors"
              >
                {folderOptions.map((opt) => (
                  <option key={opt.path || "root"} value={opt.path}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Name / Subpath Input */}
            <div>
              <label className="text-xs text-zinc-300 font-medium block mb-1">
                {newEntryModal.isDir ? "Folder Name (or subpath):" : "File Name (or subpath):"}
              </label>
              <input
                autoFocus
                type="text"
                placeholder={
                  newEntryModal.isDir
                    ? "e.g. components or utils/submodule"
                    : "e.g. Button.tsx or helpers/format.ts"
                }
                value={newEntryName}
                onChange={(e) => setNewEntryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewEntryModal(null);
                  }
                }}
                className="w-full bg-workbench border border-zinc-700 hover:border-zinc-500 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-sans transition-colors"
              />
            </div>

            {/* Live Destination Path Preview */}
            {newEntryName.trim() && (
              <div className="text-[10px] text-zinc-400 font-mono bg-black/40 px-2 py-1 rounded border border-white/5 truncate">
                <span className="text-zinc-500">Will create: </span>
                <span className="text-sky-300">
                  {getPreviewPath(newEntryModal.parentPath, newEntryName.trim())}
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setNewEntryModal(null)}
                className="px-2.5 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newEntryName.trim()}
                className="px-3 py-1 text-[11px] rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium shadow-sm transition-all"
              >
                Create {newEntryModal.isDir ? "Folder" : "File"}
              </button>
            </div>
          </form>
        </div>
      )}

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
                <Icon icon={Folder} className="w-3.5 h-3.5" />
                <span>Open Project Folder</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setNewEntryModal({ parentPath: "", isDir: false });
                setNewEntryName("main.py");
              }}
              className="mt-1 text-zinc-400 hover:text-white underline block mx-auto text-[11px]"
            >
              + Create main.py
            </button>
          </div>
        ) : (
          files.map((node) => renderNode(node, 0))
        )}
      </div>

      {confirmDeletePath && (
        <ConfirmDialog
          isOpen={true}
          title="Delete"
          message={`Delete "${confirmDeletePath}"? This cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive={true}
          onConfirm={() => {
            onDeleteFile(confirmDeletePath);
            setConfirmDeletePath(null);
          }}
          onCancel={() => setConfirmDeletePath(null)}
        />
      )}
    </div>
  );
}

export default FileTree;
