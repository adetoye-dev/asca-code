/**
 * codeGraph.ts — File-level dependency graph derived from indexed imports
 *
 * The engine's index graph only carries `file → its own symbols` and
 * `file → external package` edges, so it cannot answer "who imports this
 * file?". Each indexed file does carry its raw module specifiers, so we
 * resolve the project-local ones here and build a real file→file graph.
 *
 * Resolution is intentionally strict: a specifier only becomes an edge when it
 * resolves to a file that is actually in the index. That drops external
 * packages and the indexer's occasional string-literal noise.
 */

import type { IndexFileEntry } from "./agentHarness";

export interface CodeGraph {
  /** file → files it imports (project-local only). */
  importsOf: Map<string, string[]>;
  /** file → files that import it. */
  dependentsOf: Map<string, string[]>;
  /** Total resolved file→file edges. */
  edgeCount: number;
  /** Files other files depend on, most depended-on first. */
  hubs: Array<{ path: string; dependents: number; imports: number }>;
}

const JS_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];
const OTHER_EXTENSIONS = [".json", ".css", ".scss", ".vue", ".svelte", ".md", ".py"];
const ALL_EXTENSIONS = [...JS_EXTENSIONS, ...OTHER_EXTENSIONS];

/** Joins a relative specifier onto `dir`, collapsing `.` and `..` segments. */
function normalizeJoin(dir: string, spec: string): string {
  const parts = dir ? dir.split("/") : [];
  for (const segment of spec.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * Resolves a module specifier from `fromFile` to a known project file path,
 * or null when it points outside the project / at a third-party package.
 */
export function resolveImportSpecifier(
  spec: string,
  fromFile: string,
  known: Set<string>
): string | null {
  if (!spec) return null;
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";

  if (spec.startsWith(".")) {
    const base = normalizeJoin(dir, spec);
    // TS/ESM writes `./foo.js` to mean `./foo.ts`, so try the extensionless
    // form too.
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    const bases = stripped !== base ? [base, stripped] : [base];
    const candidates: string[] = [];
    for (const b of bases) {
      for (const ext of ALL_EXTENSIONS) candidates.push(`${b}${ext}`);
    }
    for (const b of bases) {
      for (const ext of ALL_EXTENSIONS) candidates.push(`${b}/index${ext}`);
    }
    for (const candidate of candidates) {
      if (known.has(candidate)) return candidate;
    }
    return null;
  }

  // Python bare module: `agent_tools`, `gauntlet.syntax_guard`.
  if (/^[A-Za-z_][\w.]*$/.test(spec)) {
    const modPath = spec.replace(/\./g, "/");
    const candidates = [
      dir ? `${dir}/${modPath}.py` : `${modPath}.py`,
      `${modPath}.py`,
      dir ? `${dir}/${modPath}/__init__.py` : `${modPath}/__init__.py`,
    ];
    for (const candidate of candidates) {
      if (known.has(candidate)) return candidate;
    }
  }

  return null;
}

export function buildCodeGraph(files: IndexFileEntry[]): CodeGraph {
  const known = new Set(files.map((f) => f.path));
  const importsOf = new Map<string, Set<string>>();
  const dependentsOf = new Map<string, Set<string>>();
  let edgeCount = 0;

  for (const file of files) {
    for (const spec of file.importSpecifiers || []) {
      const target = resolveImportSpecifier(spec, file.path, known);
      if (!target || target === file.path) continue;
      edgeCount += 1;
      if (!importsOf.has(file.path)) importsOf.set(file.path, new Set());
      importsOf.get(file.path)!.add(target);
      if (!dependentsOf.has(target)) dependentsOf.set(target, new Set());
      dependentsOf.get(target)!.add(file.path);
    }
  }

  const toSortedArray = (m: Map<string, Set<string>>) => {
    const out = new Map<string, string[]>();
    m.forEach((set, key) => out.set(key, [...set].sort()));
    return out;
  };

  const hubs = files
    .map((f) => ({
      path: f.path,
      dependents: dependentsOf.get(f.path)?.size || 0,
      imports: importsOf.get(f.path)?.size || 0,
    }))
    .filter((f) => f.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || b.imports - a.imports || a.path.localeCompare(b.path));

  return {
    importsOf: toSortedArray(importsOf),
    dependentsOf: toSortedArray(dependentsOf),
    edgeCount,
    hubs,
  };
}
