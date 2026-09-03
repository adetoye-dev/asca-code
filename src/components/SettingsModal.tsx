/**
 * SettingsModal.tsx — AI Engine & Verification Gauntlet Configuration Modal
 *
 * Allows users to configure and switch between real code generation providers:
 * 1. Offline Deterministic Synthesizer (Zero models, zero keys, 100% offline).
 * 2. Local Ollama (e.g. qwen2.5-coder:7b, llama3, deepseek-coder).
 * 3. Local llama.cpp Sidecar (127.0.0.1:8080).
 * 4. Cloud API Key (OpenAI / OpenRouter / Gemini / Anthropic OpenAI-compatible).
 */

import React, { useState } from "react";
import { X, Cpu, Server, Key, Zap, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

export interface AISettings {
  provider: "deterministic" | "ollama" | "local" | "openai";
  model: string;
  apiKey: string;
  baseUrl: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (newSettings: AISettings) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: SettingsModalProps) {
  const [provider, setProvider] = useState<AISettings["provider"]>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  React.useEffect(() => {
    if (!isOpen) return;
    setProvider(settings.provider);
    setModel(settings.model);
    setApiKey(settings.apiKey);
    setBaseUrl(settings.baseUrl);
    setTestStatus("idle");
    setTestMessage("");
  }, [isOpen, settings]);

  if (!isOpen) return null;

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");

    if (provider === "deterministic") {
      setTimeout(() => {
        setTestStatus("success");
        setTestMessage("Built-in AST Engine ready. Zero external dependencies required.");
      }, 200);
      return;
    }

    try {
      const targetUrl =
        provider === "ollama"
          ? (baseUrl || "http://127.0.0.1:11434") + "/api/tags"
          : provider === "local"
          ? (baseUrl || "http://127.0.0.1:8080") + "/health"
          : (baseUrl || "https://api.openai.com/v1") + "/models";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(targetUrl, { method: "GET", headers });
      if (res.ok) {
        setTestStatus("success");
        setTestMessage(`Connection verified! Server responded with HTTP ${res.status}`);
      } else {
        setTestStatus("error");
        setTestMessage(`Server returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestMessage(`Connection failed: ${err.message || String(err)}`);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ provider, model, apiKey, baseUrl });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">AI Engine & LLM Provider</h2>
              <p className="text-[11px] text-zinc-400">
                Configure which engine generates code patches for the verification gauntlet.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="font-semibold text-zinc-300">Choose Active Engine</label>
            <div className="grid grid-cols-2 gap-2">
              {/* Deterministic Offline */}
              <button
                type="button"
                aria-pressed={provider === "deterministic"}
                onClick={() => setProvider("deterministic")}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  provider === "deterministic"
                    ? "bg-sky-500/10 border-sky-500 text-white font-medium"
                    : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-zinc-200">Offline Synthesizer</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  Zero models or keys required. Built-in AST generator.
                </p>
              </button>

              {/* Local Ollama */}
              <button
                type="button"
                aria-pressed={provider === "ollama"}
                onClick={() => setProvider("ollama")}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  provider === "ollama"
                    ? "bg-sky-500/10 border-sky-500 text-white font-medium"
                    : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Server className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-zinc-200">Local Ollama</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  Connects to localhost:11434 (Qwen, Llama, DeepSeek).
                </p>
              </button>

              {/* Cloud API Key */}
              <button
                type="button"
                aria-pressed={provider === "openai"}
                onClick={() => setProvider("openai")}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  provider === "openai"
                    ? "bg-sky-500/10 border-sky-500 text-white font-medium"
                    : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-zinc-200">Cloud API Key</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  OpenAI, OpenRouter, Gemini, or Anthropic.
                </p>
              </button>

              {/* Local llama-server */}
              <button
                type="button"
                aria-pressed={provider === "local"}
                onClick={() => setProvider("local")}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  provider === "local"
                    ? "bg-sky-500/10 border-sky-500 text-white font-medium"
                    : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-zinc-200">llama.cpp Sidecar</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  Start llama-server manually at 127.0.0.1:8080.
                </p>
              </button>
            </div>
          </div>

          {/* Conditional Inputs */}
          {provider === "ollama" && (
            <div className="space-y-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div>
                <label className="text-[11px] font-semibold text-zinc-400">Ollama Model Name</label>
                <input
                  type="text"
                  value={model}
                  placeholder="e.g. qwen2.5-coder:7b or llama3"
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-zinc-400">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  placeholder="http://127.0.0.1:11434"
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          )}

          {provider === "openai" && (
            <div className="space-y-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div>
                <label className="text-[11px] font-semibold text-zinc-400">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-zinc-400">Model Name</label>
                <input
                  type="text"
                  value={model}
                  placeholder="e.g. gpt-4o-mini or gemini-1.5-pro"
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-zinc-400">Endpoint URL (Optional)</label>
                <input
                  type="text"
                  value={baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          )}

          {/* Test Status Banner */}
          {testStatus !== "idle" && (
            <div
              className={`p-2.5 rounded-xl border flex items-start gap-2 text-[11px] ${
                testStatus === "testing"
                  ? "bg-zinc-800 border-zinc-700 text-zinc-300"
                  : testStatus === "success"
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                  : "bg-red-950/40 border-red-500/40 text-red-300"
              }`}
            >
              {testStatus === "testing" && <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5" />}
              {testStatus === "success" && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
              {testStatus === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
              <span>{testMessage || "Testing endpoint connection..."}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Test Connection</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 font-bold text-xs text-white shadow-md shadow-sky-600/20"
              >
                Save Engine
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SettingsModal;
