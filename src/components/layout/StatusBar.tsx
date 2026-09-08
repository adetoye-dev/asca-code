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
        <div className="flex items-center space-x-1">
          <Icon icon={Cpu} className="w-3.5 h-3.5" />
          <span>CPU: {formatMetric(metrics?.cpu_usage_percent)}</span>
        </div>
        <div className="flex items-center space-x-1">
          <Icon icon={Activity} className="w-3.5 h-3.5" />
          <span>RAM: {formatMetric(metrics?.memory_usage_percent)}</span>
        </div>
        <div className="flex items-center space-x-1">
          <Icon icon={HardDrive} className="w-3.5 h-3.5" />
          <span>Disk: --</span>
        </div>
      </div>
    </div>
  );
}
