/**
 * VersionControlDropdown.tsx — Real Git Branch Switcher & Quick Actions Dropdown
 *
 * Implements:
 * 1. Live Git branch status & ahead/behind tracker.
 * 2. Branch switcher: lists branches with 1-click checkout (git checkout <branch>).
 * 3. Create branch inline (+ New Branch...).
 * 4. Fetch, Pull, and Push execution buttons.
 */

import { useState, useEffect, useRef } from "react";
import {
  GitBranch,
  ChevronDown,
  Plus,
  ArrowDown,
  ArrowUp,
  Check,
  AlertCircle,
} from "lucide-react";

interface VersionControlDropdownProps {
  projectCwd: string;
  onBranchChanged?: () => void;
}

interface GitBranchItem {
  name: string;
  current: boolean;
}

export function VersionControlDropdown({
  projectCwd,
  onBranchChanged,
}: VersionControlDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeBranch, setActiveBranch] = useState<string>("main");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [isGit, setIsGit] = useState(true);
  const [branches, setBranches] = useState<GitBranchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchGitStatus = async () => {
    try {
      const res = await fetch("/api/git/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsGit(data.isGit);
        setActiveBranch(data.branch || "main");
        setAhead(data.ahead || 0);
        setBehind(data.behind || 0);
      }
    } catch {}
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch("/api/git/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
      }
    } catch {}
  };

  useEffect(() => {
    fetchGitStatus();
  }, [projectCwd]);

  useEffect(() => {
    if (isOpen) {
      fetchGitStatus();
      fetchBranches();
      setActionMsg(null);
      setIsCreatingBranch(false);
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleCheckout = async (branchName: string) => {
    setIsLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd, branch: branchName }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActiveBranch(branchName);
        fetchBranches();
        onBranchChanged?.();
        setIsOpen(false);
      } else {
        setActionMsg(`Checkout failed: ${data.error || "The branch could not be checked out."}`);
      }
    } catch (err: any) {
      setActionMsg(`Checkout error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: projectCwd,
          branch: newBranchName.trim(),
          createNew: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveBranch(newBranchName.trim());
        setNewBranchName("");
        setIsCreatingBranch(false);
        fetchBranches();
        onBranchChanged?.();
        setIsOpen(false);
      } else {
        setActionMsg(`Create branch failed: ${data.error}`);
      }
    } catch (err: any) {
      setActionMsg(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePull = async () => {
    setIsLoading(true);
    setActionMsg("Pulling from remote...");
    try {
      const res = await fetch("/api/git/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMsg("Successfully pulled latest changes!");
        fetchGitStatus();
        onBranchChanged?.();
      } else {
        setActionMsg(`Pull failed: ${data.error || "The latest changes could not be pulled."}`);
      }
    } catch (err: any) {
      setActionMsg(`Pull error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePush = async () => {
    setIsLoading(true);
    setActionMsg("Pushing to remote...");
    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      const data = await res.json();
      setActionMsg(data.success ? "Successfully pushed changes!" : data.error);
      fetchGitStatus();
    } catch (err: any) {
      setActionMsg(`Push error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isGit) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-zinc-400 text-xs font-medium font-sans">
        <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
        <span>No Git Repo</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative select-none text-[13px] font-sans">
      {/* ── Version Control Pill Button ───────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-xs font-medium ${
          isOpen
            ? "bg-[#27272a] border-zinc-600 text-white shadow-sm"
            : "bg-[#222226] hover:bg-[#2c2c31] border-[#38383e] text-zinc-200 hover:text-white"
        }`}
        title={`Git Branch: ${activeBranch}`}
      >
        <GitBranch className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span className="truncate max-w-[120px] font-mono text-xs">{activeBranch}</span>
        {(ahead > 0 || behind > 0) && (
          <span className="flex items-center gap-0.5 text-[10px] font-mono text-zinc-300">
            {ahead > 0 && <span className="text-emerald-400 font-semibold">↑{ahead}</span>}
            {behind > 0 && <span className="text-amber-400 font-semibold">↓{behind}</span>}
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-zinc-400 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-zinc-200" : ""
          }`}
        />
      </button>

      {/* ── Dropdown Window ─────────────────────────────────────────────── */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#1e1e22] border border-[#38383e] rounded-2xl shadow-2xl z-50 p-2 text-[13px] text-zinc-200 animate-in fade-in zoom-in-95 duration-100 space-y-2 backdrop-blur-md font-sans">
          {/* Header Info */}
          <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
            <div className="flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-sky-400" />
              <span className="font-semibold text-zinc-100 text-[13px] truncate font-mono">{activeBranch}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-300 font-mono">
              <span className="flex items-center gap-0.5">
                <ArrowUp className="w-3 h-3 text-emerald-400" />
                <span>{ahead} ahead</span>
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowDown className="w-3 h-3 text-amber-400" />
                <span>{behind} behind</span>
              </span>
            </div>
          </div>

          {/* Quick Remote Sync Buttons: Pull & Push */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePull}
              className="py-1.5 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowDown className="w-3 h-3 text-sky-400" />
              <span>Pull</span>
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePush}
              className="py-1.5 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowUp className="w-3 h-3 text-emerald-400" />
              <span>Push</span>
            </button>
          </div>

          {/* Status Message */}
          {actionMsg && (
            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 font-mono flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
              <span className="break-all">{actionMsg}</span>
            </div>
          )}

          {/* New Branch Trigger or Input */}
          <div className="pt-1">
            {!isCreatingBranch ? (
              <button
                type="button"
                onClick={() => setIsCreatingBranch(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-zinc-800 text-zinc-200 hover:text-white transition-colors text-[13px]"
              >
                <Plus className="w-3.5 h-3.5 text-zinc-400" />
                <span>New Branch...</span>
              </button>
            ) : (
              <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-700 rounded-xl">
                <input
                  type="text"
                  value={newBranchName}
                  autoFocus
                  placeholder="Branch name (e.g. feature/login)"
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateBranch();
                    if (e.key === "Escape") setIsCreatingBranch(false);
                  }}
                  className="flex-1 bg-transparent px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={handleCreateBranch}
                  className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs"
                >
                  Create
                </button>
              </div>
            )}
          </div>

          {/* Branches List */}
          <div className="pt-1 border-t border-zinc-800">
            <div className="px-2 py-0.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Branches
            </div>

            <div className="max-h-40 overflow-y-auto space-y-0.5 mt-1">
              {branches.map((b) => {
                const isCurrent = b.name === activeBranch;
                return (
                  <div
                    key={b.name}
                    onClick={() => {
                      if (!isCurrent) handleCheckout(b.name);
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-[13px] ${
                      isCurrent
                        ? "bg-sky-500/15 text-sky-300 font-medium"
                        : "hover:bg-zinc-800/80 text-zinc-300 hover:text-zinc-100"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <GitBranch className={`w-3.5 h-3.5 ${isCurrent ? "text-sky-400" : "text-zinc-400"}`} />
                      <span className="truncate font-mono text-xs">{b.name}</span>
                    </div>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VersionControlDropdown;
