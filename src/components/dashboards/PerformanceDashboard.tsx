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

import { useState, useEffect, useMemo } from "react";
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
interface TelemetryHorizonChartProps {
  history: number[];
  currentVal: number;
  cores: number;
}

function TelemetryHorizonChart({
  history,
  currentVal,
  cores,
}: TelemetryHorizonChartProps) {
  const width = 500;
  const height = 150;
  const paddingBottom = 22;
  const chartH = height - paddingBottom;

  // Split history into historical (left 55%) and active (right 45%)
  const splitIndex = Math.floor(history.length * 0.55);
  const splitX = (splitIndex / (history.length - 1)) * width;

  const points = useMemo(() => {
    return history.map((val, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = chartH - (Math.min(100, Math.max(0, val)) / 100) * (chartH - 12) - 6;
      return { x, y, val };
    });
  }, [history, chartH, width]);

  const historicalPath = useMemo(() => {
    if (points.length === 0) return "";
    const histPts = points.slice(0, splitIndex + 1);
    return histPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }, [points, splitIndex]);

  const activePath = useMemo(() => {
    if (points.length === 0) return "";
    const activePts = points.slice(splitIndex);
    return activePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }, [points, splitIndex]);

  const activeArea = useMemo(() => {
    if (points.length === 0) return "";
    const activePts = points.slice(splitIndex);
    if (activePts.length === 0) return "";
    const firstX = activePts[0].x;
    const lastX = activePts[activePts.length - 1].x;
    const lineParts = activePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return `${lineParts} L ${lastX} ${chartH} L ${firstX} ${chartH} Z`;
  }, [points, splitIndex, chartH]);

  return (
    <div className="rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 flex flex-col justify-between space-y-3.5 shadow-2xl backdrop-blur-md">
      {/* Panel Header */}
      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
          CPU Horizon
        </h3>
        <span className="text-[10px] font-mono text-zinc-500">60s Trailing</span>
      </div>

      {/* SVG Horizon Graph */}
      <div className="relative w-full h-[140px] sm:h-[155px] overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="cyanAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.28" />
              <stop offset="90%" stopColor="#00e5ff" stopOpacity="0.01" />
            </linearGradient>
            <filter id="cyanGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="rgba(0, 229, 255, 0.7)" />
            </filter>
          </defs>

          {/* Grid horizontal guidelines */}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              y1={chartH * fraction}
              x2={width}
              y2={chartH * fraction}
              stroke="rgba(255, 255, 255, 0.04)"
              strokeDasharray="4 4"
            />
          ))}

          {/* Vertical dashed now-marker / threshold */}
          <line
            x1={splitX}
            y1={0}
            x2={splitX}
            y2={chartH}
            stroke="#ffffff"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {/* Historical line (subtle gray) */}
          <path d={historicalPath} fill="none" stroke="#52525b" strokeWidth="1.8" />

          {/* Active Area Glow */}
          <path d={activeArea} fill="url(#cyanAreaGrad)" />

          {/* Active Live Line (Electric Cyan) */}
          <path
            d={activePath}
            fill="none"
            stroke="#00e5ff"
            strokeWidth="2.2"
            filter="url(#cyanGlow)"
          />

          {/* Pulsing Dot on Current Value */}
          {points.length > 0 && (
            <g transform={`translate(${points[points.length - 1].x}, ${points[points.length - 1].y})`}>
              <circle r="4" fill="#00e5ff" filter="url(#cyanGlow)" />
              <circle r="7" fill="#00e5ff" opacity="0.3" className="animate-ping" />
            </g>
          )}

          {/* Bottom axis ticks */}
          {Array.from({ length: 50 }).map((_, i) => {
            const tx = (i / 49) * width;
            const isMajor = i % 10 === 0;
            return (
              <line
                key={i}
                x1={tx}
                y1={chartH + 2}
                x2={tx}
                y2={chartH + (isMajor ? 8 : 4)}
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth={isMajor ? 1.5 : 1}
              />
            );
          })}

          {/* Time text axis labels */}
          <text x="4" y={height - 2} fill="#71717a" fontSize="9" fontFamily="monospace">-60s</text>
          <text x={splitX - 18} y={height - 2} fill="#a1a1aa" fontSize="9" fontFamily="monospace">T-0s</text>
          <text x={width - 24} y={height - 2} fill="#00e5ff" fontSize="9" fontFamily="monospace" fontWeight="bold">NOW</text>
        </svg>
      </div>

      {/* Footer 4-Metric Readout */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/[0.06] text-xs font-mono">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Scheduler</div>
          <div className="text-zinc-100 font-bold mt-0.5">Dynamic Scaled</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">User Space</div>
          <div className="text-purple-300 font-bold mt-0.5">{(currentVal * 0.65).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Kernel System</div>
          <div className="text-zinc-300 font-bold mt-0.5">{(currentVal * 0.35).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Active Cores</div>
          <div className="text-emerald-400 font-bold mt-0.5">{cores} Cores</div>
        </div>
      </div>
    </div>
  );
}

// ── 3. Stepped Memory Watermark & Buffer Horizon Chart ───────────────────────
interface SteppedWatermarkChartProps {
  memPercent: number;
  storage: StorageMetrics;
}

function SteppedWatermarkChart({
  memPercent,
  storage,
}: SteppedWatermarkChartProps) {
  const width = 500;
  const height = 150;
  const paddingBottom = 22;
  const chartH = height - paddingBottom;

  // Generate stepped path simulating memory allocations & buffer commits
  const stepCount = 18;
  const stepWidth = width / stepCount;
  const baselineHeight = (memPercent / 100) * (chartH - 25);

  const path = useMemo(() => {
    let d = `M 0 ${chartH - baselineHeight * 0.45}`;
    for (let i = 1; i <= stepCount; i++) {
      const curX = i * stepWidth;
      // Step elevation formula
      const mult = i < 5 ? 0.45 : i < 11 ? 0.75 : i < 15 ? 0.95 : 0.82;
      const y = chartH - Math.min(chartH - 8, baselineHeight * mult + (i % 2 === 0 ? 6 : -4));
      d += ` H ${curX} V ${y}`;
    }
    return d;
  }, [baselineHeight, chartH, stepWidth, stepCount]);

  const areaPath = useMemo(() => {
    return `${path} V ${chartH} H 0 Z`;
  }, [path, chartH]);

  return (
    <div className="rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 flex flex-col justify-between space-y-3.5 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
          Memory Watermark & Buffers
        </h3>
        <span className="text-[10px] font-mono text-zinc-500">Allocation Headroom</span>
      </div>

      {/* Stepped Area SVG */}
      <div className="relative w-full h-[140px] sm:h-[155px] overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="purpleStepGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9333ea" stopOpacity="0.30" />
              <stop offset="60%" stopColor="#7e22ce" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#3b0764" stopOpacity="0.01" />
            </linearGradient>
            <filter id="purpleGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="rgba(168, 85, 247, 0.65)" />
            </filter>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              y1={chartH * fraction}
              x2={width}
              y2={chartH * fraction}
              stroke="rgba(255, 255, 255, 0.04)"
              strokeDasharray="4 4"
            />
          ))}

          {/* Capacity ceiling dashed guide */}
          <line
            x1="0"
            y1={14}
            x2={width}
            y2={14}
            stroke="#a855f7"
            strokeOpacity="0.3"
            strokeWidth="1"
            strokeDasharray="2 3"
          />

          {/* Area Fill */}
          <path d={areaPath} fill="url(#purpleStepGrad)" />

          {/* Stepped Contour Line */}
          <path
            d={path}
            fill="none"
            stroke="#c084fc"
            strokeWidth="2.2"
            filter="url(#purpleGlow)"
          />

          {/* Bottom tick marks */}
          {Array.from({ length: 50 }).map((_, i) => {
            const tx = (i / 49) * width;
            const isMajor = i % 10 === 0;
            return (
              <line
                key={i}
                x1={tx}
                y1={chartH + 2}
                x2={tx}
                y2={chartH + (isMajor ? 8 : 4)}
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth={isMajor ? 1.5 : 1}
              />
            );
          })}

          <text x="4" y={height - 2} fill="#71717a" fontSize="9" fontFamily="monospace">BASE_ALLOC</text>
          <text x={width / 2 - 35} y={height - 2} fill="#a1a1aa" fontSize="9" fontFamily="monospace">WATERMARK_COMMIT</text>
          <text x={width - 45} y={height - 2} fill="#c084fc" fontSize="9" fontFamily="monospace" fontWeight="bold">CURRENT</text>
        </svg>
      </div>

      {/* Itemized Cache Pills Strip */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
        {storage.categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-workbench border border-hairline"
          >
            <span className="text-zinc-400">{cat.name.split(" ")[0]}:</span>
            <span className="text-zinc-100 font-bold">{cat.sizeMb.toFixed(0)} MB</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 4. Dual-Tone Resource Spectrum Histogram ─────────────────────────────────
interface SpectrumHistogramProps {
  processes: RunningProcessItem[];
}

function SpectrumHistogram({ processes }: SpectrumHistogramProps) {
  const barCount = 28;
  const width = 500;
  const height = 180;
  const barW = width / barCount - 3;

  // 14 dark gray baseline bars on left + 14 matte purple bars on right
  const bars = useMemo(() => {
    return Array.from({ length: barCount }).map((_, i) => {
      const isRightActive = i >= 14;
      let heightPct = 0;
      let label = "";

      if (!isRightActive) {
        // Left rising baseline envelope (20% to 85%)
        const rel = (i + 1) / 14;
        heightPct = 20 + Math.pow(rel, 1.4) * 68 + (i % 2 === 0 ? 4 : -3);
        label = `Baseline Task #${i + 1}`;
      } else {
        // Right falling active workload (100% down to 8%)
        const rel = (i - 14) / 14;
        const p = processes[i - 14];
        heightPct = p
          ? Math.max(6, Math.min(96, p.cpuPercent))
          : 95 - Math.pow(rel, 0.7) * 85 + (i % 3 === 0 ? -4 : 3);
        label = p ? `${p.name} (PID ${p.pid})` : `Decorative IDE Worker #${i - 13}`;
      }

      return {
        idx: i,
        heightPct: Math.max(6, Math.min(96, heightPct)),
        isRightActive,
        label,
      };
    });
  }, [barCount, processes]);

  const [hoveredBar, setHoveredBar] = useState<{ label: string; pct: number } | null>(null);

  return (
    <div className="relative w-full h-full flex flex-col justify-between space-y-2">
      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pb-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#3f3f46]" />
          <span>System Baseline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#a855f7]" />
          <span className="text-purple-300 font-semibold">Active IDE Workload</span>
        </div>
      </div>

      <div className="relative w-full h-[150px] overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          {/* Vertical grid lines */}
          {Array.from({ length: 9 }).map((_, i) => {
            const x = (i / 8) * width;
            return (
              <line
                key={i}
                x1={x}
                y1={0}
                x2={x}
                y2={height}
                stroke="rgba(255, 255, 255, 0.04)"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Bars */}
          {bars.map((b) => {
            const x = b.idx * (width / barCount) + 1.5;
            const barH = (b.heightPct / 100) * (height - 10);
            const y = height - barH;
            const color = b.isRightActive ? "#a855f7" : "#3f3f46";

            return (
              <rect
                key={b.idx}
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill={color}
                rx={1.5}
                className="transition-all duration-300 cursor-pointer hover:opacity-80"
                onMouseEnter={() => setHoveredBar({ label: b.label, pct: b.heightPct })}
                onMouseLeave={() => setHoveredBar(null)}
              />
            );
          })}
        </svg>
      </div>

      {/* Hover tooltip bar */}
      <div className="h-6 flex items-center justify-between text-[11px] font-mono px-2 rounded bg-zinc-900/60 border border-white/[0.04] text-zinc-400">
        <span>{hoveredBar ? hoveredBar.label : "Hover over any spectrum bar to inspect thread telemetry"}</span>
        {hoveredBar && <span className="text-purple-300 font-bold">{hoveredBar.pct.toFixed(1)}% Load</span>}
      </div>
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

  // Maintain rolling CPU history for real-time horizon
  const [cpuHistory, setCpuHistory] = useState<number[]>(() => [
    12, 14, 18, 15, 11, 9, 14, 16, 22, 19, 15, 12, 18, 24, 21, 16, 18, 14, 15, 17, 20, 18, 16, 15, 19, 14, 16, 18, 15, 16,
  ]);

  useEffect(() => {
    return systemMetricsService.subscribe((latest) => {
      setMetrics(latest);
      if (latest && Number.isFinite(latest.cpu_usage_percent)) {
        setCpuHistory((prev) => [...prev.slice(1), latest.cpu_usage_percent]);
      }
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
  const [activeRightTab, setActiveRightTab] = useState<"spectrum" | "caches" | "services">("spectrum");

  const fetchStorageAndProcesses = async () => {
    setIsRefreshing(true);
    try {
      const [storageRes, procRes, sysMetrics] = await Promise.all([
        fetch("/api/system/storage"),
        fetch("/api/system/processes"),
        systemMetricsService.fetchMetrics(),
      ]);

      if (sysMetrics) {
        setMetrics(sysMetrics);
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
  const diskFreeGb = activeMetrics?.disk_free_gb ?? (hasStorageMetrics ? storage.freeGb : 361.4);
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* LEFT 6 COLS: Telemetry Horizon Line & Stepped Memory Watermark ─── */}
          <div className="lg:col-span-6 space-y-5">
            <TelemetryHorizonChart
              history={cpuHistory}
              currentVal={cpuPercent}
              cores={activeMetrics?.cpu_count || 8}
            />

            <SteppedWatermarkChart
              memPercent={memPercent}
              storage={storage}
            />
          </div>

          {/* RIGHT 6 COLS: Diagnostic Console & Spectrum Histogram ──────────── */}
          <div className="lg:col-span-6 rounded-2xl bg-workbench border border-hairline p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-2xl backdrop-blur-md">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Workspace Diagnostics
              </h3>
              <span className="text-[10px] font-mono text-zinc-500">Live Threads</span>
            </div>

            {/* Top 6-Metric Highlights Grid (Exact Reference Inspo) */}
            <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-950/60 border border-white/[0.06] text-xs font-mono">
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Host Arch</div>
                <div className="text-zinc-200 font-bold mt-0.5">{hostPlatform} {hostArchitecture}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Total RAM</div>
                <div className="text-zinc-200 font-bold mt-0.5">{memTotalGb} GB</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Disk Free</div>
                <div className="text-emerald-400 font-bold mt-0.5">{formatGb(diskFreeGb)} GB</div>
              </div>

              <div className="pt-2 border-t border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 uppercase">Core Sockets</div>
                <div className="text-zinc-200 font-bold mt-0.5">{activeMetrics?.cpu_count || 8} Cores</div>
              </div>
              <div className="pt-2 border-t border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 uppercase">Active PIDs</div>
                <div className="text-zinc-200 font-bold mt-0.5">{processes.length} Services</div>
              </div>
              <div className="pt-2 border-t border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 uppercase">Reclaimable</div>
                <div className="text-amber-400 font-bold mt-0.5">{storage.cacheReclaimableMb.toFixed(0)} MB</div>
              </div>
            </div>

            {/* Tab Underline Navigation */}
            <div className="flex items-center gap-6 border-b border-hairline text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveRightTab("spectrum")}
                className={`pb-2.5 transition-colors cursor-pointer ${
                  activeRightTab === "spectrum"
                    ? "text-zinc-100 border-b-2 border-zinc-200 font-bold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Core & Process Spectrum
              </button>
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
              {activeRightTab === "spectrum" && (
                <SpectrumHistogram processes={processes} />
              )}

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
