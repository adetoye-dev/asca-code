"use strict";

/**
 * graph_manager.js — Project-Wide AST Dependency Graph Engine
 *
 * Maintains a directed graph of code entities (files, functions, components,
 * schemas, endpoints, state variables) and their structural relationships.
 * Provides backward blast-radius tracing for the reactive invalidation engine
 * so the system knows exactly which downstream dependents are affected when a
 * node's code signature mutates.
 *
 * Design constraints
 * ──────────────────
 * 1. Zero external dependencies — runs in any Node ≥ 18 or Bun runtime.
 * 2. All mutations return immutable result snapshots (no leaking internal refs).
 * 3. Cycle-safe traversals — every walk tracks a visited set.
 * 4. Deterministic ordering — adjacency lists are insertion-ordered Maps.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_TYPES = Object.freeze(
  /** @type {const} */ ({
    FILE: "file",
    FUNCTION: "function",
    COMPONENT: "component",
    SCHEMA: "schema",
    ENDPOINT: "endpoint",
    STATE_VARIABLE: "state_variable",
  })
);

const EDGE_TYPES = Object.freeze(
  /** @type {const} */ ({
    IMPORT: "structural_import",
    /** file → file edge for a resolved project-local import. */
    FILE_IMPORT: "file_import",
    DATA_FLOW: "data_flow_call",
    SCHEMA_SUB: "schema_subscription",
    PROP_READ: "property_read",
  })
);

const CHANGE_KINDS = Object.freeze(
  /** @type {const} */ ({
    BODY_ONLY: "body_only",
    SIGNATURE: "signature_change",
    SCHEMA: "schema_change",
  })
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString();
}

function log(level, component, message, meta = {}) {
  const entry = {
    ts: timestamp(),
    level,
    component,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = deepClone(v);
  }
  return out;
}

function validateNodeType(type) {
  const valid = Object.values(NODE_TYPES);
  if (!valid.includes(type)) {
    throw new TypeError(
      `Invalid node type "${type}". Must be one of: ${valid.join(", ")}`
    );
  }
}

function validateEdgeType(type) {
  const valid = Object.values(EDGE_TYPES);
  if (!valid.includes(type)) {
    throw new TypeError(
      `Invalid edge type "${type}". Must be one of: ${valid.join(", ")}`
    );
  }
}

// ─── Core Graph Engine ──────────────────────────────────────────────────────

class ProjectDependencyGraph {
  constructor() {
    /** @type {Map<string, object>} nodeId → node metadata */
    this._nodes = new Map();

    /** @type {Map<string, Map<string, object>>} sourceId → Map<targetId, edgeMeta> */
    this._forwardAdj = new Map();

    /** @type {Map<string, Map<string, object>>} targetId → Map<sourceId, edgeMeta> */
    this._reverseAdj = new Map();

    /** @type {Map<string, string>} nodeId → signature hash for change detection */
    this._signatureCache = new Map();

    log("info", "GraphManager", "Dependency graph initialized");
  }

  // ── Node Operations ─────────────────────────────────────────────────────

