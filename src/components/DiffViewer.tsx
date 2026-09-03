/**
 * DiffViewer.tsx — Unified Micro-Diff Inspection Component
 *
 * Renders AI-generated unified patches with clear visual highlighting:
 * 1. Green additions (+) and red removals (-).
 * 2. Hunk coordinates (@@ -x,y +a,b @@).
 * 3. File patch headers with context validation status badges.
 */

import { GitCompare, ShieldCheck } from "lucide-react";

interface DiffViewerProps {
  diffText: string;
  isVerified: boolean;
  onApplyToEditor?: () => void;
}

export function DiffViewer({
  diffText,
  isVerified,
}: DiffViewerProps) {
  if (!diffText || !diffText.trim()) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 select-none p-8">
        <GitCompare className="w-12 h-12 text-zinc-700 mb-3" />
        <p className="text-sm font-medium text-zinc-400">No Active Diff Patch</p>
        <p className="text-xs text-zinc-600 mt-1 max-w-sm text-center">
          When the Autonomous Agent generates code drafts, micro-diffs will appear here showing verified lines before they are committed to disk.
        </p>
      </div>
    );
  }

  const lines = diffText.split("\n");

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden font-mono text-xs">
      {/* Diff Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 select-none">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-zinc-200">Unified Micro-Diff Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {isVerified ? (
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              100% Gauntlet Verified
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              Staged / In Verification
            </span>
          )}
        </div>
      </div>

      {/* Diff Lines View */}
      <div className="flex-1 overflow-auto p-3 space-y-0.5 leading-5 select-text">
        {lines.map((line, idx) => {
          let style = "text-zinc-400 hover:bg-zinc-900";

          if (line.startsWith("---") || line.startsWith("+++")) {
            style = "text-sky-400 font-bold bg-sky-950/20 border-b border-sky-900/40 my-1 py-0.5";
          } else if (line.startsWith("@@")) {
            style = "text-purple-400 bg-purple-950/20 px-2 py-0.5 rounded my-1 font-semibold";
          } else if (line.startsWith("+")) {
            style = "text-emerald-300 bg-emerald-950/30 -mx-3 px-3";
          } else if (line.startsWith("-")) {
            style = "text-red-300 bg-red-950/30 -mx-3 px-3";
          }

          return (
            <div key={idx} className={`flex items-start ${style}`}>
              <span className="w-8 text-zinc-600 select-none text-right pr-2 shrink-0 text-[10px]">
                {idx + 1}
              </span>
              <pre className="font-mono whitespace-pre overflow-x-auto flex-1">{line}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DiffViewer;
