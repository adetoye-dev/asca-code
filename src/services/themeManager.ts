/**
 * themeManager.ts — Dynamic VS Code Theme Engine for ACSA Code
 *
 * Provides built-in authentic VS Code themes (Dracula, One Dark Pro, GitHub Dark,
 * Catppuccin Mocha, and VS Code Dark+), injecting CSS variables across the entire
 * workbench and dynamically configuring Monaco Editor token colors.
 */

import type * as MonacoType from "monaco-editor";

export interface IdeTheme {
  id: string;
  name: string;
  type: "dark" | "light";
  colors: {
    background: string;
    foreground: string;
    sidebarBg: string;
    titlebarBg: string;
    activityBarBg: string;
    statusBarBg: string;
    statusBarFg: string;
    accent: string;
    border: string;
    panelBg: string;
    tabActiveBg: string;
    tabInactiveBg: string;
  };
}

export const PRESET_THEMES: Record<string, IdeTheme> = {
  "github-dark": {
    id: "github-dark",
    name: "GitHub Dark Default",
    type: "dark",
    colors: {
      background: "#0f0f12", // Matte charcoal workbench ground (matches AI Models & Providers panel)
      foreground: "#e4e4e7", // Neutral crisp zinc-200
      sidebarBg: "#0f0f12", // Matte charcoal workbench ground
      titlebarBg: "#09090b",
      activityBarBg: "#09090b",
      statusBarBg: "#09090b",
      statusBarFg: "#a1a1aa",
      accent: "#e4e4e7", // Neutral crisp zinc accent
      border: "rgba(255, 255, 255, 0.08)",
      panelBg: "#0f0f12",
      tabActiveBg: "#0f0f12", // Seamlessly matches editor canvas and center stage
      tabInactiveBg: "#141417", // Subtle dark charcoal
    },
  },
};

/**
 * Candidate accents — the brand decision, made reactable.
 *
 * Every accent surface in the app is the `purple-*` scale (257 uses), and those
 * classes now resolve through `--accent-*`. Swapping the ramp here therefore
 * retints the whole workbench, which is the point: the decision is a taste call
 * and taste needs looking at, not a list of hex codes.
 *
 * All three come from the mark's own gradient (`#38bdf8` → `#a855f7`) or sit
 * between its ends. Deliberately *not* on the table: amber, emerald, magenta and
 * grey, because the status taxonomy already spends those — `--status-pending` is
 * amber, `--status-success` emerald, `--status-action` magenta. A brand accent
 * that collides with "needs attention" is a bug, not a style.
 */
export interface AccentOption {
  id: string;
  name: string;
  /** One line for the picker, so the choice is not solely visual. */
  blurb: string;
  /** The `--accent-*` ramp this accent installs. */
  ramp: Record<string, string>;
}

export const PRESET_ACCENTS: Record<string, AccentOption> = {
  violet: {
    id: "violet",
    name: "Violet",
    blurb: "What ships today: the mark's right-hand end. Warm, but it is the same family as the progress status.",
    ramp: {
      "50": "#faf5ff", "100": "#f3e8ff", "200": "#e9d5ff", "300": "#d8b4fe",
      "400": "#c084fc", "500": "#a855f7", "600": "#9333ea", "700": "#7e22ce",
      "800": "#6b21a8", "900": "#581c87", "950": "#3b0764",
    },
  },
  sky: {
    id: "sky",
    name: "Sky",
    blurb: "The mark's left-hand end. Reads as instrumentation rather than magic, and no status colour is close to it.",
    ramp: {
      "50": "#f0f9ff", "100": "#e0f2fe", "200": "#bae6fd", "300": "#7dd3fc",
      "400": "#38bdf8", "500": "#0ea5e9", "600": "#0284c7", "700": "#0369a1",
      "800": "#075985", "900": "#0c4a6e", "950": "#082f49",
    },
  },
  indigo: {
    id: "indigo",
    name: "Indigo",
    blurb: "Between the two ends. The calmest of the three, and the furthest from looking like an AI product.",
    ramp: {
      "50": "#eef2ff", "100": "#e0e7ff", "200": "#c7d2fe", "300": "#a5b4fc",
      "400": "#818cf8", "500": "#6366f1", "600": "#4f46e5", "700": "#4338ca",
      "800": "#3730a3", "900": "#312e81", "950": "#1e1b4b",
    },
  },
};

