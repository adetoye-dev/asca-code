/**
 * WorkbenchNav.tsx — the workbench's one navigation surface.
 *
 * It replaces a permanent activity bar plus a permanent sidebar. There is a rail
 * (icons, always 56px) and a panel (labels, groups, shortcuts) that slides out
 * beside it:
 *
 * - pointing at either one reveals the panel; it is an overlay, so revealing it
 *   never reflows the editor underneath;
 * - choosing something closes it again, unless it is pinned;
 * - pinning puts the panel in the layout instead, so the work opens beside it;
 * - Escape closes it, the pin is remembered, and every row is a real button with
 *   a shortcut hint, so the keyboard story is the same as the mouse one.
 *
 * The screens themselves live in IdeLayout; this only says which one is wanted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronRight,
  Cpu,
  FolderTree,
  GitBranch,
  MessageSquare,
  Network,
  Package,
  Settings,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import { Icon } from "../ui/Icon";
import { IdeBrandLogo } from "../ui/BrandLogos";

/** Every destination the workbench can show. */
export type ScreenId = "editor" | "git" | "codeMap" | "monitor" | "aiManager" | "marketplace";

interface NavItem {
  id: ScreenId;
  label: string;
  hint: string;
  shortcut?: string;
  icon: typeof Activity;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The rail's icons and the panel's rows come from this, so the two can never
 * disagree about what exists. Order is the order on screen.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      {
        id: "editor",
        label: "Editor",
        hint: "Files, tabs and the terminal",
        shortcut: "⌘⇧E",
        icon: FolderTree,
      },
    ],
  },
  {
    label: "Code",
    items: [
      {
        id: "git",
        label: "Repository",
        hint: "Changes, staging and commits",
        shortcut: "⌘⇧G",
        icon: GitBranch,
      },
      {
        id: "codeMap",
        label: "Code map",
        hint: "Symbols, dependents and entry points",
        icon: Network,
      },
    ],
  },
  {
    label: "AI",
    items: [
      {
        id: "aiManager",
        label: "Models & providers",
        hint: "Keys, models and what is connected",
        icon: Cpu,
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        id: "marketplace",
        label: "Marketplace",
        hint: "Skills, tools and MCP servers",
        shortcut: "⌘⇧X",
        icon: Package,
      },
      {
        id: "monitor",
        label: "Health & performance",
        hint: "This machine, this app",
        icon: Activity,
      },
    ],
  },
];

/** Every item, flattened, for lookups by id. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const NAV_RAIL_WIDTH = 56;
export const NAV_PANEL_WIDTH = 208;

interface WorkbenchNavProps {
  screen: ScreenId;
  onSelectScreen: (screen: ScreenId) => void;
  /** The editor screen's file tree. Choosing Editor while on Editor toggles it. */
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  projectName?: string;
  projectPath?: string;
}

