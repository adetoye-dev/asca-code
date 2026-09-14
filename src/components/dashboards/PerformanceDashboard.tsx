/**
 * PerformanceDashboard.tsx — Host Health & Performance Monitoring Console
 *
 * Industrial-grade host telemetry workstation inspired by mission-critical rig telemetry consoles:
 * - Top context metadata strip with host runtime and architecture.
 * - Entity header with live sync clock and neon status capsule.
 * - 4-column executive metrics with diagonal hatched progress gauges (magenta / cyan).
 * - Live CPU & Core Frequency Horizon chart with dashed threshold indicator and electric cyan curve.
 * - Stepped memory watermark & cache buffer horizon chart with deep violet glow.
 * - Right diagnostic console with 6-metric telemetry grid, tab navigation, and dual-tone spectrum histogram.
 * - Seamless live synchronization with systemMetricsService, cache purge, and process monitor.
 */

import { useState, useEffect } from "react";
import {
  RefreshCw,
  HardDrive,
  Box,
  Zap,
  Code2,
  FileText,
  Trash2,
} from "lucide-react";
import { Icon } from "../ui/Icon";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { systemMetricsService } from "../../services/systemMetricsService";
import type { SystemMetrics, StorageMetrics, RunningProcessItem } from "../../types/workbench";

interface PerformanceDashboardProps {
  systemMetrics: SystemMetrics | null;
  onRefreshMetrics?: () => void;
}

// ── 1. Diagonal Hatched Progress Gauge Component ─────────────────────────────
interface HatchedBarGaugeProps {
  percent: number;
  variant?: "purple" | "cyan" | "magenta";
  slashes?: number;
  className?: string;
}

