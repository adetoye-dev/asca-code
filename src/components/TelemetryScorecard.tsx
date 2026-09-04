/**
 * TelemetryScorecard.tsx — Real-Time Performance Monitor & Proof Panel
 *
 * Renders live telemetry from the load_sandbox.py and manager.py backends
 * as scannable metric cards, a correction-round activity ticker, and
 * cost/capacity estimates derived from benchmark data.
 *
 * Styling: Tailwind CSS utility classes — zero external component libraries.
 */

import { useEffect, useRef } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

/** Telemetry payload shape matching load_sandbox.py TelemetryPayload.to_dict() */
export interface TelemetryData {
  avg_latency_ms: number;
  p50_latency_ms: number;
  p99_latency_ms: number;
  max_latency_ms: number;
  requests_per_second: number;
  total_requests: number;
  error_count: number;
  peak_cpu_percent: number;
  peak_memory_mb: number;
  avg_cpu_percent: number;
  avg_memory_mb: number;
}

/** Correction round shape from manager.py CorrectionRound */
export interface CorrectionRound {
  round_number: number;
  syntax_passed: boolean;
  performance_passed: boolean;
  syntax_errors: number;
  performance_breaches: string[];
  context_card_tokens: number;
  llm_latency_ms: number;
}

/** Full orchestration result from manager.py OrchestrationResult.to_dict() */
export interface OrchestrationResult {
  outcome: "success" | "max_retries_exceeded" | "llm_unreachable" | "paradox_detected";
  total_rounds: number;
  elapsed_ms: number;
  error_detail: string;
  rounds: CorrectionRound[];
}

/** Pipeline output line from Tauri's pipeline:output event */
export interface PipelineOutputLine {
  line_number: number;
  content: string;
  stream: "stdout" | "stderr";
  is_json: boolean;
}

/** System metrics from Tauri's fetch_system_metrics command */
export interface SystemMetrics {
  cpu_count?: number;
  cpu_usage_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_usage_percent: number;
  is_thermal_risk: boolean;
  thermal_warning: string;
}

export type PipelineStatus = "idle" | "running" | "success" | "failed" | "error";

export interface TelemetryScorecardProps {
  telemetry: TelemetryData | null;
  orchestrationResult: OrchestrationResult | null;
  pipelineStatus: PipelineStatus;
  activityLog: PipelineOutputLine[];
  systemMetrics: SystemMetrics | null;
  sliderScale: "low" | "medium" | "high";
}

// ── Cost Estimation ─────────────────────────────────────────────────────────

interface CostEstimate {
  monthly_dollars: number;
  label: string;
  max_concurrent_users: number;
}

function estimateCosts(
  telemetry: TelemetryData | null,
  scale: "low" | "medium" | "high"
): CostEstimate {
  if (!telemetry || telemetry.requests_per_second === 0) {
    const defaults: Record<string, CostEstimate> = {
      low:    { monthly_dollars: 5,   label: "~$5/mo",    max_concurrent_users: 100 },
      medium: { monthly_dollars: 25,  label: "~$25/mo",   max_concurrent_users: 5000 },
      high:   { monthly_dollars: 120, label: "~$120/mo",  max_concurrent_users: 50000 },
    };
    return defaults[scale];
  }

  // Estimate from measured throughput
  // Assume average user makes 1 request every 10 seconds
  const max_users = Math.floor(telemetry.requests_per_second * 10);

  // Rough hosting cost model based on required compute
  let monthly: number;
  if (max_users <= 200)       monthly = 5;
  else if (max_users <= 2000) monthly = 15;
  else if (max_users <= 10000) monthly = 40;
  else if (max_users <= 50000) monthly = 100;
  else                        monthly = 200;

  return {
    monthly_dollars: monthly,
    label: `~$${monthly}/mo`,
    max_concurrent_users: max_users,
  };
}

// ── Security Status ─────────────────────────────────────────────────────────

interface SecurityStatus {
  label: string;
  color: string;
  icon: string;
  detail: string;
}

