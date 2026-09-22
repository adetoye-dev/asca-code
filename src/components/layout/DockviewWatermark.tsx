import React from "react";
import { Search, Sparkles, PanelLeft, Terminal, MessageSquare } from "lucide-react";
import { Icon } from "../ui/Icon";
import { IdeBrandLogo } from "../ui/BrandLogos";

export interface DockviewWatermarkProps {
  onOpenFile?: () => void;
  onOpenCommands?: () => void;
  onToggleExplorer?: () => void;
  onToggleTerminal?: () => void;
  onToggleAi?: () => void;
  /** Optional "what do I do next?" slot, e.g. the project setup card. */
  setupSlot?: React.ReactNode;
  [key: string]: any;
}

export const DockviewWatermark: React.FC<DockviewWatermarkProps> = ({
  onOpenFile,
  onOpenCommands,
  onToggleExplorer,
  onToggleTerminal,
  onToggleAi,
  setupSlot,
}) => {
  const handleOpenFile = () => {
    if (onOpenFile) onOpenFile();
    else window.dispatchEvent(new CustomEvent("acsa:open-file-search"));
  };

  const handleOpenCommands = () => {
    if (onOpenCommands) onOpenCommands();
    else window.dispatchEvent(new CustomEvent("acsa:open-command-palette"));
  };

  const handleToggleExplorer = () => {
    if (onToggleExplorer) onToggleExplorer();
    else window.dispatchEvent(new CustomEvent("acsa:toggle-explorer"));
  };

  const handleToggleTerminal = () => {
    if (onToggleTerminal) onToggleTerminal();
    else window.dispatchEvent(new CustomEvent("acsa:toggle-terminal"));
  };

  const handleToggleAi = () => {
    if (onToggleAi) onToggleAi();
    else window.dispatchEvent(new CustomEvent("acsa:toggle-ai"));
  };

  const shortcuts = [
    {
      label: "Search Files",
      shortcut: "⌘ P",
      icon: Search,
      action: handleOpenFile,
    },
    {
      label: "Command Palette",
      shortcut: "⌘ ⇧ P",
      icon: Sparkles,
      action: handleOpenCommands,
    },
    {
      label: "Toggle Explorer",
      shortcut: "⌘ ⇧ E",
      icon: PanelLeft,
      action: handleToggleExplorer,
    },
    {
      label: "Toggle Terminal",
      shortcut: "⌃ `",
      icon: Terminal,
      action: handleToggleTerminal,
    },
    {
      label: "AI Assistant",
      shortcut: "⌘ L",
      icon: MessageSquare,
      action: handleToggleAi,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full w-full select-none bg-[var(--vscode-editor-bg)] px-4">
      {/* Brand Icon Badge */}
      <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.08] shadow-2xl flex items-center justify-center mb-4 transition-transform hover:scale-105">
        <IdeBrandLogo size={24} className="opacity-75" />
      </div>

      {/* Title & Subtitle */}
      <div className="text-xs font-semibold tracking-wider uppercase text-zinc-400 mb-1">
        ACSA Code
      </div>
      <div className="text-2xs text-zinc-500 mb-6 font-mono">
        Local-first agentic engineering workbench
      </div>

      {setupSlot}

      {/* Keyboard Shortcuts List */}
      <div className="flex flex-col gap-1 w-64 max-w-full">
        {shortcuts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-all duration-150 group border border-transparent hover:border-white/[0.04]"
          >
            <span className="flex items-center gap-2">
              <Icon
                icon={item.icon}
                className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-200 transition-colors"
              />
              <span className="font-medium">{item.label}</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-3xs font-mono text-zinc-500 group-hover:text-zinc-300 group-hover:border-zinc-600/60 transition-colors">
              {item.shortcut}
            </kbd>
          </button>
        ))}
      </div>
    </div>
  );
};

export default DockviewWatermark;
