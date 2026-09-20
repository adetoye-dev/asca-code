/**
 * CodeMapDashboard.tsx — Codebase Map & Symbol Index
 *
 * User-facing surface over the engine's AST symbol index. The agent already
 * uses this index for token-efficient context; this makes it visible and
 * searchable to a human:
 *   - index health (files, symbols, dependency edges, scale tier)
 *   - architecture landmarks (entrypoints, navigation, routing, state)
 *   - the most depended-on files (dependency hubs → blast radius)
 *   - symbol search across the whole project
 *   - per-file symbol outline with jump-to-line
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  RefreshCw,
  Network,
  Layers,
  ArrowLeft,
  CornerDownRight,
  FileCode2,
  AlertCircle,
  Crosshair,
  Waypoints,
  Sparkles,
  ArrowDownToLine,
} from "lucide-react";
import { Icon } from "../ui/Icon";
import { FileIcon } from "../ui/FileIcon";
import {
  buildArchitectureGraph,
  buildCodeGraph,
  describeFileRole,
} from "../../services/codeGraph";
import { CodeMapGraph } from "./CodeMapGraph";
import { streamChatCompletion } from "../../services/aiChatService";
import { getAutoSelectedLocalWorker, resolveEditorAiConfig } from "../../services/aiModelManager";
import { readTextFile } from "../../services/fileAccess";
import type { AISettings } from "../SettingsModal";
import {
  fetchBlastRadius,
  fetchFileOutline,
  fetchIndexMap,
  searchIndexSymbols,
  syncProjectIndex,
  type IndexFileEntry,
  type IndexMap,
  type IndexSymbol,
} from "../../services/agentHarness";

interface CodeMapDashboardProps {
  projectRoot: string;
  projectName?: string;
  onOpenFile: (path: string, line?: number) => void;
  /** Provider used for the on-demand "Explain with AI" summaries. */
  aiSettings?: AISettings | null;
}

