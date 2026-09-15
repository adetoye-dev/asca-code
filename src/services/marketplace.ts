/**
 * marketplace.ts — Skill / Tooling / MCP marketplace
 *
 * Curated, installable open-source capabilities for the ACSA harness:
 *  - Skills: markdown SKILL.md files written to .acsa/skills and picked up by
 *    the Python engine's skill_loader (instructions, review playbooks).
 *  - MCP servers: standard Model Context Protocol server configs written to
 *    .acsa/mcp.json, consumable by the engine's MCP client.
 */

export type MarketplaceKind = "skill" | "mcp";
export type MarketplaceDomain =
  | "coding"
  | "security"
  | "design"
  | "memory"
  | "research"
  | "testing"
  | "tooling";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  kind: MarketplaceKind;
  domain: MarketplaceDomain;
  description: string;
  author: string;
  source: string;
  tags: string[];
  /** SKILL.md body for skills (frontmatter is added on install if absent). */
  skillContent?: string;
  /** MCP server launch config. */
  mcpConfig?: McpServerConfig;
  /** Runtime the item needs. */
  requires?: string;
}

const SKILL_CODE_REVIEW = `# Code Review

Review the code you are given as a meticulous senior engineer.

Focus, in order:
1. Correctness bugs, off-by-one errors, wrong comparisons, unhandled edge cases.
2. Error handling: swallowed exceptions, missing validation, unsafe assumptions.
3. Security: injection, unsafe deserialisation, secrets in source, unsafe file/network access.
4. Concurrency and resource leaks (unclosed handles, unbounded growth).
5. Naming, dead code, and duplication that hurts maintenance.

For every finding give: the file and line, the concrete problem, and a specific fix.
Prefer the smallest change that fixes the real problem. Never rewrite a whole file
when a focused edit is enough.`;

const SKILL_SECURITY_AUDIT = `# Security Audit

Audit the target code for exploitable weaknesses:
- Input handling: injection (SQL/command/template), path traversal, SSRF.
- Unsafe primitives: eval/exec/pickle, shell=True, unsanitised HTML.
- Secrets: hardcoded keys/tokens, credentials in logs.
- AuthZ/AuthN gaps, missing rate limits, permissive CORS.
- Dependency risk from unpinned or abandoned packages.

Report each issue with severity (critical/high/medium/low), the exact location,
a minimal proof of exploitability, and a concrete remediation. Rank by exploitability
against the actual entry points, not by theoretical severity alone.`;

const SKILL_DESIGN_REVIEW = `# Design Review

Evaluate interfaces and UI for clarity and usability:
- Visual hierarchy: is the primary action obvious? Are metrics labelled with units?
- Consistency: spacing, typography and colour used the same way across screens.
- Accessibility: contrast, focus states, keyboard reachability, screen-reader labels.
- Empty, loading and error states for every data-driven surface.
- Copy: specific, active voice, no filler.

Give prioritised, actionable changes; reference the component and line.`;

const SKILL_REFACTOR_PLAN = `# Refactor Plan

When asked to refactor:
1. State the concrete pain the refactor removes (coupling, duplication, unclear ownership).
2. Define the target shape before touching code.
3. Plan the change in small, independently verifiable steps.
4. Preserve behaviour: keep public interfaces stable unless explicitly told otherwise.
5. After each step, run the project's verification command.

Never mix a refactor with a behaviour change in the same step.`;

const SKILL_TEST_WRITER = `# Test Writer

Write tests that would actually catch regressions:
- One behaviour per test, named for the behaviour, not the implementation.
- Cover the happy path, boundaries (empty, max, off-by-one) and error paths.
- Prefer real objects to mocks; mock only I/O boundaries.
- Assert on observable outcomes, not internal calls.
- Reproduce any reported bug with a failing test before fixing it.

Use the project's existing test framework and conventions.`;

const SKILL_MEMORY_KEEPER = `# Memory Keeper

Maintain durable project memory.

After any non-trivial decision, append a concise entry to the project memory file
(.acsa/memory.md) with: date, decision, the alternatives considered, and the reason.
Before starting work, read that file so prior decisions are respected.

Keep entries short and factual. Never record secrets or credentials.`;

