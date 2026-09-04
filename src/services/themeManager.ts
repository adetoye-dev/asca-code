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
  "vs-dark": {
    id: "vs-dark",
    name: "Dark+ (default dark)",
    type: "dark",
    colors: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      sidebarBg: "#18181b",
      titlebarBg: "#1f1f23",
      activityBarBg: "#18181b",
      statusBarBg: "#18181b",
      statusBarFg: "#d4d4d4",
      accent: "#007acc",
      border: "#27272a",
      panelBg: "#18181b",
      tabActiveBg: "#1e1e1e",
      tabInactiveBg: "#2d2d2d",
    },
  },
  "dracula": {
    id: "dracula",
    name: "Dracula Official",
    type: "dark",
    colors: {
      background: "#282a36",
      foreground: "#f8f8f2",
      sidebarBg: "#21222c",
      titlebarBg: "#191a21",
      activityBarBg: "#191a21",
      statusBarBg: "#191a21",
      statusBarFg: "#f8f8f2",
      accent: "#ff79c6",
      border: "#44475a",
      panelBg: "#21222c",
      tabActiveBg: "#282a36",
      tabInactiveBg: "#1e1f29",
    },
  },
  "one-dark": {
    id: "one-dark",
    name: "One Dark Pro",
    type: "dark",
    colors: {
      background: "#282c34",
      foreground: "#abb2bf",
      sidebarBg: "#21252b",
      titlebarBg: "#1e2227",
      activityBarBg: "#1e2227",
      statusBarBg: "#1e2227",
      statusBarFg: "#abb2bf",
      accent: "#61afef",
      border: "#181a1f",
      panelBg: "#21252b",
      tabActiveBg: "#282c34",
      tabInactiveBg: "#1e2227",
    },
  },
  "github-dark": {
    id: "github-dark",
    name: "GitHub Dark Default",
    type: "dark",
    colors: {
      background: "#0d1117",
      foreground: "#c9d1d9",
      sidebarBg: "#010409",
      titlebarBg: "#161b22",
      activityBarBg: "#010409",
      statusBarBg: "#161b22",
      statusBarFg: "#c9d1d9",
      accent: "#58a6ff",
      border: "#30363d",
      panelBg: "#010409",
      tabActiveBg: "#0d1117",
      tabInactiveBg: "#161b22",
    },
  },
  "catppuccin": {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    type: "dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      sidebarBg: "#181825",
      titlebarBg: "#11111b",
      activityBarBg: "#11111b",
      statusBarBg: "#11111b",
      statusBarFg: "#cdd6f4",
      accent: "#89b4fa",
      border: "#313244",
      panelBg: "#181825",
      tabActiveBg: "#1e1e2e",
      tabInactiveBg: "#11111b",
    },
  },
};

/**
 * Injects CSS variables into document.documentElement so the entire workbench DOM
 * (ActivityBar, Sidebars, Tabs, Bottom Panel, Status Bar) transforms instantly.
 */
export function applyGlobalWorkbenchTheme(themeId: string): IdeTheme {
  const theme = PRESET_THEMES[themeId] || PRESET_THEMES["vs-dark"];
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
      { token: "comment", foreground: "6272a4", fontStyle: "italic" },
      { token: "keyword", foreground: theme.colors.accent.replace("#", ""), fontStyle: "bold" },
      { token: "string", foreground: "50fa7b" },
      { token: "number", foreground: "bd93f9" },
      { token: "function", foreground: "8be9fd" },
      { token: "type", foreground: "ffb86c" },
    ],
    colors: {
      "editor.background": theme.colors.background,
      "editor.foreground": theme.colors.foreground,
      "editorCursor.foreground": theme.colors.accent,
      "editor.lineHighlightBackground": theme.colors.border + "33",
      "editorLineNumber.foreground": "#6272a4",
      "editorLineNumber.activeForeground": theme.colors.foreground,
      "editor.selectionBackground": theme.colors.accent + "40",
      "editor.inactiveSelectionBackground": theme.colors.accent + "20",
    },
  });

  monaco.editor.setTheme(theme.id);
  return theme;
}
