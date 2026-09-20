/**
 * ConsolePanel.tsx — Live Output console.
 *
 * Renders the agent run's diagnostic log with colorized streams. When the chat
 * shows nothing, this is where to look.
 *
 * Two behaviours here are deliberate and were bugs before:
 *
 * 1. Only the tail is rendered. A run can print thousands of lines, and every
 *    append used to rebuild a row for all of them — the full log is still in
 *    state, but the DOM holds the last MAX_RENDERED_LINES and says how many it
 *    is not showing.
 * 2. Appends only follow the tail while the reader is already at the bottom.
 *    The old unconditional `scrollIntoView` dragged anyone who had scrolled up
 *    back down on every single line, which made a running log unreadable.
 */

import { useRef, useEffect } from "react";
import type { PipelineOutputLine } from "../../types/telemetry";
import { isFollowingBottom, tailWindow } from "../../services/scrollAnchor";

interface ConsolePanelProps {
  activityLog: PipelineOutputLine[];
  onClear?: () => void;
  status?: string;
}

/** Rows kept in the DOM. The log itself is not truncated. */
const MAX_RENDERED_LINES = 500;

export function ConsolePanel({ activityLog }: ConsolePanelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!isFollowingBottom(scroller)) return;
    // Instant, not `smooth`: a run appends in bursts, and a smooth scroll
    // restarted on every line never settles — it reads as jitter.
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [activityLog]);

  const { items: visibleLines, hidden } = tailWindow(activityLog, MAX_RENDERED_LINES);

  return (
    <div className="flex flex-col h-full w-full bg-workbench overflow-hidden select-none font-mono text-xs">
      {/* Console Body */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto p-3 space-y-1 bg-workbench text-xs leading-relaxed font-mono"
      >
        {activityLog.length === 0 ? (
          <div className="text-zinc-400 py-4 font-sans text-xs">
            No output yet. Run an agent task and the runtime's step-by-step log appears here.
          </div>
        ) : (
          <>
            {hidden > 0 && (
              <div className="text-zinc-400 py-1.5 font-sans text-2xs border-b border-[var(--vscode-border)] mb-1.5">
                Showing the last {visibleLines.length} lines — {hidden.toLocaleString()} earlier{" "}
                {hidden === 1 ? "line is" : "lines are"} trimmed. The full log is kept for this run.
              </div>
            )}
            {visibleLines.map((line, idx) => {
              const isErr = line.stream === "stderr" || line.content.includes("ERROR") || line.content.includes("FAILED");
              const isPass = line.content.includes("PASSED") || line.content.includes("ALL GATES PASSED") || line.content.includes("Written:");
              const isInfo = line.content.includes("INFO") || line.content.includes("Orchestrator");

              return (
                <div
                  key={hidden + idx}
                  className={`flex items-start gap-2.5 ${
                    isErr
                      ? "text-red-400"
                      : isPass
                        ? "text-emerald-400 font-semibold"
                        : isInfo
                          ? "text-zinc-200"
                          : "text-zinc-300"
                  }`}
                >
                  <span className="text-zinc-500 select-none w-8 text-right shrink-0 font-mono text-2xs">
                    {line.line_number || hidden + idx + 1}
                  </span>
                  <span className="break-all whitespace-pre-wrap flex-1">{line.content}</span>
                </div>
              );
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ConsolePanel;