function deriveSecurityStatus(
  result: OrchestrationResult | null,
  telemetry: TelemetryData | null
): SecurityStatus {
  if (!result) {
    return {
      label: "Pending",
      color: "text-zinc-500",
      icon: "🔒",
      detail: "Run the pipeline to generate a security assessment.",
    };
  }

  const syntaxClean = result.rounds.length > 0 &&
    result.rounds[result.rounds.length - 1]?.syntax_passed;
  const noErrors = telemetry ? telemetry.error_count === 0 : true;
  const perfClean = result.rounds.length > 0 &&
    result.rounds[result.rounds.length - 1]?.performance_passed;

  if (result.outcome === "success" && syntaxClean && noErrors && perfClean) {
    return {
      label: "All Gates Passed",
      color: "text-emerald-400",
      icon: "✅",
      detail: "Syntax verified, load tested, zero errors detected.",
    };
  }

  if (result.outcome === "success" && syntaxClean) {
    return {
      label: "Syntax Verified",
      color: "text-sky-400",
      icon: "🔵",
      detail: "Static analysis passed. Performance gate may have been skipped.",
    };
  }

  if (result.outcome === "paradox_detected") {
    return {
      label: "Contradiction Detected",
      color: "text-amber-400",
      icon: "⚠️",
      detail: result.error_detail || "Conflicting requirements detected.",
    };
  }

  return {
    label: "Issues Found",
    color: "text-red-400",
    icon: "❌",
    detail: result.error_detail || "The pipeline did not achieve 100% green gates.",
  };
}

// ── Metric Card ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon: string;
  color?: string;
  barPercent?: number;
  barColor?: string;
}