function HatchedBarGauge({
  percent,
  variant = "purple",
  slashes = 32,
  className = "w-full h-3.5",
}: HatchedBarGaugeProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const activeCount = Math.round((clamped / 100) * slashes);
  const isPurple = variant === "purple" || variant === "magenta";
  const color = isPurple ? "#a855f7" : "#00e5ff";

  const spacing = 300 / slashes;
  const slashWidth = 5;

  return (
    <svg viewBox="0 0 300 14" className={className} preserveAspectRatio="none">
      {Array.from({ length: slashes }).map((_, i) => {
        const x = i * spacing + 4;
        const isActive = i < activeCount;
        return (
          <line
            key={i}
            x1={x}
            y1={12}
            x2={x + slashWidth}
            y2={2}
            stroke={isActive ? color : "rgba(255, 255, 255, 0.08)"}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

// ── 2. Live CPU Horizon Time-Series Chart ────────────────────────────────────
// ── 2. AI Spend & Savings (hero) ────────────────────────────────────────────
interface UsageDay {
  date: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

const REFERENCE_INPUT_PER_M = 2.5;
const REFERENCE_OUTPUT_PER_M = 10;

function SpendSavingsCard({
  byModel,
  totalCostUsd,
  totalCalls,
  totalTokens,
  avgLatencyS,
}: {
  byModel: ModelUsage[];
  totalCostUsd: number;
  totalCalls: number;
  totalTokens: number;
  avgLatencyS: number;
}) {
  const local = (byModel || []).filter((m) => m.provider === "ollama");
  const localCalls = local.reduce((a, m) => a + m.calls, 0);
  const tokensIn = local.reduce((a, m) => a + m.prompt_tokens, 0);
  const tokensOut = local.reduce((a, m) => a + m.completion_tokens, 0);
  const avoided =
    (tokensIn / 1_000_000) * REFERENCE_INPUT_PER_M + (tokensOut / 1_000_000) * REFERENCE_OUTPUT_PER_M;
  const localShare = totalCalls > 0 ? Math.round((localCalls / totalCalls) * 100) : 0;
  const spend = Number(totalCostUsd || 0);

  if (totalCalls === 0) {
    return (
      <div className="rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">AI Spend &amp; Savings</h3>
        <p className="text-[11px] text-zinc-500 mt-3">
          No AI activity yet. Run a task and its cost and savings will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">AI Spend &amp; Savings</h3>
        <span className="text-[10px] font-mono text-zinc-500">
          {totalCalls} call(s){avgLatencyS > 0 ? ` · avg ${avgLatencyS.toFixed(0)}s` : ""}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">Estimated saved</div>
          <div className="text-3xl font-bold font-mono text-emerald-300 leading-none mt-1.5">
            ${avoided.toFixed(2)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5">
            by running {localShare}% of work on this machine
          </div>
        </div>
        <div className="flex gap-7">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Actual spend</div>
            <div className="text-lg font-bold font-mono text-zinc-100 mt-1">${spend.toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">If all cloud</div>
            <div className="text-lg font-bold font-mono text-zinc-500 mt-1">
              ${(spend + avoided).toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Tokens</div>
            <div className="text-lg font-bold font-mono text-zinc-100 mt-1">
              {Number(totalTokens || 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800">
          <div className="bg-emerald-500/80" style={{ width: `${localShare}%` }} />
          <div className="bg-purple-500/80 flex-1" />
        </div>
        <div className="flex justify-between text-[10px] font-mono mt-1.5">
          <span className="text-emerald-400">{localShare}% local · $0</span>
          <span className="text-purple-300">
            {100 - localShare}% cloud · ${spend.toFixed(4)}
          </span>
        </div>
      </div>

      <p className="mt-auto pt-3 text-[10px] text-zinc-500 leading-snug">
        Savings estimate prices local tokens at a reference cloud rate of ${REFERENCE_INPUT_PER_M}/1M input
        and ${REFERENCE_OUTPUT_PER_M}/1M output.
      </p>
    </div>
  );
}

// ── 3. Usage over the last 14 days ──────────────────────────────────────────
function UsageTrendChart({ daily }: { daily: UsageDay[] }) {
  const rows = daily || [];
  const hasActivity = rows.some((d) => d.calls > 0);
  const maxTokens = Math.max(1, ...rows.map((d) => d.prompt_tokens + d.completion_tokens));

  return (
    <div className="h-full flex flex-col rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Usage — last 14 days</h3>
        <span className="text-[10px] font-mono text-zinc-500">
          {hasActivity ? `peak ${maxTokens.toLocaleString()} tokens/day` : "no activity"}
        </span>
      </div>
      <div className="mt-4 flex flex-1 min-h-24 items-end gap-1.5">
        {rows.map((d) => {
          const tokens = d.prompt_tokens + d.completion_tokens;
          const height = tokens === 0 ? 3 : Math.max(8, Math.round((tokens / maxTokens) * 100));
          return (
            <div
              key={d.date}
              className="flex-1 h-full flex items-end group"
              title={`${d.date}: ${tokens.toLocaleString()} tokens · ${d.calls} call(s) · $${Number(
                d.cost_usd
              ).toFixed(4)}`}
            >
              <div
                className={`w-full rounded-t transition-colors ${
                  tokens === 0
                    ? "bg-zinc-800"
                    : "bg-gradient-to-t from-cyan-700/40 to-cyan-400/80 group-hover:to-cyan-300"
                }`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-mono text-zinc-500">
        <span>{String(rows[0]?.date || "").slice(5)}</span>
        <span>today</span>
      </div>
      {!hasActivity && (
        <p className="mt-3 text-[11px] text-zinc-500">No AI activity in the last 14 days.</p>
      )}
    </div>
  );
}

// ── 4. Models used ──────────────────────────────────────────────────────────
function ModelsUsedPanel({ byModel }: { byModel: ModelUsage[] }) {
  const rows = (byModel || []).slice(0, 6);
  const totalCalls = Math.max(1, (byModel || []).reduce((a, m) => a + m.calls, 0));

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Models Used</h3>
        <p className="text-[11px] text-zinc-500 mt-3">Nothing has run yet.</p>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Models Used</h3>
      <div className="mt-4 space-y-3 flex-1">
        {rows.map((m) => {
          const share = Math.round((m.calls / totalCalls) * 100);
          const isLocal = m.provider === "ollama";
          return (
            <div key={`${m.provider}/${m.model}`}>
              <div className="flex items-center justify-between text-[11px] font-mono gap-2">
                <span className="text-zinc-300 truncate" title={`${m.provider}/${m.model}`}>
                  {m.model}
                </span>
                <span className={isLocal ? "text-emerald-400 shrink-0" : "text-purple-300 shrink-0"}>
                  {m.calls} · {isLocal ? "$0" : `$${Number(m.cost_usd).toFixed(4)}`}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={isLocal ? "h-full bg-emerald-500/70" : "h-full bg-purple-500/70"}
                    style={{ width: `${share}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500 w-9 text-right">{share}%</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-auto pt-3 text-[10px] text-zinc-500">
        Green runs locally and costs nothing; purple is a paid cloud model.
      </p>
    </div>
  );
}

// ── 5. Main Component ────────────────────────────────────────────────────────
export function PerformanceDashboard({
  systemMetrics,
  onRefreshMetrics,
}: PerformanceDashboardProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(
    () => systemMetricsService.getMetrics() || systemMetrics
  );

  useEffect(() => {
    return systemMetricsService.subscribe((latest) => {
      setMetrics(latest);
    });
  }, []);

  const [storage, setStorage] = useState<StorageMetrics>({
    totalGb: 926.4,
    freeGb: 361.4,
    usedGb: 565.0,
    usedPercent: 61.0,
    buildArtifactsMb: 221.3,
    cacheReclaimableMb: 341.4,
    categories: [
      { id: "build", name: "Build Artifacts (dist/)", objects: 14, sizeMb: 221.3, reclaimableMb: 221.3 },
      { id: "vite", name: "Vite Cache & Transpiler", objects: 42, sizeMb: 120.1, reclaimableMb: 120.1 },
      { id: "pycache", name: "Python Bytecode (__pycache__)", objects: 18, sizeMb: 14.8, reclaimableMb: 14.8 },
      { id: "logs", name: "System Logs & Buffers", objects: 9, sizeMb: 35.2, reclaimableMb: 35.2 },
    ],
  });

  const [processes, setProcesses] = useState<RunningProcessItem[]>([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    reclaimedMb: number;
    message: string;
  } | null>(null);
  const [lastChecked, setLastChecked] = useState<string>("Just now");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTelemetryOnline, setIsTelemetryOnline] = useState(false);
  const [hasStorageMetrics, setHasStorageMetrics] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<"caches" | "services">("caches");
  const [usage, setUsage] = useState<any>(null);

  const fetchStorageAndProcesses = async () => {
    setIsRefreshing(true);
    try {
      const [storageRes, procRes, sysMetrics, usageRes] = await Promise.all([
        fetch("/api/system/storage"),
        fetch("/api/system/processes"),
        systemMetricsService.fetchMetrics(),
        fetch("/api/ai/usage").catch(() => null),
      ]);

      if (sysMetrics) {
        setMetrics(sysMetrics);
      }

      if (usageRes && usageRes.ok) {
        try {
          setUsage(await usageRes.json());
        } catch {}
      }

      if (storageRes.ok) {
        const data = await storageRes.json();
        setHasStorageMetrics(true);
        setStorage((previous) => {
          const safeNumber = (value: unknown, fallback: number) =>
            typeof value === "number" && Number.isFinite(value) ? value : fallback;
          const categories = Array.isArray(data.categories)
            ? data.categories.map((category: any) => ({
                ...category,
                objects: safeNumber(category.objects, 0),
                sizeMb: safeNumber(category.sizeMb, 0),
                reclaimableMb: safeNumber(category.reclaimableMb, 0),
              }))
            : previous.categories;
          return {
            ...previous,
            ...data,
            totalGb: safeNumber(data.totalGb, previous.totalGb),
            freeGb: safeNumber(data.freeGb, previous.freeGb),
            usedGb: safeNumber(data.usedGb, previous.usedGb),
            usedPercent: safeNumber(data.usedPercent, previous.usedPercent),
            buildArtifactsMb: safeNumber(data.buildArtifactsMb, previous.buildArtifactsMb),
            cacheReclaimableMb: safeNumber(data.cacheReclaimableMb, previous.cacheReclaimableMb),
            categories,
          };
        });
      }
      if (procRes.ok) {
        const data = await procRes.json();
        setProcesses(data.processes || []);
      }
      setIsTelemetryOnline(Boolean(storageRes.ok && procRes.ok && sysMetrics && systemMetricsService.isHealthy()));
      setLastChecked(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      setIsTelemetryOnline(false);
    } finally {
      setIsRefreshing(false);
      onRefreshMetrics?.();
    }
  };

  useEffect(() => {
    fetchStorageAndProcesses();
    const timer = setInterval(fetchStorageAndProcesses, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleSafeCleanup = async () => {
    setIsCleaning(true);
    setCleanupResult(null);

    try {
      const res = await fetch("/api/system/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        const data = await res.json();
        setCleanupResult({
          reclaimedMb: data.reclaimedMb ?? 0,
          message: data.message || "Build caches cleared successfully.",
        });
        await fetchStorageAndProcesses();
      }
    } catch (err: any) {
      setCleanupResult({
        reclaimedMb: 0,
        message: `Cleanup error: ${err?.message || "Failed to clear caches"}`,
      });
    } finally {
      setIsCleaning(false);
    }
  };

  const activeMetrics = metrics || systemMetrics;
  const cpuPercent = activeMetrics ? Math.round(activeMetrics.cpu_usage_percent) : 15;
  const memUsedGb = activeMetrics
    ? (activeMetrics.memory_used_mb / 1024).toFixed(1)
    : "14.2";
  const memTotalGb = activeMetrics
    ? (activeMetrics.memory_total_mb / 1024).toFixed(0)
    : "16";
  const memPercent = activeMetrics
    ? Math.round(activeMetrics.memory_usage_percent)
    : 88;

  const diskPercent = activeMetrics?.disk_usage_percent ?? (hasStorageMetrics && Number.isFinite(storage.usedPercent) ? Math.round(storage.usedPercent) : 61);
  const diskTotalGb = activeMetrics?.disk_total_gb ?? (hasStorageMetrics ? storage.totalGb : 926.4);
  const diskUsedGb = activeMetrics?.disk_used_gb ?? (hasStorageMetrics ? storage.usedGb : 565);
  const formatGb = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "unknown";
  const hostPlatform = activeMetrics?.platform ?? "unknown";
  const hostArchitecture = activeMetrics?.architecture ?? "unknown";
  const nodeVersion = activeMetrics?.node_version ?? "unknown";
  const viteVersion = activeMetrics?.vite_version ?? "unknown";
  const pythonVersion = activeMetrics?.python_version ?? "unknown";

  const totalCachesMb = storage.buildArtifactsMb + storage.cacheReclaimableMb;
  const cachePercent = totalCachesMb > 0 ? Math.round((storage.cacheReclaimableMb / totalCachesMb) * 100) : 60;

  const isSystemHealthy = cpuPercent < 85 && memPercent < 95;

  const getCategoryIcon = (id: string) => {
    switch (id) {
      case "build":
      case "build-artifacts":
        return Box;
      case "vite":
      case "vite-cache":
        return Zap;
      case "pycache":
        return Code2;
      case "logs":
      case "logs-temp":
        return FileText;
      default:
        return HardDrive;
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-canvas text-zinc-200 p-4 sm:p-6 lg:p-7 font-sans select-none">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* ── TOP CONTEXT / RIG METADATA STRIP (Exact Reference Inspiration) ──── */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-zinc-400 pb-3 border-b border-hairline">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <span>
              <strong className="text-zinc-300 font-semibold">HOST:</strong> ACSA Local Engine ({hostPlatform} {hostArchitecture})
            </span>
            <span className="hidden sm:inline text-zinc-600">|</span>
            <span>
              <strong className="text-zinc-300 font-semibold">RUNTIME:</strong> Node {nodeVersion} · Vite {viteVersion} · Python {pythonVersion}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isTelemetryOnline ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              <span className={`font-semibold tracking-wide ${isTelemetryOnline ? "text-emerald-400" : "text-red-400"}`}>STATUS: {isTelemetryOnline ? "ONLINE & SYNCHRONIZED" : "OFFLINE"}</span>
            </div>
            <button
              type="button"
              onClick={fetchStorageAndProcesses}
              disabled={isRefreshing}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Refresh Telemetry"
            >
              <Icon icon={RefreshCw} className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-zinc-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* ── ENTITY HEADER & STATUS CAPSULE (Rig SF-4H Equivalent) ──────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white uppercase">
              ACSA Host Compute
            </h1>
            <p className="text-xs font-mono text-zinc-500 mt-0.5">
              Last sync {lastChecked}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3.5 py-1 rounded-full text-xs font-semibold font-mono tracking-wider bg-zinc-800 text-zinc-200 border border-zinc-700/60">
              {isSystemHealthy ? "Optimal Health" : "High Resource Load"}
            </span>
          </div>
        </div>

        {/* ── 4-COLUMN HIGH-IMPACT METRICS STRIP WITH DIAGONAL HATCHED GAUGES ─── */}
        <div className="rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 shadow-2xl backdrop-blur-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
            
            {/* 1. CPU COMPUTE LOAD (Purple Hatch) */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                CPU Compute Load (%)
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-mono font-extrabold text-white tracking-tight">
                  {cpuPercent.toFixed(1)}%
                </span>
                <span className="text-xs font-mono text-zinc-500">/ 100%</span>
              </div>
              <HatchedBarGauge percent={cpuPercent} variant="purple" slashes={30} />
            </div>

            {/* 2. MEMORY ALLOCATION (Cyan Hatch) */}
            <div className="space-y-2 sm:pl-5 lg:pl-6 pt-4 sm:pt-0">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                Memory Allocation (RAM)
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-mono font-extrabold text-white tracking-tight">
                  {memUsedGb}
                </span>
                <span className="text-xs font-mono text-zinc-500">/ {memTotalGb} GB</span>
              </div>
              <HatchedBarGauge percent={memPercent} variant="cyan" slashes={30} />
            </div>

            {/* 3. ROOT STORAGE OCCUPANCY (Purple Hatch) */}
            <div className="space-y-2 sm:pl-5 lg:pl-6 pt-4 sm:pt-0">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                Storage Occupancy (SSD /)
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-mono font-extrabold text-white tracking-tight">
                  {formatGb(diskUsedGb)}
                </span>
                <span className="text-xs font-mono text-zinc-500">/ {formatGb(diskTotalGb)} GB</span>
              </div>
              <HatchedBarGauge percent={diskPercent} variant="purple" slashes={30} />
            </div>

            {/* 4. RECLAIMABLE CACHE BUFFERS (Cyan Hatch) */}
            <div className="space-y-2 sm:pl-5 lg:pl-6 pt-4 sm:pt-0 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                  <span>Cache & Buffers</span>
                  <button
                    type="button"
                    onClick={() => setShowCleanupConfirm(true)}
                    disabled={isCleaning || storage.cacheReclaimableMb < 1}
                    className="text-[10px] font-mono font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Purge
                  </button>
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-2xl sm:text-3xl font-mono font-extrabold text-white tracking-tight">
                    {storage.cacheReclaimableMb.toFixed(0)}
                  </span>
                  <span className="text-xs font-mono text-zinc-500">/ {totalCachesMb.toFixed(0)} MB</span>
                </div>
              </div>
              <HatchedBarGauge percent={cachePercent} variant="cyan" slashes={30} />
            </div>

          </div>
        </div>

        {/* ── CLEANUP SUCCESS BANNER ────────────────────────────────────────── */}
        {cleanupResult && (
          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between gap-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <p className="text-xs text-emerald-200 font-mono">
                {cleanupResult.message}{" "}
                <span className="font-bold text-white">
                  {cleanupResult.reclaimedMb.toFixed(1)} MB
                </span>{" "}
                reclaimed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCleanupResult(null)}
              className="text-[11px] text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-workbench border border-hairline transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── 2-COLUMN MAIN TELEMETRY WORKBENCH ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-2 gap-5">
          
          {/* ROW 1 — spend hero (left) ──────────────────────────────────────── */}
          <div className="lg:col-span-7 lg:row-start-1 min-h-0">
            <SpendSavingsCard
              byModel={usage?.by_model || []}
              totalCostUsd={usage?.cost_usd || 0}
              totalCalls={usage?.total_calls || 0}
              totalTokens={(usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0)}
              avgLatencyS={
                usage && usage.total_calls > 0 ? usage.total_latency_ms / usage.total_calls / 1000 : 0
              }
            />
          </div>

          {/* ROW 1 — models (right) ─────────────────────────────────────────── */}
          <div className="lg:col-span-5 lg:row-start-1 min-h-0">
            <ModelsUsedPanel byModel={usage?.by_model || []} />
          </div>

          {/* ROW 2 — usage trend (left) ─────────────────────────────────────── */}
          <div className="lg:col-span-7 lg:row-start-2 min-h-0">
            <UsageTrendChart daily={usage?.daily || []} />
          </div>

          {/* ROW 2 — workspace maintenance (right) ──────────────────────────── */}
          <div className="lg:col-span-5 lg:row-start-2 min-h-0">
            <div className="h-full rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 flex flex-col space-y-4 shadow-2xl backdrop-blur-md">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Workspace Maintenance
              </h3>
              <span className="text-[10px] font-mono text-zinc-500">
                {storage.cacheReclaimableMb.toFixed(0)} MB reclaimable
              </span>
            </div>

            {/* Tab Underline Navigation */}
            <div className="flex items-center gap-6 border-b border-hairline text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveRightTab("caches")}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  activeRightTab === "caches"
                    ? "text-zinc-100 border-b-2 border-zinc-200 font-bold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Workspace Caches ({storage.categories.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveRightTab("services")}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  activeRightTab === "services"
                    ? "text-zinc-100 border-b-2 border-zinc-200 font-bold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Active Services ({processes.length})
              </button>
            </div>

            {/* Tab Views */}
            <div className="flex-1 min-h-[220px]">
              {activeRightTab === "caches" && (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-zinc-300 font-sans">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                          <th className="py-2">Category</th>
                          <th className="py-2">Files</th>
                          <th className="py-2 text-right">Size</th>
                          <th className="py-2 text-right text-amber-400">Reclaimable</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/40 text-xs font-mono">
                        {storage.categories.map((cat) => (
                          <tr key={cat.id} className="hover:bg-white/[0.02]">
                            <td className="py-2.5 font-sans font-medium text-zinc-200 flex items-center gap-2">
                              <Icon icon={getCategoryIcon(cat.id)} className="w-3.5 h-3.5 text-zinc-400" />
                              <span>{cat.name}</span>
                            </td>
                            <td className="py-2.5 text-zinc-400">{cat.objects}</td>
                            <td className="py-2.5 text-right text-zinc-200">{cat.sizeMb.toFixed(1)} MB</td>
                            <td className="py-2.5 text-right font-bold text-amber-400">
                              {cat.reclaimableMb > 0 ? `${cat.reclaimableMb.toFixed(1)} MB` : "Clean"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
                    <span className="text-[11px] font-mono text-zinc-500">
                      Total Cache Reclaimable: {storage.cacheReclaimableMb.toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCleanupConfirm(true)}
                      disabled={isCleaning || storage.cacheReclaimableMb < 1}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <Icon icon={Trash2} className="w-3.5 h-3.5" />
                      <span>Purge All Caches</span>
                    </button>
                  </div>
                </div>
              )}

              {activeRightTab === "services" && (
                <div className="overflow-x-auto max-h-[220px] overflow-y-auto">
                  <table className="w-full text-left text-xs text-zinc-300 font-sans">
                    <thead>
                      <tr className="border-b border-hairline text-[10px] text-zinc-500 font-mono uppercase tracking-wider sticky top-0 bg-workbench">
                        <th className="py-2">PID</th>
                        <th className="py-2">Service</th>
                        <th className="py-2">Status</th>
                        <th className="py-2 text-right">CPU</th>
                        <th className="py-2 text-right">RAM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40 text-[11px] font-mono">
                      {processes.map((p) => (
                        <tr key={p.pid} className="hover:bg-white/[0.02]">
                          <td className="py-2 text-zinc-500">{p.pid}</td>
                          <td className="py-2 font-sans font-medium text-zinc-200 truncate max-w-[120px]">{p.name}</td>
                          <td className="py-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              {p.status}
                            </span>
                          </td>
                          <td className="py-2 text-right text-zinc-300">{p.cpuPercent}%</td>
                          <td className="py-2 text-right text-zinc-300">{p.memoryMb} MB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>


          </div>

        </div>

      </div>

      {/* ── Cache Cleanup Confirmation Dialog ─────────────────────────────── */}
      {showCleanupConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Clear Workspace Caches"
          message={
            <span>
              Are you sure you want to purge{" "}
              <span className="font-semibold text-zinc-100">{storage.cacheReclaimableMb.toFixed(0)} MB</span> of
              temporary build artifacts, Vite transpiler caches, and Python bytecode?
            </span>
          }
          detail="Your project files, source code, and git repositories will not be modified."
          confirmText="Clear Caches"
          cancelText="Cancel"
          isDestructive={false}
          onConfirm={() => {
            setShowCleanupConfirm(false);
            handleSafeCleanup();
          }}
          onCancel={() => setShowCleanupConfirm(false)}
        />
      )}
    </div>
  );
}

export default PerformanceDashboard;