function kindTone(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (k === "component") return "bg-purple-500/15 text-purple-300";
  if (k === "class" || k === "interface" || k === "struct") return "bg-fuchsia-500/15 text-fuchsia-300";
  if (k === "endpoint" || k === "route") return "bg-amber-500/15 text-amber-300";
  if (k === "method") return "bg-sky-500/15 text-sky-300";
  return "bg-emerald-500/15 text-emerald-300";
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

export function CodeMapDashboard({
  projectRoot,
  projectName,
  onOpenFile,
  aiSettings = null,
}: CodeMapDashboardProps) {
  const [lens, setLens] = useState<"graph" | "index">("graph");
  const [indexMap, setIndexMap] = useState<IndexMap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReindexing, setIsReindexing] = useState(false);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IndexSymbol[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchSeq = useRef(0);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [outline, setOutline] = useState<IndexSymbol[]>([]);
  /** Transitive blast radius from the engine graph (files affected by a change). */
  const [dependents, setDependents] = useState<string[]>([]);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  /** Dependency communities hidden from the graph view. */
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<number>>(new Set());
  /** Highlight only the selected file's direct neighbours. */
  const [focusNeighborhood, setFocusNeighborhood] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [explainError, setExplainError] = useState("");
  const [isExplaining, setIsExplaining] = useState(false);

  // Direct file→file import edges, resolved locally from indexed specifiers.
  const graph = useMemo(
    () => (indexMap ? buildCodeGraph(indexMap.files) : null),
    [indexMap]
  );

  const entrypoints = useMemo(
    () => indexMap?.architecture.entrypoints || [],
    [indexMap]
  );

  // Interactive view: nodes sized by weight, clustered by community.
  const architecture = useMemo(
    () => (indexMap && graph ? buildArchitectureGraph(indexMap.files, graph, entrypoints) : null),
    [indexMap, graph, entrypoints]
  );

  /** Selected file + its direct neighbours, for the focus lens. */
  const neighborhood = useMemo(() => {
    if (!selectedFile || !graph) return null;
    const paths = new Set<string>([selectedFile]);
    (graph.importsOf.get(selectedFile) || []).forEach((p) => paths.add(p));
    (graph.dependentsOf.get(selectedFile) || []).forEach((p) => paths.add(p));
    return { root: selectedFile, paths };
  }, [selectedFile, graph]);

  // A new selection invalidates any rendered explanation.
  useEffect(() => {
    setAiSummary("");
    setExplainError("");
  }, [selectedFile]);

  const loadMap = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const data = await fetchIndexMap(projectRoot);
    setIndexMap(data);
    if (!data) setError("No symbol index available for this project yet.");
    setIsLoading(false);
  }, [projectRoot]);

  useEffect(() => {
    setIndexMap(null);
    setSelectedFile(null);
    setQuery("");
    setResults([]);
    loadMap();
  }, [loadMap]);

  // Debounced symbol search across the project index.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(async () => {
      const found = await searchIndexSymbols(q, projectRoot);
      if (seq !== searchSeq.current) return; // a newer query won
      setResults(found);
      setIsSearching(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, projectRoot]);

  // Load the selected file's outline + dependents.
  useEffect(() => {
    if (!selectedFile) {
      setOutline([]);
      setDependents([]);
      return;
    }
    let cancelled = false;
    setIsLoadingFile(true);
    Promise.all([
      fetchFileOutline(selectedFile, projectRoot),
      fetchBlastRadius(selectedFile, projectRoot),
    ]).then(([symbols, deps]) => {
      if (cancelled) return;
      setOutline(symbols);
      setDependents(deps);
      setIsLoadingFile(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, projectRoot]);

  const handleReindex = async () => {
    if (isReindexing) return;
    setIsReindexing(true);
    try {
      await syncProjectIndex(projectRoot);
      await loadMap();
    } finally {
      setIsReindexing(false);
    }
  };

  /**
   * Asks the configured model to explain a file's purpose in plain prose.
   * The indexed facts are included so the answer is grounded, and the result is
   * cached per (path, content hash) so repeat visits cost nothing.
   */
  const explainFile = useCallback(
    async (entry: IndexFileEntry) => {
      if (isExplaining) return;
      const cacheKey = `acsa_codemap_summary_v1::${entry.path}::${entry.hash || entry.lines}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setAiSummary(cached);
          return;
        }
      } catch {
        /* storage unavailable — just regenerate */
      }

      setIsExplaining(true);
      setAiSummary("");
      setExplainError("");
      try {
        let source = "";
        try {
          source = await readTextFile(entry.path, projectRoot);
        } catch {
          /* index facts alone are still enough to explain the role */
        }

        const facts = graph ? describeFileRole(entry, graph, entrypoints).join(" ") : "";
        const ai = resolveEditorAiConfig(aiSettings);
        const messages = [
          {
            role: "system" as const,
            content:
              "You explain code to an engineer who is new to this codebase. Answer in 3-5 short sentences of plain prose — no markdown, no bullet lists, no code fences. Cover what this file is for, how it fits the rest of the codebase, and anything to know before changing it.",
          },
          {
            role: "user" as const,
            content: `File: ${entry.path}\nIndexed facts: ${facts || "(none)"}\n\nSource:\n${source.slice(0, 8000) || "(source unavailable)"}`,
          },
        ];

        const run = (cfg: { provider: string; model: string; apiKey: string; baseUrl: string }) =>
          new Promise<string>((resolve, reject) => {
            let acc = "";
            streamChatCompletion({
              ...cfg,
              projectRoot,
              messages,
              onDelta: (delta) => {
                acc += delta;
                setAiSummary(acc.trim());
              },
              onDone: () => resolve(acc.trim()),
              onError: (message) => reject(new Error(message || "Explanation failed.")),
            }).catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
          });

        let final = "";
        try {
          final = await run(ai);
        } catch (err: any) {
          // A rejected cloud key should not dead-end: retry locally and say so.
          if (ai.provider === "ollama") throw err;
          const localModel = getAutoSelectedLocalWorker();
          final = await run({ provider: "ollama", model: localModel, apiKey: "", baseUrl: "" });
          if (final) {
            setExplainError(`${ai.provider} request failed — explained with local ${localModel} instead.`);
          }
        }
        if (final) {
          try {
            localStorage.setItem(cacheKey, final);
          } catch {
            /* cache is best-effort */
          }
        }
        setIsExplaining(false);
      } catch (err: any) {
        setExplainError(err?.message || "Explanation failed.");
        setIsExplaining(false);
      }
    },
    [aiSettings, entrypoints, graph, isExplaining, projectRoot]
  );

  const fileMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!indexMap) return [];
    if (q.length < 1) return [];
    return indexMap.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 40);
  }, [indexMap, query]);

  const selectedEntry: IndexFileEntry | null = useMemo(
    () => indexMap?.files.find((f) => f.path === selectedFile) || null,
    [indexMap, selectedFile]
  );

  const selectedImportCount = selectedFile
    ? graph?.importsOf.get(selectedFile)?.length || 0
    : 0;
  const selectedDirectDependents = selectedFile
    ? graph?.dependentsOf.get(selectedFile)?.length || 0
    : 0;

  const landmarks = useMemo(() => {
    const src = indexMap?.architecture?.landmarks || {};
    return Object.entries(src).filter(([, v]) => v != null);
  }, [indexMap]);

  const renderSymbolRow = (symbol: IndexSymbol, showFile: boolean) => (
    <button
      key={`${symbol.file_path}:${symbol.start_line}:${symbol.name}`}
      type="button"
      onClick={() => onOpenFile(symbol.file_path, symbol.start_line)}
      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.05] transition-colors group"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-4xs font-mono px-1 py-0.5 rounded shrink-0 ${kindTone(symbol.kind)}`}>
          {symbol.kind || "symbol"}
        </span>
        {/* Left as an arbitrary value on purpose: `text-xs` is 12px *and* sets a
            16px line-height, so swapping it here would quietly change the row's
            height. Line-heights belong with the type scale decisions, not with a
            rename that promises to change nothing. */}
        <span className="text-[12px] text-zinc-200 font-mono truncate">{symbol.name}</span>
      </div>
      <div className="flex items-center gap-1 mt-0.5 text-3xs text-zinc-500 font-mono min-w-0">
        {showFile && (
          <>
            <Icon icon={FileCode2} className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{symbol.file_path}</span>
            <span className="shrink-0">·</span>
          </>
        )}
        <span className="shrink-0">L{symbol.start_line}</span>
      </div>
      {symbol.signature && (
        <div className="text-3xs text-zinc-500 font-mono truncate mt-0.5">{symbol.signature}</div>
      )}
    </button>
  );

  const detailsPane = (
    <>
            {selectedFile && selectedEntry ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                    title="Back to overview"
                  >
                    <Icon icon={ArrowLeft} className="w-3.5 h-3.5" />
                  </button>
                  <FileIcon fileName={selectedEntry.path} className="w-4 h-4 shrink-0" />
                  <span className="text-body font-medium text-zinc-100 font-mono truncate">
                    {selectedEntry.path}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-2xs">
                  <Chip label="lines" value={selectedEntry.lines} />
                  <Chip label="symbols" value={selectedEntry.symbolCount} />
                  <Chip label="imports" value={selectedImportCount} />
                  <Chip label="importer files" value={selectedDirectDependents} tone="amber" />
                  {selectedEntry.language && <Chip label="lang" value={selectedEntry.language} />}
                  <button
                    type="button"
                    onClick={() => onOpenFile(selectedEntry.path, 1)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-600/80 hover:bg-purple-500 text-white font-medium transition-colors"
                  >
                    <Icon icon={Crosshair} className="w-3 h-3" />
                    Open file
                  </button>
                </div>

                {/* What this file is for — instant, from indexed facts. */}
                <Card title="Role in this codebase">
                  <ul className="space-y-1 px-1 py-0.5">
                    {(graph ? describeFileRole(selectedEntry, graph, entrypoints) : []).map(
                      (line) => (
                        <li key={line} className="flex items-start gap-1.5 text-2xs text-zinc-300">
                          <span className="text-zinc-500 mt-[1px]">•</span>
                          <span className="leading-snug">{line}</span>
                        </li>
                      )
                    )}
                  </ul>
                  <div className="mt-2 pt-2 border-t border-hairline">
                    {aiSummary ? (
                      <p className="text-2xs text-zinc-400 leading-relaxed whitespace-pre-wrap px-1">
                        {aiSummary}
                      </p>
                    ) : explainError ? (
                      <div className="flex items-start gap-1.5 px-1 text-2xs text-red-300">
                        <Icon icon={AlertCircle} className="w-3 h-3 shrink-0 mt-0.5" />
                        <span className="leading-snug">{explainError}</span>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => explainFile(selectedEntry)}
                      disabled={isExplaining}
                      className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-3xs font-semibold bg-purple-600/80 hover:bg-purple-500 disabled:opacity-50 text-white transition-colors"
                      title="Ask the active model to explain this file's purpose"
                    >
                      <Icon icon={Sparkles} className="w-3 h-3" />
                      {isExplaining ? "Explaining…" : aiSummary ? "Regenerate explanation" : "Explain with AI"}
                    </button>
                  </div>
                </Card>

                <Card title={`Symbols (${outline.length})`}>
                  {isLoadingFile && <div className="text-2xs text-zinc-500 px-1">Loading…</div>}
                  {!isLoadingFile && outline.length === 0 && (
                    <div className="text-2xs text-zinc-500 px-1">
                      No top-level symbols indexed in this file.
                    </div>
                  )}
                  {outline.map((s) => renderSymbolRow(s, false))}
                </Card>

                <Card title={`Blast radius — ${dependents.length} file(s) affected by a change`}>
                  {dependents.length === 0 ? (
                    <div className="text-2xs text-zinc-500 px-1">
                      Nothing depends on this file (transitively) — safe to change in isolation.
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {dependents.map((dep) => (
                        <button
                          key={dep}
                          type="button"
                          onClick={() => setSelectedFile(dep)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors"
                        >
                          <Icon icon={CornerDownRight} className="w-3 h-3 text-zinc-500 shrink-0" />
                          <FileIcon fileName={dep} className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                            {dep}
                          </span>
                          <span className="text-3xs text-zinc-500 font-mono shrink-0">
                            {dirname(dep) || "."}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title={`Imports ${selectedImportCount} file(s)`}>
                  {(graph?.importsOf.get(selectedEntry.path) || []).length === 0 ? (
                    <div className="text-2xs text-zinc-500 px-1">
                      Nothing project-local is imported here.
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {(graph?.importsOf.get(selectedEntry.path) || []).map((dep) => (
                        <button
                          key={dep}
                          type="button"
                          onClick={() => setSelectedFile(dep)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors"
                        >
                          <Icon icon={ArrowDownToLine} className="w-3 h-3 text-zinc-500 shrink-0" />
                          <FileIcon fileName={dep} className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                            {dep}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            ) : (
              <>
                <Card title="Architecture">
                  {!indexMap && !error && (
                    <div className="text-2xs text-zinc-500 px-1">No index loaded.</div>
                  )}
                  {indexMap && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
                        <Meta label="Archetype" value={indexMap.architecture.archetype || "—"} />
                        <Meta label="Mode" value={indexMap.architecture.mode || "—"} />
                        <Meta label="Scale tier" value={indexMap.architecture.scaleTier || "—"} />
                        <Meta
                          label="Frameworks"
                          value={
                            (indexMap.profile?.frameworks || indexMap.architecture.ecosystems || [])
                              .join(", ") || "—"
                          }
                        />
                        <Meta
                          label="Languages"
                          value={
                            indexMap.profile?.languages
                              ? Object.entries(indexMap.profile.languages)
                                  .sort((a, b) => b[1] - a[1])
                                  .map(([l, n]) => `${l} ${n}`)
                                  .join(" · ")
                              : "—"
                          }
                        />
                        <Meta
                          label="Updated"
                          value={
                            indexMap.updatedAt
                              ? new Date(Number(indexMap.updatedAt) * 1000).toLocaleString()
                              : "—"
                          }
                        />
                      </div>
                      {indexMap.architecture.entrypoints.length > 0 && (
                        <div>
                          <div className="text-3xs uppercase tracking-wide text-zinc-500 mb-1">
                            Entrypoints
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {indexMap.architecture.entrypoints.map((ep) => (
                              <button
                                key={ep}
                                type="button"
                                onClick={() => onOpenFile(ep, 1)}
                                className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-2xs font-mono hover:bg-emerald-500/20 transition-colors"
                              >
                                {ep}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>

                {landmarks.length > 0 && (
                  <Card title="Landmarks">
                    <div className="space-y-2">
                      {landmarks.map(([key, value]) => (
                        <div key={key} className="text-2xs">
                          <span className="text-zinc-500 font-mono">{key.replace(/_/g, " ")}</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {String(value)
                              .split(/,\s*/)
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .map((item) =>
                                indexMap?.files.some((f) => f.path === item) ? (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => setSelectedFile(item)}
                                    className="px-2 py-0.5 rounded-md bg-zinc-800/70 border border-zinc-700/60 text-zinc-300 text-3xs font-mono hover:bg-zinc-700 transition-colors"
                                  >
                                    {item}
                                  </button>
                                ) : (
                                  <span
                                    key={item}
                                    className="px-2 py-0.5 rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-500 text-3xs font-mono"
                                  >
                                    {item}
                                  </span>
                                )
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {graph && graph.hubs.length > 0 && (
                  <Card title="Most depended-on files (by importer count)">
                    <div className="space-y-0.5">
                      {graph.hubs.slice(0, 12).map((hub) => (
                        <button
                          key={hub.path}
                          type="button"
                          onClick={() => setSelectedFile(hub.path)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors"
                        >
                          <FileIcon fileName={hub.path} className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                            {hub.path}
                          </span>
                          <span className="text-3xs text-zinc-500 font-mono shrink-0">
                            {hub.imports} imports
                          </span>
                          <span className="text-3xs text-amber-300/90 font-mono shrink-0 w-[74px] text-right">
                            {hub.dependents} importers
                          </span>
                        </button>
                      ))}
                    </div>
                  </Card>
                )}

                {!indexMap && error && (
                  <Card title="Getting started">
                    <div className="text-2xs text-zinc-400 leading-relaxed px-1">
                      The code map is built from the AST symbol index in{" "}
                      <span className="font-mono text-zinc-300">.acsa/index.json</span>. Run{" "}
                      <span className="font-mono text-zinc-300">Re-index</span> above to generate it for{" "}
                      <span className="font-mono text-zinc-300">{projectName || projectRoot}</span>.
                    </div>
                  </Card>
                )}
              </>
            )}
    </>
  );

  return (
    <div className="h-full w-full flex flex-col bg-canvas text-zinc-200 font-sans select-none overflow-hidden">
      {/* ── Index status strip ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-hairline px-4 py-2 flex items-center gap-2 flex-wrap text-2xs">
        <span className="inline-flex items-center gap-1.5 text-zinc-400">
          <Icon icon={Network} className="w-3.5 h-3.5 text-purple-300" />
          <span className="font-medium text-zinc-200">{projectName || "project"}</span>
        </span>
        {indexMap && (
          <>
            <Chip label="files" value={indexMap.totalFiles} />
            <Chip label="symbols" value={indexMap.totalSymbols} />
            {graph && <Chip label="dep edges" value={graph.edgeCount} />}
            {indexMap.architecture.scaleTier && (
              <Chip label="scale" value={indexMap.architecture.scaleTier} />
            )}
            {indexMap.architecture.archetype && (
              <span className="text-zinc-500">{indexMap.architecture.archetype}</span>
            )}
          </>
        )}
        <span className="flex-1" />
        {/* Lens switch: the map explains the shape, the index explains the detail. */}
        <div className="inline-flex items-center rounded-md border border-zinc-700/70 bg-zinc-900/60 p-0.5">
          {(["graph", "index"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLens(option)}
              className={`px-2.5 py-0.5 rounded text-2xs font-medium transition-colors ${
                lens === option
                  ? "bg-zinc-700/80 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title={option === "graph" ? "Interactive dependency map" : "Symbol & file index"}
            >
              {option === "graph" ? "Map" : "Index"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleReindex}
          disabled={isReindexing}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/70 text-zinc-200 transition-colors disabled:opacity-50"
        >
          <Icon icon={RefreshCw} className={`w-3 h-3 ${isReindexing ? "animate-spin" : ""}`} />
          {isReindexing ? "Re-indexing…" : "Re-index"}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* ── Left: search + file index ─────────────────────────────────── */}
        <div className="w-[clamp(230px,24%,330px)] shrink-0 border-r border-hairline flex flex-col min-h-0">
          <div className="p-3 border-b border-hairline">
            <div className="relative">
              <Icon
                icon={isSearching ? RefreshCw : Search}
                className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 ${
                  isSearching ? "animate-spin" : ""
                }`}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbols or files…"
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg pl-8 pr-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-500/60 font-mono"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {error && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-2xs text-red-300">
                <Icon icon={AlertCircle} className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {isLoading && !indexMap && !error && (
              <div className="p-3 text-2xs text-zinc-500">Building code map…</div>
            )}

            {/* Map lens: the clusters Louvain found, each toggleable. */}
            {lens === "graph" && query.trim().length < 2 && architecture && (
              <>
                <SectionLabel>
                  <Icon icon={Waypoints} className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Communities ({architecture.communities.length})
                </SectionLabel>
                <div className="px-2 pb-1 text-3xs text-zinc-500 leading-snug">
                  Files clustered by dependency. Toggle to isolate a subsystem.
                </div>
                {architecture.communities.map((community) => {
                  const hidden = hiddenCommunities.has(community.id);
                  return (
                    <button
                      key={community.id}
                      type="button"
                      onClick={() =>
                        setHiddenCommunities((prev) => {
                          const next = new Set(prev);
                          if (next.has(community.id)) next.delete(community.id);
                          else next.add(community.id);
                          return next;
                        })
                      }
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-white/[0.05] ${
                        hidden ? "opacity-45" : ""
                      }`}
                      title={hidden ? "Show this cluster" : "Hide this cluster"}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/10"
                        style={{ background: hidden ? "transparent" : community.color }}
                      />
                      <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                        {community.label}
                      </span>
                      <span className="text-3xs text-zinc-500 font-mono shrink-0">
                        {community.count}
                      </span>
                    </button>
                  );
                })}
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => setFocusNeighborhood((prev) => !prev)}
                    className={`mt-2 w-full px-2 py-1.5 rounded-lg text-2xs border transition-colors ${
                      focusNeighborhood
                        ? "border-purple-500/50 bg-purple-500/10 text-purple-200"
                        : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {focusNeighborhood ? "Showing neighbourhood only" : "Focus selected neighbourhood"}
                  </button>
                )}
              </>
            )}

            {query.trim().length >= 2 && (
              <>
                <SectionLabel>
                  Symbols {results.length > 0 && `(${results.length})`}
                </SectionLabel>
                {!isSearching && results.length === 0 && (
                  <div className="px-2 py-1 text-2xs text-zinc-500">No symbols matched.</div>
                )}
                {results.slice(0, 60).map((s) => renderSymbolRow(s, true))}
                {fileMatches.length > 0 && (
                  <>
                    <SectionLabel>Files ({fileMatches.length})</SectionLabel>
                    {fileMatches.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => setSelectedFile(f.path)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors ${
                          selectedFile === f.path ? "bg-white/[0.06]" : ""
                        }`}
                      >
                        <FileIcon fileName={f.path} className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                          {f.path}
                        </span>
                        <span className="text-3xs text-zinc-500 font-mono shrink-0">
                          {f.symbolCount}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}

            {lens === "index" && query.trim().length < 2 && indexMap && (
              <>
                <SectionLabel>
                  <Icon icon={Waypoints} className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Dependency hubs
                </SectionLabel>
                {(graph?.hubs || []).slice(0, 8).map((hub) => (
                  <button
                    key={hub.path}
                    type="button"
                    onClick={() => setSelectedFile(hub.path)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors ${
                      selectedFile === hub.path ? "bg-white/[0.06]" : ""
                    }`}
                    title={`${hub.dependents} file(s) import this · it imports ${hub.imports}`}
                  >
                    <FileIcon fileName={hub.path} className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-2xs text-zinc-300 font-mono truncate flex-1">
                      {hub.path}
                    </span>
                    <span className="text-3xs text-amber-300/90 font-mono shrink-0">
                      {hub.dependents} ←
                    </span>
                  </button>
                ))}

                <SectionLabel>
                  <Icon icon={Layers} className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Indexed files ({indexMap.files.length})
                </SectionLabel>
                {indexMap.files
                  .slice()
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => setSelectedFile(f.path)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left hover:bg-white/[0.05] transition-colors ${
                        selectedFile === f.path ? "bg-white/[0.06]" : ""
                      }`}
                    >
                      <FileIcon fileName={f.path} className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-2xs text-zinc-400 font-mono truncate flex-1">
                        {f.path}
                      </span>
                      <span className="text-3xs text-zinc-500 font-mono shrink-0">
                        {f.symbolCount}
                      </span>
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>

        {/* ── Centre: interactive map (Map lens only). The details panel is an
             overlay so opening it never resizes (and re-frames) the canvas. ── */}
        {lens === "graph" && (
          <div className="flex-1 min-w-0 relative">
            <div className="absolute inset-0 p-3">
            {architecture && architecture.nodes.length > 0 ? (
              <CodeMapGraph
                nodes={architecture.nodes}
                links={architecture.links}
                communities={architecture.communities}
                hiddenCommunities={hiddenCommunities}
                query={query}
                selectedPath={selectedFile}
                onSelect={setSelectedFile}
                depthFocus={focusNeighborhood ? neighborhood : null}
              />
            ) : (
              <div className="h-full w-full rounded-xl border border-hairline bg-[#0d0d10] flex items-center justify-center text-2xs text-zinc-500">
                {isLoading ? "Building code map…" : "No resolvable dependencies to graph yet."}
              </div>
            )}
            </div>

            {selectedFile && (
              <div className="absolute top-3 right-3 bottom-3 w-[clamp(240px,28%,340px)] z-popover overflow-y-auto rounded-xl border border-hairline bg-[#141416]/96 backdrop-blur-md shadow-2xl p-4 space-y-4">
                {detailsPane}
              </div>
            )}
          </div>
        )}

        {/* ── Right column: file detail in the Index lens (Map lens overlays it) ── */}
        {lens === "index" && (
          <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">{detailsPane}</div>
        )}

      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: string | number;
  tone?: "zinc" | "amber";
}) {
  const valueTone = tone === "amber" ? "text-amber-300" : "text-zinc-200";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900/70 border border-zinc-800">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono ${valueTone}`}>{value}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-3xs uppercase tracking-wide text-zinc-500 sticky top-0 bg-canvas/95 backdrop-blur-sm z-popover">
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-workbench border border-hairline overflow-hidden">
      <div className="px-3 py-2 border-b border-hairline text-2xs font-semibold text-zinc-300">
        {title}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-3xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-zinc-300 font-mono break-words" title={value}>
        {value}
      </div>
    </div>
  );
}

export default CodeMapDashboard;
