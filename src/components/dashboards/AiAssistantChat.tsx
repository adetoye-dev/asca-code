/**
 * AiAssistantChat.tsx — IntelliJ-Inspired AI Assistant Tool Window
 *
 * Modeled directly on IntelliJ AI Assistant (media_1788515647714.png)
 * and Inline Model Selector popup (media_1788512464275.png):
 * 1. Dedicated tool window with collapse, pop-out, and close controls.
 * 2. Authentic brand logos for Claude, OpenAI, Gemini, Ollama, DeepSeek, etc.
 * 3. Quick-action prompt cards ("Generate code", "Generate commit message", "Review git diff").
 * 4. Inline Model Selector with authentic logos inside the prompt box.
 */

import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  ChevronDown,
  Check,
  Send,
  Code2,
  GitCommit,
  AlertTriangle,
  StopCircle,
  Maximize2,
  X,
} from "lucide-react";
import type { PipelineStatus, PipelineOutputLine } from "../TelemetryScorecard";
import {
  getConfiguredModelsList,
  ConfiguredModelItem,
} from "../../services/aiModelManager";
import {
  ClaudeLogo,
  OpenAiLogo,
  CopilotLogo,
  OllamaLogo,
  DeterministicLogo,
  ProviderLogo,
} from "../ui/BrandLogos";

interface AiAssistantChatProps {
  prompt: string;
  setPrompt: (p: string) => void;
  status: PipelineStatus;
  activityLog: PipelineOutputLine[];
  onRunPipeline: (overrideModel?: { provider: string; model: string }) => void;
  onCancelPipeline: () => void;
  onClose?: () => void;
  onPopOutWide?: () => void;
  isWide?: boolean;
}

