/**
 * AiAssistantChat.tsx — Full Conversational AI Chat & Agent Gauntlet
 *
 * Provides two primary workflows:
 * 1. 💬 Chat Mode (Default): Conversational AI assistant with real token streaming,
 *    syntax-highlighted code blocks, 1-click copy, and workspace awareness (git context,
 *    recent changes).
 * 2. ⚡ Agent Gauntlet Mode: Autonomous multi-round code generation & verification gauntlet
 *    (python3 core-engine/manager.py) with AST compilation and syntax gates.
 */

import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { Trash2, Copy, GitCommit, Maximize2, Minimize2, RefreshCw, Square, User, Check, ChevronDown, Code, X, Bot, Send, Wand2, CheckCircle2, Plus, Folder, GitBranch, Sparkles } from "lucide-react";
import type { PipelineStatus, PipelineOutputLine } from "../TelemetryScorecard";
import {
  getConfiguredModelsList,
  ConfiguredModelItem,
  loadAllProviders,
  saveProviderConfig,
} from "../../services/aiModelManager";
import {
  ProviderLogo,
} from "../ui/BrandLogos";
import { openAiManagementDashboard, EVENT_START_CODING_WITH_OLLAMA } from "../../services/ollamaSetup";
import {
  streamChatCompletion,
  type ChatMessage,
} from "../../services/aiChatService";
import {
  loadChatHistory,
  saveChatHistory,
  clearChatHistory,
  subscribeChatHistory,
} from "../../services/aiChatPersistence";
import { ConfirmDialog } from "../ui/ConfirmDialog";



