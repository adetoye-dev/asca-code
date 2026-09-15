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
} from "lucide-react";
import { Icon } from "../ui/Icon";
import { FileIcon } from "../ui/FileIcon";
import { buildCodeGraph } from "../../services/codeGraph";
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

export function CodeMapDashboard({ projectRoot, projectName, onOpenFile }: CodeMapDashboardProps) {
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

  // Direct file→file import edges, resolved locally from indexed specifiers.
  const graph = useMemo(
    () => (indexMap ? buildCodeGraph(indexMap.files) : null),
    [indexMap]
  );

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
        <span className={`text-[9px] font-mono px-1 py-0.5 rounded shrink-0 ${kindTone(symbol.kind)}`}>
          {symbol.kind || "symbol"}
        </span>
        <span className="text-[12px] text-zinc-200 font-mono truncate">{symbol.name}</span>
      </div>
      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500 font-mono min-w-0">
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
        <div className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">{symbol.signature}</div>
      )}
    </button>
  );

  return (
    <div className="h-full w-full flex flex-col bg-canvas text-zinc-200 font-sans select-none overflow-hidden">
      {/* ── Index status strip ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-hairline px-4 py-2 flex items-center gap-2 flex-wrap text-[11px]">
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
        <div className="w-[330px] shrink-0 border-r border-hairline flex flex-col min-h-0">
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
              <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                <Icon icon={AlertCircle} className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {isLoading && !indexMap && !error && (
              <div className="p-3 text-[11px] text-zinc-500">Building code map…</div>
            )}

            {query.trim().length >= 2 && (
              <>
                <SectionLabel>
                  Symbols {results.length > 0 && `(${results.length})`}
                </SectionLabel>
                {!isSearching && results.length === 0 && (
                  <div className="px-2 py-1 text-[11px] text-zinc-500">No symbols matched.</div>
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
                        <span className="text-[11px] text-zinc-300 font-mono truncate flex-1">
                          {f.path}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                          {f.symbolCount}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}

            {query.trim().length < 2 && indexMap && (
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
                    <span className="text-[11px] text-zinc-300 font-mono truncate flex-1">
                      {hub.path}
                    </span>
                    <span className="text-[10px] text-amber-300/90 font-mono shrink-0">
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
                      <span className="text-[11px] text-zinc-400 font-mono truncate flex-1">
                        {f.path}
                      </span>
                      <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                        {f.symbolCount}
                      </span>
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right: overview or file detail ────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
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
                <span className="text-[13px] font-medium text-zinc-100 font-mono truncate">
                  {selectedEntry.path}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-[11px]">
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

              <Card title={`Symbols (${outline.length})`}>
                {isLoadingFile && <div className="text-[11px] text-zinc-500 px-1">Loading…</div>}
                {!isLoadingFile && outline.length === 0 && (
                  <div className="text-[11px] text-zinc-500 px-1">
                    No top-level symbols indexed in this file.
                  </div>
                )}
                {outline.map((s) => renderSymbolRow(s, false))}
              </Card>

              <Card title={`Blast radius — ${dependents.length} file(s) affected by a change`}>
                {dependents.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 px-1">
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
                        <span className="text-[11px] text-zinc-300 font-mono truncate flex-1">
                          {dep}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                          {dirname(dep) || "."}
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
                  <div className="text-[11px] text-zinc-500 px-1">No index loaded.</div>
                )}
                {indexMap && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
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
                        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                          Entrypoints
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {indexMap.architecture.entrypoints.map((ep) => (
                            <button
                              key={ep}
                              type="button"
                              onClick={() => onOpenFile(ep, 1)}
                              className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono hover:bg-emerald-500/20 transition-colors"
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
                      <div key={key} className="text-[11px]">
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
                                  className="px-2 py-0.5 rounded-md bg-zinc-800/70 border border-zinc-700/60 text-zinc-300 text-[10px] font-mono hover:bg-zinc-700 transition-colors"
                                >
                                  {item}
                                </button>
                              ) : (
                                <span
                                  key={item}
                                  className="px-2 py-0.5 rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-500 text-[10px] font-mono"
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
                        <span className="text-[11px] text-zinc-300 font-mono truncate flex-1">
                          {hub.path}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                          {hub.imports} imports
                        </span>
                        <span className="text-[10px] text-amber-300/90 font-mono shrink-0 w-[74px] text-right">
                          {hub.dependents} importers
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {!indexMap && error && (
                <Card title="Getting started">
                  <div className="text-[11px] text-zinc-400 leading-relaxed px-1">
                    The code map is built from the AST symbol index in{" "}
                    <span className="font-mono text-zinc-300">.acsa/index.json</span>. Run{" "}
                    <span className="font-mono text-zinc-300">Re-index</span> above to generate it for{" "}
                    <span className="font-mono text-zinc-300">{projectName || projectRoot}</span>.
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
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
    <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wide text-zinc-500 sticky top-0 bg-canvas/95 backdrop-blur-sm z-10">
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-workbench border border-hairline overflow-hidden">
      <div className="px-3 py-2 border-b border-hairline text-[11px] font-semibold text-zinc-300">
        {title}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-zinc-300 font-mono break-words" title={value}>
        {value}
      </div>
    </div>
  );
}

export default CodeMapDashboard;