export function AiAssistantChat({
  prompt,
  setPrompt,
  status,
  activityLog,
  onRunPipeline,
  onCancelPipeline,
  onClose,
  onPopOutWide,
  isWide = false,
}: AiAssistantChatProps) {
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>(getConfiguredModelsList());
  const [selectedModelItem, setSelectedModelItem] = useState<ConfiguredModelItem>(() => {
    const list = getConfiguredModelsList();
    return list.find((m) => m.isDefault) || list[0];
  });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Sync available models
  useEffect(() => {
    const list = getConfiguredModelsList();
    setConfiguredModels(list);
    if (!list.some((m) => m.model === selectedModelItem.model && m.providerId === selectedModelItem.providerId)) {
      const def = list.find((m) => m.isDefault) || list[0];
      if (def) setSelectedModelItem(def);
    }
  }, []);

  // Close popup on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    if (isModelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isModelMenuOpen]);

  // Scroll chat bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog]);

  const handleSend = () => {
    if (!prompt.trim() || status === "running") return;
    onRunPipeline({
      provider: selectedModelItem.providerId,
      model: selectedModelItem.model,
    });
  };

  const handleActionClick = (actionText: string) => {
    setPrompt(actionText);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#141416] text-zinc-200 font-sans select-none overflow-hidden border-l border-[var(--vscode-border)]">
      {/* ── Tool Window Header (IntelliJ Style media_1788515647714.png) ── */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span className="text-[13px] font-semibold text-zinc-100 tracking-tight">AI Chat</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-zinc-700/60">
            <ProviderLogo providerId={selectedModelItem.providerId} className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[100px]">{selectedModelItem.model}</span>
          </span>
        </div>

        <div className="flex items-center gap-1">
          {onPopOutWide && (
            <button
              type="button"
              onClick={onPopOutWide}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title={isWide ? "Dock to Side Tool Window" : "Open in Center Stage Editor Tab"}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Close AI Tool Window (Cmd+L)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Chat Messages / Main Body ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 font-sans">
        {/* Welcome & Features Screen (Exact IntelliJ Style media_1788515647714.png) */}
        {activityLog.length === 0 && (
          <div className="space-y-4 max-w-xl mx-auto py-2">
            <div>
              <h2 className="text-base font-bold text-zinc-100 tracking-tight">
                Pair Your IDE Intelligence with AI
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Local-first deterministic generation with self-healing verification gauntlets
              </p>
            </div>

            {/* JetBrains-Style Agent Selection Cards */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Active & Available Agents
              </span>

              <div className="space-y-1.5">
                {/* Claude Card */}
                <div
                  onClick={() => {
                    const match = configuredModels.find((m) => m.providerId === "anthropic" || m.model.includes("claude"));
                    if (match) setSelectedModelItem(match);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/80 border border-zinc-800 cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <ClaudeLogo className="w-4 h-4" />
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">Claude Agent</div>
                      <div className="text-xs text-zinc-400">Anthropic Claude 3.5 Sonnet / Haiku</div>
                    </div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </div>

                {/* OpenAI / Codex Card */}
                <div
                  onClick={() => {
                    const match = configuredModels.find((m) => m.providerId === "openai");
                    if (match) setSelectedModelItem(match);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/80 border border-zinc-800 cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <OpenAiLogo className="w-4 h-4" />
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">Codex & GPT-4o</div>
                      <div className="text-xs text-zinc-400">OpenAI structured synthesis</div>
                    </div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </div>

                {/* Local Ollama Card */}
                <div
                  onClick={() => {
                    const match = configuredModels.find((m) => m.providerId === "ollama");
                    if (match) setSelectedModelItem(match);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/80 border border-zinc-800 cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <OllamaLogo className="w-4 h-4" />
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">Local Ollama</div>
                      <div className="text-xs text-zinc-400">Qwen2.5-Coder / DeepSeek / Llama3 (100% private)</div>
                    </div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </div>

                {/* GitHub Copilot Card */}
                <div
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <CopilotLogo className="w-4 h-4" />
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">GitHub Copilot</div>
                      <div className="text-xs text-zinc-400">OpenVSX extension integration</div>
                    </div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </div>

                {/* Offline AST Synthesizer */}
                <div
                  onClick={() => {
                    const match = configuredModels.find((m) => m.providerId === "deterministic");
                    if (match) setSelectedModelItem(match);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/80 border border-zinc-800 cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <DeterministicLogo className="w-4 h-4" />
                    <div>
                      <div className="text-[13px] font-medium text-zinc-100">Offline AST Engine</div>
                      <div className="text-xs text-zinc-400">Zero models, zero keys, 100% offline</div>
                    </div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </div>
              </div>
            </div>

            {/* Quick Feature Action Cards */}
            <div className="space-y-2 pt-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-sans">
                Suggested Prompts
              </span>

              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => handleActionClick("Generate a robust REST API handler with error boundary and unit tests.")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/70 text-left transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <Code2 className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[13px] font-medium text-zinc-200 group-hover:text-zinc-100">Generate code from descriptions</span>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleActionClick("Generate conventional git commit messages based on our current working tree changes.")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/70 text-left transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <GitCommit className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[13px] font-medium text-zinc-200 group-hover:text-zinc-100">Generate commit messages</span>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleActionClick("Inspect syntax and runtime problems, and provide an automated AST fix.")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/70 text-left transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[13px] font-medium text-zinc-200 group-hover:text-zinc-100">Explain runtime errors</span>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200">›</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Streaming / Output Activity Stream */}
        {activityLog.length > 0 && (
          <div className="space-y-3 font-sans">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <ProviderLogo providerId={selectedModelItem.providerId} className="w-3.5 h-3.5" />
                <span>Transcript: {selectedModelItem.model}</span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                status === "running"
                  ? "bg-sky-500/20 text-sky-400 animate-pulse"
                  : status === "success"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-300"
              }`}>
                {status.toUpperCase()}
              </span>
            </div>

            <div className="space-y-1 font-mono text-xs">
              {activityLog.map((line, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl border transition-colors ${
                    line.stream === "stderr"
                      ? "bg-red-950/20 border-red-500/30 text-red-300"
                      : line.content.startsWith("---") || line.content.startsWith("@@")
                      ? "bg-sky-950/20 border-sky-500/30 text-sky-300"
                      : "bg-zinc-900/60 border-zinc-800/80 text-zinc-200"
                  }`}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">{line.content}</div>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* ── Prompt Input Area with Inline Model Selector (media_1788512464275.png) ── */}
      <div className="p-3 border-t border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 focus-within:border-sky-500/70 transition-all shadow-lg relative">
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask AI Assistant, generate code, or request modifications..."
            className="w-full bg-transparent p-3 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none font-sans"
          />

          {/* Prompt Toolbar (Bottom strip) */}
          <div className="flex items-center justify-between px-2.5 pb-2 pt-1 border-t border-zinc-800/60">
            {/* Inline Model Picker Trigger (Matching media_1788512464275.png) */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setIsModelMenuOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-200 text-xs font-medium transition-colors border border-zinc-700/60"
                title="Select model to use for next prompt"
              >
                <ProviderLogo providerId={selectedModelItem.providerId} className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono text-xs truncate max-w-[130px]">
                  {selectedModelItem.model}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                  selectedModelItem.speedBadge === "Fast"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : selectedModelItem.speedBadge === "Thinking"
                    ? "bg-purple-500/20 text-purple-400"
                    : selectedModelItem.speedBadge === "Offline"
                    ? "bg-sky-500/20 text-sky-400"
                    : "bg-zinc-700 text-zinc-300"
                }`}>
                  {selectedModelItem.speedBadge}
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-400 ml-0.5" />
              </button>

              {/* Popup Menu with Authentic Logos (media_1788512464275.png) */}
              {isModelMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 font-sans">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Select Model
                  </div>

                  <div className="space-y-0.5 max-h-64 overflow-y-auto">
                    {configuredModels.map((item) => {
                      const isSelected =
                        item.model === selectedModelItem.model &&
                        item.providerId === selectedModelItem.providerId;

                      return (
                        <button
                          type="button"
                          key={`${item.providerId}-${item.model}`}
                          onClick={() => {
                            setSelectedModelItem(item);
                            setIsModelMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-colors ${
                            isSelected
                              ? "bg-zinc-800 text-white font-medium"
                              : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 truncate">
                            <ProviderLogo providerId={item.providerId} className="w-3.5 h-3.5 shrink-0" />
                            <div className="truncate">
                              <div className="truncate font-mono text-xs">{item.model}</div>
                              <div className="text-xs text-zinc-400 truncate font-sans">
                                {item.providerName}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                              item.speedBadge === "Fast"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : item.speedBadge === "Thinking"
                                ? "bg-purple-500/20 text-purple-400"
                                : item.speedBadge === "Offline"
                                ? "bg-sky-500/20 text-sky-400"
                                : "bg-zinc-800 text-zinc-300"
                            }`}>
                              {item.speedBadge}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-sky-400" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Submit or Stop Button */}
            <div className="flex items-center gap-2">
              {status === "running" ? (
                <button
                  type="button"
                  onClick={onCancelPipeline}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[13px] font-semibold transition-all shadow-sm cursor-pointer"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!prompt.trim()}
                  onClick={handleSend}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all shadow-sm ${
                    !prompt.trim()
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/20 cursor-pointer"
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AiAssistantChat;
