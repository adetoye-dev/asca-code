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
