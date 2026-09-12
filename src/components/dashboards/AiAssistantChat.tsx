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
import { Trash2, Copy, GitCommit, Maximize2, Minimize2, RefreshCw, Square, User, Check, ChevronDown, ChevronRight, Code, Code2, MessageSquare, ListTodo, X, Bot, CheckCircle2, Plus, Folder, GitBranch, ArrowUp, Image as ImageIcon, Database, AlertCircle, AtSign, Sparkles, Shield, Terminal, Search, Wrench, Users } from "lucide-react";
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
  type AgentStep,
} from "../../services/aiChatService";
import {
  loadChatHistory,
  saveChatHistory,
  clearChatHistory,
  subscribeChatHistory,
} from "../../services/aiChatPersistence";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { ProjectIndexState } from "../../hooks/usePipeline";

interface AiAssistantChatProps {
  prompt: string;
  setPrompt: (p: string) => void;
  status: PipelineStatus;
  activityLog: PipelineOutputLine[];
  onRunPipeline: (
    request: string,
    overrideModel?: { provider: string; model: string; apiKey?: string; baseUrl?: string },
    activeFilePath?: string,
    selectedCode?: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ) => void;
  onCancelPipeline: () => void;
  projectRoot?: string;
  onClose?: () => void;
  onPopOutWide?: () => void;
  isWide?: boolean;
  selectedContext?: { path: string; code: string } | null;
  failureDetail?: string;
  orchestrationResult?: any;
  indexStatus?: ProjectIndexState;
  isIndexing?: boolean;
  onSyncIndex?: () => void;
  streamingAnswer?: string;
  streamingThought?: string;
  agentSteps?: AgentStep[];
}