const SKILL_DOCS_WRITER = `# Docs Writer

Produce documentation a new engineer can act on:
- Lead with what the component does and when to use it.
- Show a minimal working example before exhaustive detail.
- Document inputs, outputs, errors and side effects precisely.
- Keep prose in the present tense and avoid marketing language.
- Update the README or the nearest existing doc rather than creating a parallel one.`;

const SKILL_PERF_TUNER = `# Performance Tuner

Optimise measured hot paths only:
1. Establish a baseline (time it, or count calls) before changing anything.
2. Identify the real bottleneck; do not guess.
3. Prefer algorithmic fixes over micro-optimisations.
4. Cache only where invalidation is provably correct.
5. Re-measure and report the before/after numbers.

Never trade correctness for speed.`;

export const MARKETPLACE_ITEMS: MarketplaceItem[] = [
  // ── Built-in MCP server (offline, guaranteed to work) ────────────────────
  {
    id: "acsa-workspace",
    name: "ACSA Workspace",
    kind: "mcp",
    domain: "tooling",
    description:
      "Built-in read-only workspace tools (list_files, read_file, search_code). Runs offline with zero install.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["workspace", "search", "offline"],
    mcpConfig: { command: "python3", args: ["core-engine/mcp_servers/workspace_server.py"] },
    requires: "python3",
  },
  // ── Reference / official MCP servers ─────────────────────────────────────
  {
    id: "mcp-filesystem",
    name: "Filesystem (official MCP)",
    kind: "mcp",
    domain: "tooling",
    description: "Official MCP server exposing scoped filesystem read/write tools.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["files", "read", "write"],
    mcpConfig: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    requires: "npx",
  },
  {
    id: "mcp-git",
    name: "Git (official MCP)",
    kind: "mcp",
    domain: "coding",
    description: "Inspect repositories: log, diff, status and blame through MCP.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["git", "history", "diff"],
    mcpConfig: { command: "npx", args: ["-y", "@modelcontextprotocol/server-git", "."] },
    requires: "npx",
  },
  {
    id: "mcp-memory",
    name: "Memory (knowledge graph)",
    kind: "mcp",
    domain: "memory",
    description: "Persistent knowledge-graph memory across sessions for long-running work.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["memory", "graph", "context"],
    mcpConfig: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
    requires: "npx",
  },
  {
    id: "mcp-sequential-thinking",
    name: "Sequential Thinking",
    kind: "mcp",
    domain: "tooling",
    description: "Structured step-by-step reasoning scaffold for hard multi-step problems.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["reasoning", "planning"],
    mcpConfig: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
    requires: "npx",
  },
  {
    id: "mcp-sqlite",
    name: "SQLite",
    kind: "mcp",
    domain: "tooling",
    description: "Query and inspect SQLite databases directly from the agent.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["database", "sql"],
    mcpConfig: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "data.db"],
    },
    requires: "npx",
  },
  {
    id: "mcp-fetch",
    name: "Fetch (web)",
    kind: "mcp",
    domain: "research",
    description: "Fetch and convert web pages to markdown for grounded research.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["web", "research"],
    mcpConfig: { command: "uvx", args: ["mcp-server-fetch"] },
    requires: "uvx",
  },
  {
    id: "mcp-github",
    name: "GitHub",
    kind: "mcp",
    domain: "coding",
    description: "Issues, pull requests and repository data via the GitHub API.",
    author: "modelcontextprotocol",
    source: "github.com/modelcontextprotocol/servers",
    tags: ["github", "issues", "prs"],
    mcpConfig: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    },
    requires: "npx + token",
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    id: "code-review",
    name: "Code Review",
    kind: "skill",
    domain: "coding",
    description: "Senior-engineer review focusing on correctness, safety and maintainability.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["review", "quality"],
    skillContent: SKILL_CODE_REVIEW,
  },
  {
    id: "security-audit",
    name: "Security Audit",
    kind: "skill",
    domain: "security",
    description: "Find exploitable issues: injection, unsafe primitives, secrets, auth gaps.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["security", "audit"],
    skillContent: SKILL_SECURITY_AUDIT,
  },
  {
    id: "design-review",
    name: "Design & UX Review",
    kind: "skill",
    domain: "design",
    description: "Hierarchy, consistency, accessibility and state coverage for interfaces.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["design", "ux", "a11y"],
    skillContent: SKILL_DESIGN_REVIEW,
  },
  {
    id: "refactor-plan",
    name: "Refactor Planning",
    kind: "skill",
    domain: "coding",
    description: "Behaviour-preserving refactors planned as small verifiable steps.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["refactor", "planning"],
    skillContent: SKILL_REFACTOR_PLAN,
  },
  {
    id: "test-writer",
    name: "Test Writer",
    kind: "skill",
    domain: "testing",
    description: "Regression-catching tests with boundaries and error paths covered.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["tests", "quality"],
    skillContent: SKILL_TEST_WRITER,
  },
  {
    id: "memory-keeper",
    name: "Project Memory",
    kind: "skill",
    domain: "memory",
    description: "Record decisions and rationale in .acsa/memory.md across sessions.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["memory", "decisions"],
    skillContent: SKILL_MEMORY_KEEPER,
  },
  {
    id: "docs-writer",
    name: "Documentation Writer",
    kind: "skill",
    domain: "tooling",
    description: "Actionable docs: what it does, minimal example, precise inputs/outputs.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["docs", "readme"],
    skillContent: SKILL_DOCS_WRITER,
  },
  {
    id: "perf-tuner",
    name: "Performance Tuner",
    kind: "skill",
    domain: "coding",
    description: "Measure-first optimisation of real hot paths, with before/after numbers.",
    author: "ACSA Code",
    source: "built-in",
    tags: ["performance", "profiling"],
    skillContent: SKILL_PERF_TUNER,
  },
];

