/**
 * ProjectSwitcher.tsx — Sleek Project Switcher & Actions Dropdown
 *
 * Implements:
 * 1. Mathematical Concentric Radii (R_outer = 12px, P = 4px, R_item = 8px)
 * 2. Standardized Lucide iconography through the shared `Icon` component
 * 3. Full Keyboard Navigation (ArrowUp/Down, Enter, Escape, Cmd/Ctrl+O)
 * 4. Apple Obsidian palette & dual-layer elevation styling
 */

import { useState, useRef, useEffect } from "react";
import { Plus, Check, GitFork, ChevronDown, Folder } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { ProjectMeta } from "../../hooks/usePipeline";

interface ProjectSwitcherProps {
  activeProject: ProjectMeta;
  onOpenFolder: () => void;
  onNewProject: () => void;
  onCloneRepo: () => void;
  onSelectRecentProject: (path: string) => void;
}

const RECENT_PROJECTS_KEY = "autonomous_ide_recent_projects";

export function ProjectSwitcher({
  activeProject,
  onOpenFolder,
  onNewProject,
  onCloneRepo,
  onSelectRecentProject,
}: ProjectSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectMeta[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load and update recent projects
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
      let list: ProjectMeta[] = raw ? JSON.parse(raw) : [];

      // Ensure active project is at the front, and filter out stale dot paths
      list = list.filter((p) => {
        if (activeProject.path !== "." && activeProject.path !== "./") {
          if (p.path === "." || p.path === "./") return false;
        }
        return p.path !== activeProject.path;
      });
      list.unshift(activeProject);
      if (list.length > 5) list = list.slice(0, 5);

      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list));
      setRecentProjects(list);
    } catch {
      setRecentProjects([activeProject]);
    }
  }, [activeProject]);

  // Click outside to dismiss
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Global Cmd+O / Ctrl+O keyboard shortcut to open folder
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onOpenFolder();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenFolder]);

  // Reset keyboard focus index on open/close
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0);
    } else {
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  // Keyboard navigation within dropdown
  const totalActions = 3; // New, Open, Clone
  const totalItems = totalActions + recentProjects.length;

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeItem(focusedIndex);
    }
  };

  const executeItem = (index: number) => {
    if (index === 0) {
      setIsOpen(false);
      onNewProject();
    } else if (index === 1) {
      setIsOpen(false);
      onOpenFolder();
    } else if (index === 2) {
      setIsOpen(false);
      onCloneRepo();
    } else if (index >= 3) {
      const projectIndex = index - 3;
      const targetProject = recentProjects[projectIndex];
      if (targetProject) {
        if (targetProject.path !== activeProject.path) {
          onSelectRecentProject(targetProject.path);
        }
        setIsOpen(false);
      }
    }
  };

  const formatPath = (fullPath: string) => {
    if (!fullPath || fullPath === "." || fullPath === "./") {
      return "";
    }
    const home = typeof window !== "undefined" ? "/Users/" : "";
    if (fullPath.startsWith(home)) {
      const parts = fullPath.split("/");
      if (parts.length > 3) {
        return "~/" + parts.slice(3).join("/");
      }
    }
    return fullPath;
  };

  const getInitial = (name: string) => {
    return (name || "P").charAt(0).toUpperCase();
  };

  return (
    <div
      ref={dropdownRef}
      onKeyDown={handleDropdownKeyDown}
      className="relative select-none text-[13px] font-sans"
    >
      {/* ── Project Switcher Pill Button ──────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-pill border transition-all ${
          isOpen
            ? "bg-surface border-zinc-500 text-white shadow-elevation-1"
            : "bg-workbench hover:bg-surface border-hairline text-zinc-200 hover:text-white"
        }`}
        title={activeProject.path && activeProject.path !== "." ? `Active Project: ${activeProject.path}` : activeProject.name}
      >
        {/* Project Initial Colored Rounded Badge */}
        <div className="w-5 h-5 rounded-md bg-emerald-600/90 text-white font-bold flex items-center justify-center text-xs shadow-sm">
          {getInitial(activeProject.name)}
        </div>

        {/* Project Name */}
        <span className="font-semibold text-[13px] tracking-tight max-w-[140px] truncate text-zinc-100">
          {activeProject.name}
        </span>

        {/* Subtle Hugeicon Chevron Down */}
        <Icon icon={ChevronDown}
          size="xs"
          className={`text-zinc-400 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-zinc-200" : ""
          }`}
        />
      </button>

      {/* ── Dropdown Menu Window (Concentric R_outer = 12px, P = 4px, R_item = 8px) ── */}
      {isOpen && (
        <div
          role="menu"
          tabIndex={0}
          className="absolute left-0 top-full mt-1.5 w-72 bg-overlay border border-hairline rounded-dropdown shadow-elevation-3 z-50 p-1 text-[13px] text-zinc-200 animate-in fade-in zoom-in-95 duration-100 space-y-1 backdrop-blur-xl font-sans focus:outline-none"
        >
          {/* Top Actions: New, Open, Clone */}
          <div className="space-y-0.5 pb-1 border-b border-hairline">
            {/* New Project (Index 0) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onNewProject();
              }}
              onMouseEnter={() => setFocusedIndex(0)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-[8px] text-left transition-colors ${
                focusedIndex === 0
                  ? "bg-surface-hover text-white ring-1 ring-white/10"
                  : "text-zinc-200 hover:bg-surface-hover hover:text-white"
              }`}
            >
              <Icon icon={Plus} size="sm" className="text-zinc-400" />
              <span className="font-medium text-[13px]">New Project...</span>
            </button>

            {/* Open Folder (Index 1) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onOpenFolder();
              }}
              onMouseEnter={() => setFocusedIndex(1)}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-[8px] text-left transition-colors ${
                focusedIndex === 1
                  ? "bg-surface-hover text-white ring-1 ring-white/10"
                  : "text-zinc-200 hover:bg-surface-hover hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon icon={Folder} size="sm" className="text-zinc-400" />
                <span className="font-medium text-[13px]">Open...</span>
              </div>
              <kbd className="text-[10px] font-mono text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded border border-hairline">
                ⌘O
              </kbd>
            </button>

            {/* Clone Repository (Index 2) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onCloneRepo();
              }}
              onMouseEnter={() => setFocusedIndex(2)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-[8px] text-left transition-colors ${
                focusedIndex === 2
                  ? "bg-surface-hover text-white ring-1 ring-white/10"
                  : "text-zinc-200 hover:bg-surface-hover hover:text-white"
              }`}
            >
              <Icon icon={GitFork} size="sm" className="text-zinc-400" />
              <span className="font-medium text-[13px]">Clone Repository...</span>
            </button>
          </div>

          {/* Section: Open Projects */}
          <div className="pt-1">
            <div className="px-3 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Open Projects
            </div>

            <div className="space-y-0.5 mt-0.5">
              {recentProjects.map((p, idx) => {
                const itemIndex = totalActions + idx;
                const isActive = p.path === activeProject.path;
                const isFocused = focusedIndex === itemIndex;

                return (
                  <button
                    key={p.path}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      if (!isActive) {
                        onSelectRecentProject(p.path);
                      }
                      setIsOpen(false);
                    }}
                    onMouseEnter={() => setFocusedIndex(itemIndex)}
                    className={`w-full flex items-start gap-2.5 p-2 rounded-[8px] cursor-pointer transition-all ${
                      isActive && isFocused
                        ? "bg-zinc-800/90 border border-zinc-600 text-white ring-1 ring-white/10 shadow-sm"
                        : isActive
                        ? "bg-zinc-800/80 border border-zinc-700/60 text-zinc-100 shadow-sm"
                        : isFocused
                        ? "bg-surface-hover text-white ring-1 ring-white/10"
                        : "hover:bg-surface-hover text-zinc-300"
                    }`}
                  >
                    {/* Badge */}
                    <div
                      className={`w-6 h-6 rounded-md text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 ${
                        isActive ? "bg-zinc-600" : "bg-zinc-700 text-zinc-300"
                      }`}
                    >
                      {getInitial(p.name)}
                    </div>

                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[13px] text-zinc-100 truncate">
                          {p.name}
                        </span>
                        {isActive && <Icon icon={Check} size="xs" className="text-zinc-200 shrink-0" />}
                      </div>
                      {formatPath(p.path) ? (
                        <div className="text-xs text-zinc-400 truncate mt-0.5 font-mono">
                          {formatPath(p.path)}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectSwitcher;