export type WorkflowMode = "agent" | "chat" | "plan";

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
  selectedContext = null,
  failureDetail = "",
  orchestrationResult = null,
  indexStatus,
  isIndexing = false,
  onSyncIndex,
  streamingAnswer = "",
  streamingThought = "",
  agentSteps = [],
}: AiAssistantChatProps) {

  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>(getConfiguredModelsList());
  const [selectedModelItem, setSelectedModelItem] = useState<ConfiguredModelItem | null>(() => {
    const list = getConfiguredModelsList();
    return list.find((m) => m.isDefault) || list[0] || null;
  });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  // Persistent chat history across tab switches, panel open/close, and reloads
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    loadChatHistory(projectRoot)
  );
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("agent");
  const [agentElapsedSeconds, setAgentElapsedSeconds] = useState(0);
  const agentStartedAtRef = useRef<number | null>(null);
  const isStreamingRef = useRef(false);

  // Multimodal image attachment state
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (dataUrl) {
          setAttachedImages((prev) => [...prev, dataUrl]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleImageFiles(imageFiles);
    }
  };

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const heroMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const heroModeMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const heroContextMenuRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const projectName = projectRoot ? projectRoot.split("/").filter(Boolean).pop() || "acsa-code" : "acsa-code";
  const latestActivity = activityLog[activityLog.length - 1]?.content || "";
  const currentAgentPhase = latestActivity.includes("syntax")
    ? "Checking generated changes"
    : latestActivity.includes("performance") || latestActivity.includes("sandbox")
    ? "Running verification checks"
    : latestActivity.includes("Written:") || latestActivity.includes("patch")
    ? "Applying verified changes"
    : status === "running"
    ? "Thinking through the task"
    : status === "success"
    ? "Task completed"
    : status === "failed" || status === "error"
    ? "Task failed"
    : "Ready";

  useEffect(() => {
    if (status !== "running") {
      agentStartedAtRef.current = null;
      setAgentElapsedSeconds(0);
      return;
    }
    agentStartedAtRef.current ??= Date.now();
    const timer = window.setInterval(() => {
      setAgentElapsedSeconds(Math.floor((Date.now() - (agentStartedAtRef.current || Date.now())) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "running" && (status === "success" || status === "failed" || status === "error")) {
      const isSuccess = status === "success";
      let errorType: "offline" | "timeout" | "syntax" | "general" = "general";
      const detailLower = (failureDetail || "").toLowerCase();
      if (
        detailLower.includes("unable to connect") ||
        detailLower.includes("unreachable") ||
        detailLower.includes("connection refused")
      ) {
        errorType = "offline";
      } else if (
        detailLower.includes("timed out") ||
        detailLower.includes("timeout") ||
        orchestrationResult?.outcome === "timeout"
      ) {
        errorType = "timeout";
      } else if (
        detailLower.includes("syntax") ||
        detailLower.includes("lint") ||
        detailLower.includes("paradox") ||
        orchestrationResult?.outcome === "paradox_detected"
      ) {
        errorType = "syntax";
      }

      const finalContent = isSuccess
        ? (orchestrationResult?.answer || streamingAnswer)
          ? (orchestrationResult?.answer || streamingAnswer)
          : orchestrationResult
          ? `### Verified Workspace Update\n\nTask successfully verified and applied in ${orchestrationResult.total_rounds ?? 1} round(s) (${Math.round(orchestrationResult.elapsed_ms ?? 0)}ms).`
          : "Verified changes were successfully applied to the workspace."
        : failureDetail
        ? `⚠️ **Task Failed:** ${failureDetail}`
        : "The task needs attention. Review Problems or Output for details.";

      const finalizedSteps = agentSteps.map((s) =>
        s.status === "running" ? { ...s, status: "done" as const } : s
      );

      const agentMsg: ChatMessage = {
        id: `assistant-agent-${Date.now()}`,
        role: "assistant",
        content: finalContent,
        timestamp: Date.now(),
        provider: selectedModelItem?.providerId || "ollama",
        model: selectedModelItem?.model || "ACSA Agent",
        steps: finalizedSteps.length > 0 ? finalizedSteps : undefined,
        thinking: streamingThought || undefined,
        error: !isSuccess,
        errorType: !isSuccess ? errorType : undefined,
      };
      setChatMessages((prev) => {
        const next = [...prev, agentMsg];
        saveChatHistory(next, projectRoot);
        return next;
      });
    }
    prevStatusRef.current = status;
  }, [status, orchestrationResult, failureDetail, projectRoot, selectedModelItem, streamingAnswer, streamingThought, agentSteps]);

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

  // Load chat history on mount or when projectRoot changes
  useEffect(() => {
    setChatMessages(loadChatHistory(projectRoot));
  }, [projectRoot]);

  // Subscribe to external chat updates across tabs/panels
  useEffect(() => {
    const unsub = subscribeChatHistory(projectRoot, (incoming) => {
      if (!isStreamingRef.current) {
        setChatMessages(incoming);
      }
    });
    return unsub;
  }, [projectRoot]);

  // Auto-focus the input textarea when panel opens or model changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [selectedModelItem, workflowMode]);

  // Keyboard shortcut listeners (Cmd+L for Chat mode, Shift+Cmd+I for Agent mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setWorkflowMode("agent");
        textareaRef.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        setWorkflowMode((prev) => (prev === "chat" ? "agent" : "chat"));
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        heroMenuRef.current &&
        !heroMenuRef.current.contains(e.target as Node)
      ) {
        setIsModelMenuOpen(false);
      }
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node) &&
        heroContextMenuRef.current &&
        !heroContextMenuRef.current.contains(e.target as Node)
      ) {
        setIsContextMenuOpen(false);
      }
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(e.target as Node) &&
        heroModeMenuRef.current &&
        !heroModeMenuRef.current.contains(e.target as Node)
      ) {
        setIsModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Listen for custom event from Ollama banner to switch to Ollama
  useEffect(() => {
    const handleSwitch = (e: CustomEvent<{ providerId: string; model: string }>) => {
      if (e.detail?.model) {
        const list = getConfiguredModelsList();
        setConfiguredModels(list);
        const match = list.find(
          (m) => m.providerId === e.detail.providerId && m.model === e.detail.model
        );
        if (match) setSelectedModelItem(match);
      }
    };
    window.addEventListener(EVENT_START_CODING_WITH_OLLAMA as any, handleSwitch);
    return () => window.removeEventListener(EVENT_START_CODING_WITH_OLLAMA as any, handleSwitch);
  }, []);

  useEffect(() => {
    const handleWorkflowRequest = (event: Event) => {
      const mode = (event as CustomEvent<WorkflowMode>).detail;
      setWorkflowMode(mode);
      if (!selectedContext?.code) return;
      const context = `\n\nSelected code from ${selectedContext.path}:\n\`\`\`\n${selectedContext.code}\n\`\`\``;
      setPrompt(
        mode === "agent"
          ? `Edit the selected code to make it more readable. Preserve behavior and write the change to ${selectedContext.path}.${context}`
          : mode === "plan"
          ? `Help me design and plan architectural improvements or changes for this selected code.${context}`
          : `Help me understand this selected code.${context}`
      );
      textareaRef.current?.focus();
    };
    window.addEventListener("acsa:ai-workflow", handleWorkflowRequest);
    return () => window.removeEventListener("acsa:ai-workflow", handleWorkflowRequest);
  }, [selectedContext, setPrompt]);

  // Scroll chat bottom on new messages, logs, or streaming updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activityLog, isStreaming, streamingAnswer, agentSteps]);

  // ── Handle Send ─────────────────────────────────────────────────────────
  const handleSend = async (textToSend = prompt) => {
    const trimmed = textToSend.trim();
    if (!trimmed && attachedImages.length === 0) return;

    const currentImages = attachedImages.length > 0 ? [...attachedImages] : undefined;
    const promptToSend = trimmed || (currentImages ? "Please analyze the attached image(s)." : "");

    if (workflowMode === "agent") {
      if (status === "running") return;
      const providers = loadAllProviders();
      const activeProvider = selectedModelItem ? providers[selectedModelItem.providerId] : undefined;

      // Extract recent conversation memory for the autonomous agent
      const recentHistory = chatMessages
        .filter((m) => !m.error && m.content)
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 1500),
        }));

      onRunPipeline(
        promptToSend,
        selectedModelItem
          ? {
              provider: selectedModelItem.providerId,
              model: selectedModelItem.model,
              apiKey: activeProvider?.apiKey,
              baseUrl: activeProvider?.baseUrl,
            }
          : undefined,
        selectedContext?.path || undefined,
        selectedContext?.code || undefined,
        recentHistory
      );
      // Optional: add a user message to chat history too, so they see what they asked
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: promptToSend,
        images: currentImages,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => {
        const next = [...prev, userMsg];
        saveChatHistory(next, projectRoot);
        return next;
      });
      setPrompt("");
      setAttachedImages([]);
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
      content: promptToSend,
      images: currentImages,
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
    setAttachedImages([]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const providers = loadAllProviders();
    const activeProvider = providers[selectedModelItem.providerId];

    const outgoingMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> =
      workflowMode === "plan"
        ? [
            {
              role: "system" as const,
              content:
                "You are an expert software architect and engineering planner in ACSA Code. Your objective is to help the user plan, architect, brainstorm, and evaluate technical trade-offs before writing or editing code. Structure your response with: Requirements Breakdown, Architecture & Trade-offs, Step-by-Step Implementation Plan, Edge Cases to Consider, and Verification Strategies.",
            },
            ...nextHistory.map((m) => ({ role: m.role, content: m.content })),
          ]
        : nextHistory.map((m) => ({ role: m.role, content: m.content }));

    await streamChatCompletion({
      provider: selectedModelItem.providerId,
      model: selectedModelItem.model,
      messages: outgoingMessages,
      images: currentImages,
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

  const renderModeMenu = (isCenterHero: boolean) => (
    <div
      className={`absolute ${
        isCenterHero ? "top-full mt-2 left-0" : "bottom-full mb-2 left-0"
      } w-60 bg-[#18181b]/95 backdrop-blur-xl border border-zinc-700/60 rounded-xl shadow-2xl p-1.5 z-50 space-y-1 text-left`}
    >
      {/* Option 1: Agent (Default) */}
      <button
        type="button"
        onClick={() => {
          setWorkflowMode("agent");
          setIsModeMenuOpen(false);
        }}
        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all ${
          workflowMode === "agent"
            ? "border border-purple-500/60 bg-purple-950/40 text-purple-200 font-medium shadow-sm"
            : "border border-transparent text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
        }`}
        title="Autonomous multi-step code generation & verification gauntlet (Shift+Cmd+I)"
      >
        <div className="flex items-center gap-2">
          <Icon icon={Code2} className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="font-medium">Agent</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500 tracking-tighter">⇧⌘I</span>
      </button>

      {/* Option 2: Ask / Chat */}
      <button
        type="button"
        onClick={() => {
          setWorkflowMode("chat");
          setIsModeMenuOpen(false);
        }}
        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all ${
          workflowMode === "chat"
            ? "border border-purple-500/60 bg-purple-950/40 text-purple-200 font-medium shadow-sm"
            : "border border-transparent text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
        }`}
        title="Conversational chat, code explanations & questions (Cmd+L)"
      >
        <div className="flex items-center gap-2">
          <Icon icon={MessageSquare} className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="font-medium">Ask</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500 tracking-tighter">⌘L</span>
      </button>

      {/* Option 3: Plan / Brainstorm */}
      <button
        type="button"
        onClick={() => {
          setWorkflowMode("plan");
          setIsModeMenuOpen(false);
        }}
        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all ${
          workflowMode === "plan"
            ? "border border-amber-500/60 bg-amber-950/40 text-amber-200 font-medium shadow-sm"
            : "border border-transparent text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
        }`}
        title="Architectural planning, task breakdown & brainstorming (Shift+Cmd+P)"
      >
        <div className="flex items-center gap-2">
          <Icon icon={ListTodo} className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-medium">Plan</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500 tracking-tighter">⇧⌘P</span>
      </button>

      <div className="border-t border-zinc-800/80 my-1" />

      {/* Option 4: Configure Custom Agent */}
      <button
        type="button"
        onClick={() => {
          setIsModeMenuOpen(false);
          openAiManagementDashboard();
        }}
        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 font-sans transition-colors"
      >
        Configure Custom Agent...
      </button>
    </div>
  );

  const renderAddContextMenu = (isCenterHero: boolean) => (
    <div
      className={`absolute ${
        isCenterHero ? "top-full mt-2 left-0" : "bottom-full mb-2 left-0"
      } w-52 bg-[#18181b]/95 backdrop-blur-xl border border-zinc-700/60 rounded-xl shadow-2xl p-1.5 z-50 space-y-0.5 text-left animate-in fade-in-0 zoom-in-95 duration-100`}
    >
      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 select-none">
        Add Context
      </div>

      {/* 1: Media */}
      <button
        type="button"
        onClick={() => {
          setIsContextMenuOpen(false);
          fileInputRef.current?.click();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-all group"
      >
        <Icon icon={ImageIcon} className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
        <span className="font-medium">Media</span>
      </button>

      {/* 2: Mentions */}
      <button
        type="button"
        onClick={() => {
          setIsContextMenuOpen(false);
          const nextPrompt = prompt && !prompt.endsWith(" ") ? `${prompt} @` : `${prompt}@`;
          setPrompt(nextPrompt);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-all group"
      >
        <Icon icon={AtSign} className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
        <span className="font-medium">Mentions</span>
      </button>

      {/* 3: Actions */}
      <button
        type="button"
        onClick={() => {
          setIsContextMenuOpen(false);
          const nextPrompt = prompt && !prompt.endsWith(" ") ? `${prompt} /` : `${prompt}/`;
          setPrompt(nextPrompt);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-all group"
      >
        <svg
          className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2.5" />
          <path d="m9 9 6 6" />
        </svg>
        <span className="font-medium">Actions</span>
      </button>

      {/* 4: Browser */}
      <button
        type="button"
        onClick={() => {
          setIsContextMenuOpen(false);
          const prefix = "/browser ";
          const nextPrompt = prompt.startsWith(prefix) ? prompt : `${prefix}${prompt}`.trimStart();
          setPrompt(nextPrompt);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-all group"
      >
        <svg
          className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="21.17" x2="12" y1="8" y2="8" />
          <line x1="3.95" x2="8.54" y1="6.06" y2="14" />
          <line x1="10.88" x2="15.46" y1="21.94" y2="14" />
        </svg>
        <span className="font-medium">Browser</span>
      </button>
    </div>
  );


  return (
    <div className="h-full w-full flex flex-col bg-[#141416] text-zinc-200 font-sans select-none overflow-hidden border-l border-[var(--vscode-border)]">
      {/* ── Header: Title, Pop-out, Close ───────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans">
        <div className="flex items-center gap-2">
          <Icon icon={Bot} className="w-4 h-4 text-purple-400" />
          <span className="text-[13px] font-semibold text-zinc-100 tracking-tight">AI Assistant</span>
          {indexStatus && (
            <div className="flex items-center gap-1.5 ml-1">
              {isIndexing ? (
                <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20 animate-pulse font-mono">
                  <Icon icon={RefreshCw} className="w-2.5 h-2.5 animate-spin" />
                  Indexing AST...
                </span>
              ) : indexStatus.indexed ? (
                <button
                  type="button"
                  onClick={onSyncIndex}
                  title={`Project Code Intelligence:
• Files synced: ${indexStatus.profile?.indexed_files ?? "--"}
• Symbols indexed: ${indexStatus.totalSymbols}
• Frameworks: ${indexStatus.profile?.frameworks?.join(", ") || "generic"}
Click to re-index project.`}
                  className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/30 hover:bg-emerald-900/40 px-2 py-0.5 rounded-full border border-emerald-800/40 transition-colors font-mono cursor-pointer"
                >
                  <Icon icon={Database} className="w-2.5 h-2.5" />
                  <span>{indexStatus.profile?.indexed_files ?? 0} files synced</span>
                </button>
            ) : (
              <button
                  type="button"
                  onClick={onSyncIndex}
                  className="text-[10px] text-amber-400 bg-amber-950/30 hover:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-800/40 transition-colors font-mono cursor-pointer"
                  title="Click to build AST symbol index"
                >
                  Index AST
                </button>
              )}
            </div>
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
          {chatMessages.length === 0 && status !== "running" && (
            isWide ? (
              /* Center Stage Hero Mode (Full Canvas Omnibar) */
              <div className="h-full min-h-[460px] flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-2xl space-y-4">
                  {/* Context pill strip */}
                  <div className="flex items-center justify-between px-1 text-xs text-zinc-400">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                        <Icon icon={Folder} className="w-3 h-3 text-purple-400" />
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
                    {/* Attached Image Previews */}
                    {attachedImages.length > 0 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {attachedImages.map((img, idx) => (
                          <div key={idx} className="relative group shrink-0 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
                            <img src={img} alt="Attachment" className="w-14 h-14 object-cover" />
                            <button
                              type="button"
                              onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                              className="absolute top-0.5 right-0.5 bg-black/80 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors cursor-pointer"
                              title="Remove image"
                            >
                              <Icon icon={X} className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onPaste={handlePaste}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={
                        workflowMode === "agent"
                          ? "Describe a task for the agent to build, edit, or test… (Enter to run)"
                          : workflowMode === "plan"
                          ? "Brainstorm an architectural plan or discuss design decisions… (Enter)"
                          : "Ask anything, / for commands, @ for context (Enter to send)"
                      }
                      rows={3}
                      className="w-full bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 outline-none resize-none font-sans leading-relaxed focus:ring-0 p-1"
                    />

                    {/* Bottom control bar inside card */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/80">
                      <div className="flex items-center gap-2">
                        {/* Add Context (+) Dropdown */}
                        <div className="relative shrink-0" ref={heroContextMenuRef}>
                          <button
                            type="button"
                            onClick={() => {
                              setIsContextMenuOpen((prev) => !prev);
                              setIsModeMenuOpen(false);
                              setIsModelMenuOpen(false);
                            }}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              isContextMenuOpen
                                ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                                : "bg-zinc-800/40 hover:bg-zinc-800/80 border-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                            }`}
                            title="Add Context (Media, Mentions, Actions, Browser)"
                          >
                            <Icon icon={Plus} className="w-3.5 h-3.5" />
                          </button>
                          {isContextMenuOpen && renderAddContextMenu(true)}
                        </div>

                        {/* Mode Selector Pill */}
                        <div className="relative" ref={heroModeMenuRef}>
                          <button
                            type="button"
                            onClick={() => {
                              setIsModeMenuOpen((prev) => !prev);
                              setIsModelMenuOpen(false);
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800/80 text-xs font-medium transition-all shadow-sm ${
                              workflowMode === "agent"
                                ? "text-purple-300"
                                : workflowMode === "plan"
                                ? "text-amber-300"
                                : "text-purple-300"
                            }`}
                            title={`Current mode: ${workflowMode.toUpperCase()} (Click to switch)`}
                          >
                            <span className="font-sans text-[11px] font-medium capitalize">
                              {workflowMode === "chat" ? "Ask" : workflowMode === "plan" ? "Plan" : "Agent"}
                            </span>
                            <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400 ml-0.5" />
                          </button>

                          {isModeMenuOpen && renderModeMenu(true)}
                        </div>

                        {/* Model Selector Pill */}
                        <div className="relative" ref={heroMenuRef}>
                          <button
                            type="button"
                            onClick={() => {
                              setIsModelMenuOpen((prev) => !prev);
                              setIsModeMenuOpen(false);
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800/80 text-xs text-zinc-200 font-medium transition-all shadow-sm"
                          >
                            <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-mono text-[11px]">{selectedModelItem?.model || "Select Model"}</span>
                            <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400" />
                          </button>

                          {isModelMenuOpen && renderModelMenu(true)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={!prompt.trim()}
                        className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all shadow-sm ${
                          prompt.trim()
                            ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20"
                            : "bg-zinc-800/40 border border-zinc-800/80 text-zinc-600 cursor-not-allowed"
                        }`}
                        title={workflowMode === "agent" ? "Run Agent (Enter)" : "Send (Enter)"}
                      >
                        <Icon icon={ArrowUp} className="w-4 h-4 stroke-[2.5]" />
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
                      <Icon icon={Code} className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
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
                    <span>ACSA Code AI Assistant</span>
                    {selectedModelItem?.model && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-300">
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
                        <Icon icon={Code} className="w-4 h-4 text-purple-400 shrink-0 group-hover:scale-110 transition-transform" />
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
          {(chatMessages.length > 0 || status === "running") && (
            <div className={isWide ? "max-w-3xl lg:max-w-4xl mx-auto w-full space-y-4 py-2" : "space-y-4"}>
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  {/* Role Header with Model, Provider, Timestamp & 1-Click Copy */}
                  <div className="flex items-center justify-between w-full mb-1 px-1 text-[10px] text-zinc-400">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {msg.role === "user" ? (
                        <>
                          <span className="font-semibold text-zinc-300">You</span>
                          <Icon icon={User} className="w-3 h-3 text-zinc-400 shrink-0" />
                          {msg.timestamp && (
                            <span className="text-[9px] font-mono text-zinc-500 ml-1">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {msg.provider ? (
                            <ProviderLogo providerId={msg.provider} className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Icon icon={Bot} className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          )}
                          <span className="font-semibold text-purple-300 font-mono text-[11px] truncate">
                            {msg.model || "AI Assistant"}
                          </span>
                          {msg.timestamp && (
                            <span className="text-[9px] font-mono text-zinc-500 ml-1">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {msg.content && (
                      <CopyMessageButton text={msg.content} />
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[95%] p-3.5 rounded-2xl text-xs leading-relaxed transition-all ${
                      msg.role === "user"
                        ? "bg-zinc-800/80 border border-zinc-700/60 text-zinc-100 rounded-tr-sm shadow-sm"
                        : msg.error
                        ? "bg-red-950/30 border border-red-500/30 text-red-200 rounded-tl-sm w-full"
                        : "bg-zinc-900/90 border border-zinc-800/90 text-zinc-100 rounded-tl-sm w-full"
                    }`}
                  >
                    {/* User Attached Images */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.images.map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt="Attachment"
                            className="max-h-48 max-w-xs rounded-lg border border-zinc-700 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(img, "_blank")}
                          />
                        ))}
                      </div>
                    )}

                    {/* Collapsible Model Thinking & Agent Steps (auto-collapsed when summary exists) */}
                    {((msg.steps && msg.steps.length > 0) || Boolean(msg.thinking)) && (
                      <ThinkingAccordion
                        steps={msg.steps}
                        thinking={msg.thinking}
                        isLive={false}
                        hasSummary={Boolean(msg.content && msg.content.trim())}
                      />
                    )}

                    <FormattedMarkdown content={msg.content} isStreaming={msg.isStreaming} />

                    {/* Actionable Error Recovery Card */}
                    {msg.error && (
                      <div className="mt-3 p-3 rounded-xl bg-zinc-900/95 border border-zinc-700/60 text-xs space-y-2.5 shadow-xl">
                        {msg.errorType === "timeout" ? (
                          <>
                            <div className="flex items-center gap-2 text-amber-300 font-medium">
                              <Icon icon={AlertCircle} className="w-4 h-4 text-amber-400 shrink-0" />
                              <span>Generation Timed Out</span>
                            </div>
                            <p className="text-zinc-400 text-[11px] leading-relaxed">
                              The local model <strong>{msg.model || "qwen2.5-coder"}</strong> took longer than expected to process the request. Local 7B models can be slow under heavy context. Consider switching to a faster local model (e.g. <code>qwen2.5-coder:1.5b</code> or <code>3b</code>) or shortening the prompt.
                            </p>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => openAiManagementDashboard()}
                                className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Switch Model / Provider
                              </button>
                            </div>
                          </>
                        ) : msg.errorType === "offline" ? (
                          <>
                            <div className="flex items-center gap-2 text-red-300 font-medium">
                              <Icon icon={AlertCircle} className="w-4 h-4 text-red-400 shrink-0" />
                              <span>Provider Unreachable or Offline</span>
                            </div>
                            <p className="text-zinc-400 text-[11px] leading-relaxed">
                              Unable to connect to <strong>{msg.provider || selectedModelItem?.providerId || "the AI provider"}</strong>. If you are using local models, ensure the Ollama background daemon is running.
                            </p>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => openAiManagementDashboard()}
                                className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Configure Provider / Model
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent("acsa:open-ollama-wizard"));
                                }}
                                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition-colors border border-zinc-700 cursor-pointer"
                              >
                                Start Ollama Wizard
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-zinc-300 font-medium">
                              <Icon icon={AlertCircle} className="w-4 h-4 text-amber-400 shrink-0" />
                              <span>Verification Gauntlet Halted</span>
                            </div>
                            <p className="text-zinc-400 text-[11px] leading-relaxed">
                              The deterministic verification gauntlet caught syntax/linter issues or contradictions in the generated code and stopped safely without modifying disk files. Review the <strong>Output (Gauntlet)</strong> tab for diagnostic logs.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Active Running Agent Assistant Turn */}
              {status === "running" && (
                <div className="flex flex-col items-start">
                  <div className="flex items-center justify-between w-full mb-1 px-1 text-[10px] text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      {selectedModelItem?.providerId ? (
                        <ProviderLogo providerId={selectedModelItem.providerId} className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Icon icon={Bot} className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}
                      <span className="font-semibold text-purple-300 font-mono text-[11px]">
                        {selectedModelItem?.model || "ACSA Agent"}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-purple-400 font-mono ml-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        Working ({agentElapsedSeconds}s)
                      </span>
                    </div>
                    {streamingAnswer && (
                      <CopyMessageButton text={streamingAnswer} />
                    )}
                  </div>

                  <div className="max-w-[95%] p-3.5 rounded-2xl text-xs leading-relaxed bg-zinc-900/90 border border-purple-500/30 text-zinc-100 rounded-tl-sm w-full shadow-lg">
                    {/* Live Thinking Accordion (auto-collapses when summary arrives) */}
                    <ThinkingAccordion
                      steps={agentSteps}
                      thinking={streamingThought}
                      isLive={true}
                      hasSummary={Boolean(streamingAnswer && streamingAnswer.trim())}
                      elapsedSeconds={agentElapsedSeconds}
                    />

                    {/* Live Streaming Answer */}
                    {streamingAnswer ? (
                      <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80">
                        <FormattedMarkdown content={streamingAnswer} isStreaming={true} />
                      </div>
                    ) : (
                      !streamingThought && (!agentSteps || agentSteps.length === 0) ? (
                        <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
                          <Icon icon={RefreshCw} className="w-3 h-3 animate-spin text-purple-400" />
                          <span>Thinking through solution...</span>
                        </div>
                      ) : null
                    )}

                    {/* Stop Generating Button & Active Step */}
                    <div className="mt-3 pt-2.5 border-t border-zinc-800/60 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400 truncate max-w-[70%]">
                        {agentSteps.length > 0
                          ? agentSteps[agentSteps.length - 1]?.detail || agentSteps[agentSteps.length - 1]?.name
                          : currentAgentPhase || "Processing..."}
                      </span>
                      <button
                        type="button"
                        onClick={onCancelPipeline}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-[11px] font-medium transition-colors border border-zinc-700/80 cursor-pointer shadow-sm shrink-0"
                      >
                        <Icon icon={Square} className="w-2.5 h-2.5 fill-red-400 text-red-400" />
                        <span>Stop Generating</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>

        <div ref={chatBottomRef} />
      </div>

      {/* ── Input Box & Controls (Only shown when not in empty Center Stage mode) ── */}
      {(!isWide || chatMessages.length > 0 || status === "running") && (
        <div className={`p-3 border-t border-[var(--vscode-border)] bg-[#18181b] shrink-0 font-sans ${isWide ? "py-4" : ""}`}>
          <div className={isWide ? "max-w-3xl lg:max-w-4xl mx-auto w-full" : "w-full"}>
            {/* Unified Omnibar Input Card */}
            <div className="relative rounded-2xl bg-zinc-900/90 border border-zinc-800/90 focus-within:border-purple-500/50 focus-within:ring-1 focus-within:ring-purple-500/20 p-2.5 transition-all shadow-lg">
              {/* Attached Image Previews */}
              {attachedImages.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {attachedImages.map((img, idx) => (
                    <div key={idx} className="relative group shrink-0 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
                      <img src={img} alt="Attachment" className="w-14 h-14 object-cover" />
                      <button
                        type="button"
                        onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-0.5 right-0.5 bg-black/80 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors cursor-pointer"
                        title="Remove image"
                      >
                        <Icon icon={X} className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  workflowMode === "agent"
                    ? "Describe a task for the agent to build, edit, or test… (Enter to run)"
                    : workflowMode === "plan"
                    ? "Brainstorm an architectural plan or discuss design decisions… (Enter)"
                    : `Ask ${selectedModelItem?.model || "AI"} anything… (Shift+Enter for new line)`
                }
                rows={2}
                className="w-full bg-transparent border-0 text-xs text-zinc-100 placeholder-zinc-500 outline-none resize-none font-sans leading-relaxed focus:ring-0 p-0.5"
              />

              {/* Bottom control strip inside card */}
              <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-zinc-800/70 mt-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {/* Add Context (+) Dropdown */}
                  <div className="relative shrink-0" ref={contextMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsContextMenuOpen((prev) => !prev);
                        setIsModeMenuOpen(false);
                        setIsModelMenuOpen(false);
                      }}
                      className={`p-1 rounded-md border transition-colors shrink-0 ${
                        isContextMenuOpen
                          ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                          : "bg-zinc-800/40 hover:bg-zinc-800/80 border-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                      }`}
                      title="Add Context (Media, Mentions, Actions, Browser)"
                    >
                      <Icon icon={Plus} className="w-3.5 h-3.5" />
                    </button>
                    {isContextMenuOpen && renderAddContextMenu(false)}
                  </div>

                  {/* Mode Selector Pill Button */}
                  <div className="relative shrink-0" ref={modeMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsModeMenuOpen((prev) => !prev);
                        setIsModelMenuOpen(false);
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800/80 text-xs font-medium transition-all ${
                        workflowMode === "agent"
                          ? "text-purple-300 hover:text-purple-200"
                          : workflowMode === "plan"
                          ? "text-amber-300 hover:text-amber-200"
                          : "text-purple-300 hover:text-purple-200"
                      }`}
                      title={`Current Mode: ${workflowMode.toUpperCase()} (Click to switch)`}
                    >
                      <span className="font-sans text-[11px] font-medium capitalize">
                        {workflowMode === "chat" ? "Ask" : workflowMode === "plan" ? "Plan" : "Agent"}
                      </span>
                      <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400 ml-0.5" />
                    </button>

                    {isModeMenuOpen && renderModeMenu(false)}
                  </div>

                  {/* Model Selector Dropdown Button */}
                  <div className="relative min-w-0 max-w-[150px]" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsModelMenuOpen((prev) => !prev);
                        setIsModeMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800/80 text-xs text-zinc-200 transition-colors"
                      title={selectedModelItem?.model || "Select Model"}
                    >
                      <ProviderLogo providerId={selectedModelItem?.providerId || "ollama"} className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono text-[10px] truncate">
                        {selectedModelItem?.model || "Model"}
                      </span>
                      <Icon icon={ChevronDown} className="w-3 h-3 text-zinc-400 shrink-0 ml-auto" />
                    </button>

                    {isModelMenuOpen && renderModelMenu(false)}
                  </div>
                </div>

                {/* Right: Send / Stop icon button */}
                <div className="flex items-center gap-1 shrink-0">
                  {(isStreaming || status === "running") ? (
                    <button
                      type="button"
                      onClick={handleStopStream}
                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 transition-colors shadow-sm"
                      title="Stop Generation"
                    >
                      <Icon icon={Square} className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={!prompt.trim() && attachedImages.length === 0}
                      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all shadow-sm shrink-0 ${
                        prompt.trim() || attachedImages.length > 0
                          ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20 cursor-pointer"
                          : "bg-zinc-800/40 border border-zinc-800/80 text-zinc-600 cursor-not-allowed"
                      }`}
                      title={workflowMode === "agent" ? "Run Agent (Enter)" : "Send (Enter)"}
                    >
                      <Icon icon={ArrowUp} className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  )}
                </div>
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

      {/* Hidden File Input for Image Attachments */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleImageFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── 1-Click Message Copy Button ────────────────────────────────────────── */
export function CopyMessageButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy message to clipboard"
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-all select-none cursor-pointer ${
        copied
          ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/50"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 border border-transparent"
      } ${className}`}
    >
      {copied ? (
        <>
          <Icon icon={Check} className="w-3 h-3 text-emerald-400" />
          <span className="font-medium text-[10px]">Copied</span>
        </>
      ) : (
        <>
          <Icon icon={Copy} className="w-3 h-3" />
          <span className="font-medium text-[10px]">Copy</span>
        </>
      )}
    </button>
  );
}

function getStepCategory(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("plan") || lower.includes("architect")) {
    return { icon: ListTodo, color: "text-amber-400 bg-amber-500/10 border-amber-500/20", label: "PLAN" };
  }
  if (lower.startsWith("subagent:") || lower.includes("swarm")) {
    return { icon: Users, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20", label: "SWARM" };
  }
  if (lower.includes("syntax") || lower.includes("gate") || lower.includes("healing") || lower.includes("verif")) {
    return { icon: Shield, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "VERIFY" };
  }
  if (lower.includes("grep") || lower.includes("search") || lower.includes("find")) {
    return { icon: Search, color: "text-blue-400 bg-blue-500/10 border-blue-500/20", label: "SEARCH" };
  }
  if (lower.includes("run") || lower.includes("command") || lower.includes("bash")) {
    return { icon: Terminal, color: "text-orange-400 bg-orange-500/10 border-orange-500/20", label: "SHELL" };
  }
  if (lower.startsWith("tool:") || lower.includes("read") || lower.includes("edit")) {
    return { icon: Wrench, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20", label: "TOOL" };
  }
  return { icon: Code2, color: "text-purple-400 bg-purple-500/10 border-purple-500/20", label: "AGENT" };
}

/* ── Collapsible Thinking & Steps Accordion ───────────────────────────── */
interface ThinkingAccordionProps {
  steps?: AgentStep[];
  thinking?: string;
  isLive?: boolean;
  hasSummary?: boolean;
  elapsedSeconds?: number;
}

function ThinkingAccordion({
  steps = [],
  thinking = "",
  isLive = false,
  hasSummary = false,
  elapsedSeconds = 0,
}: ThinkingAccordionProps) {
  // Auto-collapse if a summary or conclusion has been reached
  const [isOpen, setIsOpen] = useState(() => isLive && !hasSummary);

  const prevLiveRef = useRef(isLive);
  const prevSummaryRef = useRef(hasSummary);

  useEffect(() => {
    // When a conclusion/summary is delivered, auto-collapse the thinking loop
    if (!prevSummaryRef.current && hasSummary) {
      setIsOpen(false);
    }
    // When live execution finishes, auto-collapse
    if (prevLiveRef.current && !isLive) {
      setIsOpen(false);
    } else if (!prevLiveRef.current && isLive && !hasSummary) {
      setIsOpen(true);
    }
    prevLiveRef.current = isLive;
    prevSummaryRef.current = hasSummary;
  }, [isLive, hasSummary]);

  if ((!steps || steps.length === 0) && !thinking && !isLive) {
    return null;
  }

  const effectiveSteps = isLive
    ? steps
    : steps.map((s) => (s.status === "running" ? { ...s, status: "done" as const } : s));
  const activeStep = effectiveSteps.find((s) => s.status === "running") || effectiveSteps[effectiveSteps.length - 1];
  const completedCount = effectiveSteps.filter((s) => s.status === "done" || s.status === "success").length;

  return (
    <div className="mb-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/50 overflow-hidden text-xs transition-all">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/60 hover:bg-zinc-900/90 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            icon={isOpen ? ChevronDown : ChevronRight}
            className="w-3.5 h-3.5 text-zinc-400 shrink-0"
          />
          {isLive && !hasSummary ? (
            <div className="flex items-center gap-2 min-w-0">
              <Icon icon={RefreshCw} className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
              <span className="font-semibold text-purple-300 font-mono text-[11px]">
                Thinking ({elapsedSeconds}s)…
              </span>
              {activeStep && (
                <span className="text-[10px] text-zinc-400 truncate hidden sm:inline">
                  · {activeStep.name}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <Icon icon={Sparkles} className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="font-semibold text-zinc-300 font-mono text-[11px]">
                {elapsedSeconds > 0 ? `Thought for ${elapsedSeconds}s` : "Reasoning & Gauntlet Steps"}
              </span>
              {effectiveSteps.length > 0 && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  ({completedCount}/{effectiveSteps.length} steps)
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-zinc-500 font-mono">
          <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            {isOpen ? "Hide reasoning" : "View reasoning"}
          </span>
        </div>
      </button>

      {/* Expanded Drawer */}
      {isOpen && (
        <div className="p-3 space-y-3 border-t border-zinc-800/60 bg-zinc-950/80">
          {/* Steps Checklist */}
          {effectiveSteps.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono mb-1">
                Execution Steps
              </div>
              <div className="space-y-1 pl-1">
                {effectiveSteps.map((step, idx) => {
                  const isRunning = isLive && step.status === "running";
                  const isSuccess = step.status === "done" || step.status === "success";
                  const isFailed = step.status === "failed";
                  const category = getStepCategory(step.name);

                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 text-[11px] py-1 px-1.5 rounded transition-colors ${
                        isRunning
                          ? "bg-purple-950/20 text-purple-200"
                          : isSuccess
                          ? "text-zinc-300 hover:bg-zinc-900/40"
                          : isFailed
                          ? "bg-red-950/20 text-red-300"
                          : "text-zinc-500"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0 flex items-center gap-1.5">
                        {isRunning ? (
                          <Icon icon={RefreshCw} className="w-3 h-3 text-purple-400 animate-spin" />
                        ) : isSuccess ? (
                          <Icon icon={CheckCircle2} className="w-3 h-3 text-emerald-400" />
                        ) : isFailed ? (
                          <Icon icon={X} className="w-3 h-3 text-red-400" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-zinc-700 mx-0.5" />
                        )}
                        <span className={`px-1 py-0.5 text-[9px] font-mono uppercase font-semibold rounded border inline-flex items-center gap-1 ${category.color}`}>
                          <Icon icon={category.icon} className="w-2.5 h-2.5" />
                          {category.label}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className={`font-medium ${isRunning ? "text-purple-200" : "text-zinc-200"}`}>
                          {step.name}
                        </span>
                        {step.detail && (
                          <span className="text-[10px] text-zinc-400 ml-1.5 font-mono break-all">
                            — {step.detail}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model Thoughts / Streaming Reasoning */}
          {thinking && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                Model Thoughts
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                {thinking}
                {isLive && <span className="inline-block w-1.5 h-3 bg-purple-400 ml-1 animate-pulse align-middle" />}
              </div>
            </div>
          )}
        </div>
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
