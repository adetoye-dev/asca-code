/**
 * GauntletDrawer.tsx — Bottom Verification & Telemetry Drawer
 *
 * Integrated dockable bottom panel housing:
 * 1. Verification Console: live stdout/stderr streams from linters, test runner, and sandbox.
 * 2. Telemetry Scorecard: RPS, latency percentiles, hosting costs, and verification status.
 * 3. Security Policy: active sandbox chroot path and network containment status.
 */

import { useState } from "react";
import {
  Terminal,
  Activity,
  Shield,
  ChevronDown,
  ChevronUp,
  Trash2,
  CheckCircle,
} from "lucide-react";
import { TelemetryScorecard } from "./TelemetryScorecard";
import type { SliderLevel } from "./TradeOffSliders";
import type {
  TelemetryData,
  OrchestrationResult,
  PipelineOutputLine,
  SystemMetrics,
  PipelineStatus,
} from "./TelemetryScorecard";

export interface SecurityStatus {
  filesystemChroot: "verified" | "blocked" | "informational";
  environmentSanitization: "verified" | "blocked" | "informational";
  networkEgress: "verified" | "blocked" | "informational";
  details?: {
    filesystem?: string;
    environment?: string;
    network?: string;
  };
}

interface GauntletDrawerProps {
  activityLog: PipelineOutputLine[];
  telemetry: TelemetryData | null;
  orchestrationResult: OrchestrationResult | null;
  pipelineStatus: PipelineStatus;
  systemMetrics: SystemMetrics | null;
  sliderScale: SliderLevel;
  securityStatus?: SecurityStatus | null;
  onClearLog: () => void;
}

export function GauntletDrawer({
  activityLog,
  telemetry,
  orchestrationResult,
  pipelineStatus,
  systemMetrics,
  sliderScale,
  securityStatus = null,
  onClearLog,
}: GauntletDrawerProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"console" | "telemetry" | "security">("console");

  const isRunning = pipelineStatus === "running";

  return (
    <div
      className={`flex flex-col border-t border-zinc-800 bg-zinc-950 transition-all duration-200 select-none ${
        isExpanded ? "h-64" : "h-9"
      }`}
    >
      {/* Drawer Header / Tab Bar */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-zinc-800/80 bg-zinc-900/80 shrink-0 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab("console");
              setIsExpanded(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              activeTab === "console" && isExpanded
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>Verification Console</span>
            {activityLog.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-700 text-zinc-300">
                {activityLog.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("telemetry");
              setIsExpanded(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              activeTab === "telemetry" && isExpanded
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Performance Scorecard</span>
            {telemetry && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("security");
              setIsExpanded(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              activeTab === "security" && isExpanded
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-purple-400" />
            <span>Sandbox Containment</span>
          </button>
        </div>

        {/* Right Status & Controls */}
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-1.5 text-sky-400 text-[11px] font-medium mr-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span>Gauntlet Active...</span>
            </div>
          )}

          {activeTab === "console" && (
            <button
              type="button"
              title="Clear Log"
              onClick={onClearLog}
              className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            title={isExpanded ? "Collapse Panel" : "Expand Panel"}
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Drawer Content */}
      {isExpanded && (
        <div className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs select-text">
          {activeTab === "console" && (
            <div className="space-y-1">
              {activityLog.length === 0 ? (
                <div className="text-zinc-600 italic py-4 text-center">
                  Verification console idle. Output from ruff, mypy, oracle tests, and load benchmarks will stream here.
                </div>
              ) : (
                activityLog.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 leading-relaxed ${
                      log.stream === "stderr"
                        ? "text-red-400"
                        : log.content.includes("PASSED")
                        ? "text-emerald-400"
                        : log.content.includes("Round")
                        ? "text-sky-300 font-bold"
                        : "text-zinc-300"
                    }`}
                  >
                    <span className="text-zinc-600 select-none text-[10px] w-6 shrink-0 text-right">
                      {idx + 1}
                    </span>
                    <pre className="whitespace-pre-wrap font-mono flex-1">{log.content}</pre>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "telemetry" && (
            <div className="overflow-y-auto">
              <TelemetryScorecard
                telemetry={telemetry}
                orchestrationResult={orchestrationResult}
                pipelineStatus={pipelineStatus}
                activityLog={activityLog}
                systemMetrics={systemMetrics}
                sliderScale={sliderScale}
              />
            </div>
          )}

          {activeTab === "security" && (
            <div className="p-2 space-y-3 font-sans text-xs text-zinc-300">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    title: "Filesystem Chroot",
                    key: "filesystemChroot" as const,
                    value: securityStatus?.filesystemChroot ?? "informational",
                    details: securityStatus?.details?.filesystem ??
                      "Informational documentation only — no live attestation available.",
                  },
                  {
                    title: "Environment Sanitization",
                    key: "environmentSanitization" as const,
                    value: securityStatus?.environmentSanitization ?? "informational",
                    details: securityStatus?.details?.environment ??
                      "Informational documentation only — no live attestation available.",
                  },
                  {
                    title: "Network Egress Guard",
                    key: "networkEgress" as const,
                    value: securityStatus?.networkEgress ?? "informational",
                    details: securityStatus?.details?.network ??
                      "Informational documentation only — no live attestation available.",
                  },
                ].map((entry) => {
                  const stateText =
                    entry.value === "verified"
                      ? "Verified"
                      : entry.value === "blocked"
                        ? "Blocked"
                        : "Informational";
                  const toneClass =
                    entry.value === "verified"
                      ? "text-emerald-400"
                      : entry.value === "blocked"
                        ? "text-red-400"
                        : "text-amber-400";
                  const prefix =
                    entry.value === "verified" ? (
                      <CheckCircle className="w-3.5 h-3.5" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-current inline-block" />
                    );

                  return (
                    <div key={entry.title} className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                      <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        {entry.title}
                      </div>
                      <div className={`text-sm font-bold mt-1 flex items-center gap-1 ${toneClass}`}>
                        {prefix}
                        {stateText}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1">{entry.details}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GauntletDrawer;
