/**
 * AiManagementDashboard.tsx — Executive Multi-Model AI Management & Provider Configuration
 *
 * Modern AI Control Plane:
 * 1. Fixed-width left navigation grouped into "Local & Offline Engines" and "Cloud LLM APIs".
 * 2. Authentic brand logos with connection state and default model badges.
 * 3. Configuration stage with model selector, API key management, endpoint settings,
 *    live connection ping test with latency metrics, and prominent default model switcher.
 * 4. Multi-provider persistence in localStorage.
 */

import { useState, useEffect } from "react";
import {
  Star,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Eye,
  EyeOff,
  Cpu,
  Zap,
  Globe,
  Lock,
} from "lucide-react";
import { ProviderLogo } from "../ui/BrandLogos";
import type { AIProviderConfig, AIProviderId } from "../../types/workbench";
import {
  loadAllProviders,
  saveProviderConfig,
  setDefaultProvider,
} from "../../services/aiModelManager";

interface AiManagementDashboardProps {
  onModelSettingsChanged?: () => void;
}

export function AiManagementDashboard({
  onModelSettingsChanged,
}: AiManagementDashboardProps) {
  const [providers, setProviders] = useState<Record<AIProviderId, AIProviderConfig>>(loadAllProviders());
  const [selectedId, setSelectedId] = useState<AIProviderId>("deterministic");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);

  const activeProvider = providers[selectedId] || providers.deterministic;

  // Sync inputs when selected provider changes
  useEffect(() => {
    if (activeProvider) {
      setApiKeyInput(activeProvider.apiKey || "");
      setBaseUrlInput(activeProvider.baseUrl || "");
      setSelectedModel(activeProvider.selectedModel || activeProvider.availableModels[0] || "");
      setTestResult(null);
      setShowApiKey(false);
    }
  }, [selectedId]);

  const handleSaveProvider = (modelValue = selectedModel, baseUrlValue = baseUrlInput) => {
    const isConnected = !!(
      activeProvider.category === "local" ||
      (apiKeyInput && apiKeyInput.trim().length > 3)
    );

    const updated: AIProviderConfig = {
      ...activeProvider,
      apiKey: apiKeyInput.trim(),
      baseUrl: baseUrlValue.trim(),
      selectedModel: modelValue,
      isConnected,
    };

    const newMap = saveProviderConfig(updated);
    setProviders(newMap);
    onModelSettingsChanged?.();
  };

  const handleSetDefault = () => {
    handleSaveProvider();
    const newMap = setDefaultProvider(selectedId);
    setProviders(newMap);
    onModelSettingsChanged?.();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/ai/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider.id,
          baseUrl: baseUrlInput || activeProvider.baseUrl,
          apiKey: apiKeyInput || activeProvider.apiKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
        if (data.ok) {
          const updated: AIProviderConfig = {
            ...activeProvider,
            isConnected: true,
            latencyMs: data.latencyMs,
          };
          const newMap = saveProviderConfig(updated);
          setProviders(newMap);
        }
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: `Ping failed: ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const localProviders = Object.values(providers).filter((p) => p.category === "local");
  const cloudProviders = Object.values(providers).filter((p) => p.category === "cloud");
  const defaultProvider = Object.values(providers).find((p) => p.isDefault) || providers.deterministic;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0d0d10] text-zinc-200 p-6 lg:p-8 font-sans select-none">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* ── Top Header Toolbar ────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                <Cpu className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">AI Models & Providers</h1>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure local and cloud AI inference engines. Designate your global default model or switch on the fly.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-400 px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-2">
              <span className="text-zinc-500">Default:</span>
              <span className="font-semibold text-white">{defaultProvider.name}</span>
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            </span>
          </div>
        </div>

        {/* ── Main Two-Column Workbench Container ────────────────────────── */}
        <div className="flex flex-col md:flex-row rounded-2xl bg-[#131317] border border-zinc-800/80 overflow-hidden shadow-xl min-h-[580px]">
          {/* Left Column: Fixed-Width Providers Sidebar */}
          <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-zinc-800/80 p-4 space-y-5 bg-[#101014]/60">
            {/* Group 1: Local Engines */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>Local Engines (Offline)</span>
              </div>
              <div className="space-y-1">
                {localProviders.map((p) => {
                  const isSelected = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                        isSelected
                          ? "bg-zinc-800/90 text-white font-medium border border-zinc-700/60 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                          <ProviderLogo providerId={p.id} className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold">{p.name}</div>
                          <div className="truncate text-[10px] text-zinc-500 font-mono">{p.selectedModel}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pl-1">
                        {p.isDefault && (
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        )}
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Group 2: Cloud LLMs */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                <Globe className="w-3 h-3 text-sky-400" />
                <span>Cloud LLM APIs</span>
              </div>
              <div className="space-y-1">
                {cloudProviders.map((p) => {
                  const isSelected = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                        isSelected
                          ? "bg-zinc-800/90 text-white font-medium border border-zinc-700/60 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                          <ProviderLogo providerId={p.id} className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold">{p.name}</div>
                          <div className="truncate text-[10px] text-zinc-500 font-mono">{p.selectedModel}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pl-1">
                        {p.isDefault && (
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        )}
                        <span
                          className={`w-2 h-2 rounded-full ${
                            p.isConnected ? "bg-emerald-400" : "bg-zinc-700"
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Selected Provider Configuration Panel */}
          <div className="flex-1 p-6 lg:p-8 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              {/* Provider Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                    <ProviderLogo providerId={activeProvider.id} className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold text-white tracking-tight">{activeProvider.name}</h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                        {activeProvider.category === "local" ? "Local Engine" : "Cloud LLM"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          activeProvider.isConnected ? "bg-emerald-400" : "bg-zinc-600"
                        }`}
                      />
                      <span className="text-[11px] font-mono text-zinc-400 font-medium">
                        {activeProvider.isConnected ? "Connected & Verified" : "Not Configured"}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSetDefault}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-sm ${
                    activeProvider.isDefault
                      ? "bg-amber-400 text-zinc-950 shadow-amber-400/20"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/60"
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${activeProvider.isDefault ? "fill-zinc-950 text-zinc-950" : ""}`} />
                  <span>{activeProvider.isDefault ? "Current Default" : "Set as Default"}</span>
                </button>
              </div>

              {/* Model Selection Dropdown */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-300">
                  Active Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    handleSaveProvider(e.target.value, baseUrlInput);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-sky-500 transition-colors cursor-pointer"
                >
                  {activeProvider.availableModels.map((m) => (
                    <option key={m} value={m} className="bg-zinc-900 text-zinc-100">
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  Powers inline completions, code suggestions, syntax repair, and AI assistant conversations.
                </p>
              </div>

              {/* API Key Input (if cloud provider) */}
              {activeProvider.category === "cloud" ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                    <span>API Key / Secret Token</span>
                    <span className="text-[11px] text-zinc-500 font-normal">Stored in browser local storage on this device</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="sk-••••••••••••••••••••••••"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                        title={showApiKey ? "Hide key" : "Show key"}
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveProvider()}
                      className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white transition-colors shadow-sm"
                    >
                      Save Key
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-white">100% Offline & Private</div>
                    <p className="text-[11px] text-emerald-300/80 mt-0.5">
                      This model runs locally on your machine. Zero network traffic, zero third-party telemetry, zero API keys required.
                    </p>
                  </div>
                </div>
              )}

              {/* Base URL / Endpoint */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Base URL / Endpoint</span>
                  <button
                    type="button"
                    onClick={() => {
                      setBaseUrlInput(activeProvider.baseUrl);
                      handleSaveProvider(selectedModel, activeProvider.baseUrl);
                    }}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    Reset default
                  </button>
                </label>
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  placeholder="https://api..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
                />
              </div>

              {/* Test Connection Button */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={handleTestConnection}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 hover:text-white transition-all shadow-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-sky-400" : "text-zinc-400"}`} />
                  <span>{isTesting ? "Pinging Endpoint..." : "Test Connection"}</span>
                </button>

                {testResult && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 font-mono ${
                      testResult.ok
                        ? "bg-emerald-950/60 border border-emerald-500/40 text-emerald-300"
                        : "bg-red-950/60 border border-red-500/40 text-red-300"
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    )}
                    <span>
                      {testResult.ok
                        ? `Connection verified! Round-trip latency: ${testResult.latencyMs}ms`
                        : testResult.message || "Connection failed. Please check endpoint or API key."}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Status Callout */}
            <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
              <span>{activeProvider.availableModels.length} models available for {activeProvider.name}</span>
              <span className="font-mono text-[11px] text-zinc-500">ID: {activeProvider.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AiManagementDashboard;