interface AiAssistantChatProps {
  prompt: string;
  setPrompt: (p: string) => void;
  status: PipelineStatus;
  activityLog: PipelineOutputLine[];
  onRunPipeline: (overrideModel?: { provider: string; model: string }) => void;
  onCancelPipeline: () => void;
  projectRoot?: string;
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
  projectRoot = "",
  onClose,
  onPopOutWide,
  isWide = false,
}: AiAssistantChatProps) {

  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>(getConfiguredModelsList());
  const [selectedModelItem, setSelectedModelItem] = useState<ConfiguredModelItem | null>(() => {
    const list = getConfiguredModelsList();
    return list.find((m) => m.isDefault) || list[0] || null;
  });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  // Persistent chat history across tab switches, panel open/close, and reloads
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    loadChatHistory(projectRoot)
  );
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const heroMenuRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const projectName = projectRoot ? projectRoot.split("/").filter(Boolean).pop() || "acsa-code" : "acsa-code";

  // Sync available models and listen for global updates
  useEffect(() => {
    const refresh = () => {
      const list = getConfiguredModelsList();
      setConfiguredModels(list);
      setSelectedModelItem((prev) => {
        if (prev) {
          const match = list.find((m) => m.model === prev.model && m.providerId === prev.providerId);
          if (match) return match;
        }
        return list.find((m) => m.isDefault) || list[0] || null;
      });
    };

    refresh();
    window.addEventListener("acsa:models-updated", refresh);
    return () => window.removeEventListener("acsa:models-updated", refresh);
  }, []);

  // Listen for focus requests / Start Coding with Ollama triggers
  useEffect(() => {
    const handleFocus = (e: any) => {
      const targetModel = e?.detail?.model;
      if (targetModel) {
        setSelectedModelItem((prev) => {
          const list = getConfiguredModelsList();
          const match = list.find((m) => m.model === targetModel);
          return match || prev;
        });
      }
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    };

    window.addEventListener("acsa:focus-ai-chat-input", handleFocus);
    window.addEventListener(EVENT_START_CODING_WITH_OLLAMA, handleFocus);
    return () => {
      window.removeEventListener("acsa:focus-ai-chat-input", handleFocus);
      window.removeEventListener(EVENT_START_CODING_WITH_OLLAMA, handleFocus);
    };
  }, []);

  // Sync chat history when projectRoot changes and listen for cross-tab/cross-view updates
  useEffect(() => {
    setChatMessages(loadChatHistory(projectRoot));
    const unsubscribe = subscribeChatHistory(projectRoot, (incoming) => {
      if (!isStreamingRef.current) {
        setChatMessages(incoming);
      }
    });
    return unsubscribe;
  }, [projectRoot]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Close popup on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedMenu = menuRef.current && menuRef.current.contains(target);
      const clickedHeroMenu = heroMenuRef.current && heroMenuRef.current.contains(target);
      if (!clickedMenu && !clickedHeroMenu) {
        setIsModelMenuOpen(false);
      }
    };
    if (isModelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isModelMenuOpen]);

  // Scroll chat bottom on new messages or logs
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activityLog, isStreaming]);

  // ── Handle Send ─────────────────────────────────────────────────────────
  const handleSend = async (textToSend = prompt) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    // Determine intent from prompt
    const isAgentIntent =
      trimmed.startsWith("/") ||
      /^(refactor|build|generate|create)\b/i.test(trimmed);

    if (isAgentIntent) {
      if (status === "running") return;
      onRunPipeline(
        selectedModelItem
          ? {
              provider: selectedModelItem.providerId,
              model: selectedModelItem.model,
            }
          : undefined
      );
      // Optional: add a user message to chat history too, so they see what they asked
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setChatMessages(prev => {
        const next = [...prev, userMsg];
        saveChatHistory(next, projectRoot);
        return next;
      });
      setPrompt("");
      return;
    }

    // ── Chat Mode: Streaming conversational AI
    if (isStreaming) return;

    if (!selectedModelItem) {
      setChatMessages((prev) => {
        const warning: ChatMessage = {
          id: `warn-${Date.now()}`,
          role: "assistant",
          content: "⚠️ No local AI model is installed or selected. Please pull a model in the AI Management Dashboard to begin chatting.",
          timestamp: Date.now(),
          error: true,
        };
        const updated = [...prev, warning];
        saveChatHistory(updated, projectRoot);
        return updated;
      });
      return;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      provider: selectedModelItem.providerId,
      model: selectedModelItem.model,
      isStreaming: true,
    };

    const nextHistory = [...chatMessages, userMsg];
    const withPlaceholder = [...nextHistory, assistantPlaceholder];
    setChatMessages(withPlaceholder);
    saveChatHistory(withPlaceholder, projectRoot);
    setPrompt("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const providers = loadAllProviders();
    const activeProvider = providers[selectedModelItem.providerId];

    await streamChatCompletion({
      provider: selectedModelItem.providerId,
      model: selectedModelItem.model,
      messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
      projectRoot,
      baseUrl: activeProvider?.baseUrl,
      apiKey: activeProvider?.apiKey,
      signal: controller.signal,
      onDelta: (delta) => {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: msg.content + delta }
              : msg
          )
        );
      },
      onDone: () => {
        setIsStreaming(false);
        setChatMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, isStreaming: false }
              : msg
          );
          saveChatHistory(updated, projectRoot);
          return updated;
        });
      },
      onError: (errMsg) => {
        setIsStreaming(false);
        setChatMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: msg.content
                    ? `${msg.content}\n\n⚠️ **Error:** ${errMsg}`
                    : `⚠️ **Error:** ${errMsg}`,
                  isStreaming: false,
                  error: true,
                }
              : msg
          );
          saveChatHistory(updated, projectRoot);
          return updated;
        });
      },
    });
  };

  const handleStopStream = () => {
    if (status === "running") {
      onCancelPipeline();
    }
    abortControllerRef.current?.abort();
      setIsStreaming(false);
      setChatMessages((prev) => {
        const updated = prev.map((msg) =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg
        );
        saveChatHistory(updated, projectRoot);
        return updated;
      });
  };

  const handleClearChat = () => {
    clearChatHistory(projectRoot);
    setChatMessages([]);
  };

  const handleQuickAction = (text: string) => {
    setPrompt(text);
    void handleSend(text);
  };

  const renderModelMenu = (isCenterHero: boolean) => (
    <div
      className={`absolute ${
        isCenterHero ? "top-full mt-2 left-0" : "bottom-full mb-1.5 left-0"
      } w-64 bg-[#18181b] border border-zinc-800 rounded-xl shadow-2xl p-1.5 z-50 space-y-1 text-left`}
    >
      <div className="text-[10px] font-semibold text-zinc-400 px-2 py-1 uppercase tracking-wider font-mono">
        Installed AI Models
      </div>
      {configuredModels.length === 0 ? (
        <div className="px-2.5 py-3 text-center text-xs text-zinc-500 font-mono">
          No models installed yet
        </div>
      ) : (
        configuredModels.map((item) => {
          const isSelected =
            item.model === selectedModelItem?.model && item.providerId === selectedModelItem?.providerId;
          return (
            <button
              key={`${item.providerId}-${item.model}`}
              type="button"
              onClick={() => {
                setSelectedModelItem(item);
                setIsModelMenuOpen(false);
                if (item.providerId === "ollama") {
                  const all = loadAllProviders();
                  if (all.ollama) {
                    all.ollama.selectedModel = item.model;
                    saveProviderConfig(all.ollama);
                  }
                }
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                isSelected ? "bg-purple-950/50 text-purple-300 font-semibold" : "text-zinc-300 hover:bg-zinc-800/80"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <ProviderLogo providerId={item.providerId} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-mono text-[11px]">{item.model}</span>
              </div>
              {isSelected && <Icon icon={Check} className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
            </button>
          );
        })
      )}

      <div className="pt-1 border-t border-zinc-800/80 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => {
            setIsModelMenuOpen(false);
            openAiManagementDashboard();
          }}
          className="text-[10px] text-purple-400 hover:text-purple-300 py-1 transition-colors font-mono font-medium"
        >
          + Download More Models
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full w-full flex flex-col bg-[#141416] text-zinc-200 font-sans select-none overflow-hidden border-l border-[var(--vscode-border)]">
      {/* ── Header: Title, Mode Indicator, Pop-out, Close ────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans">
        <div className="flex items-center gap-2">
          <Icon icon={Bot} className="w-4 h-4 text-sky-400" />
          <span className="text-[13px] font-semibold text-zinc-100 tracking-tight">AI Assistant</span>
          {isWide ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 font-medium">
              Center Stage
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-400">
              Side Dock
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {chatMessages.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearChat(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Clear Conversation"
            >
              <Icon icon={Trash2} className="w-3.5 h-3.5" />
            </button>
          )}

          {onPopOutWide && (
            <button
              type="button"
              onClick={onPopOutWide}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title={isWide ? "Dock to Side Tool Window" : "Open in Center Stage Editor Tab"}
            >
              <Icon icon={isWide ? Minimize2 : Maximize2} className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Close AI Assistant (Cmd+L)"
            >
              <Icon icon={X} className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Main Scroll Area ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 font-sans">
        {/* ── 1. Chat Mode Content ──────────────────────────────────────── */}
        <>
          {/* Empty State / Welcome Screen */}
          {chatMessages.length === 0 && (
            isWide ? (
              /* Center Stage Hero Mode (Full Canvas Omnibar) */
              <div className="h-full min-h-[460px] flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-2xl space-y-4">
                  {/* Context pill strip */}
                  <div className="flex items-center justify-between px-1 text-xs text-zinc-400">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                        <Icon icon={Folder} className="w-3 h-3 text-sky-400" />
                        <span className="font-mono text-[11px]">{projectName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                        <Icon icon={GitBranch} className="w-3 h-3 text-emerald-400" />
                        <span className="font-mono text-[11px]">main</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-400">
                      <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3 h-3" />
                      <span className="font-mono text-[11px] text-zinc-300">{selectedModelItem?.model || "AI Model"}</span>
                    </div>
                  </div>

                  {/* Centered Floating Hero Omnibar Card */}
                  <div className="relative rounded-2xl bg-[#1c1c24]/95 backdrop-blur-xl border border-zinc-700/60 shadow-2xl p-4 space-y-3">
                    <textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="Ask anything, / for commands, @ for context"
                      rows={3}
                      className="w-full bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 outline-none resize-none font-sans leading-relaxed focus:ring-0 p-1"
                    />

                    {/* Bottom control bar inside card */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/80">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleQuickAction("Explain codebase structure and key modules")}
                          className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Add Context / Actions"
                        >
                          <Icon icon={Plus} className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => openAiManagementDashboard()}
                          className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Model Management & Tuning"
                        >
                          <Icon icon={Sparkles} className="w-3.5 h-3.5 text-purple-400" />
                        </button>

                        {/* Model Selector Pill */}
                        <div className="relative" ref={heroMenuRef}>
                          <button
                            type="button"
                            onClick={() => setIsModelMenuOpen((prev) => !prev)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-xs text-zinc-200 font-medium transition-all shadow-sm"
                          >
                            <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-mono text-[11px]">{selectedModelItem?.model || "Select Model"}</span>
                            <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400" />
                          </button>

                          {isModelMenuOpen && renderModelMenu(true)}
                        </div>

                        {/* Speed badge */}
                        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-800/40 border border-zinc-700/40 text-[11px] font-mono text-zinc-400">
                          <span>High · Fast</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={!prompt.trim()}
                        className="flex items-center justify-center w-8 h-8 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white shadow-md transition-all"
                        title="Send (Enter)"
                      >
                        <Icon icon={Send} className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Prompt suggestion chips */}
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleQuickAction("Give me a breakdown of the recent changes in this project.")}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-all group"
                    >
                      <Icon icon={GitCommit} className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                      <span>Recent changes breakdown</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickAction("Explain the architecture and main components of this codebase.")}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-all group"
                    >
                      <Icon icon={Code} className="w-3.5 h-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
                      <span>Explain project architecture</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickAction("How do I test and verify recent modifications in this workspace?")}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-all group"
                    >
                      <Icon icon={CheckCircle2} className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                      <span>Test & verification guide</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Compact Side Dock Empty State */
              <div className="space-y-5 max-w-xl mx-auto py-2">
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 tracking-tight flex items-center gap-2">
                    <span>ACSA Code AI Chat</span>
                    {selectedModelItem?.model && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 text-purple-300">
                        {selectedModelItem.model}
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Ask questions, request code reviews, generate components, or inspect recent changes.
                  </p>
                </div>

                {/* Quick Action Suggestions */}
                <div className="space-y-2">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                    Suggested Prompts
                  </span>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleQuickAction("Give me a breakdown of the recent changes in this project.")}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 text-left transition-all group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon icon={GitCommit} className="w-4 h-4 text-emerald-400 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-medium text-zinc-200 group-hover:text-zinc-100 truncate">
                          Give me a breakdown of the recent changes
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-300 shrink-0">›</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickAction("Explain the architecture and main components of this codebase.")}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 text-left transition-all group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon icon={Code} className="w-4 h-4 text-sky-400 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-medium text-zinc-200 group-hover:text-zinc-100 truncate">
                          Explain project architecture & key files
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-300 shrink-0">›</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickAction("How do I test and verify recent modifications in this workspace?")}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 text-left transition-all group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon icon={CheckCircle2} className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-medium text-zinc-200 group-hover:text-zinc-100 truncate">
                          How to test and verify recent modifications
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-300 shrink-0">›</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Conversation Messages */}
          {chatMessages.length > 0 && (
            <div className={isWide ? "max-w-3xl lg:max-w-4xl mx-auto w-full space-y-4 py-2" : "space-y-4"}>
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  {/* Role Header */}
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-zinc-400">
                    {msg.role === "user" ? (
                      <>
                        <span className="font-semibold text-zinc-300">You</span>
                        <Icon icon={User} className="w-3 h-3 text-zinc-400" />
                      </>
                    ) : (
                      <>
                        {msg.provider ? (
                          <ProviderLogo providerId={msg.provider} className="w-3 h-3" />
                        ) : (
                          <Icon icon={Bot} className="w-3 h-3 text-zinc-400" />
                        )}
                        <span className="font-semibold text-purple-300">{msg.model || "AI Assistant"}</span>
                      </>
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[95%] p-3.5 rounded-2xl text-xs leading-relaxed transition-all ${
                      msg.role === "user"
                        ? "bg-purple-950/40 border border-purple-500/30 text-purple-100 rounded-tr-sm"
                        : msg.error
                        ? "bg-red-950/30 border border-red-500/30 text-red-200 rounded-tl-sm w-full"
                        : "bg-zinc-900/90 border border-zinc-800/90 text-zinc-100 rounded-tl-sm w-full"
                    }`}
                  >
                    <FormattedMarkdown content={msg.content} isStreaming={msg.isStreaming} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>

        {/* ── 2. Agent Gauntlet Mode Content ────────────────────────────── */}
        {activityLog.length > 0 && (
          <div className={isWide ? "max-w-3xl lg:max-w-4xl mx-auto w-full space-y-4 font-sans mt-8 border-t border-zinc-800 pt-6" : "space-y-4 font-sans mt-8 border-t border-zinc-800 pt-6"}>
            <div className="p-3 rounded-xl bg-sky-950/20 border border-sky-500/30 text-xs text-sky-200/90">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Icon icon={Wand2} className="w-3.5 h-3.5 text-sky-400" />
                Autonomous Verification Gauntlet
              </span>
              <p className="mt-1 text-[11px] text-zinc-300">
                Executes multi-round self-healing code generation, runs physical syntax/performance gates, and applies atomic patches to files.
              </p>
            </div>

            <div className="space-y-3 font-sans">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                  <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3.5 h-3.5" />
                  <span>Engine Output: {selectedModelItem?.model || "AI Gauntlet"}</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                    status === "running"
                      ? "bg-sky-500/20 text-sky-400 animate-pulse"
                      : status === "success"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {status.toUpperCase()}
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px]">
                {activityLog.map((line, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg border transition-colors break-words ${
                      line.stream === "stderr"
                        ? "bg-red-950/20 border-red-500/30 text-red-300"
                        : line.content.startsWith("---") || line.content.startsWith("@@")
                        ? "bg-sky-950/20 border-sky-500/30 text-sky-300"
                        : "bg-zinc-900/60 border-zinc-800/80 text-zinc-200"
                    }`}
                  >
                    {line.content}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* ── Input Box & Controls (Only shown when not in empty Center Stage mode) ── */}
      {(!isWide || chatMessages.length > 0) && (
        <div className={`p-3 border-t border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans ${isWide ? "py-4" : ""}`}>
          <div className={isWide ? "max-w-3xl lg:max-w-4xl mx-auto w-full space-y-2.5" : "space-y-2"}>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Ask ${selectedModelItem?.model || "AI"} anything, or describe a task (Shift+Enter for new line)…`}
                rows={2}
                className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none resize-none font-sans transition-all"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              {/* Model Selector Dropdown Button */}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setIsModelMenuOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors"
                >
                  <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-mono text-[11px] truncate max-w-[120px]">
                    {selectedModelItem?.model || "Select Model"}
                  </span>
                  <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400" />
                </button>

                {isModelMenuOpen && renderModelMenu(false)}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5">
                {(isStreaming || status === "running") ? (
                  <button
                    type="button"
                    onClick={handleStopStream}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-xs font-semibold text-red-300 transition-colors"
                  >
                    <Icon icon={Square} className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!prompt.trim()}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40`}
                  >
                    <Icon icon={Send} className="w-3 h-3" />
                    <span>Send</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmClearChat && (
        <ConfirmDialog
          isOpen={true}
          title="Clear Conversation"
          message="Are you sure you want to clear the entire chat history? This cannot be undone."
          confirmText="Clear Chat"
          cancelText="Cancel"
          isDestructive={true}
          onConfirm={() => {
            handleClearChat();
            setConfirmClearChat(false);
          }}
          onCancel={() => setConfirmClearChat(false)}
        />
      )}
    </div>
  );
}

/* ── Formatted Markdown & Code Block Renderer ─────────────────────────── */
function FormattedMarkdown({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  if (!content && isStreaming) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
        <Icon icon={RefreshCw} className="w-3 h-3 animate-spin text-purple-400" />
        <span>Thinking…</span>
      </div>
    );
  }

  // Split content by code blocks: ```lang ... ```
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 leading-relaxed">
      {parts.map((part, idx) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const firstLineEnd = part.indexOf("\n");
          const lang = part.slice(3, firstLineEnd > 0 ? firstLineEnd : 3).trim() || "code";
          const code = firstLineEnd > 0 ? part.slice(firstLineEnd + 1, -3) : part.slice(3, -3);
          return <CodeBlock key={idx} language={lang} code={code} />;
        }

        // Render formatted text lines
        return <FormattedParagraph key={idx} text={part} />;
      })}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-purple-400 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  );
}

