/**
 * SearchSidebar.tsx — Production VS Code Search & Replace Primary Sidebar View
 *
 * Implements:
 * 1. VS Code standard search & replace UI with header controls (Refresh, Clear, Collapse/Expand).
 * 2. Search input with Match Case (Aa), Match Whole Word (\\b), and Use Regular Expression (.*).
 * 3. Expandable Replace input with Preserve Case (AB) and Replace All ([→]).
 * 4. Expandable Search Details with "files to include" and "files to exclude" glob filters.
 * 5. Results summary counter ("X results in Y files") and search progress indicator.
 * 6. Interactive results tree grouped by file with authentic and match count badge.
 * 7. Line match preview with highlighted search match text.
 * 8. Jump to exact line & column in Monaco Editor on click.
 * 9. Per-match replace, per-file replace, and workspace-wide replace with live tab buffer sync.
 */

import React, { useRef, useCallback, useState, useEffect } from "react";
import { Search, MoreHorizontal, ChevronRight, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, RefreshCw, AlertCircle, X, WholeWord, Replace, ReplaceAll } from "lucide-react";
import { Icon } from "../ui/Icon";
import { searchWorkspace, replaceInWorkspace } from "../../services/workspaceSearch";

import { FileIcon } from "../ui/FileIcon";

export interface SearchMatch {
  lineNumber: number;
  column: number;
  lineContent: string;
  matchStart: number;
  matchLength: number;
}

export interface SearchResultFile {
  filePath: string;
  fileName: string;
  relativeDir: string;
  relativeFilePath: string;
  matches: SearchMatch[];
}

interface SearchSidebarProps {
  projectCwd: string;
  projectName: string;
  onOpenFile: (filePath: string, lineNumber?: number, column?: number) => void;
  onUpdateTabContent: (filePath: string, newContent: string) => void;
  onRefreshFiles: () => void;
  initialReplaceExpanded?: boolean;
}

