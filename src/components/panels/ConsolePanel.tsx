/**
 * ConsolePanel.tsx — Live Output console.
 *
 * Renders the agent run's diagnostic log with colorized streams. When the chat
 * shows nothing, this is where to look.
 */

import { useRef, useEffect } from "react";
import type { PipelineOutputLine } from "../../types/telemetry";

interface ConsolePanelProps {
  activityLog: PipelineOutputLine[];
  onClear?: () => void;
  status?: string;
}

export function ConsolePanel({ activityLog }: ConsolePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog]);

  return (
    <div className="flex flex-col h-full w-full bg-workbench overflow-hidden select-none font-mono text-xs">
      {/* Console Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-workbench text-xs leading-relaxed font-mono">
        {activityLog.length === 0 ? (
          <div className="text-zinc-400 py-4 font-sans text-xs">
            No output yet. Run an agent task and the runtime's step-by-step log appears here.
          </div>
        ) : (
          activityLog.map((line, idx) => {
            const isErr = line.stream === "stderr" || line.content.includes("ERROR") || line.content.includes("FAILED");
            const isPass = line.content.includes("PASSED") || line.content.includes("ALL GATES PASSED") || line.content.includes("Written:");
            const isInfo = line.content.includes("INFO") || line.content.includes("Orchestrator");

            return (
              <div
                key={idx}
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
                <span className="text-zinc-500 select-none w-8 text-right shrink-0 font-mono text-[11px]">
                  {line.line_number || idx + 1}
                </span>
                <span className="break-all whitespace-pre-wrap flex-1">{line.content}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ConsolePanel;