export function WorkbenchNav({
  screen,
  onSelectScreen,
  explorerOpen,
  onToggleExplorer,
  pinned,
  onPinnedChange,
  chatOpen,
  onToggleChat,
  onOpenSettings,
  onOpenCommandPalette,
  projectName,
  projectPath,
}: WorkbenchNavProps) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  /**
   * Set when the panel closes while the pointer is still on the rail — after a
   * choice, or Escape. Without it the pointer's own presence would immediately
   * reveal the panel again, which reads as it refusing to close.
   */
  const [dismissed, setDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Pointing at either surface, or tabbing into it, opens the panel. */
  const revealed = pinned || ((hovered || focusWithin) && !dismissed);

  const close = useCallback(() => {
    setDismissed(true);
    if (pinned) onPinnedChange(false);
  }, [pinned, onPinnedChange]);

  const activate = useCallback(
    (item: NavItem) => {
      // The active Editor row is a toggle for its file tree, the way the old
      // activity bar behaved: the screen is already the one you are asking for.
      if (item.id === "editor" && screen === "editor") onToggleExplorer();
      else onSelectScreen(item.id);
      if (!pinned) setDismissed(true);
    },
    [screen, pinned, onSelectScreen, onToggleExplorer]
  );

  /** Arrow keys walk the panel; Escape closes it. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const rows = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        current === -1
          ? 0
          : (current + step + rows.length) % rows.length;
      rows[next]?.focus();
    },
    [close]
  );

  // A click anywhere else puts it away, the same as any other menu.
  useEffect(() => {
    if (!revealed || pinned) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((event.target as HTMLElement).closest("[data-nav-surface]")) return;
      setDismissed(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [revealed, pinned]);

  return (
    <div
      role="presentation"
      data-nav-surface
      data-testid="workbench-nav"
      style={{ width: pinned ? "auto" : NAV_RAIL_WIDTH }}
      className="relative z-raised flex h-full shrink-0"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setDismissed(false);
      }}
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
      onKeyDown={handleKeyDown}
    >
      <nav aria-label="Workbench" className="flex h-full">
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <div
        style={{ width: NAV_RAIL_WIDTH }}
        className="flex h-full flex-col items-center gap-1 border-r border-hairline bg-[var(--vscode-activitybar-bg)] py-2"
        data-testid="nav-rail"
      >
        <button
          type="button"
          onClick={() => onPinnedChange(!pinned)}
          title="ACSA Code — open the menu (⌘B)"
          aria-expanded={revealed}
          aria-label="ACSA Code menu"
          className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <IdeBrandLogo className="w-5 h-5" />
        </button>

        <div className="my-1 h-px w-6 bg-hairline" />

        {NAV_SECTIONS.map((section, sectionIndex) => (
          <div key={section.label} className="flex flex-col items-center gap-1">
            {sectionIndex > 0 && <div className="my-1 h-px w-6 bg-hairline" />}
            {section.items.map((item) => {
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  data-testid={`nav-rail-${item.id}`}
                  onClick={() => activate(item)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                  }`}
                >
                  <Icon icon={item.icon} className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        ))}

        <div className="flex-1" />

        <button
          type="button"
          title="Chat (⌘L)"
          aria-label="Chat"
          aria-pressed={chatOpen}
          data-testid="nav-rail-chat"
          onClick={onToggleChat}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            chatOpen ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          }`}
        >
          <Icon icon={MessageSquare} className="w-4 h-4" />
        </button>
        <button
          type="button"
          title="Settings (⌘,)"
          aria-label="Settings"
          data-testid="nav-rail-settings"
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
        >
          <Icon icon={Settings} className="w-4 h-4" />
        </button>
      </div>

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      <div
        ref={panelRef}
        data-testid="nav-panel"
        aria-hidden={!revealed}
        // `inert` as well as the faded-out styling: without it, Tab would walk
        // into a panel nobody can see.
        {...(revealed ? {} : ({ inert: "" } as Record<string, string>))}
        style={{ width: NAV_PANEL_WIDTH }}
        className={`h-full flex-col border-r border-hairline bg-[var(--vscode-sidebar-bg)] shadow-2xl ${
          pinned ? "relative flex opacity-100" : "absolute left-full top-0 flex"
        } ${
          revealed && !pinned
            ? "pointer-events-auto translate-x-0 opacity-100"
            : revealed
              ? ""
              : "pointer-events-none -translate-x-2 opacity-0"
        } transition-[opacity,transform] duration-150 ease-out`}
      >
        {/* Who and where */}
        <div className="flex items-start justify-between gap-2 border-b border-hairline px-3 py-3">
          <div className="min-w-0">
            <div className="truncate text-body font-semibold text-zinc-100">
              {projectName || "No project open"}
            </div>
            <div className="truncate text-4xs text-zinc-500" title={projectPath}>
              {projectPath || "Open a folder to begin"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onPinnedChange(!pinned)}
            title={pinned ? "Unpin the menu" : "Keep the menu open"}
            aria-label={pinned ? "Unpin the menu" : "Keep the menu open"}
            aria-pressed={pinned}
            data-testid="nav-pin"
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
              pinned ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            <Icon icon={pinned ? PinOff : Pin} className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {/* Same entry point as clicking the omnibar in the titlebar. */}
          <button
            type="button"
            onClick={() => {
              onOpenCommandPalette();
              if (!pinned) setDismissed(true);
            }}
            data-testid="nav-command-palette"
            className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-2xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
          >
            <Icon icon={Search} className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">Search files or run a command</span>
            <span className="shrink-0 font-mono text-4xs text-zinc-500">⌘P</span>
          </button>

          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="px-2 pb-2">
              <div className="px-2.5 pb-1 pt-2 text-4xs font-semibold uppercase tracking-wider text-zinc-500">
                {section.label}
              </div>
              {section.items.map((item) => {
                const active = screen === item.id;
                const isExplorerToggle = item.id === "editor" && active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => activate(item)}
                    aria-current={active ? "page" : undefined}
                    data-testid={`nav-item-${item.id}`}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                    }`}
                  >
                    <Icon
                      icon={item.icon}
                      className={`h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : ""}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xs font-medium">{item.label}</span>
                      <span className="block truncate text-4xs text-zinc-500">
                        {isExplorerToggle
                          ? explorerOpen
                            ? "File tree open — click to hide"
                            : "File tree hidden — click to show"
                          : item.hint}
                      </span>
                    </span>
                    {item.shortcut && (
                      <span className="shrink-0 font-mono text-4xs text-zinc-500">{item.shortcut}</span>
                    )}
                    {isExplorerToggle && (
                      <Icon
                        icon={ChevronRight}
                        className={`w-3 h-3 shrink-0 text-zinc-500 transition-transform ${explorerOpen ? "rotate-90" : ""}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-hairline p-2">
          <button
            type="button"
            onClick={() => {
              onToggleChat();
              if (!pinned) setDismissed(true);
            }}
            aria-pressed={chatOpen}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-2xs transition-colors ${
              chatOpen ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            <Icon icon={MessageSquare} className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">Chat</span>
            <span className="font-mono text-4xs text-zinc-500">⌘L</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              if (!pinned) setDismissed(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-2xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
          >
            <Icon icon={Settings} className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">Settings</span>
            <span className="font-mono text-4xs text-zinc-500">⌘,</span>
          </button>
        </div>
      </div>
      </nav>
    </div>
  );
}

export default WorkbenchNav;
