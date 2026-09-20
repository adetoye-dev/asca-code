/**
 * SourceControlSidebar.tsx — Production VS Code Git Source Control View
 *
 * Implements:
 * 1. Distinct "STAGED CHANGES" and "CHANGES" (unstaged) sections with counts.
 * 2. Stage (+), Unstage (-), Discard (↩), Stage All (+), and Unstage All (-).
 * 3. Clicking any file opens the real Git diff in Monaco Diff Editor
 *    (HEAD vs Index for staged files, Index vs Working Tree for unstaged files).
 * 4. Commit message input with direct git commit execution.
 */

import { useState, useEffect } from "react";
import { Plus, Minus, ChevronRight, Check, ChevronUp, GitPullRequest, ChevronDown, RefreshCw, AlertCircle } from "lucide-react";
import { Icon } from "../ui/Icon";

import { FileIcon } from "../ui/FileIcon";
import { gitFetch } from "../../services/gitClient";

export interface ChangedGitFile {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  isStaged: boolean;
}

interface SourceControlSidebarProps {
  projectCwd: string;
  onOpenDiff: (filePath: string, originalContent: string, modifiedContent: string, isStaged?: boolean) => void;
  onRefreshFiles: () => void;
}

export function SourceControlSidebar({
  projectCwd,
  onOpenDiff,
  onRefreshFiles,
}: SourceControlSidebarProps) {
  const [branch, setBranch] = useState("main");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<ChangedGitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<ChangedGitFile[]>([]);
  const [isStagedOpen, setIsStagedOpen] = useState(true);
  const [isUnstagedOpen, setIsUnstagedOpen] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const res = await gitFetch("/api/git/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      if (res.ok) {
        const data = await res.json();
        setBranch(data.branch || "main");
        setAhead(data.ahead || 0);
        setBehind(data.behind || 0);
        setStagedFiles(data.staged || []);
        setUnstagedFiles(data.unstaged || []);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Re-runs when the project changes, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCwd]);

  const handleOpenFileDiff = async (file: ChangedGitFile, isStaged: boolean) => {
    try {
      const res = await gitFetch("/api/git/diff-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd, filePath: file.path, staged: isStaged }),
      });
      if (res.ok) {
        const data = await res.json();
        onOpenDiff(file.path, data.originalContent || "", data.modifiedContent || "", isStaged);
      }
    } catch (err: any) {
      setStatusMsg(`Diff error: ${err.message}`);
    }
  };

  const handleStageFile = async (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await gitFetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd, filePath }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Stage operation failed");
      await fetchStatus();
      onRefreshFiles();
    } catch (err: any) { setStatusMsg(`Stage error: ${err.message}`); }
  };

  const handleUnstageFile = async (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await gitFetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd, filePath }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unstage operation failed");
      await fetchStatus();
      onRefreshFiles();
    } catch (err: any) { setStatusMsg(`Unstage error: ${err.message}`); }
  };

  const handleStageAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await gitFetch("/api/git/stage-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Stage all operation failed");
      await fetchStatus();
      onRefreshFiles();
    } catch (err: any) { setStatusMsg(`Stage all error: ${err.message}`); }
  };

  const handleUnstageAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await gitFetch("/api/git/unstage-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unstage all operation failed");
      await fetchStatus();
      onRefreshFiles();
    } catch (err: any) { setStatusMsg(`Unstage all error: ${err.message}`); }
  };

  const handleDiscardFile = async (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const confirmed = window.confirm(
      `Discard all changes in ${filePath}? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const res = await gitFetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectCwd, filePath }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Discard operation failed");
      await fetchStatus();
      onRefreshFiles();
    } catch (err: any) { setStatusMsg(`Discard error: ${err.message}`); }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      setStatusMsg("Please enter a commit message.");
      return;
    }

    setIsCommitting(true);
    setStatusMsg(null);

    const shouldStageAll = stagedFiles.length === 0 && unstagedFiles.length > 0;

    try {
      const res = await gitFetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: projectCwd,
          message: commitMessage.trim(),
          stageAll: shouldStageAll,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCommitMessage("");
        setStatusMsg("Changes committed successfully!");
        fetchStatus();
        onRefreshFiles();
      } else {
        setStatusMsg(data.error || "Commit failed.");
      }
    } catch (err: any) {
      setStatusMsg(`Commit error: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  const getStatusBadge = (file: ChangedGitFile) => {
    if (file.indexStatus === "A" || file.workTreeStatus === "?") {
      return <span className="text-3xs font-bold text-emerald-400 font-mono">U</span>;
    }
    if (file.indexStatus === "D" || file.workTreeStatus === "D") {
      return <span className="text-3xs font-bold text-red-400 font-mono">D</span>;
    }
    return <span className="text-3xs font-bold text-amber-400 font-mono">M</span>;
  };

  const totalChanges = stagedFiles.length + unstagedFiles.length;

  return (
    <div className="flex flex-col h-full w-full bg-workbench select-none text-body text-zinc-300 font-sans">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-zinc-300 text-2xs">
            <Icon icon={GitPullRequest} className="w-4 h-4 text-primary-icon" />
            <span>Source Control</span>
          </div>

          <button
            type="button"
            onClick={fetchStatus}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh Git Status"
          >
            <Icon icon={RefreshCw} className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Branch & Sync Status */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-sans">
          <div className="flex items-center gap-1.5 font-medium text-zinc-200 truncate">
            <span className="text-zinc-400">branch:</span>
            <span className="font-mono text-accent truncate">{branch}</span>
          </div>

          {(ahead > 0 || behind > 0) && (
            <div className="flex items-center gap-2 font-mono text-3xs">
              {ahead > 0 && (
                <span className="flex items-center gap-0.5 text-emerald-400 font-semibold">
                  <Icon icon={ChevronUp} className="w-3 h-3" />
                  <span>{ahead}</span>
                </span>
              )}
              {behind > 0 && (
                <span className="flex items-center gap-0.5 text-amber-400 font-semibold">
                  <Icon icon={ChevronDown} className="w-3 h-3" />
                  <span>{behind}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Commit Message Box */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <textarea
          rows={3}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Message (Cmd+Enter to commit)"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleCommit();
            }
          }}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-body text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 resize-none font-sans"
        />

        {statusMsg && (
          <div
            className={`p-2 rounded-lg text-xs font-mono flex items-start gap-1.5 ${
              statusMsg.includes("success")
                ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                : "bg-red-950/40 border border-red-500/40 text-red-300"
            }`}
          >
            <Icon icon={statusMsg.includes("success") ? Check : AlertCircle} className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{statusMsg}</span>
          </div>
        )}

        <button
          type="button"
          disabled={isCommitting || !commitMessage.trim()}
          onClick={handleCommit}
          className={`w-full py-2 px-3 rounded-xl font-semibold text-body text-white shadow-sm flex items-center justify-center gap-1.5 transition-all font-sans ${
            isCommitting || !commitMessage.trim()
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              : "bg-primary-action hover:bg-primary-action/90 shadow-sm cursor-pointer"
          }`}
        >
          {isCommitting ? (
            <Icon icon={RefreshCw} className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Icon icon={Check} className="w-3.5 h-3.5" />
          )}
          <span>
            {stagedFiles.length > 0
              ? `Commit to ${branch} (Staged)`
              : `Stage All & Commit to ${branch}`}
          </span>
        </button>
      </div>

      {/* Changes Accordions Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3 font-sans">
        {totalChanges === 0 ? (
          <div className="p-6 text-center text-zinc-400 text-xs">
            Working tree clean. No modified or untracked files.
          </div>
        ) : (
          <>
            {/* ── STAGED CHANGES ────────────────────────────────────────── */}
            {stagedFiles.length > 0 && (
              <div className="space-y-1">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isStagedOpen}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setIsStagedOpen((prev) => !prev);
                    }
                  }}
                  onClick={() => setIsStagedOpen((prev) => !prev)}
                  className="flex items-center justify-between px-2 py-1 text-2xs font-semibold text-emerald-400 hover:bg-zinc-800/60 rounded cursor-pointer group uppercase tracking-wider"
                >
                  <div className="flex items-center gap-1.5">
                    {isStagedOpen ? (
                      <Icon icon={ChevronDown} className="w-3.5 h-3.5 text-zinc-400" />
                    ) : (
                      <Icon icon={ChevronRight} className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>STAGED CHANGES</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUnstageAll}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-100 transition-all"
                      title="Unstage All Changes"
                    >
                      <Icon icon={Minus} className="w-3 h-3" />
                    </button>
                    <span className="font-mono text-3xs px-1.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                      {stagedFiles.length}
                    </span>
                  </div>
                </div>

                {isStagedOpen && (
                  <div className="space-y-0.5 pl-1">
                    {stagedFiles.map((file) => (
                      <div
                        key={file.path}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleOpenFileDiff(file, true);
                          }
                        }}
                        onClick={() => handleOpenFileDiff(file, true)}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/80 cursor-pointer transition-colors group"
                        title={`Click to review staged git diff for ${file.path}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 truncate">
                          <FileIcon fileName={file.path} className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-zinc-100 group-hover:text-white truncate font-medium text-body font-sans">
                            {file.path.split("/").pop()}
                          </span>
                          <span className="text-xs text-zinc-400 truncate ml-1 font-sans">
                            {file.path.split("/").slice(0, -1).join("/")}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 pl-2">
                          <button
                            type="button"
                            onClick={(e) => handleUnstageFile(file.path, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-amber-400 transition-all"
                            title="Unstage Changes"
                          >
                            <Icon icon={Minus} className="w-3.5 h-3.5" />
                          </button>
                          {getStatusBadge(file)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── CHANGES (UNSTAGED) ────────────────────────────────────── */}
            <div className="space-y-1">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isUnstagedOpen}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsUnstagedOpen((prev) => !prev);
                  }
                }}
                onClick={() => setIsUnstagedOpen((prev) => !prev)}
                className="flex items-center justify-between px-2 py-1 text-2xs font-semibold text-zinc-300 hover:bg-zinc-800/60 rounded cursor-pointer group uppercase tracking-wider"
              >
                <div className="flex items-center gap-1.5">
                  {isUnstagedOpen ? (
                    <Icon icon={ChevronDown} className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <Icon icon={ChevronRight} className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>CHANGES</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStageAll}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-100 transition-all"
                    title="Stage All Changes"
                  >
                    <Icon icon={Plus} className="w-3 h-3" />
                  </button>
                  <span className="font-mono text-3xs px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {unstagedFiles.length}
                  </span>
                </div>
              </div>

              {isUnstagedOpen && (
                <div className="space-y-0.5 pl-1">
                  {unstagedFiles.map((file) => (
                    <div
                      key={file.path}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenFileDiff(file, false);
                        }
                      }}
                      onClick={() => handleOpenFileDiff(file, false)}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/80 cursor-pointer transition-colors group"
                      title={`Click to review git diff for ${file.path}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 truncate">
                        <FileIcon fileName={file.path} className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-zinc-100 group-hover:text-white truncate font-medium text-body font-sans">
                          {file.path.split("/").pop()}
                        </span>
                        <span className="text-xs text-zinc-400 truncate ml-1 font-sans">
                          {file.path.split("/").slice(0, -1).join("/")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 pl-2">
                        <button
                          type="button"
                          onClick={(e) => handleDiscardFile(file.path, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-red-400 transition-all"
                          title="Discard Changes"
                        >
                          <Icon icon={RefreshCw} className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleStageFile(file.path, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-emerald-400 transition-all"
                          title="Stage Changes"
                        >
                          <Icon icon={Plus} className="w-3.5 h-3.5" />
                        </button>
                        {getStatusBadge(file)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SourceControlSidebar;