/**
 * Indigo, chosen 2026-09-20. The mark's two ends were the candidates and the
 * middle won: sky reads colder and violet collides with the reserved "progress"
 * status colour. Violet and sky stay selectable.
 */
export const DEFAULT_ACCENT = "indigo";

/** Install an accent ramp. Inline on `:root`, so it beats the stylesheet copy. */
export function applyAccent(accentId: string): AccentOption {
  const accent = PRESET_ACCENTS[accentId] ?? PRESET_ACCENTS[DEFAULT_ACCENT];
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    for (const [shade, value] of Object.entries(accent.ramp)) {
      root.style.setProperty(`--accent-${shade}`, value);
    }
  }
  return accent;
}

/**
 * Injects CSS variables into document.documentElement so the entire workbench DOM
 * (ActivityBar, Sidebars, Tabs, Bottom Panel, Status Bar) transforms instantly.
 */
export function applyGlobalWorkbenchTheme(themeId: string): IdeTheme {
  const theme = PRESET_THEMES[themeId] || PRESET_THEMES["github-dark"];
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.style.setProperty("--vscode-editor-bg", theme.colors.background);
    root.style.setProperty("--vscode-editor-fg", theme.colors.foreground);
    root.style.setProperty("--vscode-sidebar-bg", theme.colors.sidebarBg);
    root.style.setProperty("--vscode-titlebar-bg", theme.colors.titlebarBg);
    root.style.setProperty("--vscode-activitybar-bg", theme.colors.activityBarBg);
    root.style.setProperty("--vscode-statusbar-bg", theme.colors.statusBarBg);
    root.style.setProperty("--vscode-statusbar-fg", theme.colors.statusBarFg);
    root.style.setProperty("--vscode-accent", theme.colors.accent);
    root.style.setProperty("--vscode-border", theme.colors.border);
    root.style.setProperty("--vscode-panel-bg", theme.colors.panelBg);
    root.style.setProperty("--vscode-tab-active-bg", theme.colors.tabActiveBg);
    root.style.setProperty("--vscode-tab-inactive-bg", theme.colors.tabInactiveBg);
    // Sync design system semantic variables
    root.style.setProperty("--surface-canvas", theme.colors.background);
    root.style.setProperty("--surface-workbench", theme.colors.sidebarBg);
    root.style.setProperty("--text-primary", theme.colors.foreground);
    root.style.setProperty("--border-accent", theme.colors.accent);
  }
  return theme;
}

/**
 * Dynamically registers and sets Monaco Editor theme tokens and colors.
 */
export function applyMonacoTheme(monaco: typeof MonacoType, themeId: string): IdeTheme {
  const theme = applyGlobalWorkbenchTheme(themeId);

  monaco.editor.defineTheme(theme.id, {
    base: theme.type === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: theme.colors.foreground.replace("#", "") },
      { token: "comment", foreground: "71717a", fontStyle: "italic" }, // Neutral zinc-500
      { token: "keyword", foreground: "ff7b72", fontStyle: "bold" }, // GitHub coral keyword
      { token: "string", foreground: "7ee787" }, // Soft mint sage
      { token: "number", foreground: "f59e0b" }, // Warm amber
      { token: "function", foreground: "d2a8ff" }, // Lavender purple
      { token: "type", foreground: "ffa657" }, // Warm peach/orange
    ],
    colors: {
      "editor.background": theme.colors.background,
      "editor.foreground": theme.colors.foreground,
      "editorCursor.foreground": "#e4e4e7",
      "editor.lineHighlightBackground": "rgba(255, 255, 255, 0.03)",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#e4e4e7",
      "editor.selectionBackground": "rgba(255, 255, 255, 0.15)",
      "editor.inactiveSelectionBackground": "rgba(255, 255, 255, 0.08)",
    },
  });

  monaco.editor.setTheme(theme.id);
  return theme;
}
