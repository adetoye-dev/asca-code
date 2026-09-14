import { GitBranch, Activity, FileCode, Cpu, HardDrive, Database, RefreshCw } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { SystemMetrics } from "../TelemetryScorecard";
import type { ProjectIndexState } from "../../hooks/usePipeline";

export interface StatusBarProps {
  gitBranch: string;
  encoding?: string;
  cursorPosition?: string;
  metrics?: SystemMetrics | null;
  indexStatus?: ProjectIndexState;
  isIndexing?: boolean;
  onSyncIndex?: () => void;
}

export function StatusBar({
  gitBranch,
  encoding = "UTF-8",
  cursorPosition = "Ln 1, Col 1",
  metrics,
  indexStatus,
  isIndexing = false,
  onSyncIndex,
}: StatusBarProps) {
  const formatMetric = (value?: number) => value === undefined ? "--" : `${Math.round(value)}%`;

  return (
    <div className="h-[24px] bg-canvas border-t border-hairline flex items-center justify-between px-4 text-xs text-muted select-none w-full">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1">
          <Icon icon={GitBranch} className="w-3.5 h-3.5" />
          <span>{gitBranch}</span>
        </div>
        <div className="flex items-center space-x-1">
          <span>{cursorPosition}</span>
        </div>
        <div className="flex items-center space-x-1">
          <Icon icon={FileCode} className="w-3.5 h-3.5" />
          <span>{encoding}</span>
        </div>

        {/* ── AST Code Intelligence Indexer Badge ── */}
        <div className="h-3.5 w-px bg-hairline/80 mx-1" />
        {isIndexing ? (
          <div className="flex items-center space-x-1.5 text-accent animate-pulse" title="AST Code Indexing in progress...">
            <Icon icon={RefreshCw} className="w-3.5 h-3.5 animate-spin text-accent" />
            <span className="font-mono text-[11px]">Indexing AST...</span>
          </div>
        ) : indexStatus?.indexed ? (
          <button
            type="button"
            onClick={onSyncIndex}
            className="flex items-center space-x-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer group"
            title={`Project Code Intelligence:
• Files synced: ${indexStatus.profile?.indexed_files ?? "--"}
• Symbols indexed: ${indexStatus.totalSymbols} across project
• Frameworks: ${indexStatus.profile?.frameworks?.join(", ") || "generic"}
Click to re-index project.`}
          >
            <Icon icon={Database} className="w-3.5 h-3.5 text-muted group-hover:scale-110 transition-transform" />
            <span className="group-hover:underline font-mono text-[11px]">{indexStatus.profile?.indexed_files ?? 0} files synced</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSyncIndex}
            className="flex items-center space-x-1 text-xs text-amber-400/80 hover:text-amber-400 cursor-pointer"
            title="Click to build AST symbol index for instant code intelligence"
          >
            <Icon icon={Database} className="w-3.5 h-3.5" />
            <span className="text-[11px]">Index Project</span>
          </button>
        )}
      </div>
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1" title={metrics?.cpu_count ? `${metrics.cpu_count} CPU Cores` : undefined}>
          <Icon icon={Cpu} className="w-3.5 h-3.5" />
          <span>CPU: {formatMetric(metrics?.cpu_usage_percent)}</span>
        </div>
        <div className="flex items-center space-x-1" title={metrics?.memory_used_mb && metrics?.memory_total_mb ? `${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB (${Math.round(metrics.memory_usage_percent)}%)` : undefined}>
          <Icon icon={Activity} className="w-3.5 h-3.5" />
          <span>RAM: {formatMetric(metrics?.memory_usage_percent)}</span>
        </div>
        <div
          className="flex items-center space-x-1"
          title={
            metrics?.disk_used_gb !== undefined && metrics?.disk_total_gb !== undefined
              ? `${metrics.disk_used_gb.toFixed(1)} GB used of ${metrics.disk_total_gb.toFixed(1)} GB${
                  metrics.disk_free_gb !== undefined ? ` (${metrics.disk_free_gb.toFixed(1)} GB free)` : ""
                }`
              : undefined
          }
        >
          <Icon icon={HardDrive} className="w-3.5 h-3.5" />
          <span>Disk: {formatMetric(metrics?.disk_usage_percent)}</span>
        </div>
      </div>
    </div>
  );
}
