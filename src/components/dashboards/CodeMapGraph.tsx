/**
 * CodeMapGraph.tsx — interactive codebase map
 *
 * Renders the resolved file graph as a force-directed canvas: files are nodes
 * (sized by weight, coloured by dependency community), imports are links. The
 * point is comprehension — you can see which modules form a cluster, which
 * files everything depends on, and what sits on the periphery.
 *
 * Hovering shows a popup summary in place; clicking selects the file so the
 * parent panel can show its role, symbols and connections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { ArchCommunity, ArchLink, ArchNode } from "../../services/codeGraph";

interface CodeMapGraphProps {
  nodes: ArchNode[];
  links: ArchLink[];
  communities: ArchCommunity[];
  hiddenCommunities: Set<number>;
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Dim everything except nodes matching this predicate. */
  depthFocus?: { root: string; paths: Set<string> } | null;
}

/** Node plus the layout coordinates force-graph mutates onto each node. */
type LayoutNode = ArchNode & { x?: number; y?: number };

interface HoverState {
  node: LayoutNode;
  x: number;
  y: number;
}

const DIM_ALPHA = 0.12;

export function CodeMapGraph({
  nodes,
  links,
  hiddenCommunities,
  query,
  selectedPath,
  onSelect,
  depthFocus = null,
}: CodeMapGraphProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<LayoutNode | null>(null);
  const fittedRef = useRef(false);

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<HoverState | null>(null);

  // Track the container size so the canvas fills whatever space it is given.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(() => {
    const kept = nodes.filter((n) => !hiddenCommunities.has(n.community));
    const ids = new Set(kept.map((n) => n.id));
    return { nodes: kept, ids };
  }, [nodes, hiddenCommunities]);

  const graphData = useMemo(
    () => ({
      nodes: visible.nodes,
      links: links.filter(
        (l) =>
          visible.ids.has(typeof l.source === "string" ? l.source : (l.source as any).id) &&
          visible.ids.has(typeof l.target === "string" ? l.target : (l.target as any).id)
      ),
    }),
    [visible, links]
  );

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(nodes.filter((n) => n.path.toLowerCase().includes(q)).map((n) => n.id));
  }, [nodes, query]);

  const isActive = useCallback(
    (node: ArchNode): boolean => {
      if (depthFocus && !depthFocus.paths.has(node.path)) return false;
      if (matched && !matched.has(node.id)) return false;
      return true;
    },
    [depthFocus, matched]
  );

  const anyFocus = Boolean(matched || depthFocus);

  const radiusFor = useCallback((node: ArchNode, globalScale: number) => {
    const base = Math.sqrt(node.val) * 1.7;
    // Keep nodes legible when zoomed out.
    return Math.max(2.2, Math.min(base, 26 / Math.max(globalScale, 0.4)));
  }, []);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const arch = node as LayoutNode;
      const active = isActive(arch);
      const radius = radiusFor(arch, globalScale);
      const isSelected = selectedPath === arch.path;
      const isHovered = hoverRef.current?.path === arch.path;

      ctx.beginPath();
      ctx.arc(arch.x ?? 0, arch.y ?? 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = active ? arch.color : arch.color + "1f";
      ctx.globalAlpha = active ? (isHovered || isSelected ? 1 : 0.92) : DIM_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (arch.isEntrypoint) {
        ctx.beginPath();
        ctx.arc(arch.x ?? 0, arch.y ?? 0, radius + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 1.4 / globalScale;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(arch.x ?? 0, arch.y ?? 0, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.6 / globalScale;
        ctx.stroke();
      }

      // Label the nodes that matter at the current zoom: hubs, entrypoints,
      // anything focused, and (when zoomed in) ordinary files.
      const showLabel =
        active &&
        (isHovered ||
          isSelected ||
          arch.isEntrypoint ||
          arch.dependents >= 4 ||
          globalScale > 1.5);
      if (showLabel) {
        const fontSize = Math.max(9 / globalScale, 2.4);
        ctx.font = `${fontSize}px var(--ide-font-family, ui-monospace, monospace)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = active ? "rgba(228,228,231,0.92)" : "rgba(120,120,130,0.4)";
        ctx.fillText(arch.label, arch.x ?? 0, (arch.y ?? 0) + radius + 1.5);
      }
    },
    [isActive, radiusFor, selectedPath]
  );

  const nodePointerAreaPaint = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const arch = node as LayoutNode;
      const radius = Math.max(radiusFor(arch, globalScale), 4);
      ctx.beginPath();
      ctx.arc(arch.x ?? 0, arch.y ?? 0, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [radiusFor]
  );

  const handleHover = useCallback((node: any) => {
    hoverRef.current = (node as LayoutNode) || null;
    setHover(node ? { node: node as LayoutNode, x: 0, y: 0 } : null);
  }, []);

  // Follow the hovered node without re-rendering React every frame.
  const handleFramePost = useCallback(() => {
    const node = hoverRef.current;
    const el = tooltipRef.current;
    if (!node || !el || !graphRef.current) return;
    try {
      const { x, y } = graphRef.current.graph2ScreenCoords(node.x ?? 0, node.y ?? 0);
      el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 10)}px)`;
    } catch {
      /* graph not laid out yet */
    }
  }, []);

  const handleEngineStop = useCallback(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    try {
      graphRef.current?.zoomToFit(500, 70, (n: any) => isActive(n as ArchNode));
    } catch {
      /* nothing to fit */
    }
  }, [isActive]);

  // Tame the default forces: the stock charge flings disconnected files far
  // away, so a zoom-to-fit ends up shrinking the whole map to a dot.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as any;
    charge?.strength(-34)?.distanceMax?.(260);
    const link = fg.d3Force("link") as any;
    link?.distance?.(34);
    const center = fg.d3Force("center") as any;
    center?.strength?.(0.12);
    try {
      fg.d3ReheatSimulation();
    } catch {
      /* older builds */
    }
  }, [graphData]);

  // Re-fit when the lens changes to a completely different node set.
  useEffect(() => {
    fittedRef.current = false;
  }, [hiddenCommunities, depthFocus]);

  return (
    <div ref={wrapRef} className="relative h-full w-full bg-[#0d0d10] rounded-xl border border-hairline overflow-hidden">
      <ForceGraph2D
        ref={graphRef as any}
        width={size.width}
        height={size.height}
        graphData={graphData as any}
        backgroundColor="#0d0d10"
        nodeId="id"
        nodeRelSize={4}
        nodeCanvasObject={nodeCanvasObject as any}
        nodePointerAreaPaint={nodePointerAreaPaint as any}
        linkColor={(link: any) => {
          const src = typeof link.source === "object" ? link.source : null;
          const tgt = typeof link.target === "object" ? link.target : null;
          const active =
            !anyFocus ||
            (isActive(src as ArchNode) && isActive(tgt as ArchNode));
          return active ? "rgba(120,130,150,0.35)" : "rgba(90,95,110,0.06)";
        }}
        linkWidth={0.6}
        linkDirectionalArrowLength={2.6}
        linkDirectionalArrowRelPos={0.92}
        onNodeClick={(node: any) => onSelect((node as ArchNode).path)}
        onNodeHover={handleHover}
        onRenderFramePost={handleFramePost}
        onEngineStop={handleEngineStop}
        warmupTicks={30}
        cooldownTicks={120}
        d3AlphaDecay={0.028}
        enableNodeDrag
        enablePointerInteraction
      />

      {/* Hover popup — positioned imperatively so panning stays smooth. */}
      {hover && (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute left-0 top-0 z-10 max-w-[300px] rounded-lg border border-zinc-700/80 bg-[#16161a]/95 px-2.5 py-2 shadow-xl backdrop-blur-sm"
        >
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: hover.node.color }}
            />
            <span className="text-[11px] font-mono text-zinc-100 truncate">
              {hover.node.path}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400 font-mono">
            {hover.node.language || "unknown"} · {hover.node.lines} lines ·{" "}
            {hover.node.symbols} symbols
          </div>
          <div className="text-[10px] text-zinc-400 font-mono">
            {hover.node.dependents} importer(s) · imports {hover.node.imports}
          </div>
          {hover.node.isEntrypoint && (
            <div className="mt-0.5 text-[10px] text-amber-300">Application entry point</div>
          )}
          <div className="mt-1 text-[10px] text-zinc-500">Click for details</div>
        </div>
      )}

      {/* Legend / controls hint */}
      <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-zinc-500 font-mono">
        drag to pan · scroll to zoom · click a file for its role
      </div>
    </div>
  );
}

export default CodeMapGraph;