function FormattedParagraph({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1.5" />;

        // Headings: ###
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={i} className="text-xs font-bold text-zinc-100 pt-1">
              {trimmed.slice(4)}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={i} className="text-xs font-bold text-white pt-1">
              {trimmed.slice(3)}
            </h3>
          );
        }

        // List item: - or *
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex items-start gap-1.5 ml-2">
              <span className="text-purple-400 font-bold">•</span>
              <span>{renderInlineStyles(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Numbered list: 1.
        if (/^\d+\.\s/.test(trimmed)) {
          return (
            <div key={i} className="ml-2">
              {renderInlineStyles(trimmed)}
            </div>
          );
        }

        // Blockquote: >
        if (trimmed.startsWith("> ")) {
          return (
            <div key={i} className="bg-purple-500/10 border border-purple-500/20 rounded-md px-3 py-1.5 text-zinc-300 italic">
              {renderInlineStyles(trimmed.slice(2))}
            </div>
          );
        }

        return <div key={i}>{renderInlineStyles(line)}</div>;
      })}
    </div>
  );
}

function renderInlineStyles(text: string) {
  // Support inline `code` and **bold**
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith("`") && token.endsWith("`")) {
          return (
            <code
              key={index}
              className="px-1 py-0.5 rounded bg-zinc-800 text-purple-300 font-mono text-[11px]"
            >
              {token.slice(1, -1)}
            </code>
          );
        }
        if (token.startsWith("**") && token.endsWith("**")) {
          return (
            <strong key={index} className="font-bold text-white">
              {token.slice(2, -2)}
            </strong>
          );
        }
        return token;
      })}
    </>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden my-2 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800/80 text-zinc-400">
        <span className="text-[10px] font-semibold uppercase">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors"
        >
          {copied ? <Icon icon={Check} className="w-3 h-3 text-emerald-400" /> : <Icon icon={Copy} className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-zinc-200 leading-relaxed font-mono whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export default AiAssistantChat;
