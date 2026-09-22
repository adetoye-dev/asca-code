/**
 * WorkbenchNav.tsx — the workbench's sidebar.
 *
 * One element, two states. Collapsed it is an icon column; expanded it is the
 * same column with its labels open. Nothing is rendered twice: every row is one
 * button whose label is simply hidden while the sidebar is narrow, which is what
 * keeps the two states from drifting apart.
 *
 * The rows also have exactly one *layout*. They are indented so the icon sits on
 * the centre line of the collapsed column (20px in a 56px column), and expanding
 * only opens the width and fades the labels in — nothing re-flows per state. Two
 * layouts swapping while the width animated is what made opening and closing look
 * broken: the icons flew across the panel because the collapsed layout centred
 * itself in a box that was still wide.
 *
 * Behaviour:
 * - pointing at it (or tabbing into it) expands it in place — the layout makes
 *   room rather than a second surface appearing over the top;
 * - a short hover intent keeps a cursor merely crossing it from shoving the
 *   editor sideways;
 * - choosing something collapses it again unless it is pinned, and the pin is
 *   remembered;
 * - Escape closes it, and it spans the full height of the window because the
 *   brand lives here rather than in a bar above it.
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
  Network,
  Package,
  Pin,
  PinOff,
  Search,
  Settings,
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
 * The rows, and the groups they sit in. One list: the collapsed and expanded
 * states read from it, so they cannot disagree about what exists.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "editor", label: "Editor", hint: "Files, tabs and the terminal", shortcut: "⌘⇧E", icon: FolderTree },
    ],
  },
  {
    label: "Code",
    items: [
      { id: "git", label: "Repository", hint: "Changes, staging and commits", shortcut: "⌘⇧G", icon: GitBranch },
      { id: "codeMap", label: "Code map", hint: "Symbols, dependents and entry points", icon: Network },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "aiManager", label: "Models & providers", hint: "Keys, models and what is connected", icon: Cpu },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "marketplace", label: "Marketplace", hint: "Skills, tools and MCP servers", shortcut: "⌘⇧X", icon: Package },
      { id: "monitor", label: "Health & performance", hint: "This machine, this app", icon: Activity },
    ],
  },
];

/** Every row, flattened, for lookups by id. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const NAV_COLLAPSED_WIDTH = 56;
export const NAV_EXPANDED_WIDTH = 240;
/** A cursor crossing the sidebar must not shove the editor across. */
export const NAV_HOVER_INTENT_MS = 140;

interface WorkbenchNavProps {
  screen: ScreenId;
  onSelectScreen: (screen: ScreenId) => void;
  /** The editor screen's file tree. Choosing Editor while on Editor toggles it. */
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
}

