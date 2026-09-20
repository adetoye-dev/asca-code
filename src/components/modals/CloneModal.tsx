/**
 * CloneModal.tsx — Real Git Repository Clone Modal
 *
 * Provides:
 * 1. Remote repository URL input with validation.
 * 2. Destination folder selection (with native OS folder picker).
 * 3. Real git clone execution with live progress output.
 * 4. Automatic workspace opening on completion.
 */

import { useRef, useState } from "react";
import { CheckCircle2, AlertCircle, GitFork, RefreshCw, Folder, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import { gitFetch } from "../../services/gitClient";

interface CloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPickFolder: () => Promise<string | null>;
  onCloneSuccess: (clonedPath: string) => void;
}

export function CloneModal({
  isOpen,
  onClose,
  onPickFolder,
  onCloneSuccess,
}: CloneModalProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Tab stays in, Escape closes, focus comes back. This dialog had none of the
  // three, so the only way out of it was the mouse.
  useDialogA11y(dialogRef, onClose, isOpen);

  if (!isOpen) return null;

  const handleBrowseDestination = async () => {
    const picked = await onPickFolder();
    if (picked) {
      setTargetDir(picked);
    }
  };

  const handleUrlChange = (val: string) => {
    setRepoUrl(val);
    if (!targetDir && val) {
      const repoName = val.split("/").pop()?.replace(/\.git$/, "") || "";
      if (repoName) {
        setTargetDir(`~/Desktop/${repoName}`);
      }
    }
  };

  const handleClone = async () => {
    if (!repoUrl.trim()) {
      setStatusMsg({ type: "error", text: "Please enter a repository URL." });
      return;
    }

    setIsCloning(true);
    setStatusMsg({ type: "info", text: "Cloning repository from remote..." });

    try {
      const res = await gitFetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: repoUrl.trim(),
          targetDir: targetDir.startsWith("~/")
            ? targetDir // Backend can expand ~/ or use absolute path
            : targetDir.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMsg({ type: "success", text: `Repository cloned to: ${data.targetDir}` });
        setTimeout(() => {
          onCloneSuccess(data.targetDir);
          onClose();
        }, 800);
      } else {
        setStatusMsg({ type: "error", text: data.error || "Failed to clone repository." });
      }
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Clone error: ${err.message || String(err)}` });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Clone a repository"
      className="fixed inset-0 z-modal bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-100"
    >
      <div className="w-full max-w-lg bg-modal/95 backdrop-blur-xl border border-hairline rounded-modal shadow-elevation-3 p-5 space-y-4 text-xs text-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-purple-950/40 border border-purple-500/40 flex items-center justify-center text-purple-300">
              <Icon icon={GitFork} className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-zinc-100">Clone Repository</h3>
              <p className="text-2xs text-zinc-400">Clone a remote Git repository to your local machine</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <Icon icon={X} className="w-4 h-4" />
          </button>
        </div>

        {/* Form Inputs */}
        <div className="space-y-3">
          {/* Repo URL */}
          <div>
            <label htmlFor="clonemodal-repository-url-1" className="text-2xs font-semibold text-zinc-300">Repository URL</label>
            <input id="clonemodal-repository-url-1"
              type="text"
              value={repoUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://github.com/username/repository.git or git@github.com:..."
              className="w-full mt-1 bg-workbench border border-hairline rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60 font-mono"
            />
          </div>

          {/* Destination Path */}
          <div>
            <label htmlFor="clonemodal-destination-directory-2" className="text-2xs font-semibold text-zinc-300">Destination Directory</label>
            <div className="flex items-center gap-2 mt-1">
              <input id="clonemodal-destination-directory-2"
                type="text"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="~/Desktop/my-project"
                className="flex-1 bg-workbench border border-hairline rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60 font-mono"
              />
              <button
                type="button"
                onClick={handleBrowseDestination}
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium text-xs flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Icon icon={Folder} className="w-3.5 h-3.5 text-purple-400" />
                <span>Browse...</span>
              </button>
            </div>
          </div>
        </div>

        {/* Status Feedback */}
        {statusMsg && (
          <div
            className={`p-2.5 rounded-xl border flex items-start gap-2 text-2xs ${
              statusMsg.type === "info"
                ? "bg-purple-950/40 border-purple-500/40 text-purple-300"
                : statusMsg.type === "success"
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                : "bg-red-950/40 border-red-500/40 text-red-300"
            }`}
          >
            {statusMsg.type === "info" && <Icon icon={RefreshCw} className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5" />}
            {statusMsg.type === "success" && <Icon icon={CheckCircle2} className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
            {statusMsg.type === "error" && <Icon icon={AlertCircle} className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
            <span className="font-mono break-all">{statusMsg.text}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
          <button
            type="button"
            disabled={isCloning}
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isCloning || !repoUrl.trim()}
            onClick={handleClone}
            className={`px-5 py-2 rounded-xl text-white font-bold flex items-center gap-2 transition-all ${
              isCloning || !repoUrl.trim()
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-600/20 cursor-pointer"
            }`}
          >
            {isCloning ? (
              <>
                <Icon icon={RefreshCw} className="w-3.5 h-3.5 animate-spin" />
                <span>Cloning...</span>
              </>
            ) : (
              <>
                <Icon icon={GitFork} className="w-3.5 h-3.5" />
                <span>Clone</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CloneModal;