export interface McpToolInfo {
  name: string;
  description?: string;
}

export async function installSkill(
  item: MarketplaceItem,
  projectRoot: string,
  scope: "project" | "user" = "project"
): Promise<{ ok: boolean; error?: string }> {
  if (item.kind !== "skill" || !item.skillContent) {
    return { ok: false, error: "Not a skill" };
  }
  try {
    const res = await fetch("/api/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.id,
        content: item.skillContent,
        scope,
        projectRoot,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: Boolean(data.ok), error: data.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Install failed" };
  }
}

export async function installMcpServer(
  item: MarketplaceItem,
  projectRoot: string
): Promise<{ ok: boolean; error?: string }> {
  if (item.kind !== "mcp" || !item.mcpConfig) {
    return { ok: false, error: "Not an MCP server" };
  }
  try {
    const config = { ...item.mcpConfig };
    if (item.id === "acsa-workspace") {
      const root = projectRoot.replace(/[\\/]+$/, "");
      config.args = [`${root}/core-engine/mcp_servers/workspace_server.py`];
      config.env = { ...(config.env || {}), ACSA_MCP_ROOT: projectRoot };
    }
    const res = await fetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, config, projectRoot }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: Boolean(data.ok), error: data.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Install failed" };
  }
}

export async function removeMcpServer(
  id: string,
  projectRoot: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/mcp/servers/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, projectRoot }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: Boolean(data.ok), error: data.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Uninstall failed" };
  }
}

export async function listMcpServers(
  projectRoot: string
): Promise<Record<string, McpServerConfig>> {
  try {
    const res = await fetch(`/api/mcp/servers?projectRoot=${encodeURIComponent(projectRoot)}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.servers || {};
  } catch {
    return {};
  }
}

export async function listMcpTools(
  id: string,
  projectRoot: string
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  try {
    const res = await fetch("/api/mcp/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, projectRoot }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: Boolean(data.ok),
      tools: Array.isArray(data.tools) ? data.tools : [],
      error: data.error,
    };
  } catch (err: any) {
    return { ok: false, tools: [], error: err?.message || "Could not reach server" };
  }
}

export function domainLabel(domain: MarketplaceDomain): string {
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}
