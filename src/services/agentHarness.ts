/**
 * agentHarness.ts — Project Code-Intelligence Index (frontend bridge)
 *
 * Thin client for the engine's AST symbol index. The agent's actual tool
 * surface (search_symbols, get_file_outline, get_blast_radius, read_code_slice,
 * apply_patch, run_gauntlet, run_terminal_command) is owned by the Python
 * engine (`core-engine/agent_tools.py`) and driven from `agent_loop.py`; this
 * module only syncs/reports index status for the UI.
 *
 * Progressive Context Disclosure (compact symbol outlines instead of whole
 * files) and automatic project scale-tier detection live engine-side.
 */

export interface ProjectIndexProfile {
  scale_tier: "micro" | "standard" | "enterprise";
  total_loc: number;
  indexed_files: number;
  primary_language: string;
  frameworks: string[];
  languages: Record<string, number>;
}

export interface IndexSyncResult {
  success: boolean;
  totalSymbols: number;
  profile: ProjectIndexProfile;
  elapsedMs: number;
}

export interface IndexSymbol {
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature?: string;
  docstring?: string | null;
}

export interface IndexFileEntry {
  path: string;
  language: string;
  lines: number;
  symbolCount: number;
  /** Raw module specifiers as recorded by the indexer. */
  importSpecifiers: string[];
}

export interface IndexMap {
  indexed: boolean;
  updatedAt: string | null;
  totalSymbols: number;
  totalFiles: number;
  profile: ProjectIndexProfile | null;
  architecture: {
    archetype: string;
    mode: string;
    scaleTier: string;
    ecosystems: string[];
    entrypoints: string[];
    landmarks: Record<string, unknown>;
  };
  files: IndexFileEntry[];
}

/**
 * Triggers a project-wide index sync.
 */
export async function syncProjectIndex(projectRoot: string): Promise<IndexSyncResult | null> {
  try {
    const res = await fetch("/api/indexer/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    });
    if (res.ok) {
      return (await res.json()) as IndexSyncResult;
    }
  } catch (err) {
    console.warn("Index sync failed:", err);
  }
  return null;
}

/**
 * Fetches current index status and profile.
 */
export async function getIndexStatus(projectRoot = ""): Promise<{
  indexed: boolean;
  totalSymbols: number;
  profile: ProjectIndexProfile | null;
}> {
  try {
    const res = await fetch(`/api/indexer/status?projectRoot=${encodeURIComponent(projectRoot)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { indexed: false, totalSymbols: 0, profile: null };
}

/**
 * Fetches the compact symbol/dependency map used by the Code Map surface.
 */
export async function fetchIndexMap(projectRoot: string): Promise<IndexMap | null> {
  try {
    const res = await fetch(`/api/indexer/map?projectRoot=${encodeURIComponent(projectRoot)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.indexed) return data as IndexMap;
    }
  } catch (err) {
    console.warn("fetchIndexMap failed:", err);
  }
  return null;
}

/**
 * Searches the AST symbol index by name/substring. An empty query returns a
 * capped sample of all indexed symbols.
 */
export async function searchIndexSymbols(
  query: string,
  projectRoot: string
): Promise<IndexSymbol[]> {
  try {
    const res = await fetch("/api/indexer/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, query }),
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.symbols) ? (data.symbols as IndexSymbol[]) : [];
    }
  } catch (err) {
    console.warn("searchIndexSymbols failed:", err);
  }
  return [];
}

/**
 * Returns the symbol outline for a single file.
 */
export async function fetchFileOutline(
  file: string,
  projectRoot: string
): Promise<IndexSymbol[]> {
  try {
    const res = await fetch("/api/indexer/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, file }),
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.symbols) ? (data.symbols as IndexSymbol[]) : [];
    }
  } catch (err) {
    console.warn("fetchFileOutline failed:", err);
  }
  return [];
}

/**
 * Lists the files that depend on `filePath` (transitive blast radius).
 */
export async function fetchBlastRadius(
  filePath: string,
  projectRoot: string
): Promise<string[]> {
  try {
    const res = await fetch("/api/indexer/blast-radius", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, filePath }),
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.invalidatedFilePaths) ? data.invalidatedFilePaths : [];
    }
  } catch (err) {
    console.warn("fetchBlastRadius failed:", err);
  }
  return [];
}