export function WorkbenchNav({
  screen,
  onSelectScreen,
  explorerOpen,
  onToggleExplorer,
  pinned,
  onPinnedChange,
  onOpenSettings,
  onOpenCommandPalette,
}: WorkbenchNavProps) {
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  /**
   * Whether the last thing the user did was type. A click focuses the row it
   * lands on, and that is not a request to keep the sidebar open — without this,
   * choosing something with the mouse reopened the sidebar the moment the pointer
   * left it. The browser's `:focus-visible` says the same thing, but this is the
   * same thing *and* testable.
   */
  const keyboardIntent = useRef(false);
  useEffect(() => {
    const onKey = () => { keyboardIntent.current = true; };
    const onPointer = () => { keyboardIntent.current = false; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  const [focusWithin, setFocusWithin] = useState(false);
  /**
   * Set when a choice or Escape closes the sidebar while the pointer is still on
   * it. Without it the pointer's own presence would reopen it immediately, which
   * reads as the menu refusing to close.
   */
  const [dismissed, setDismissed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const expanded = pinned || ((hovered || focusWithin) && !dismissed);

  const cancelHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const onPointerEnter = useCallback(() => {
    setDismissed(false);
    // Tabbing or clicking is deliberate; a pointer arriving is not.
    if (pinned) return;
    cancelHoverTimer();
    hoverTimer.current = window.setTimeout(() => setHovered(true), NAV_HOVER_INTENT_MS);
  }, [pinned, cancelHoverTimer]);

  const onPointerLeave = useCallback(() => {
    cancelHoverTimer();
    setHovered(false);
    setDismissed(false);
  }, [cancelHoverTimer]);

  useEffect(() => cancelHoverTimer, [cancelHoverTimer]);

  const close = useCallback(() => {
    setDismissed(true);
    if (pinned) onPinnedChange(false);
  }, [pinned, onPinnedChange]);

  const activate = useCallback(
    (item: NavItem) => {
      // The active Editor row is a switch for its file tree, the way the old
      // activity bar behaved: you are already on the screen it names.
      if (item.id === "editor" && screen === "editor") onToggleExplorer();
      else onSelectScreen(item.id);
      if (!pinned) setDismissed(true);
    },
    [screen, pinned, onSelectScreen, onToggleExplorer]
  );

  /** Arrow keys walk the rows; Escape closes the sidebar. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const rows = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      rows[current === -1 ? 0 : (current + step + rows.length) % rows.length]?.focus();
    },
    [close]
  );

  // A click anywhere else puts it away, the same as any other menu.
  useEffect(() => {
    if (!expanded || pinned) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setDismissed(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [expanded, pinned]);

  /**
   * Label visibility, in one place. The text stays in the DOM so the width can
   * animate, but it is hidden from the accessibility tree while the sidebar is
   * collapsed — the row's `aria-label` is what is read then.
   */
  const labelClass = `transition-opacity duration-100 ${
    expanded ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  return (
    /* One sidebar in the flow: collapsed it is an icon column, expanded it is the
       same column with room for its labels, and the layout makes room for it
       either way. There is no second surface to drift out of step.
       The wrapper is presentational and carries the hover/keyboard plumbing, so
       the landmark inside stays a landmark — the same shape as the resize
       handles, which are pointer-only by nature. */
    <div
      role="presentation"
      data-testid="nav-surface"
      className="flex h-full shrink-0"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onFocus={() => {
        if (keyboardIntent.current) setFocusWithin(true);
      }}
      onBlur={() => setFocusWithin(false)}
      onKeyDown={handleKeyDown}
    >
    <aside
      ref={rootRef}
      aria-label="Workbench"
      data-testid="workbench-nav"
      style={{ width: expanded ? NAV_EXPANDED_WIDTH : NAV_COLLAPSED_WIDTH }}
      className="relative z-raised flex h-full shrink-0 flex-col overflow-hidden border-r border-hairline bg-[var(--vscode-activitybar-bg)] transition-[width] duration-150 ease-out"
    >
        {/* ── Identity ─────────────────────────────────────────────────────
            The brand is the sidebar's, not a bar's: it is the icon alone when
            collapsed and the icon with the name when there is room. */}
        <div className="relative flex h-10 shrink-0 items-center border-b border-hairline">
          <button
            type="button"
            onClick={() => onPinnedChange(!pinned)}
            data-testid="nav-brand"
            aria-expanded={expanded}
            title={pinned ? "ACSA Code — release the sidebar (⌘B)" : "ACSA Code — keep the sidebar open (⌘B)"}
            className="mx-1.5 flex h-9 w-[calc(100%-0.75rem)] shrink-0 items-center gap-2.5 rounded-lg pl-3 pr-2.5 hover:bg-white/5"
          >
            <IdeBrandLogo size={20} className="h-5 w-5 shrink-0" />
            <span
              aria-hidden={!expanded}
              className={`truncate text-body font-semibold tracking-tight text-zinc-100 ${labelClass}`}
            >
              ACSA Code
            </span>
          </button>
          {expanded && (
          <button
            type="button"
            onClick={() => onPinnedChange(!pinned)}
            data-testid="nav-pin"
            aria-pressed={pinned}
            aria-hidden={!expanded}
            tabIndex={expanded ? 0 : -1}
            title={pinned ? "Release the sidebar" : "Keep the sidebar open"}
            aria-label={pinned ? "Release the sidebar" : "Keep the sidebar open"}
            className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 ${labelClass}`}
          >
            <Icon icon={pinned ? PinOff : Pin} className="w-3.5 h-3.5" />
          </button>
          )}
        </div>

        {/* ── Find and commands ─────────────────────────────────────────── */}
        <Row
          expanded={expanded}
          labelClass={labelClass}
          icon={Search}
          label="Search or run a command"
          shortcut="⌘P"
          testId="nav-command-palette"
          onClick={() => {
            onOpenCommandPalette();
            if (!pinned) setDismissed(true);
          }}
        />

        {/* ── Screens ───────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div key={section.label}>
              {sectionIndex > 0 && (
                <div
                  aria-hidden
                  className={`mx-5 bg-hairline transition-all duration-150 ${
                    expanded ? "h-0 opacity-0" : "h-px opacity-100"
                  }`}
                />
              )}
              <div
                className={`overflow-hidden pl-5 transition-all duration-150 ${
                  expanded ? "h-6 opacity-100" : "h-0 opacity-0"
                }`}
              >
                <span className="flex h-6 items-end pb-1 text-4xs font-semibold uppercase tracking-wider text-zinc-500">
                  {section.label}
                </span>
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
                    aria-label={item.label}
                    title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                    data-testid={`nav-item-${item.id}`}
                    className={`mx-1.5 flex h-9 w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg pl-[14px] pr-2.5 text-left transition-colors ${
                      active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                    }`}
                  >
                    <Icon
                      icon={item.icon}
                      className={`h-[15px] w-[15px] shrink-0 ${active ? "text-accent" : ""}`}
                    />
                    <span aria-hidden={!expanded} className={`min-w-0 flex-1 ${labelClass}`}>
                      <span className="block truncate text-2xs font-medium">{item.label}</span>
                      <span className="block truncate text-4xs text-zinc-500">
                        {isExplorerToggle
                          ? explorerOpen
                            ? "Hide the file tree"
                            : "Show the file tree"
                          : item.hint}
                      </span>
                    </span>
                    {item.shortcut && expanded && (
                      <span className={`shrink-0 font-mono text-4xs text-zinc-500 ${labelClass}`}>
                        {item.shortcut}
                      </span>
                    )}
                    {isExplorerToggle && expanded && (
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

        <div className="shrink-0 border-t border-hairline py-1">
          <Row
            expanded={expanded}
            labelClass={labelClass}
            icon={Settings}
            label="Settings"
            shortcut="⌘,"
            testId="nav-settings"
            onClick={() => {
              onOpenSettings();
              if (!pinned) setDismissed(true);
            }}
          />
        </div>
    </aside>
    </div>
  );
}

/** A row that is an icon when the sidebar is collapsed and a row when it is not. */
function Row({
  expanded,
  labelClass,
  icon,
  label,
  shortcut,
  testId,
  onClick,
}: {
  expanded: boolean;
  labelClass: string;
  icon: typeof Settings;
  label: string;
  shortcut?: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className="mx-1.5 mt-1 flex h-9 w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg pl-[14px] pr-2.5 text-left text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
    >
      <Icon icon={icon} className="h-[15px] w-[15px] shrink-0" />
      <span aria-hidden={!expanded} className={`min-w-0 flex-1 truncate text-2xs ${labelClass}`}>
        {label}
      </span>
      {shortcut && expanded && (
        <span className={`shrink-0 font-mono text-4xs text-zinc-500 ${labelClass}`}>{shortcut}</span>
      )}
    </button>
  );
}

export default WorkbenchNav;
