/**
 * ExtensionsSidebar.tsx — VS Code Extensions & Open VSX Marketplace View
 *
 * Provides:
 * 1. Search Open VSX Registry for extensions and themes.
 * 2. Install / Uninstall extensions with local state persistence.
 * 3. Quick theme application (Dracula, One Dark, GitHub Dark, Catppuccin).
 * 4. VS Code settings.json and keybindings importer.
 */

import { useState, useEffect } from "react";
import { FileText, Search, Check, Download, RefreshCw, Package, Palette } from "lucide-react";
import { Icon } from "../ui/Icon";
import {
  searchOpenVsx,
  saveInstalledExtensionIds,
  getInstalledExtensionIds,
  parseVsCodeSettings,
} from "../../services/extensionMarketplace";
import type { ExtensionManifest } from "../../types/workbench";

interface ExtensionsSidebarProps {
  onApplyTheme: (themeId: string) => void;
  activeThemeId: string;
}

export function ExtensionsSidebar({ onApplyTheme, activeThemeId }: ExtensionsSidebarProps) {
  const [query, setQuery] = useState("");
  const [extensions, setExtensions] = useState<ExtensionManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "installed">("all");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInput, setSettingsInput] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  const fetchExtensions = async (searchQuery: string) => {
    setLoading(true);
    try {
      const results = await searchOpenVsx(searchQuery);
      setExtensions(results);
    } catch {
      // Handled inside service
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExtensions(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const toggleInstall = (ext: ExtensionManifest) => {
    const installedIds = getInstalledExtensionIds();
    const newInstalled = !ext.installed;

    if (newInstalled) {
      installedIds.add(ext.id);
      // If it's a theme, activate it
      if (ext.id.includes("dracula")) onApplyTheme("dracula");
      else if (ext.id.includes("material-theme")) onApplyTheme("one-dark");
      else if (ext.id.includes("github")) onApplyTheme("github-dark");
      else if (ext.id.includes("catppuccin")) onApplyTheme("catppuccin");
    } else {
      installedIds.delete(ext.id);
    }

    saveInstalledExtensionIds(installedIds);
    setExtensions((prev) =>
      prev.map((e) => (e.id === ext.id ? { ...e, installed: newInstalled } : e))
    );
  };

  const handleImportSettings = () => {
    try {
      const parsed = parseVsCodeSettings(settingsInput);
      setSettingsStatus(
        `Successfully imported ${Object.keys(parsed).length} settings!`
      );
      if (parsed["workbench.colorTheme"]) {
        const lower = parsed["workbench.colorTheme"].toLowerCase();
        if (lower.includes("dracula")) onApplyTheme("dracula");
        else if (lower.includes("one dark")) onApplyTheme("one-dark");
        else if (lower.includes("github")) onApplyTheme("github-dark");
      }
      setTimeout(() => setShowSettingsModal(false), 1200);
    } catch (err: any) {
      setSettingsStatus(`Error: ${err.message}`);
    }
  };

  const displayedExtensions =
    filter === "installed" ? extensions.filter((e) => e.installed) : extensions;

  return (
    <div className="flex flex-col h-full w-full bg-workbench select-none text-xs text-zinc-300">
      {/* Search Header */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-zinc-300">
            <Icon icon={Package} className="w-4 h-4 text-primary-icon" />
            <span>Extensions</span>
          </div>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium border border-zinc-700/60 transition-colors"
            title="Import VS Code settings.json"
          >
            Import Settings
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Icon icon={Search} className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Open VSX Extensions..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 text-[11px] pt-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-2 py-0.5 rounded transition-colors ${
              filter === "all"
                ? "bg-surface-selected text-accent font-semibold"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Marketplace
          </button>
          <button
            type="button"
            onClick={() => setFilter("installed")}
            className={`px-2 py-0.5 rounded transition-colors ${
              filter === "installed"
                ? "bg-surface-selected text-accent font-semibold"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Installed ({extensions.filter((e) => e.installed).length})
          </button>
        </div>
      </div>

      {/* Extensions List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-zinc-500 gap-2">
            <Icon icon={RefreshCw} className="w-3.5 h-3.5 animate-spin" />
            <span>Searching Open VSX...</span>
          </div>
        ) : displayedExtensions.length === 0 ? (
          <div className="text-center p-8 text-zinc-500">
            No extensions found. Try searching for "theme", "python", or "formatter".
          </div>
        ) : (
          displayedExtensions.map((ext) => {
            const isTheme = ext.category === "Theme" || ext.id.includes("theme");

            return (
              <div
                key={ext.id}
                className="p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 transition-all flex flex-col gap-2"
              >
                <div className="flex items-start gap-2.5">
                  {/* Icon */}
                  {ext.iconUrl ? (
                    <img
                      src={ext.iconUrl}
                      alt={ext.displayName}
                      className="w-8 h-8 rounded-lg object-contain bg-zinc-950 p-1 shrink-0 border border-zinc-800"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                      {isTheme ? <Icon icon={Palette} className="w-4 h-4" /> : <Icon icon={Package} className="w-4 h-4" />}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-100 truncate text-[11px]">
                        {ext.displayName}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">v{ext.version}</span>
                    </div>

                    <p className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5 leading-snug">
                      {ext.description}
                    </p>

                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
                      <span>{ext.publisher}</span>
                      {ext.downloadCount > 0 && (
                        <span>• {(ext.downloadCount / 1000).toFixed(0)}k installs</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-zinc-800/50">
                  {isTheme && ext.installed && (
                    <button
                      type="button"
                      onClick={() => {
                        if (ext.id.includes("dracula")) onApplyTheme("dracula");
                        else if (ext.id.includes("material-theme")) onApplyTheme("one-dark");
                        else if (ext.id.includes("github")) onApplyTheme("github-dark");
                        else if (ext.id.includes("catppuccin")) onApplyTheme("catppuccin");
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium transition-colors"
                    >
                      {activeThemeId && ext.id.toLowerCase().includes(activeThemeId.toLowerCase()) ? "✓ Active" : "Set Theme"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleInstall(ext)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
                      ext.installed
                        ? "bg-zinc-800 hover:bg-red-950/60 text-zinc-300 hover:text-red-400 border border-zinc-700 hover:border-red-800"
                        : "bg-primary-action hover:bg-primary-action/90 text-white shadow-sm"
                    }`}
                  >
                    {ext.installed ? (
                      <>
                        <Icon icon={Check} className="w-3 h-3 text-emerald-400" />
                        <span>Installed</span>
                      </>
                    ) : (
                      <>
                        <Icon icon={Download} className="w-3 h-3" />
                        <span>Install</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Settings Importer Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2 font-bold text-zinc-100">
                <Icon icon={FileText} className="w-4 h-4 text-purple-400" />
                <span>Import VS Code settings.json</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-zinc-400">
              Paste the contents of your VS Code <code className="text-zinc-200">settings.json</code> below to import your font size, tab spacing, minimap, and theme settings.
            </p>

            <textarea
              rows={8}
              value={settingsInput}
              onChange={(e) => setSettingsInput(e.target.value)}
              placeholder={`{\n  "editor.fontSize": 14,\n  "editor.tabSize": 2,\n  "workbench.colorTheme": "Dracula"\n}`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-mono text-xs text-zinc-200 focus:outline-none focus:border-purple-500/60 resize-none"
            />

            {settingsStatus && (
              <div
                className={`p-2 rounded-lg text-[11px] ${
                  settingsStatus.startsWith("Error")
                    ? "bg-red-950/40 border border-red-500/40 text-red-300"
                    : "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                }`}
              >
                {settingsStatus}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSettings}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold"
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExtensionsSidebar;
