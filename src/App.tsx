/**
 * App.tsx — Autonomous IDE Main Application Layout
 *
 * Full desktop IDE interface combining:
 * 1. Status Bar: Offline status, host hardware load, thermal safety guards.
 * 2. Steering & Prompt Panel: User request prompt with presets and TradeOffSliders.
 * 3. Telemetry & Verification Panel: TelemetryScorecard with real-time gauntlet cards.
 * 4. Micro-Diff Inspector: Live visual review of generated unified diff hunks.
 */

import React, { useState } from "react";
import { TradeOffSliders } from "./components/TradeOffSliders";
import { TelemetryScorecard } from "./components/TelemetryScorecard";
import { usePipeline } from "./hooks/usePipeline";

const PRESET_PROMPTS = [
  {
    title: "High-Throughput Token Auth",
    prompt:
      "Create a high-performance token authentication module with in-memory token caching, rate-limiting, and timing-safe signature verification.",
  },
  {
    title: "Transactional Order Processing",
    prompt:
      "Implement an atomic checkout pipeline with inventory decrementing, idempotent order ledger entries, and zero-loss rollback logic.",
  },
  {
    title: "Lightweight Key-Value Storage",
    prompt:
      "Build an in-process key-value store with TTL expiration, thread-safe access locks, and snapshot persistence to disk.",
  },
];

export function App() {
  const {
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
  } = usePipeline();

  const [customLanguage, setCustomLanguage] = useState("python");

  const isRunning = status === "running";

  const handlePresetClick = (presetText: string) => {
    if (!isRunning) {
      setPrompt(presetText);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* ── Top Navigation Bar ────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md select-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center font-black text-white text-base shadow-lg shadow-sky-500/20">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-zinc-100">
                AUTONOMOUS IDE
              </h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                100% Offline-First
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Deterministic Verification Gates over Probabilistic AI Reasoning
            </p>
          </div>
        </div>

        {/* Right Host Hardware Telemetry */}
        <div className="flex items-center gap-4 text-xs">
          {systemMetrics && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">CPU</span>
                <span
                  className={`font-mono font-medium ${
                    systemMetrics.cpu_usage_percent > 80
                      ? "text-red-400"
                      : "text-zinc-300"
                  }`}
                >
                  {systemMetrics.cpu_usage_percent.toFixed(0)}%
                </span>
              </div>
              <div className="w-px h-3 bg-zinc-700" />
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">RAM</span>
                <span className="font-mono font-medium text-zinc-300">
                  {systemMetrics.memory_used_mb > 1024
                    ? `${(systemMetrics.memory_used_mb / 1024).toFixed(1)} GB`
                    : `${systemMetrics.memory_used_mb.toFixed(0)} MB`}
                </span>
              </div>
              {systemMetrics.is_thermal_risk && (
                <>
                  <div className="w-px h-3 bg-zinc-700" />
                  <span className="flex items-center gap-1 text-amber-400 font-medium animate-pulse">
                    🔥 Hot
                  </span>
                </>
              )}
            </div>
          )}

          {/* Navigation View Switcher */}
          <div className="flex items-center p-0.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50">
            <button
              onClick={() => setActiveTab("editor")}
              className={`px-3 py-1 rounded-md font-medium text-xs transition-colors ${
                activeTab === "editor"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Control & Config
            </button>
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`px-3 py-1 rounded-md font-medium text-xs transition-colors ${
                activeTab === "telemetry"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Performance Scorecard
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace Body ───────────────────────────────────────────── */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Column: Prompt Input & Trade-off Sliders */}
        <div className="w-1/2 flex flex-col border-r border-zinc-800 overflow-y-auto p-6 space-y-6">
          {/* Prompt Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <label
                htmlFor="user-prompt"
                className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
              >
                Code Generation Request
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Target Language:</span>
                <select
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  disabled={isRunning}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="python">Python</option>
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </div>
            </div>

            <textarea
              id="user-prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
              placeholder="Describe what you want to build (e.g., 'Build a fast JWT auth service with SQLite cache')..."
              className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900/80 p-4 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none transition-colors"
            />

            {/* Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-zinc-500">
                Quick Architectural Presets:
              </span>
              <div className="flex flex-wrap gap-2">
                {PRESET_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePresetClick(p.prompt)}
                    disabled={isRunning}
                    className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                  >
                    ⚡ {p.title}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Trade-off Sliders Panel */}
          <TradeOffSliders
            initialConfig={sliders}
            onChange={setSliders}
            disabled={isRunning}
          />

          {/* Action CTA */}
          <div className="pt-2">
            {!isRunning ? (
              <button
                type="button"
                onClick={() => runPipeline()}
                disabled={!prompt.trim()}
                className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white shadow-xl transition-all flex items-center justify-center gap-2 ${
                  prompt.trim()
                    ? "bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 hover:opacity-95 hover:shadow-sky-500/25 cursor-pointer"
                    : "bg-zinc-800 text-zinc-500 border border-zinc-700/40 cursor-not-allowed"
                }`}
              >
                <span>🚀 Execute Autonomous Pipeline</span>
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled
                  className="flex-1 py-3.5 px-4 rounded-xl font-bold text-sm bg-zinc-800 border border-zinc-700 text-sky-400 flex items-center justify-center gap-3 cursor-wait"
                >
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500" />
                  </span>
                  Verification Gauntlet Running...
                </button>
                <button
                  type="button"
                  onClick={cancelPipeline}
                  className="px-5 py-3.5 rounded-xl font-semibold text-sm bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Telemetry & Micro-Diff Inspector */}
        <div className="w-1/2 flex flex-col overflow-y-auto p-6 bg-zinc-950/50">
          <TelemetryScorecard
            telemetry={telemetry}
            orchestrationResult={orchestrationResult}
            pipelineStatus={status}
            activityLog={activityLog}
            systemMetrics={systemMetrics}
            sliderScale={sliders.budget_vs_scale}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
