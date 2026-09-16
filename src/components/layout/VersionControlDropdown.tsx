/**
 * VersionControlDropdown.tsx — Real Git Branch Switcher & Quick Actions Dropdown
 *
 * Implements:
 * 1. Mathematical concentric geometry (R_outer = 12px, P = 4px, R_item = 8px)
 * 2. Standardized Hugeicons stroke-rounded iconography
 * 3. 5-Glyph Universal Lifecycle status chips (Success, In-Progress, Needs Action, Pending, Open)
 * 4. Pull, Push, Checkout, and Branch creation workflows
 */

import { useState, useEffect, useRef } from "react";
import { Plus, Info, Check, ChevronUp, ChevronDown, GitBranch } from "lucide-react";
import { Icon } from "../ui/Icon";
import { StatusGlyph, StatusChip } from "../ui/StatusGlyph";

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

  // Click outside or press Escape to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
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
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-workbench border border-hairline text-zinc-400 text-xs font-medium font-sans">
        <StatusGlyph status="open" size="xs" />
        <span>No Git Repo</span>
      </div>
    );
  }

  // 5-Glyph status logic for titlebar branch pill
  const branchStatus = isLoading
    ? "progress"
    : behind > 0
    ? "action"
    : ahead > 0
    ? "pending"
    : "success";

  return (
    <div ref={dropdownRef} className="relative select-none text-[13px] font-sans">
      {/* ── Version Control Pill Button ───────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-pill border transition-all text-xs font-medium ${
          isOpen
            ? "bg-surface-active border-hairline text-white shadow-elevation-1"
            : "bg-workbench hover:bg-surface border-hairline text-zinc-200 hover:text-white"
        }`}
        title={`Git Branch: ${activeBranch}`}
      >
        <Icon icon={GitBranch} size="xs" className="text-zinc-400 shrink-0" />
        <span className="truncate max-w-[120px] font-mono text-xs">{activeBranch}</span>

        {/* 5-glyph status indicator */}
        <StatusGlyph status={branchStatus} size="xs" pulse={isLoading} />

        {(ahead > 0 || behind > 0) && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-300">
            {ahead > 0 && <span className="text-emerald-400 font-semibold">↑{ahead}</span>}
            {behind > 0 && <span className="text-amber-400 font-semibold">↓{behind}</span>}
          </span>
        )}

        <Icon icon={ChevronDown}
          size="xs"
          className={`text-zinc-400 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-zinc-200" : ""
          }`}
        />
      </button>

      {/* ── Dropdown Window (Concentric R_outer = 12px, P = 4px, R_item = 8px) ── */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-72 bg-overlay border border-hairline rounded-dropdown shadow-elevation-3 z-50 p-1 text-[13px] text-zinc-200 animate-in fade-in zoom-in-95 duration-100 space-y-1.5 backdrop-blur-xl font-sans">
          {/* Header Info */}
          <div className="flex items-center justify-between p-2 pb-1.5 border-b border-hairline">
            <div className="flex items-center gap-1.5">
              <Icon icon={GitBranch} size="sm" className="text-zinc-300" />
              <span className="font-semibold text-zinc-100 text-[13px] truncate font-mono">{activeBranch}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <StatusChip status="progress" label="Syncing..." size="xs" pulse />
              ) : ahead === 0 && behind === 0 ? (
                <StatusChip status="success" label="Synced" size="xs" />
              ) : ahead > 0 && behind > 0 ? (
                <StatusChip status="action" label={`↑${ahead} ↓${behind}`} size="xs" />
              ) : ahead > 0 ? (
                <StatusChip status="pending" label={`Ahead ${ahead}`} size="xs" />
              ) : (
                <StatusChip status="action" label={`Behind ${behind}`} size="xs" />
              )}
            </div>
          </div>

          {/* Quick Remote Sync Buttons: Pull & Push */}
          <div className="grid grid-cols-2 gap-1 px-1">
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePull}
              className="py-1.5 px-2.5 rounded-[8px] bg-surface hover:bg-surface-hover text-zinc-200 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors border border-hairline disabled:opacity-50"
            >
              <Icon icon={ChevronDown} size="xs" className="text-zinc-300" />
              <span>Pull</span>
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePush}
              className="py-1.5 px-2.5 rounded-[8px] bg-surface hover:bg-surface-hover text-zinc-200 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors border border-hairline disabled:opacity-50"
            >
              <Icon icon={ChevronUp} size="xs" className="text-emerald-400" />
              <span>Push</span>
            </button>
          </div>

          {/* Status Message */}
          {actionMsg && (
            <div className="mx-1 p-2 rounded-[8px] bg-workbench border border-hairline text-xs text-zinc-200 font-mono flex items-start gap-1.5">
              <Icon icon={Info} size="xs" className="text-zinc-400 shrink-0 mt-0.5" />
              <span className="break-all">{actionMsg}</span>
            </div>
          )}

          {/* New Branch Trigger or Input */}
          <div className="px-1 pt-0.5">
            {!isCreatingBranch ? (
              <button
                type="button"
                onClick={() => setIsCreatingBranch(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] hover:bg-surface-hover text-zinc-200 hover:text-white transition-colors text-[13px]"
              >
                <Icon icon={Plus} size="xs" className="text-zinc-400" />
                <span>New Branch...</span>
              </button>
            ) : (
              <div className="flex items-center gap-1 p-1 bg-surface border border-hairline rounded-[8px]">
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
                  className="px-2.5 py-1 rounded-[4px] bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600 font-semibold text-xs transition-colors"
                >
                  Create
                </button>
              </div>
            )}
          </div>

          {/* Branches List */}
          <div className="pt-1 border-t border-hairline">
            <div className="px-2.5 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Branches
            </div>

            <div className="max-h-40 overflow-y-auto space-y-0.5 mt-0.5 px-1">
              {branches.map((b) => {
                const isCurrent = b.name === activeBranch;
                return (
                  <button
                    type="button"
                    key={b.name}
                    onClick={() => {
                      if (!isCurrent) handleCheckout(b.name);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[8px] cursor-pointer transition-colors text-[13px] text-left ${
                      isCurrent
                        ? "bg-zinc-800/90 text-zinc-100 font-medium"
                        : "hover:bg-surface-hover text-zinc-300 hover:text-zinc-100"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Icon icon={GitBranch}
                        size="xs"
                        className={isCurrent ? "text-zinc-200" : "text-zinc-400"}
                      />
                      <span className="truncate font-mono text-xs">{b.name}</span>
                    </div>
                    {isCurrent && <Icon icon={Check} size="xs" className="text-zinc-200 shrink-0" />}
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

export default VersionControlDropdown;
