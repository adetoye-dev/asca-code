/**
 * ProjectSwitcher.tsx — Sleek Project Switcher & Actions Dropdown
 *
 * Replicates the authentic modern IDE project pill & dropdown menu:
 * 1. Compact titlebar pill with colored project initial badge & chevron.
 * 2. Dropdown actions: "+ New Project...", "Open... ⌘O", "Clone Repository...".
 * 3. "Open Projects" list with highlighted active project and physical disk path.
 * 4. Recent projects memory persisted in localStorage.
 */

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Plus,
  Folder,
  GitFork,
  Check,
} from "lucide-react";
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

  // Keyboard shortcut: Cmd+O / Ctrl+O to open folder
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
    <div ref={dropdownRef} className="relative select-none text-[13px] font-sans">
      {/* ── Project Switcher Pill Button ──────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border transition-all ${
          isOpen
            ? "bg-[#27272a] border-zinc-600 text-white shadow-sm"
            : "bg-[#222226] hover:bg-[#2c2c31] border-[#38383e] text-zinc-200"
        }`}
        title={activeProject.path && activeProject.path !== "." ? `Active Project: ${activeProject.path}` : activeProject.name}
      >
        {/* Project Initial Colored Rounded Badge */}
        <div className="w-5 h-5 rounded bg-emerald-600/90 text-white font-bold flex items-center justify-center text-xs shadow-sm">
          {getInitial(activeProject.name)}
        </div>

        {/* Project Name */}
        <span className="font-semibold text-[13px] tracking-tight max-w-[140px] truncate text-zinc-100">
          {activeProject.name}
        </span>

        {/* Subtle Chevron Down */}
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-zinc-200" : ""
          }`}
        />
      </button>

      {/* ── Dropdown Menu Window ────────────────────────────────────────── */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#1e1e22] border border-[#38383e] rounded-2xl shadow-2xl z-50 p-1.5 text-[13px] text-zinc-200 animate-in fade-in zoom-in-95 duration-100 space-y-1 backdrop-blur-md font-sans">
          {/* Top Actions: New, Open, Clone */}
          <div className="space-y-0.5 pb-1 border-b border-zinc-800/80">
            {/* New Project */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNewProject();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-800/80 text-left text-zinc-200 hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4 text-zinc-400" />
              <span className="font-medium text-[13px]">New Project...</span>
            </button>

            {/* Open Folder */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenFolder();
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-zinc-800/80 text-left text-zinc-200 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Folder className="w-4 h-4 text-zinc-400" />
                <span className="font-medium text-[13px]">Open...</span>
              </div>
              <kbd className="text-[10px] font-mono text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60">
                ⌘O
              </kbd>
            </button>

            {/* Clone Repository */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onCloneRepo();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-800/80 text-left text-zinc-200 hover:text-white transition-colors"
            >
              <GitFork className="w-4 h-4 text-zinc-400" />
              <span className="font-medium text-[13px]">Clone Repository...</span>
            </button>
          </div>

          {/* Section: Open Projects */}
          <div className="pt-1">
            <div className="px-3 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Open Projects
            </div>

            <div className="space-y-1 mt-0.5">
              {recentProjects.map((p) => {
                const isActive = p.path === activeProject.path;

                return (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => {
                      if (!isActive) {
                        onSelectRecentProject(p.path);
                      }
                      setIsOpen(false);
                    }}
                    className={`flex items-start gap-2.5 p-2 rounded-xl cursor-pointer transition-all ${
                      isActive
                        ? "bg-[#1c3150] border border-[#264573] text-white shadow-sm"
                        : "hover:bg-zinc-800/60 text-zinc-300"
                    }`}
                  >
                    {/* Badge */}
                    <div
                      className={`w-6 h-6 rounded-lg text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 ${
                        isActive ? "bg-emerald-600" : "bg-zinc-700 text-zinc-300"
                      }`}
                    >
                      {getInitial(p.name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[13px] text-zinc-100 truncate">
                          {p.name}
                        </span>
                        {isActive && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
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