export function SearchSidebar({
  projectCwd,
  projectName,
  onOpenFile,
  onUpdateTabContent,
  onRefreshFiles,
  initialReplaceExpanded = false,
}: SearchSidebarProps) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(initialReplaceExpanded);

  // Search option flags
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);

  // Search details (filters)
  const [showDetails, setShowDetails] = useState(false);
  const [includePattern, setIncludePattern] = useState("");
  const [excludePattern, setExcludePattern] = useState("");

  // Search results state
  const [results, setResults] = useState<SearchResultFile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  // Tree collapsed states & dismissals
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [dismissedFilePaths, setDismissedFilePaths] = useState<Set<string>>(new Set());
  const [dismissedMatchKeys, setDismissedMatchKeys] = useState<Set<string>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<any>(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Update replace expansion if initialReplaceExpanded prop changes
  useEffect(() => {
    if (initialReplaceExpanded) {
      setIsReplaceExpanded(true);
      setTimeout(() => replaceInputRef.current?.focus(), 50);
    }
  }, [initialReplaceExpanded]);

  // Execute workspace search via backend
  const executeSearch = useCallback(
    async (searchTerm: string) => {
      const trimmed = searchTerm.trim();
      if (!trimmed) {
        setResults([]);
        setErrorMessage(null);
        setCapped(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setErrorMessage(null);

      try {
        const data = await searchWorkspace({
          projectRoot: projectCwd,
          query: searchTerm,
          matchCase,
          matchWholeWord,
          useRegex,
          includePattern,
          excludePattern,
          maxResults: 1000,
        });

        if (data.error) {
          setErrorMessage(data.error || "Search failed");
          setResults([]);
        } else {
          setResults(data.results || []);
          setCapped(Boolean(data.capped));
        }
      } catch (err: any) {
        setErrorMessage(`Search error: ${err.message}`);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [projectCwd, matchCase, matchWholeWord, useRegex, includePattern, excludePattern]
  );

  // Debounced auto-search when query or flags change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!query) {
      setResults([]);
      setErrorMessage(null);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(query);
    }, 280);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, executeSearch]);

  // Clear search inputs and results
  const handleClear = () => {
    setQuery("");
    setReplaceText("");
    setResults([]);
    setErrorMessage(null);
    setDismissedFilePaths(new Set());
    setDismissedMatchKeys(new Set());
    searchInputRef.current?.focus();
  };

  // Toggle Collapse / Expand All
  const areAllCollapsed =
    results.length > 0 && results.every((file) => collapsedFiles[file.filePath]);

  const handleToggleCollapseAll = () => {
    if (areAllCollapsed) {
      setCollapsedFiles({});
    } else {
      const all: Record<string, boolean> = {};
      results.forEach((file) => {
        all[file.filePath] = true;
      });
      setCollapsedFiles(all);
    }
  };

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  // Dismiss a file or match from current view
  const handleDismissFile = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    setDismissedFilePaths((prev) => new Set(prev).add(filePath));
  };

  const handleDismissMatch = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setDismissedMatchKeys((prev) => new Set(prev).add(key));
  };

  // ── Replace Operations ─────────────────────────────────────────────────────

  // 1. Replace Single Match
  const handleReplaceSingleMatch = async (
    e: React.MouseEvent,
    filePath: string,
    match: SearchMatch
  ) => {
    e.stopPropagation();
    if (!query) return;

    setIsReplacing(true);
    try {
      const data = await replaceInWorkspace({
          projectRoot: projectCwd,
          query,
          replaceText,
          matchCase,
          matchWholeWord,
          useRegex,
          preserveCase,
          filePath,
          lineNumbers: [match.lineNumber],
        });
      if (data.success && data.updatedFiles) {
        for (const uf of data.updatedFiles) {
          onUpdateTabContent(uf.filePath, uf.newContent);
        }
        onRefreshFiles();
        showFeedback(`Replaced 1 occurrence`);
        // Re-execute search to refresh view
        await executeSearch(query);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch (err: any) {
      setErrorMessage(`Replace failed: ${err.message}`);
    } finally {
      setIsReplacing(false);
    }
  };

  // 2. Replace All in Specific File
  const handleReplaceAllInFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    if (!query) return;

    setIsReplacing(true);
    try {
      const data = await replaceInWorkspace({
          projectRoot: projectCwd,
          query,
          replaceText,
          matchCase,
          matchWholeWord,
          useRegex,
          preserveCase,
          filePath,
        });
      if (data.success && data.updatedFiles) {
        for (const uf of data.updatedFiles) {
          onUpdateTabContent(uf.filePath, uf.newContent);
        }
        onRefreshFiles();
        showFeedback(`Replaced in ${data.updatedFiles.length} file`);
        await executeSearch(query);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch (err: any) {
      setErrorMessage(`Replace failed: ${err.message}`);
    } finally {
      setIsReplacing(false);
    }
  };

  // 3. Replace All across Entire Workspace
  const handleReplaceAllAcrossWorkspace = async () => {
    if (!query || results.length === 0) return;

    setIsReplacing(true);
    try {
      const data = await replaceInWorkspace({
          projectRoot: projectCwd,
          query,
          replaceText,
          matchCase,
          matchWholeWord,
          useRegex,
          preserveCase,
        });
      if (data.success && data.updatedFiles) {
        for (const uf of data.updatedFiles) {
          onUpdateTabContent(uf.filePath, uf.newContent);
        }
        onRefreshFiles();
        showFeedback(
          `Replaced ${data.totalReplaced} occurrences across ${data.updatedFiles.length} files`
        );
        await executeSearch(query);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch (err: any) {
      setErrorMessage(`Replace failed: ${err.message}`);
    } finally {
      setIsReplacing(false);
    }
  };

  const showFeedback = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  // Filter out dismissed files & matches
  const visibleResults = results
    .filter((file) => !dismissedFilePaths.has(file.filePath))
    .map((file) => ({
      ...file,
      matches: file.matches.filter(
        (m) => !dismissedMatchKeys.has(`${file.filePath}:${m.lineNumber}:${m.column}`)
      ),
    }))
    .filter((file) => file.matches.length > 0);

  const activeMatchesCount = visibleResults.reduce(
    (acc, f) => acc + f.matches.length,
    0
  );

  return (
    <div className="flex flex-col h-full w-full bg-[var(--vscode-sidebar-bg,#18181b)] select-none text-[13px] text-zinc-200 overflow-hidden font-sans">
      {/* ── Top Sidebar Header (SEARCH) ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--vscode-border,#27272a)] shrink-0">
        <span className="font-semibold tracking-wider text-[11px] uppercase text-zinc-300">
          Search
        </span>
      </div>

      {/* ── Search & Replace Inputs Section ──────────────────────────────── */}
      <div className="p-3 border-b border-[var(--vscode-border,#27272a)] flex flex-col gap-2 shrink-0 bg-zinc-900/30">
        {/* Search Input Row */}
        <div className="flex items-center gap-1.5 w-full min-w-0">
          {/* Expand/Collapse Replace Toggle Chevron */}
          <button
            type="button"
            title={isReplaceExpanded ? "Collapse Replace" : "Expand Replace"}
            onClick={() => setIsReplaceExpanded((prev) => !prev)}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
          >
            <Icon icon={isReplaceExpanded ? ChevronDown : ChevronRight} className="w-3.5 h-3.5" />
          </button>

          {/* Search Box Container */}
          <div className="flex-1 min-w-0 flex items-center bg-zinc-900/80 border border-zinc-700/60 rounded-md px-2 py-1 focus-within:border-purple-500/60 focus-within:ring-1 focus-within:ring-purple-500/20 transition-all">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  executeSearch(query);
                } else if (e.key === "Escape") {
                  handleClear();
                }
              }}
              placeholder="Search"
              className="w-0 flex-1 min-w-0 bg-transparent text-[12.5px] text-zinc-100 placeholder-zinc-500 outline-none focus:outline-none focus:ring-0 border-none font-sans leading-normal"
            />

            {/* Toggle Flags: Match Case (Aa), Match Whole Word (\b), Regex (.*) */}
            <div className="flex items-center gap-0.5 ml-1.5 shrink-0">
              <button
                type="button"
                title="Match Case (⌥C)"
                onClick={() => setMatchCase((prev) => !prev)}
                className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                  matchCase
                    ? "bg-purple-950/40 text-purple-200 border border-purple-500/40"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
                }`}
              >
                <span className="font-mono text-[11px] font-bold leading-none select-none">Aa</span>
              </button>

              <button
                type="button"
                title="Match Whole Word (⌥W)"
                onClick={() => setMatchWholeWord((prev) => !prev)}
                className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                  matchWholeWord
                    ? "bg-purple-950/40 text-purple-200 border border-purple-500/40"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
                }`}
              >
                <Icon icon={WholeWord} className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                title="Use Regular Expression (⌥R)"
                onClick={() => setUseRegex((prev) => !prev)}
                className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                  useRegex
                    ? "bg-purple-950/40 text-purple-200 border border-purple-500/40"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
                }`}
              >
                <span className="font-mono text-[11px] font-bold leading-none select-none">.*</span>
              </button>
            </div>
          </div>
        </div>

        {/* Replace Input Row (Collapsible) */}
        {isReplaceExpanded && (
          <div className="flex items-center gap-1.5 w-full min-w-0 pl-[26px]">
            <div className="flex-1 min-w-0 flex items-center bg-zinc-900/80 border border-zinc-700/60 rounded-md px-2 py-1 focus-within:border-purple-500/60 focus-within:ring-1 focus-within:ring-purple-500/20 transition-all">
              <input
                ref={replaceInputRef}
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.altKey)) {
                    e.preventDefault();
                    handleReplaceAllAcrossWorkspace();
                  }
                }}
                placeholder="Replace"
                className="w-0 flex-1 min-w-0 bg-transparent text-[12.5px] text-zinc-100 placeholder-zinc-500 outline-none focus:outline-none focus:ring-0 border-none font-sans leading-normal"
              />

              {/* Preserve Case & Replace All Buttons */}
              <div className="flex items-center gap-0.5 ml-1.5 shrink-0">
                <button
                  type="button"
                  title="Preserve Case"
                  onClick={() => setPreserveCase((prev) => !prev)}
                  className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                    preserveCase
                      ? "bg-purple-950/40 text-purple-200 border border-purple-500/40"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
                  }`}
                >
                  <span className="font-mono text-[10px] font-bold leading-none select-none">AB</span>
                </button>

                <button
                  type="button"
                  title="Replace All (⌥⌘↵)"
                  onClick={handleReplaceAllAcrossWorkspace}
                  disabled={isReplacing || results.length === 0 || !query}
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                >
                  <Icon icon={ReplaceAll} className={`w-3.5 h-3.5 ${isReplacing ? "animate-pulse text-amber-400" : ""}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Details Toggle Button (...) */}
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-0.5 px-1 rounded hover:bg-zinc-800/60"
            title="Toggle Search Details (files to include / exclude)"
          >
            <Icon icon={MoreHorizontal} className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">{showDetails ? "Hide filters" : "Toggle filters"}</span>
          </button>
        </div>

        {/* Collapsible Search Details: Include / Exclude Globs */}
        {showDetails && (
          <div className="flex flex-col gap-2 pt-1 border-t border-zinc-800/80">
            <div>
              <div className="text-[11px] uppercase font-semibold text-zinc-400 mb-1">
                files to include
              </div>
              <input
                type="text"
                value={includePattern}
                onChange={(e) => setIncludePattern(e.target.value)}
                placeholder="e.g. *.ts, src/**"
                className="w-full bg-zinc-900/80 border border-zinc-700/60 rounded-md px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:outline-none focus:ring-1 focus:ring-purple-500/20 focus:border-purple-500/60 transition-all font-sans"
              />
            </div>

            <div>
              <div className="text-[11px] uppercase font-semibold text-zinc-400 mb-1">
                files to exclude
              </div>
              <input
                type="text"
                value={excludePattern}
                onChange={(e) => setExcludePattern(e.target.value)}
                placeholder="e.g. dist, node_modules, *.test.ts"
                className="w-full bg-zinc-900/80 border border-zinc-700/60 rounded-md px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:outline-none focus:ring-1 focus:ring-purple-500/20 focus:border-purple-500/60 transition-all font-sans"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Status & Feedback Banner ─────────────────────────────────────── */}
      {notification && (
        <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 flex items-center gap-2 text-xs animate-fadeIn">
          <Icon icon={Check} className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{notification}</span>
        </div>
      )}

      {errorMessage && (
        <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-300 flex items-center gap-2 text-xs">
          <Icon icon={AlertCircle} className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}

      {/* ── Result Summary Counter ───────────────────────────────────────── */}
      {(query.trim() || isSearching) && (
        <div className="px-3 py-1.5 text-xs text-zinc-300 border-b border-zinc-800/60 bg-zinc-900/40 flex items-center justify-between shrink-0">
          {isSearching ? (
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Icon icon={RefreshCw} className="w-3 h-3 animate-spin text-purple-400" />
              Searching workspace...
            </span>
          ) : (
            <div className="flex items-center justify-between w-full">
              <span>
                <strong className="text-zinc-100 font-semibold">{activeMatchesCount}</strong>{" "}
                {activeMatchesCount === 1 ? "result" : "results"} in{" "}
                <strong className="text-zinc-100 font-semibold">{visibleResults.length}</strong>{" "}
                {visibleResults.length === 1 ? "file" : "files"}
                {capped && <span className="text-amber-400 ml-1">(capped)</span>}
              </span>
              {visibleResults.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleCollapseAll}
                  className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                  title={areAllCollapsed ? "Expand All" : "Collapse All"}
                >
                  <Icon icon={areAllCollapsed ? ChevronsUpDown : ChevronsDownUp} className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Results Tree View ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-1">
        {visibleResults.length > 0 ? (
          visibleResults.map((file) => {
            const isCollapsed = Boolean(collapsedFiles[file.filePath]);

            return (
              <div key={file.filePath} className="group/file flex flex-col">
                {/* File Header Row */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={!isCollapsed}
                  onKeyDown={(e) => {
                    // A real <button> is not possible here: the row contains its
                    // own replace/dismiss buttons.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleFileCollapse(file.filePath);
                    }
                  }}
                  onClick={() => toggleFileCollapse(file.filePath)}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-zinc-800/70 cursor-pointer transition-colors text-zinc-300"
                >
                  {/* Chevron Toggle */}
                  <span className="text-zinc-500 group-hover/file:text-zinc-300">
                    {isCollapsed ? (
                      <Icon icon={ChevronRight} className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Icon icon={ChevronDown} className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </span>

                  {/* File Icon */}
                  <FileIcon fileName={file.fileName} className="w-3.5 h-3.5 shrink-0" />

                  {/* File Name & Path */}
                  <span className="font-sans font-medium text-zinc-100 truncate text-[13px]">
                    {file.fileName}
                  </span>
                  {file.relativeDir && (
                    <span className="text-xs text-zinc-400 truncate flex-1 ml-1 font-sans">
                      {file.relativeDir}
                    </span>
                  )}

                  {/* Match Count Pill */}
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 group-hover/file:bg-zinc-700 ml-auto shrink-0">
                    {file.matches.length}
                  </span>

                  {/* Hover Action Buttons for File: Replace All in File, Dismiss */}
                  <div className="hidden group-hover/file:flex items-center gap-0.5 shrink-0 ml-1">
                    {isReplaceExpanded && (
                      <button
                        type="button"
                        title="Replace All in this File"
                        onClick={(e) => handleReplaceAllInFile(e, file.filePath)}
                        disabled={isReplacing}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
                      >
                        <Icon icon={ReplaceAll} className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Dismiss from results"
                      onClick={(e) => handleDismissFile(e, file.filePath)}
                      className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                      <Icon icon={X} className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Match Items Under File (Expanded) */}
                {!isCollapsed && (
                  <div className="flex flex-col ml-4 pl-2 border-l border-zinc-800 space-y-0.5 my-0.5">
                    {file.matches.map((match, idx) => {
                      const matchKey = `${file.filePath}:${match.lineNumber}:${match.column}`;

                      // Trim leading whitespace for clean preview snippet
                      const trimmedLine = match.lineContent.trimStart();
                      const leadingSpaces = match.lineContent.length - trimmedLine.length;
                      const adjustedStart = Math.max(0, match.matchStart - leadingSpaces);
                      const adjustedEnd = adjustedStart + match.matchLength;

                      const prefix = trimmedLine.slice(0, adjustedStart);
                      const matchedSubstring = trimmedLine.slice(adjustedStart, adjustedEnd);
                      const suffix = trimmedLine.slice(adjustedEnd);

                      return (
                        <div
                          key={`${matchKey}-${idx}`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenFile(file.filePath, match.lineNumber, match.column);
                            }
                          }}
                          onClick={() => onOpenFile(file.filePath, match.lineNumber, match.column)}
                          className="group/match flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded-sm hover:bg-zinc-800/70 cursor-pointer text-zinc-300 hover:text-zinc-100 transition-colors font-mono text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* Line Number */}
                            <span className="text-[11px] text-zinc-400 font-mono w-5 text-right shrink-0">
                              {match.lineNumber}
                            </span>

                            {/* Snippet with Match Highlight */}
                            <span className="truncate whitespace-pre text-xs font-mono text-zinc-200">
                              <span>{prefix}</span>
                              <span className="bg-amber-400/25 text-amber-200 border-b border-amber-400 font-semibold px-0.5 rounded-xs">
                                {matchedSubstring || query}
                              </span>
                              <span>{suffix}</span>
                            </span>
                          </div>

                          {/* Hover Actions for Match: Replace Single, Dismiss */}
                          <div className="hidden group-hover/match:flex items-center gap-0.5 shrink-0 ml-1">
                            {isReplaceExpanded && (
                              <button
                                type="button"
                                title="Replace this occurrence"
                                onClick={(e) =>
                                  handleReplaceSingleMatch(e, file.filePath, match)
                                }
                                disabled={isReplacing}
                                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
                              >
                                <Icon icon={Replace} className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Dismiss"
                              onClick={(e) => handleDismissMatch(e, matchKey)}
                              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
                            >
                              <Icon icon={X} className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : query && !isSearching ? (
          /* Empty Search Results */
          <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-400 font-sans">
            <Icon icon={Search} className="w-8 h-8 text-zinc-500 mb-2 stroke-[1.5]" />
            <p className="text-[13px] text-zinc-200 font-medium mb-1">No results found</p>
            <p className="text-xs text-zinc-400">
              No occurrences for &quot;{query}&quot;. Review your search term, case sensitivity, or filters.
            </p>
          </div>
        ) : !query ? (
          /* Idle Initial Prompt */
          <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-400 font-sans">
            <Icon icon={Search} className="w-8 h-8 text-zinc-500 mb-2 stroke-[1.5]" />
            <p className="text-[13px] text-zinc-200 font-medium mb-1">Search Files</p>
            <p className="text-xs text-zinc-400 max-w-[200px]">
              Type a term above to search across all files in <span className="text-zinc-200 font-mono">{projectName}</span>.
            </p>
            <div className="mt-4 flex flex-col gap-1.5 text-xs text-zinc-300 font-sans bg-zinc-900/80 p-2.5 rounded-md border border-zinc-800 w-full max-w-[210px]">
              <div className="flex justify-between items-center">
                <span>Find in Files</span>
                <kbd className="font-mono text-[10px] text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60">⌘⇧F</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span>Replace in Files</span>
                <kbd className="font-mono text-[10px] text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60">⌘⇧H</kbd>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default SearchSidebar;
