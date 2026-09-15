/**
 * MarketplaceSidebar.tsx — Skill / Tooling / MCP marketplace
 *
 * Browse and install open-source harness capabilities:
 *  - Skills -> written to .acsa/skills (consumed by the Python skill loader)
 *  - MCP servers -> written to .acsa/mcp.json (consumed by the MCP client)
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import {
  Package,
  Download,
  Trash2,
  Search,
  Wrench,
  Brain,
  Shield,
  Palette,
  FlaskConical,
  Plug,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Info,
  FileText,
} from "lucide-react";
import {
  ECOSYSTEM_LINKS,
  MARKETPLACE_ITEMS,
  TRUST_LABEL,
  domainLabel,
  installTarget,
  installMcpServer,
  installSkill,
  listMcpServers,
  listMcpTools,
  removeMcpServer,
  type MarketplaceDomain,
  type MarketplaceItem,
  type MarketplaceKind,
} from "../../services/marketplace";

interface MarketplaceSidebarProps {
  projectRoot?: string;
}

const DOMAIN_ICONS: Record<MarketplaceDomain, any> = {
  coding: Wrench,
  security: Shield,
  design: Palette,
  memory: Brain,
  research: Search,
  testing: FlaskConical,
  tooling: Package,
};

export function MarketplaceSidebar({ projectRoot = "" }: MarketplaceSidebarProps) {
  const [kind, setKind] = useState<MarketplaceKind | "all">("all");
  const [domain, setDomain] = useState<MarketplaceDomain | "all">("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set());
  const [installedServers, setInstalledServers] = useState<Record<string, any>>({});
  const [toolsById, setToolsById] = useState<Record<string, string[]>>({});
  /** Which entry's detail view is open (one at a time keeps the sidebar calm). */
  const [expandedId, setExpandedId] = useState<string>("");

  const refreshInstalled = async () => {
    try {
      const res = await fetch(`/api/skills/list?projectRoot=${encodeURIComponent(projectRoot)}`);
      if (res.ok) {
        const data = await res.json();
        setInstalledSkills(
          new Set<string>(
            (data.skills || []).map((s: any) => String(s.name || "").toLowerCase())
          )
        );
      }
    } catch {}
    setInstalledServers(await listMcpServers(projectRoot));
  };

  useEffect(() => {
    refreshInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKETPLACE_ITEMS.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (domain !== "all" && item.domain !== domain) return false;
      if (q) {
        const haystack = `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [kind, domain, query]);

  const isInstalled = (item: MarketplaceItem) =>
    item.kind === "skill"
      ? installedSkills.has(item.id.toLowerCase())
      : Boolean(installedServers[item.id]);

  const handleInstall = async (item: MarketplaceItem) => {
    setBusyId(item.id);
    setMessage(null);
    const result =
      item.kind === "skill"
        ? await installSkill(item, projectRoot)
        : await installMcpServer(item, projectRoot);
    if (result.ok) {
      setMessage({ text: `Installed ${item.name}`, ok: true });
      await refreshInstalled();
    } else {
      setMessage({ text: result.error || `Could not install ${item.name}`, ok: false });
    }
    setBusyId("");
  };

  const handleUninstall = async (item: MarketplaceItem) => {
    setBusyId(item.id);
    setMessage(null);
    if (item.kind === "mcp") {
      const result = await removeMcpServer(item.id, projectRoot);
      setMessage(
        result.ok
          ? { text: `Removed ${item.name}`, ok: true }
          : { text: result.error || "Could not remove server", ok: false }
      );
      await refreshInstalled();
    } else {
      setMessage({ text: `Skills are managed in .acsa/skills (delete the file to remove)`, ok: false });
    }
    setBusyId("");
  };

  const handleTest = async (item: MarketplaceItem) => {
    setBusyId(item.id);
    setMessage(null);
    const result = await listMcpTools(item.id, projectRoot);
    if (result.ok) {
      setToolsById((prev) => ({ ...prev, [item.id]: result.tools.map((t) => t.name) }));
      setMessage({ text: `${item.name}: ${result.tools.length} tool(s) available`, ok: true });
    } else {
      setMessage({ text: result.error || "Could not list tools", ok: false });
    }
    setBusyId("");
  };

  const kindTabs: Array<{ id: MarketplaceKind | "all"; label: string }> = [
    { id: "all", label: "All" },
    { id: "skill", label: "Skills" },
    { id: "mcp", label: "MCP Servers" },
  ];

  const domains: Array<MarketplaceDomain | "all"> = [
    "all",
    "coding",
    "security",
    "design",
    "memory",
    "research",
    "testing",
    "tooling",
  ];

  return (
    <div className="flex flex-col h-full w-full bg-workbench text-zinc-300">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Marketplace
          </span>
          <button
            type="button"
            onClick={refreshInstalled}
            title="Refresh installed capabilities"
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <Icon icon={RefreshCw} className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills, tools, MCP servers…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2.5 py-1.5 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-purple-500/60"
          />
          <Icon icon={Search} className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
        </div>

        <div className="flex items-center gap-1 mb-2">
          {kindTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setKind(tab.id)}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                kind === tab.id
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {domains.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDomain(d)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                domain === d
                  ? "bg-purple-500/20 text-purple-200 border border-purple-500/40"
                  : "text-zinc-500 hover:text-zinc-200 border border-transparent"
              }`}
            >
              {d === "all" ? "all" : domainLabel(d).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className={`mx-3 mb-2 px-2 py-1.5 rounded-lg text-[10px] border ${
            message.ok
              ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
              : "bg-amber-950/30 border-amber-500/40 text-amber-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {items.length === 0 && (
          <div className="text-[11px] text-zinc-500 text-center py-6">
            No capabilities match your filters.
          </div>
        )}
        {items.map((item) => {
          const installed = isInstalled(item);
          const busy = busyId === item.id;
          const DomainIcon = DOMAIN_ICONS[item.domain] || Package;
          const tools = toolsById[item.id];
          const expanded = expandedId === item.id;
          const links = [
            { label: "Repository", url: item.repo },
            { label: "Docs", url: item.docs },
            { label: "Website", url: item.homepage },
          ].filter((l) => Boolean(l.url));
          const target = installTarget(item, projectRoot);
          const trustTone =
            item.trust === "built-in"
              ? "bg-sky-500/15 text-sky-300"
              : item.trust === "official"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300";
          return (
            <div
              key={item.id}
              className={`rounded-xl border bg-zinc-900/40 transition-colors ${
                expanded ? "border-purple-500/40" : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? "" : item.id)}
                className="w-full text-left p-2.5"
                title={expanded ? "Hide details" : "Show details"}
              >
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                    <Icon icon={DomainIcon} className="w-3.5 h-3.5 text-purple-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-zinc-100 truncate">
                        {item.name}
                      </span>
                      <span
                        className={`px-1 rounded text-[9px] font-mono uppercase ${
                          item.kind === "mcp"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {item.kind === "mcp" ? "mcp" : "skill"}
                      </span>
                      <span className={`px-1 rounded text-[9px] font-mono uppercase ${trustTone}`}>
                        {TRUST_LABEL[item.trust]}
                      </span>
                      {installed && (
                        <span className="px-1 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-300">
                          installed
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[9px] font-mono text-zinc-500">
                        {domainLabel(item.domain).toLowerCase()} · {item.author}
                      </span>
                      {item.license && (
                        <span className="text-[9px] font-mono text-zinc-600">
                          {item.license}
                        </span>
                      )}
                      {item.requires && (
                        <span className="text-[9px] font-mono text-amber-400/80">
                          needs {item.requires}
                        </span>
                      )}
                    </div>
                  </div>
                  <Icon
                    icon={expanded ? ChevronDown : ChevronRight}
                    className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-1"
                  />
                </div>
              </button>

              {expanded && (
                <div className="px-2.5 pb-2.5 space-y-2 border-t border-zinc-800 pt-2">
                  {item.overview && (
                    <p className="text-[10px] text-zinc-400 leading-relaxed">{item.overview}</p>
                  )}

                  {/* Source & credibility */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <Icon icon={ShieldCheck} className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="font-mono">
                        {item.trust === "built-in"
                          ? "Ships with ACSA Code"
                          : item.trust === "official"
                          ? `Published by ${item.author} (upstream maintainer)`
                          : `Third-party — maintained by ${item.author}`}
                      </span>
                    </div>
                    {item.version && (
                      <div className="text-[9px] font-mono text-zinc-500">
                        version: {item.version}
                      </div>
                    )}
                    {links.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {links.map((link) => (
                          <a
                            key={link.label}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-700 text-[9px] font-mono text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                          >
                            {link.label}
                            <Icon icon={ExternalLink} className="w-2.5 h-2.5" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[9px] font-mono text-zinc-600">
                        No external source — bundled with the app.
                      </div>
                    )}
                  </div>

                  {/* What the install actually does */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <Icon icon={FileText} className="w-3 h-3 shrink-0" />
                      <span className="font-mono">What installs</span>
                    </div>
                    <div className="text-[9px] font-mono text-zinc-500 break-all">
                      {target.path}
                    </div>
                    {target.command && (
                      <div className="text-[9px] font-mono text-zinc-400 break-all">
                        runs: <span className="text-zinc-300">{target.command}</span>
                      </div>
                    )}
                    {item.permissions && item.permissions.length > 0 && (
                      <ul className="pt-0.5 space-y-0.5">
                        {item.permissions.map((permission) => (
                          <li
                            key={permission}
                            className="flex items-start gap-1 text-[9px] text-zinc-400"
                          >
                            <span className="text-zinc-600">•</span>
                            <span className="leading-snug">{permission}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Skill body preview */}
                  {item.kind === "skill" && item.skillContent && (
                    <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
                      <summary className="text-[10px] text-zinc-400 cursor-pointer font-mono">
                        Preview SKILL.md
                      </summary>
                      <pre className="mt-1.5 max-h-52 overflow-auto text-[9px] leading-snug text-zinc-400 whitespace-pre-wrap font-mono">
                        {item.skillContent}
                      </pre>
                    </details>
                  )}

                  {/* MCP tools */}
                  {item.kind === "mcp" && (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 space-y-1">
                      <div className="text-[10px] text-zinc-400 font-mono">
                        {tools && tools.length > 0
                          ? `Tools exposed (${tools.length})`
                          : "Tool list"}
                      </div>
                      {tools && tools.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tools.map((tool) => (
                            <span
                              key={tool}
                              className="px-1 py-0.5 rounded bg-zinc-800/70 border border-zinc-700 text-[9px] font-mono text-emerald-300"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[9px] text-zinc-500 leading-snug">
                          {installed
                            ? "Run “Test” to start the server and list its tools."
                            : "Install, then Test to start the server and list its tools."}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    {!installed ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleInstall(item)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
                      >
                        <Icon icon={Download} className="w-3 h-3" />
                        <span>{busy ? "Installing…" : "Install"}</span>
                      </button>
                    ) : (
                      <>
                        {item.kind === "mcp" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTest(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-colors disabled:opacity-50"
                          >
                            <Icon icon={Plug} className="w-3 h-3" />
                            <span>{busy ? "Testing…" : "Test"}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleUninstall(item)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-zinc-800/60 hover:bg-red-900/40 border border-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
                        >
                          <Icon icon={Trash2} className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Where to find more — real, external sources */}
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <Icon icon={Info} className="w-3 h-3 shrink-0" />
            Find more capabilities
          </div>
          {ECOSYSTEM_LINKS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block group"
            >
              <div className="flex items-center gap-1 text-[10px] text-zinc-300 group-hover:text-white">
                <span className="font-medium">{link.label}</span>
                <Icon icon={ExternalLink} className="w-2.5 h-2.5" />
              </div>
              <div className="text-[9px] text-zinc-500 leading-snug">{link.note}</div>
            </a>
          ))}
          <div className="text-[9px] text-zinc-500 leading-snug border-t border-zinc-800 pt-1.5">
            This build connects to <span className="font-mono text-zinc-400">stdio</span> MCP
            servers (a command plus arguments). Remote/HTTP servers are not supported yet, and
            skills are plain <span className="font-mono text-zinc-400">SKILL.md</span> files you
            can also add by hand to <span className="font-mono text-zinc-400">.acsa/skills</span>.
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarketplaceSidebar;
