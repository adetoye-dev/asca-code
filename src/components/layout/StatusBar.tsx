import { GitBranch, Activity, FileCode, Cpu, HardDrive } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { SystemMetrics } from "../TelemetryScorecard";

export interface StatusBarProps {
  gitBranch: string;
  encoding?: string;
  cursorPosition?: string;
  metrics?: SystemMetrics | null;
}

export function StatusBar({ gitBranch, encoding = "UTF-8", cursorPosition = "Ln 1, Col 1", metrics }: StatusBarProps) {
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
