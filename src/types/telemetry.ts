/**
 * telemetry.ts — shared shapes for host metrics and agent run output.
 *
 * These used to live in `TelemetryScorecard.tsx`, a component that rendered an
 * invented benchmark dashboard ("Est. Hosting Cost", "Max Capacity",
 * "Verification Status") from a verification gauntlet that no longer exists.
 * Nothing rendered that component any more — only its types were imported — so
 * the types moved here and the component is gone.
 */

/** Host metrics sampled by the Rust layer (`fetch_system_metrics`). */
export interface SystemMetrics {
  platform?: string;
  architecture?: string;
  node_version?: string;
  vite_version?: string;
  python_version?: string;
  cpu_count?: number;
  cpu_usage_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_usage_percent: number;
  disk_usage_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  is_thermal_risk: boolean;
  thermal_warning: string;
}

/** One line of run output, shown in the Output panel. */
export interface PipelineOutputLine {
  line_number: number;
  content: string;
  stream: "stdout" | "stderr";
  is_json: boolean;
}

export type PipelineStatus = "idle" | "running" | "success" | "failed" | "error";
