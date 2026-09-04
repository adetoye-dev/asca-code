/**
 * extensionMarketplace.ts — Open VSX Extension Registry & Settings Importer
 *
 * Implements:
 * 1. Open VSX API search & metadata query (https://open-vsx.org).
 * 2. Curated popular VS Code extensions (Dracula, Python, ESLint, Prettier).
 * 3. Local extension state persistence (Install / Uninstall).
 * 4. VS Code settings.json and keybindings.json parser.
 */

import type { ExtensionManifest } from "../types/workbench";

const STORAGE_KEY = "autonomous_ide_installed_extensions";

export const CURATED_EXTENSIONS: ExtensionManifest[] = [
  {
    id: "dracula-theme.theme-dracula",
    name: "theme-dracula",
    displayName: "Dracula Official",
    publisher: "dracula-theme",
    version: "2.24.3",
    description: "Official Dracula Theme. A dark theme for 200+ apps, created by Zeno Rocha.",
    iconUrl: "https://raw.githubusercontent.com/dracula/visual-studio-code/master/icon.png",
    downloadCount: 6500000,
    installed: false,
    category: "Theme",
  },
  {
    id: "zhuangtongfa.material-theme",
    name: "material-theme",
    displayName: "One Dark Pro",
    publisher: "zhuangtongfa",
    version: "3.18.0",
    description: "Atom's iconic One Dark theme, and one of the most installed themes for VS Code!",
    iconUrl: "https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/images/icon.png",
    downloadCount: 8200000,
    installed: false,
    category: "Theme",
  },
  {
    id: "github.github-vscode-theme",
    name: "github-vscode-theme",
    displayName: "GitHub Theme",
    publisher: "GitHub",
    version: "6.3.5",
    description: "GitHub theme for VS Code with Dark Default, Dark High Contrast, and Dimmed palettes.",
    iconUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    downloadCount: 11000000,
    installed: false,
    category: "Theme",
  },
  {
    id: "ms-python.python",
    name: "python",
    displayName: "Python",
    publisher: "ms-python",
    version: "2024.2.0",
    description: "Python language support with extension syntax highlighting, code navigation, and formatting.",
    iconUrl: "https://raw.githubusercontent.com/microsoft/vscode-python/main/icon.png",
    downloadCount: 105000000,
    installed: true,
    category: "Language",
  },
  {
    id: "esbenp.prettier-vscode",
    name: "prettier-vscode",
    displayName: "Prettier - Code formatter",
    publisher: "esbenp",
    version: "10.4.0",
    description: "Code formatter using Prettier for JavaScript, TypeScript, CSS, and Markdown.",
    iconUrl: "https://raw.githubusercontent.com/prettier/prettier-vscode/main/images/icon.png",
    downloadCount: 42000000,
    installed: true,
    category: "Linter",
  },
  {
    id: "continuedev.continue",
    name: "continue",
    displayName: "Continue - Open-source AI Code Assistant",
    publisher: "Continue",
    version: "0.8.50",
    description: "Connect any models (Ollama, llama.cpp, Claude, GPT-4) for tab autocomplete and edits.",
    iconUrl: "https://raw.githubusercontent.com/continuedev/continue/main/extension/assets/logo.png",
    downloadCount: 850000,
    installed: true,
    category: "AI",
  },
];

export function getInstalledExtensionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(["ms-python.python", "esbenp.prettier-vscode", "continuedev.continue"]);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function saveInstalledExtensionIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

export async function searchOpenVsx(query: string): Promise<ExtensionManifest[]> {
  if (!query.trim()) {
    const installed = getInstalledExtensionIds();
    return CURATED_EXTENSIONS.map((ext) => ({
      ...ext,
      installed: installed.has(ext.id),
    }));
  }

  try {
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=20`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const installed = getInstalledExtensionIds();

    const results: ExtensionManifest[] = (data.extensions || []).map((item: any) => {
      const ext = item.extension || {};
      const id = `${ext.namespace}.${ext.name}`;
      const isTheme = (ext.categories || []).includes("Themes") || ext.name.includes("theme");

      return {
        id,
        name: ext.name,
        displayName: ext.displayName || ext.name,
        publisher: ext.namespace,
        version: ext.version || "1.0.0",
        description: ext.description || "No description provided.",
        iconUrl: ext.files?.icon,
        downloadCount: ext.downloadCount || 0,
        installed: installed.has(id),
        category: isTheme ? "Theme" : "Other",
      };
    });

    return results;
  } catch (err) {
    // Fallback to local curated search
    const lower = query.toLowerCase();
    const installed = getInstalledExtensionIds();
    return CURATED_EXTENSIONS.filter(
      (e) =>
        e.displayName.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.publisher.toLowerCase().includes(lower)
    ).map((e) => ({ ...e, installed: installed.has(e.id) }));
  }
}

export interface VsCodeSettings {
  "editor.fontSize"?: number;
  "editor.tabSize"?: number;
  "editor.minimap.enabled"?: boolean;
  "editor.wordWrap"?: "on" | "off" | "wordWrapColumn" | "bounded";
  "editor.lineNumbers"?: "on" | "off" | "relative" | "interval";
  "workbench.colorTheme"?: string;
  [key: string]: any;
}

export function parseVsCodeSettings(jsonContent: string): VsCodeSettings {
  try {
    // Strip trailing commas and comments before JSON.parse
    const cleanJson = jsonContent
      .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(cleanJson);
  } catch (err) {
    throw new Error("Invalid settings.json format: " + (err as Error).message);
  }
}
