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
