/**
 * usePipeline.ts — Orchestration State Coordination Hook
 *
 * Coordinates state between the TradeOffSliders configuration panel,
 * the TelemetryScorecard performance monitor, and the Tauri desktop backend.
 *
 * Handles:
 * 1. Listening to `pipeline:output` streaming lines emitted by Tauri/manager.py.
 * 2. Listening to `pipeline:complete` structured event payloads.
 * 3. Polling `fetch_system_metrics` periodically to check thermal/hardware state.
 * 4. Triggering `run_generation_pipeline` Tauri command.
 * 5. Graceful fallback when running in web browser dev preview (outside Tauri runtime).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SliderConfig } from "../components/TradeOffSliders";
import type {
  TelemetryData,
  OrchestrationResult,
  PipelineOutputLine,
  SystemMetrics,
  PipelineStatus,
} from "../components/TelemetryScorecard";

export interface UsePipelineOptions {
  projectRoot?: string;
  defaultLanguage?: string;
  pollMetricsIntervalMs?: number;
}

export interface UsePipelineReturn {
  // State
  prompt: string;
  setPrompt: (p: string) => void;
  sliders: SliderConfig;
  setSliders: (s: SliderConfig) => void;
  status: PipelineStatus;
  telemetry: TelemetryData | null;
  orchestrationResult: OrchestrationResult | null;
  activityLog: PipelineOutputLine[];
  systemMetrics: SystemMetrics | null;
  activeTab: "editor" | "telemetry" | "diffs";
  setActiveTab: (t: "editor" | "telemetry" | "diffs") => void;

  // Actions
  runPipeline: (customPrompt?: string) => Promise<void>;
  cancelPipeline: () => void;
  clearLog: () => void;
  isTauriAvailable: boolean;
}

const DEFAULT_SLIDERS: SliderConfig = {
  budget_vs_scale: "medium",
  speed_vs_precision: "medium",
  simplicity_vs_futureproof: "medium",
};

export function usePipeline(options: UsePipelineOptions = {}): UsePipelineReturn {
  const {
    projectRoot = ".",
    defaultLanguage = "python",
    pollMetricsIntervalMs = 2000,
  } = options;

  const [prompt, setPrompt] = useState<string>("");
  const [sliders, setSliders] = useState<SliderConfig>(DEFAULT_SLIDERS);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [orchestrationResult, setOrchestrationResult] = useState<OrchestrationResult | null>(null);
  const [activityLog, setActivityLog] = useState<PipelineOutputLine[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "telemetry" | "diffs">("editor");

  const unlistenOutputRef = useRef<(() => void) | null>(null);
  const unlistenCompleteRef = useRef<(() => void) | null>(null);

  // Check if running inside Tauri webview
  const isTauriAvailable = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // ── Poll System Metrics ───────────────────────────────────────────────────
  useEffect(() => {
    let timer: any = null;

    const poll = async () => {
      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const metrics = await invoke<SystemMetrics>("fetch_system_metrics");
          setSystemMetrics(metrics);
        } catch (err) {
          console.warn("fetch_system_metrics invoke failed:", err);
        }
      } else {
        // Mock metrics for web development mode
        setSystemMetrics({
          cpu_usage_percent: 18.5,
          memory_used_mb: 4096,
          memory_total_mb: 16384,
          memory_usage_percent: 25.0,
          is_thermal_risk: false,
          thermal_warning: "",
        });
      }
    };

    poll();
    timer = setInterval(poll, pollMetricsIntervalMs);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isTauriAvailable, pollMetricsIntervalMs]);

  // ── Event Listeners Setup ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauriAvailable) return;

    let mounted = true;

    async function setupListeners() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        // Listen for streaming output lines
        const unlistenOut = await listen<PipelineOutputLine>("pipeline:output", (event) => {
          if (!mounted) return;
          const line = event.payload;
          setActivityLog((prev) => [...prev, line]);

          // Extract inline telemetry if json payload emitted
          if (line.is_json) {
            try {
              const data = JSON.parse(line.content);
              if (data.telemetry) {
                setTelemetry(data.telemetry);
              }
            } catch {
              // ignore
            }
          }
        });

        // Listen for complete event
        const unlistenComp = await listen<any>("pipeline:complete", (event) => {
          if (!mounted) return;
          const result = event.payload;
          if (result && result.parsed_result) {
            setOrchestrationResult(result.parsed_result);
            if (result.parsed_result.outcome === "success") {
              setStatus("success");
            } else {
              setStatus("failed");
            }
          } else if (result && result.success) {
            setStatus("success");
          } else {
            setStatus("failed");
          }
        });

        unlistenOutputRef.current = unlistenOut;
        unlistenCompleteRef.current = unlistenComp;
      } catch (err) {
        console.error("Failed to setup Tauri event listeners:", err);
      }
    }

    setupListeners();

    return () => {
      mounted = false;
      if (unlistenOutputRef.current) unlistenOutputRef.current();
      if (unlistenCompleteRef.current) unlistenCompleteRef.current();
    };
  }, [isTauriAvailable]);

  // ── Run Pipeline ──────────────────────────────────────────────────────────
  const runPipeline = useCallback(
    async (customPrompt?: string) => {
      const activePrompt = customPrompt ?? prompt;
      if (!activePrompt.trim()) return;

      setStatus("running");
      setActivityLog([]);
      setOrchestrationResult(null);
      setTelemetry(null);

      if (isTauriAvailable) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const result: any = await invoke("run_generation_pipeline", {
            prompt: activePrompt,
            sliders,
            projectRoot,
            language: defaultLanguage,
            skipPerformance: false,
            dryRun: false,
          });

          if (result && result.parsed_result) {
            setOrchestrationResult(result.parsed_result);
            setStatus(result.parsed_result.outcome === "success" ? "success" : "failed");
          } else {
            setStatus(result.success ? "success" : "failed");
          }
        } catch (err: any) {
          console.error("Pipeline invocation failed:", err);
          setStatus("error");
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: prev.length + 1,
              content: `Error: ${err?.message || err}`,
              stream: "stderr",
              is_json: false,
            },
          ]);
        }
      } else {
        // Simulated execution for web browser preview mode
        const mockLines = [
          "Starting generation pipeline with budget_vs_scale=" + sliders.budget_vs_scale,
          "Calling local sidecar at 127.0.0.1:8080...",
          "Received diff patch draft (1 file)",
          "Running syntax gate on staged files...",
          "Syntax gate PASSED (0 errors, 0 warnings)",
          "Running property oracle tests...",
          "Oracle tests PASSED (12/12 edge cases verified)",
          "Launching load sandbox on port 9102...",
          "Benchmark complete: 10,500 req/s, 0.9ms avg latency",
          "All verification gates PASSED — finalizing patch to disk",
        ];

        for (let i = 0; i < mockLines.length; i++) {
          await new Promise((res) => setTimeout(res, 350));
          setActivityLog((prev) => [
            ...prev,
            {
              line_number: i + 1,
              content: mockLines[i],
              stream: "stdout",
              is_json: false,
            },
          ]);
        }

        setTelemetry({
          avg_latency_ms: 0.9,
          p50_latency_ms: 0.8,
          p99_latency_ms: 2.1,
          max_latency_ms: 5.4,
          requests_per_second: 10500,
          total_requests: 50000,
          error_count: 0,
          peak_cpu_percent: 22.4,
          peak_memory_mb: 34.5,
          avg_cpu_percent: 15.2,
          avg_memory_mb: 28.1,
        });

        setOrchestrationResult({
          outcome: "success",
          total_rounds: 1,
          elapsed_ms: 3200,
          error_detail: "",
          rounds: [
            {
              round_number: 1,
              syntax_passed: true,
              performance_passed: true,
              syntax_errors: 0,
              performance_breaches: [],
              context_card_tokens: 120,
              llm_latency_ms: 1800,
            },
          ],
        });

        setStatus("success");
      }
    },
    [prompt, sliders, projectRoot, defaultLanguage, isTauriAvailable]
  );

  const cancelPipeline = useCallback(() => {
    setStatus("idle");
  }, []);

  const clearLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  return {
    prompt,
    setPrompt,
    sliders,
    setSliders,
    status,
    telemetry,
    orchestrationResult,
    activityLog,
    systemMetrics,
    activeTab,
    setActiveTab,
    runPipeline,
    cancelPipeline,
    clearLog,
    isTauriAvailable,
  };
}

export default usePipeline;