function MetricCard({
  label,
  value,
  sublabel,
  icon,
  color = "text-zinc-100",
  barPercent,
  barColor = "bg-sky-500",
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/50 p-4 flex flex-col justify-between min-h-[120px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={`text-2xl font-bold ${color} tabular-nums leading-tight`}>
        {value}
      </div>
      {sublabel && (
        <p className="text-[11px] text-zinc-500 mt-1">{sublabel}</p>
      )}
      {barPercent !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-zinc-700/60 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-500`}
            style={{ width: `${Math.min(Math.max(barPercent, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Activity Ticker ─────────────────────────────────────────────────────────

interface ActivityTickerProps {
  rounds: CorrectionRound[];
  log: PipelineOutputLine[];
  status: PipelineStatus;
}

function ActivityTicker({ rounds, log, status }: ActivityTickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rounds, log]);

  // Build ticker entries from correction rounds
  const tickerEntries: { icon: string; text: string; color: string }[] = [];

  for (const round of rounds) {
    if (round.syntax_passed && round.performance_passed) {
      tickerEntries.push({
        icon: "✅",
        text: `Round ${round.round_number} — All gates passed`,
        color: "text-emerald-400",
      });
    } else if (!round.syntax_passed) {
      tickerEntries.push({
        icon: "🔨",
        text: `Round ${round.round_number} — Resolving ${round.syntax_errors} syntax issue${round.syntax_errors !== 1 ? "s" : ""}... attempt ${round.round_number}`,
        color: "text-amber-400",
      });
    } else if (!round.performance_passed) {
      const breach = round.performance_breaches[0] || "performance threshold";
      tickerEntries.push({
        icon: "⚙️",
        text: `Round ${round.round_number} — Optimizing: ${breach}`,
        color: "text-amber-400",
      });
    }
  }

  // Add live log entries (last 8 parseable lines)
  const recentLogEntries = log
    .filter((l) => l.stream === "stdout" && l.content.trim().length > 0)
    .slice(-8)
    .map((l) => {
      let display = l.content;
      // Parse JSON log lines for cleaner display
      try {
        const parsed = JSON.parse(l.content);
        if (parsed.message) {
          display = parsed.message;
        }
      } catch {
        // Use raw line
      }

      const icon = display.includes("PASSED")
        ? "✅"
        : display.includes("FAILED")
          ? "❌"
          : display.includes("error")
            ? "⚠️"
            : "📡";

      return {
        icon,
        text: display.length > 120 ? display.slice(0, 117) + "..." : display,
        color: "text-zinc-400",
      };
    });

  const allEntries = [...tickerEntries, ...recentLogEntries];

  const statusIndicator =
    status === "running" ? (
      <span className="inline-flex items-center gap-1.5 text-xs text-sky-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        Processing
      </span>
    ) : status === "success" ? (
      <span className="text-xs text-emerald-400">✓ Complete</span>
    ) : status === "failed" ? (
      <span className="text-xs text-red-400">✗ Failed</span>
    ) : null;

  return (
    <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-700/30 bg-zinc-800/80">
        <div className="flex items-center gap-2">
          <span className="text-sm">📋</span>
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
            Activity Log
          </span>
        </div>
        {statusIndicator}
      </div>

      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-track-zinc-800 scrollbar-thumb-zinc-600"
      >
        {allEntries.length === 0 ? (
          <p className="text-xs text-zinc-600 italic py-4 text-center">
            No activity yet. Submit a prompt to begin.
          </p>
        ) : (
          allEntries.map((entry, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs ${entry.color} leading-relaxed`}
            >
              <span className="flex-shrink-0 mt-0.5">{entry.icon}</span>
              <span className="font-mono">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function TelemetryScorecard({
  telemetry,
  orchestrationResult,
  pipelineStatus,
  activityLog,
  systemMetrics,
  sliderScale,
}: TelemetryScorecardProps) {
  const costs = estimateCosts(telemetry, sliderScale);
  const security = deriveSecurityStatus(orchestrationResult, telemetry);

  // Format numbers for display
  const fmt = (n: number, decimals = 1) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(decimals);

  const latencyColor = (ms: number) =>
    ms < 50
      ? "text-emerald-400"
      : ms < 200
        ? "text-sky-400"
        : ms < 500
          ? "text-amber-400"
          : "text-red-400";

  const latencyBarPercent = (ms: number) =>
    Math.min((ms / 1000) * 100, 100);

  const latencyBarColor = (ms: number) =>
    ms < 50
      ? "bg-emerald-500"
      : ms < 200
        ? "bg-sky-500"
        : ms < 500
          ? "bg-amber-500"
          : "bg-red-500";

  return (
    <section aria-label="Telemetry Scorecard" className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight">
            Performance Scorecard
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Real-world metrics from the verification gauntlet
          </p>
        </div>
        {pipelineStatus === "running" && (
          <div className="flex items-center gap-2 rounded-full bg-sky-500/10 border border-sky-500/20 px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
            <span className="text-xs font-medium text-sky-400">Live</span>
          </div>
        )}
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Hosting Cost */}
        <MetricCard
          label="Est. Hosting Cost"
          value={costs.label}
          sublabel={`Based on ${sliderScale} scale profile`}
          icon="💰"
          color="text-emerald-400"
        />

        {/* Max Concurrent Users */}
        <MetricCard
          label="Max Capacity"
          value={
            costs.max_concurrent_users > 0
              ? fmt(costs.max_concurrent_users, 0) + " users"
              : "—"
          }
          sublabel={
            telemetry
              ? `${fmt(telemetry.requests_per_second, 0)} req/s measured`
              : "Awaiting benchmark"
          }
          icon="👥"
          color="text-sky-400"
        />

        {/* Avg Latency */}
        <MetricCard
          label="Avg Latency"
          value={telemetry ? `${telemetry.avg_latency_ms.toFixed(1)}ms` : "—"}
          sublabel={
            telemetry
              ? `p99: ${telemetry.p99_latency_ms.toFixed(1)}ms`
              : "Awaiting benchmark"
          }
          icon="⏱️"
          color={telemetry ? latencyColor(telemetry.avg_latency_ms) : "text-zinc-500"}
          barPercent={telemetry ? latencyBarPercent(telemetry.avg_latency_ms) : undefined}
          barColor={telemetry ? latencyBarColor(telemetry.avg_latency_ms) : undefined}
        />

        {/* Security Status */}
        <MetricCard
          label="Verification Status"
          value={security.label}
          sublabel={security.detail.length > 80 ? security.detail.slice(0, 77) + "..." : security.detail}
          icon={security.icon}
          color={security.color}
        />
      </div>

      {/* Secondary Metrics */}
      {(telemetry || systemMetrics) && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {telemetry && (
            <>
              <MetricCard
                label="p50 Latency"
                value={`${telemetry.p50_latency_ms.toFixed(1)}ms`}
                icon="📊"
                color={latencyColor(telemetry.p50_latency_ms)}
                barPercent={latencyBarPercent(telemetry.p50_latency_ms)}
                barColor={latencyBarColor(telemetry.p50_latency_ms)}
              />
              <MetricCard
                label="p99 Latency"
                value={`${telemetry.p99_latency_ms.toFixed(1)}ms`}
                icon="📈"
                color={latencyColor(telemetry.p99_latency_ms)}
                barPercent={latencyBarPercent(telemetry.p99_latency_ms)}
                barColor={latencyBarColor(telemetry.p99_latency_ms)}
              />
              <MetricCard
                label="Error Rate"
                value={
                  telemetry.total_requests > 0
                    ? `${((telemetry.error_count / telemetry.total_requests) * 100).toFixed(2)}%`
                    : "0%"
                }
                sublabel={`${telemetry.error_count} / ${fmt(telemetry.total_requests, 0)} requests`}
                icon="🚨"
                color={telemetry.error_count === 0 ? "text-emerald-400" : "text-red-400"}
              />
            </>
          )}
          {systemMetrics && (
            <>
              <MetricCard
                label="Host CPU"
                value={`${systemMetrics.cpu_usage_percent.toFixed(1)}%`}
                icon="🖥️"
                color={
                  systemMetrics.cpu_usage_percent > 85
                    ? "text-red-400"
                    : systemMetrics.cpu_usage_percent > 60
                      ? "text-amber-400"
                      : "text-emerald-400"
                }
                barPercent={systemMetrics.cpu_usage_percent}
                barColor={
                  systemMetrics.cpu_usage_percent > 85
                    ? "bg-red-500"
                    : systemMetrics.cpu_usage_percent > 60
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }
              />
              <MetricCard
                label="Host Memory"
                value={`${systemMetrics.memory_usage_percent.toFixed(1)}%`}
                sublabel={`${systemMetrics.memory_used_mb.toFixed(0)} / ${systemMetrics.memory_total_mb.toFixed(0)} MB`}
                icon="💾"
                color={
                  systemMetrics.memory_usage_percent > 90
                    ? "text-red-400"
                    : "text-emerald-400"
                }
                barPercent={systemMetrics.memory_usage_percent}
                barColor={
                  systemMetrics.memory_usage_percent > 90
                    ? "bg-red-500"
                    : "bg-sky-500"
                }
              />
            </>
          )}
          <MetricCard
            label="Peak CPU"
            value={
              telemetry
                ? `${telemetry.peak_cpu_percent.toFixed(1)}%`
                : "—"
            }
            sublabel="During benchmark"
            icon="🔥"
            color={
              telemetry && telemetry.peak_cpu_percent > 85
                ? "text-red-400"
                : "text-zinc-300"
            }
          />
        </div>
      )}

      {/* Thermal Warning */}
      {systemMetrics?.is_thermal_risk && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-400">
              Thermal Throttling Risk
            </p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              {systemMetrics.thermal_warning}
            </p>
          </div>
        </div>
      )}

      {/* Pipeline Result Summary */}
      {orchestrationResult && pipelineStatus !== "running" && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            orchestrationResult.outcome === "success"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : orchestrationResult.outcome === "paradox_detected"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {orchestrationResult.outcome === "success"
                  ? "✅"
                  : orchestrationResult.outcome === "paradox_detected"
                    ? "⚠️"
                    : "❌"}
              </span>
              <span
                className={`text-sm font-semibold ${
                  orchestrationResult.outcome === "success"
                    ? "text-emerald-400"
                    : orchestrationResult.outcome === "paradox_detected"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {orchestrationResult.outcome === "success"
                  ? "Pipeline Complete"
                  : orchestrationResult.outcome === "max_retries_exceeded"
                    ? "Max Retries Exceeded"
                    : orchestrationResult.outcome === "llm_unreachable"
                      ? "LLM Sidecar Unreachable"
                      : "Contradictory Requirements Detected"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>
                {orchestrationResult.total_rounds} round
                {orchestrationResult.total_rounds !== 1 ? "s" : ""}
              </span>
              <span>{(orchestrationResult.elapsed_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>
          {orchestrationResult.error_detail && (
            <p className="text-xs text-zinc-400 mt-2">
              {orchestrationResult.error_detail}
            </p>
          )}
        </div>
      )}

      {/* Activity Ticker */}
      <ActivityTicker
        rounds={orchestrationResult?.rounds ?? []}
        log={activityLog}
        status={pipelineStatus}
      />
    </section>
  );
}

export default TelemetryScorecard;