  /**
   * Register a code entity in the graph.
   *
   * @param {string} id        Unique node identifier (e.g. "src/utils/auth.ts::validateToken")
   * @param {string} type      One of NODE_TYPES
   * @param {object} metadata  Arbitrary metadata: filePath, startLine, endLine, signatureHash, …
   * @returns {object}         Frozen snapshot of the created node
   */
  addNode(id, type, metadata = {}) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("Node id must be a non-empty string");
    }
    validateNodeType(type);

    if (this._nodes.has(id)) {
      throw new Error(`Node "${id}" already exists. Use updateNode() to mutate.`);
    }

    const node = Object.freeze({
      id,
      type,
      filePath: metadata.filePath || null,
      startLine: Number.isFinite(metadata.startLine) ? metadata.startLine : null,
      endLine: Number.isFinite(metadata.endLine) ? metadata.endLine : null,
      signatureHash: metadata.signatureHash || null,
      meta: Object.freeze(deepClone(metadata)),
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });

    this._nodes.set(id, node);
    this._forwardAdj.set(id, new Map());
    this._reverseAdj.set(id, new Map());

    if (node.signatureHash) {
      this._signatureCache.set(id, node.signatureHash);
    }

    log("info", "GraphManager", `Node added: ${id}`, { type });
    return deepClone(node);
  }

  /**
   * Update an existing node's metadata and optionally its signature hash.
   *
   * @param {string} id              Node identifier
   * @param {object} patchMetadata   Fields to merge into the existing metadata
   * @returns {{ node: object, changeKind: string }}
   */
  updateNode(id, patchMetadata = {}) {
    const existing = this._nodes.get(id);
    if (!existing) {
      throw new Error(`Node "${id}" does not exist`);
    }

    const newSignature = patchMetadata.signatureHash || existing.signatureHash;
    const oldSignature = this._signatureCache.get(id) || null;

    let changeKind = CHANGE_KINDS.BODY_ONLY;
    if (newSignature !== oldSignature) {
      changeKind =
        existing.type === NODE_TYPES.SCHEMA
          ? CHANGE_KINDS.SCHEMA
          : CHANGE_KINDS.SIGNATURE;
    }

    const merged = {
      ...existing,
      filePath:
        patchMetadata.filePath !== undefined
          ? patchMetadata.filePath
          : existing.filePath,
      startLine:
        patchMetadata.startLine !== undefined
          ? patchMetadata.startLine
          : existing.startLine,
      endLine:
        patchMetadata.endLine !== undefined
          ? patchMetadata.endLine
          : existing.endLine,
      signatureHash: newSignature,
      meta: Object.freeze({
        ...deepClone(existing.meta),
        ...deepClone(patchMetadata),
      }),
      updatedAt: timestamp(),
    };

    const frozen = Object.freeze(merged);
    this._nodes.set(id, frozen);

    if (newSignature) {
      this._signatureCache.set(id, newSignature);
    }

    log("info", "GraphManager", `Node updated: ${id}`, { changeKind });
    return { node: deepClone(frozen), changeKind };
  }

  /**
   * Remove a node and all its incident edges.
   *
   * @param {string} id
   * @returns {boolean}
   */
  removeNode(id) {
    if (!this._nodes.has(id)) {
      log("warn", "GraphManager", `removeNode: "${id}" not found`);
      return false;
    }

    const forward = this._forwardAdj.get(id);
    if (forward) {
      for (const targetId of forward.keys()) {
        const rev = this._reverseAdj.get(targetId);
        if (rev) rev.delete(id);
      }
    }

    const reverse = this._reverseAdj.get(id);
    if (reverse) {
      for (const sourceId of reverse.keys()) {
        const fwd = this._forwardAdj.get(sourceId);
        if (fwd) fwd.delete(id);
      }
    }

    this._forwardAdj.delete(id);
    this._reverseAdj.delete(id);
    this._nodes.delete(id);
    this._signatureCache.delete(id);

    log("info", "GraphManager", `Node removed: ${id}`);
    return true;
  }

  /**
   * Retrieve a node by id.
   *
   * @param {string} id
   * @returns {object|null}
   */
  getNode(id) {
    const node = this._nodes.get(id);
    return node ? deepClone(node) : null;
  }

  /**
   * Return all registered nodes as an array of snapshots.
   *
   * @returns {object[]}
   */
  getAllNodes() {
    return Array.from(this._nodes.values()).map(deepClone);
  }

  // ── Edge Operations ─────────────────────────────────────────────────────

  /**
   * Create a directed edge from `sourceId` to `targetId`.
   *
   * @param {string} sourceId
   * @param {string} targetId
   * @param {string} edgeType  One of EDGE_TYPES
   * @param {object} metadata  Optional metadata (weight, label, lineRef, …)
   * @returns {object}         Frozen edge descriptor
   */
  addEdge(sourceId, targetId, edgeType, metadata = {}) {
    if (!this._nodes.has(sourceId)) {
      throw new Error(`Source node "${sourceId}" does not exist`);
    }
    if (!this._nodes.has(targetId)) {
      throw new Error(`Target node "${targetId}" does not exist`);
    }
    if (sourceId === targetId) {
      throw new Error("Self-loops are not permitted");
    }
    validateEdgeType(edgeType);

    const existing = this._forwardAdj.get(sourceId);
    if (existing && existing.has(targetId)) {
      throw new Error(
        `Edge "${sourceId}" → "${targetId}" already exists. Use updateEdge() to mutate.`
      );
    }

    const edge = Object.freeze({
      source: sourceId,
      target: targetId,
      edgeType,
      meta: Object.freeze(deepClone(metadata)),
      createdAt: timestamp(),
    });

    this._forwardAdj.get(sourceId).set(targetId, edge);
    this._reverseAdj.get(targetId).set(sourceId, edge);

    log("info", "GraphManager", `Edge added: ${sourceId} → ${targetId}`, {
      edgeType,
    });
    return deepClone(edge);
  }

  /**
   * Remove a directed edge.
   *
   * @param {string} sourceId
   * @param {string} targetId
   * @returns {boolean}
   */
  removeEdge(sourceId, targetId) {
    const fwd = this._forwardAdj.get(sourceId);
    if (!fwd || !fwd.has(targetId)) {
      log(
        "warn",
        "GraphManager",
        `removeEdge: "${sourceId}" → "${targetId}" not found`
      );
      return false;
    }
    fwd.delete(targetId);
    const rev = this._reverseAdj.get(targetId);
    if (rev) rev.delete(sourceId);

    log("info", "GraphManager", `Edge removed: ${sourceId} → ${targetId}`);
    return true;
  }

  /**
   * Get all outgoing edges from a node.
   *
   * @param {string} id
   * @returns {object[]}
   */
  getOutEdges(id) {
    const adj = this._forwardAdj.get(id);
    if (!adj) return [];
    return Array.from(adj.values()).map(deepClone);
  }

  /**
   * Get all incoming edges to a node.
   *
   * @param {string} id
   * @returns {object[]}
   */
  getInEdges(id) {
    const adj = this._reverseAdj.get(id);
    if (!adj) return [];
    return Array.from(adj.values()).map(deepClone);
  }

  // ── Blast-Radius Tracing ────────────────────────────────────────────────

  /**
   * Given a mutated node, walk **backward** along reverse edges to collect
   * every upstream dependent that would be invalidated by a signature change.
   *
   * For body-only changes the blast radius is empty — no downstream consumer
   * is affected because the interface contract is intact.
   *
   * @param {string}  targetId    The node whose code was mutated
   * @param {string}  changeKind  One of CHANGE_KINDS
   * @param {object}  options
   * @param {number}  [options.maxDepth=Infinity]  Maximum traversal depth
   * @param {Set<string>} [options.edgeFilter]     If provided, only follow these EDGE_TYPES
   * @returns {{ invalidatedNodes: object[], invalidatedFilePaths: string[], traversalDepth: number }}
   */
  traceBlastRadius(targetId, changeKind, options = {}) {
    if (!this._nodes.has(targetId)) {
      throw new Error(`Node "${targetId}" does not exist`);
    }

    if (changeKind === CHANGE_KINDS.BODY_ONLY) {
      log(
        "info",
        "GraphManager",
        `Blast radius for "${targetId}": body-only change — no invalidation`
      );
      return {
        invalidatedNodes: [],
        invalidatedFilePaths: [],
        traversalDepth: 0,
      };
    }

    const maxDepth =
      Number.isFinite(options.maxDepth) && options.maxDepth > 0
        ? options.maxDepth
        : Infinity;
    const edgeFilter = options.edgeFilter instanceof Set ? options.edgeFilter : null;

    const visited = new Set();
    const invalidated = [];
    let deepestLevel = 0;

    const queue = [{ nodeId: targetId, depth: 0 }];
    visited.add(targetId);

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift();

      if (depth > 0) {
        const node = this._nodes.get(nodeId);
        if (node) {
          invalidated.push(deepClone(node));
        }
      }

      if (depth >= maxDepth) continue;

      const incomingEdges = this._reverseAdj.get(nodeId);
      if (!incomingEdges) continue;

      for (const [sourceId, edge] of incomingEdges) {
        if (visited.has(sourceId)) continue;
        if (edgeFilter && !edgeFilter.has(edge.edgeType)) continue;

        visited.add(sourceId);
        const nextDepth = depth + 1;
        if (nextDepth > deepestLevel) deepestLevel = nextDepth;
        queue.push({ nodeId: sourceId, depth: nextDepth });
      }
    }

    const filePathSet = new Set();
    for (const node of invalidated) {
      if (node.filePath) {
        filePathSet.add(node.filePath);
      }
    }

    const result = {
      invalidatedNodes: invalidated,
      invalidatedFilePaths: Array.from(filePathSet).sort(),
      traversalDepth: deepestLevel,
    };

    log("info", "GraphManager", `Blast radius for "${targetId}"`, {
      changeKind,
      invalidatedCount: invalidated.length,
      fileCount: result.invalidatedFilePaths.length,
      depth: deepestLevel,
    });

    return result;
  }

  // ── Context Pruning ─────────────────────────────────────────────────────

  /**
   * For a given set of invalidated nodes, return a minimal context payload
   * with exact file paths and line ranges — never the entire codebase.
   *
   * @param {object[]} invalidatedNodes  Array of node snapshots from traceBlastRadius
   * @returns {object[]}  Array of { filePath, startLine, endLine, nodeId, nodeType }
   */
  pruneContext(invalidatedNodes) {
    if (!Array.isArray(invalidatedNodes)) {
      throw new TypeError("invalidatedNodes must be an array");
    }

    const contextSlices = [];
    const seen = new Set();

    for (const node of invalidatedNodes) {
      if (!node || !node.id) continue;
      if (seen.has(node.id)) continue;
      seen.add(node.id);

      if (!node.filePath) continue;

      contextSlices.push({
        filePath: node.filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        nodeId: node.id,
        nodeType: node.type,
      });
    }

    contextSlices.sort((a, b) => {
      const fp = a.filePath.localeCompare(b.filePath);
      if (fp !== 0) return fp;
      return (a.startLine || 0) - (b.startLine || 0);
    });

    log("info", "GraphManager", "Context pruned", {
      sliceCount: contextSlices.length,
    });

    return contextSlices;
  }

  // ── Topological Ordering ────────────────────────────────────────────────

  /**
   * Return a topological ordering of the graph using Kahn's algorithm.
   * Throws if the graph contains a cycle.
   *
   * @returns {string[]} Node IDs in topological order
   */
  topologicalSort() {
    const inDegree = new Map();
    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
    }

    for (const [, targets] of this._forwardAdj) {
      for (const targetId of targets.keys()) {
        inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);

      const neighbors = this._forwardAdj.get(current);
      if (neighbors) {
        for (const neighborId of neighbors.keys()) {
          const newDeg = inDegree.get(neighborId) - 1;
          inDegree.set(neighborId, newDeg);
          if (newDeg === 0) queue.push(neighborId);
        }
      }
    }

    if (sorted.length !== this._nodes.size) {
      const cycleMembers = [];
      for (const [id, deg] of inDegree) {
        if (deg > 0) cycleMembers.push(id);
      }
      throw new Error(
        `Graph contains a cycle involving nodes: ${cycleMembers.join(", ")}`
      );
    }

    return sorted;
  }

  // ── Cycle Detection ─────────────────────────────────────────────────────

  /**
   * Detect all cycles in the graph using iterative DFS with explicit stack.
   *
   * @returns {{ hasCycle: boolean, cycles: string[][] }}
   */
  detectCycles() {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map();
    const parent = new Map();
    for (const id of this._nodes.keys()) {
      color.set(id, WHITE);
      parent.set(id, null);
    }

    const cycles = [];

    for (const startId of this._nodes.keys()) {
      if (color.get(startId) !== WHITE) continue;

      const stack = [{ nodeId: startId, neighborIter: null }];
      color.set(startId, GRAY);

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];

        if (!frame.neighborIter) {
          const adj = this._forwardAdj.get(frame.nodeId);
          frame.neighborIter = adj ? adj.keys() : [][Symbol.iterator]();
        }

        const next = frame.neighborIter.next();
        if (next.done) {
          color.set(frame.nodeId, BLACK);
          stack.pop();
          continue;
        }

        const neighborId = next.value;

        if (color.get(neighborId) === GRAY) {
          const cycle = [neighborId];
          for (let i = stack.length - 1; i >= 0; i--) {
            cycle.push(stack[i].nodeId);
            if (stack[i].nodeId === neighborId) break;
          }
          cycle.reverse();
          cycles.push(cycle);
        } else if (color.get(neighborId) === WHITE) {
          color.set(neighborId, GRAY);
          parent.set(neighborId, frame.nodeId);
          stack.push({ nodeId: neighborId, neighborIter: null });
        }
      }
    }

    const result = { hasCycle: cycles.length > 0, cycles };
    if (result.hasCycle) {
      log("warn", "GraphManager", "Cycles detected", {
        count: cycles.length,
      });
    }
    return result;
  }

  // ── Graph Statistics ────────────────────────────────────────────────────

  /**
   * Return summary statistics about the current graph.
   *
   * @returns {object}
   */
  stats() {
    let edgeCount = 0;
    for (const adj of this._forwardAdj.values()) {
      edgeCount += adj.size;
    }

    const typeCounts = {};
    for (const node of this._nodes.values()) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    }

    return {
      nodeCount: this._nodes.size,
      edgeCount,
      typeCounts,
    };
  }

  // ── Serialization ───────────────────────────────────────────────────────

  /**
   * Export the graph as a plain JSON-serializable object.
   *
   * @returns {object}
   */
  toJSON() {
    const nodes = [];
    for (const node of this._nodes.values()) {
      nodes.push(deepClone(node));
    }

    const edges = [];
    for (const adj of this._forwardAdj.values()) {
      for (const edge of adj.values()) {
        edges.push(deepClone(edge));
      }
    }

    return { nodes, edges, exportedAt: timestamp() };
  }

  /**
   * Rebuild the graph from a previously exported JSON object.
   *
   * @param {object} data  Output of toJSON()
   * @returns {ProjectDependencyGraph}
   */
  static fromJSON(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new TypeError("Invalid graph JSON: expected { nodes, edges }");
    }

    const graph = new ProjectDependencyGraph();

    for (const n of data.nodes) {
      const meta = { ...(n.meta || {}), signatureHash: n.signatureHash };
      meta.filePath = n.filePath;
      meta.startLine = n.startLine;
      meta.endLine = n.endLine;

      graph._nodes.set(
        n.id,
        Object.freeze({
          id: n.id,
          type: n.type,
          filePath: n.filePath || null,
          startLine: n.startLine ?? null,
          endLine: n.endLine ?? null,
          signatureHash: n.signatureHash || null,
          meta: Object.freeze(deepClone(n.meta || {})),
          createdAt: n.createdAt || timestamp(),
          updatedAt: n.updatedAt || timestamp(),
        })
      );
      graph._forwardAdj.set(n.id, new Map());
      graph._reverseAdj.set(n.id, new Map());

      if (n.signatureHash) {
        graph._signatureCache.set(n.id, n.signatureHash);
      }
    }

    for (const e of data.edges) {
      if (!graph._nodes.has(e.source) || !graph._nodes.has(e.target)) {
        log(
          "warn",
          "GraphManager",
          `fromJSON: skipping dangling edge ${e.source} → ${e.target}`
        );
        continue;
      }

      const edge = Object.freeze({
        source: e.source,
        target: e.target,
        edgeType: e.edgeType,
        meta: Object.freeze(deepClone(e.meta || {})),
        createdAt: e.createdAt || timestamp(),
      });

      graph._forwardAdj.get(e.source).set(e.target, edge);
      graph._reverseAdj.get(e.target).set(e.source, edge);
    }

    log("info", "GraphManager", "Graph restored from JSON", {
      nodes: data.nodes.length,
      edges: data.edges.length,
    });

    return graph;
  }

  /**
   * Clear the entire graph state.
   */
  clear() {
    this._nodes.clear();
    this._forwardAdj.clear();
    this._reverseAdj.clear();
    this._signatureCache.clear();
    log("info", "GraphManager", "Graph cleared");
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  ProjectDependencyGraph,
  NODE_TYPES,
  EDGE_TYPES,
  CHANGE_KINDS,
};

export default ProjectDependencyGraph;
