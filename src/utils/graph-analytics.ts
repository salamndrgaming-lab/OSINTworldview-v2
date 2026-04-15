/**
 * Graph Analytics Engine — Palantir-grade intelligence graph analysis
 *
 * Pure computational module with no DOM or rendering dependencies.
 * Operates on adjacency-list representations for O(V+E) traversals.
 *
 * Capabilities:
 *  - Degree centrality (in/out/total)
 *  - Betweenness centrality (Brandes' algorithm)
 *  - PageRank (iterative power method)
 *  - Community detection (Louvain method)
 *  - Shortest path (Dijkstra with edge weights)
 *  - Clustering coefficient (local + global)
 *  - Bridge detection (edges whose removal disconnects components)
 *  - Influence propagation scoring
 */

// ── Types ──────────────────────────────────────────────────────

export interface AnalyticsNode {
  id: string;
  [key: string]: unknown;
}

export interface AnalyticsEdge {
  source: string;
  target: string;
  weight?: number;
  [key: string]: unknown;
}

export interface AnalyticsGraph {
  nodes: AnalyticsNode[];
  edges: AnalyticsEdge[];
}

export interface DegreeCentrality {
  nodeId: string;
  degree: number;
  inDegree: number;
  outDegree: number;
  normalized: number;
}

export interface BetweennessResult {
  nodeId: string;
  betweenness: number;
  normalized: number;
}

export interface PageRankResult {
  nodeId: string;
  rank: number;
}

export interface Community {
  id: number;
  members: string[];
  size: number;
  /** Internal edge density */
  density: number;
}

export interface CommunityAssignment {
  nodeId: string;
  communityId: number;
}

export interface ShortestPath {
  from: string;
  to: string;
  distance: number;
  path: string[];
}

export interface ClusteringResult {
  nodeId: string;
  coefficient: number;
}

export interface BridgeEdge {
  source: string;
  target: string;
  /** Components created if this edge is removed */
  componentDelta: number;
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  avgDegree: number;
  avgClustering: number;
  componentCount: number;
  diameter: number;
  avgPathLength: number;
}

// ── Adjacency helpers ─────────────────────────────────────────

type AdjList = Map<string, Map<string, number>>;

function buildAdjacency(graph: AnalyticsGraph, directed = false): AdjList {
  const adj: AdjList = new Map();

  for (const node of graph.nodes) {
    if (!adj.has(node.id)) adj.set(node.id, new Map());
  }

  for (const edge of graph.edges) {
    const w = edge.weight ?? 1;
    if (!adj.has(edge.source)) adj.set(edge.source, new Map());
    if (!adj.has(edge.target)) adj.set(edge.target, new Map());

    const existing = adj.get(edge.source)!.get(edge.target) ?? Infinity;
    adj.get(edge.source)!.set(edge.target, Math.min(existing, w));

    if (!directed) {
      const existingRev = adj.get(edge.target)!.get(edge.source) ?? Infinity;
      adj.get(edge.target)!.set(edge.source, Math.min(existingRev, w));
    }
  }

  return adj;
}

function buildInAdjacency(graph: AnalyticsGraph): AdjList {
  const adj: AdjList = new Map();
  for (const node of graph.nodes) {
    if (!adj.has(node.id)) adj.set(node.id, new Map());
  }
  for (const edge of graph.edges) {
    const w = edge.weight ?? 1;
    if (!adj.has(edge.target)) adj.set(edge.target, new Map());
    adj.get(edge.target)!.set(edge.source, w);
  }
  return adj;
}

// ── Degree Centrality ─────────────────────────────────────────

export function degreeCentrality(graph: AnalyticsGraph): DegreeCentrality[] {
  const n = graph.nodes.length;
  if (n === 0) return [];

  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const node of graph.nodes) {
    outDeg.set(node.id, 0);
    inDeg.set(node.id, 0);
  }

  for (const edge of graph.edges) {
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }

  const maxDeg = n > 1 ? n - 1 : 1;
  return graph.nodes.map(node => {
    const out = outDeg.get(node.id) ?? 0;
    const ind = inDeg.get(node.id) ?? 0;
    const total = out + ind;
    return {
      nodeId: node.id,
      degree: total,
      inDegree: ind,
      outDegree: out,
      normalized: total / maxDeg,
    };
  });
}

// ── Betweenness Centrality (Brandes' O(VE) algorithm) ─────────

export function betweennessCentrality(graph: AnalyticsGraph): BetweennessResult[] {
  const adj = buildAdjacency(graph);
  const nodeIds = graph.nodes.map(n => n.id);
  const n = nodeIds.length;
  if (n < 3) {
    return nodeIds.map(id => ({ nodeId: id, betweenness: 0, normalized: 0 }));
  }

  const cb = new Map<string, number>();
  for (const id of nodeIds) cb.set(id, 0);

  for (const s of nodeIds) {
    // BFS from s
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    const delta = new Map<string, number>();

    for (const v of nodeIds) {
      pred.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
      delta.set(v, 0);
    }
    sigma.set(s, 1);
    dist.set(s, 0);

    const queue: string[] = [s];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const neighbors = adj.get(v);
      if (!neighbors) continue;

      for (const [w] of neighbors) {
        // w found for the first time?
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        // shortest path to w via v?
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    // Accumulation
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + contribution);
      }
      if (w !== s) {
        cb.set(w, cb.get(w)! + delta.get(w)!);
      }
    }
  }

  // Normalize: undirected graph divides by 2
  const normFactor = n > 2 ? (n - 1) * (n - 2) : 1;
  for (const [id, val] of cb) {
    cb.set(id, val / 2); // undirected correction
  }

  return nodeIds.map(id => ({
    nodeId: id,
    betweenness: cb.get(id) ?? 0,
    normalized: (cb.get(id) ?? 0) / normFactor,
  }));
}

// ── PageRank (power iteration) ────────────────────────────────

export function pageRank(
  graph: AnalyticsGraph,
  options?: { damping?: number; iterations?: number; tolerance?: number },
): PageRankResult[] {
  const d = options?.damping ?? 0.85;
  const maxIter = options?.iterations ?? 100;
  const tol = options?.tolerance ?? 1e-6;

  const nodeIds = graph.nodes.map(n => n.id);
  const n = nodeIds.length;
  if (n === 0) return [];

  const inAdj = buildInAdjacency(graph);

  // Count outgoing edges per node
  const outDeg = new Map<string, number>();
  for (const id of nodeIds) outDeg.set(id, 0);
  for (const edge of graph.edges) {
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
  }

  // Initialize ranks uniformly
  let ranks = new Map<string, number>();
  for (const id of nodeIds) ranks.set(id, 1 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const newRanks = new Map<string, number>();
    let diff = 0;

    // Dangling node contribution (nodes with no outgoing edges)
    let danglingSum = 0;
    for (const id of nodeIds) {
      if ((outDeg.get(id) ?? 0) === 0) {
        danglingSum += ranks.get(id) ?? 0;
      }
    }

    for (const id of nodeIds) {
      let inSum = 0;
      const inNeighbors = inAdj.get(id);
      if (inNeighbors) {
        for (const [src] of inNeighbors) {
          const srcOut = outDeg.get(src) ?? 1;
          inSum += (ranks.get(src) ?? 0) / srcOut;
        }
      }

      const rank = (1 - d) / n + d * (inSum + danglingSum / n);
      newRanks.set(id, rank);
      diff += Math.abs(rank - (ranks.get(id) ?? 0));
    }

    ranks = newRanks;
    if (diff < tol) break;
  }

  return nodeIds.map(id => ({
    nodeId: id,
    rank: ranks.get(id) ?? 0,
  }));
}

// ── Community Detection (Louvain Method) ──────────────────────

export function detectCommunities(graph: AnalyticsGraph): {
  assignments: CommunityAssignment[];
  communities: Community[];
  modularity: number;
} {
  const nodeIds = graph.nodes.map(n => n.id);
  const n = nodeIds.length;
  if (n === 0) return { assignments: [], communities: [], modularity: 0 };

  // Build weighted adjacency for modularity computation
  const adj = buildAdjacency(graph);
  let totalWeight = 0;
  for (const edge of graph.edges) {
    totalWeight += (edge.weight ?? 1) * 2; // undirected: count each edge twice
  }
  if (totalWeight === 0) totalWeight = 1;

  // Node → weighted degree
  const k = new Map<string, number>();
  for (const id of nodeIds) {
    let deg = 0;
    const neighbors = adj.get(id);
    if (neighbors) {
      for (const [, w] of neighbors) deg += w;
    }
    k.set(id, deg);
  }

  // Initialize: each node in its own community
  const community = new Map<string, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    community.set(nodeIds[i]!, i);
  }

  // Community → total internal weight and total degree
  const commDegree = new Map<number, number>();
  const commInternal = new Map<number, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    commDegree.set(i, k.get(nodeIds[i]!) ?? 0);
    commInternal.set(i, 0);
  }

  // Phase 1: Local moves for modularity optimization
  let improved = true;
  let passes = 0;
  const maxPasses = 20;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;

    for (const nodeId of nodeIds) {
      const nodeCom = community.get(nodeId)!;
      const nodeK = k.get(nodeId) ?? 0;
      const neighbors = adj.get(nodeId);
      if (!neighbors || neighbors.size === 0) continue;

      // Compute weight to each neighboring community
      const neighborComWeights = new Map<number, number>();
      let weightToOwnCom = 0;

      for (const [neighborId, w] of neighbors) {
        const neighborCom = community.get(neighborId)!;
        neighborComWeights.set(neighborCom, (neighborComWeights.get(neighborCom) ?? 0) + w);
        if (neighborCom === nodeCom) weightToOwnCom += w;
      }

      // Try removing node from current community
      const removeDelta = -2 * (weightToOwnCom - (((commDegree.get(nodeCom) ?? 0) - nodeK) * nodeK) / totalWeight);

      let bestCom = nodeCom;
      let bestDelta = 0;

      for (const [targetCom, weightToTarget] of neighborComWeights) {
        if (targetCom === nodeCom) continue;
        const insertDelta = 2 * (weightToTarget - ((commDegree.get(targetCom) ?? 0) * nodeK) / totalWeight);
        const totalDelta = removeDelta + insertDelta;
        if (totalDelta > bestDelta) {
          bestDelta = totalDelta;
          bestCom = targetCom;
        }
      }

      if (bestCom !== nodeCom && bestDelta > 1e-10) {
        // Move node to best community
        commDegree.set(nodeCom, (commDegree.get(nodeCom) ?? 0) - nodeK);
        commInternal.set(nodeCom, (commInternal.get(nodeCom) ?? 0) - weightToOwnCom);

        community.set(nodeId, bestCom);

        const weightToBest = neighborComWeights.get(bestCom) ?? 0;
        commDegree.set(bestCom, (commDegree.get(bestCom) ?? 0) + nodeK);
        commInternal.set(bestCom, (commInternal.get(bestCom) ?? 0) + weightToBest);

        improved = true;
      }
    }
  }

  // Renumber communities consecutively
  const comMap = new Map<number, number>();
  let nextCom = 0;
  for (const [, com] of community) {
    if (!comMap.has(com)) comMap.set(com, nextCom++);
  }

  const assignments: CommunityAssignment[] = nodeIds.map(id => ({
    nodeId: id,
    communityId: comMap.get(community.get(id)!)!,
  }));

  // Build community objects
  const comMembers = new Map<number, string[]>();
  for (const a of assignments) {
    if (!comMembers.has(a.communityId)) comMembers.set(a.communityId, []);
    comMembers.get(a.communityId)!.push(a.nodeId);
  }

  const communities: Community[] = [];
  for (const [comId, members] of comMembers) {
    // Compute internal density
    let internalEdges = 0;
    const memberSet = new Set(members);
    for (const edge of graph.edges) {
      if (memberSet.has(edge.source) && memberSet.has(edge.target)) internalEdges++;
    }
    const maxEdges = members.length > 1 ? (members.length * (members.length - 1)) / 2 : 1;

    communities.push({
      id: comId,
      members,
      size: members.length,
      density: internalEdges / maxEdges,
    });
  }

  // Compute modularity Q
  const m = totalWeight / 2;
  let Q = 0;
  for (const edge of graph.edges) {
    const w = edge.weight ?? 1;
    if (community.get(edge.source) === community.get(edge.target)) {
      const ki = k.get(edge.source) ?? 0;
      const kj = k.get(edge.target) ?? 0;
      Q += w - (ki * kj) / (2 * m);
    }
  }
  Q /= m || 1;

  return {
    assignments,
    communities: communities.sort((a, b) => b.size - a.size),
    modularity: Q,
  };
}

// ── Shortest Path (Dijkstra) ──────────────────────────────────

export function shortestPath(graph: AnalyticsGraph, from: string, to: string): ShortestPath | null {
  const adj = buildAdjacency(graph);
  if (!adj.has(from) || !adj.has(to)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const node of graph.nodes) {
    dist.set(node.id, Infinity);
    prev.set(node.id, null);
  }
  dist.set(from, 0);

  // Simple priority queue via sorted array (adequate for graphs < 10k nodes)
  const pq: Array<[string, number]> = [[from, 0]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[1] - b[1]);
    const [u, uDist] = pq.shift()!;

    if (visited.has(u)) continue;
    visited.add(u);

    if (u === to) break;

    const neighbors = adj.get(u);
    if (!neighbors) continue;

    for (const [v, w] of neighbors) {
      if (visited.has(v)) continue;
      // Use inverse weight: higher weight = stronger connection = shorter path
      const edgeCost = w > 0 ? 1 / w : 10;
      const alt = uDist + edgeCost;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
        pq.push([v, alt]);
      }
    }
  }

  if (dist.get(to) === Infinity) return null;

  // Reconstruct path
  const path: string[] = [];
  let current: string | null = to;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return { from, to, distance: dist.get(to)!, path };
}

/** All-pairs shortest paths (Floyd-Warshall). Returns distance matrix. */
function allPairsShortestPaths(graph: AnalyticsGraph): Map<string, Map<string, number>> {
  const nodeIds = graph.nodes.map(n => n.id);
  const adj = buildAdjacency(graph);

  const dist = new Map<string, Map<string, number>>();
  for (const u of nodeIds) {
    const row = new Map<string, number>();
    for (const v of nodeIds) row.set(v, u === v ? 0 : Infinity);
    dist.set(u, row);
  }

  for (const [u, neighbors] of adj) {
    for (const [v, w] of neighbors) {
      const cost = w > 0 ? 1 / w : 10;
      const row = dist.get(u)!;
      if (cost < (row.get(v) ?? Infinity)) row.set(v, cost);
    }
  }

  for (const k of nodeIds) {
    for (const i of nodeIds) {
      for (const j of nodeIds) {
        const ikDist = dist.get(i)!.get(k)!;
        const kjDist = dist.get(k)!.get(j)!;
        const ijDist = dist.get(i)!.get(j)!;
        if (ikDist + kjDist < ijDist) {
          dist.get(i)!.set(j, ikDist + kjDist);
        }
      }
    }
  }

  return dist;
}

// ── Clustering Coefficient ────────────────────────────────────

export function clusteringCoefficient(graph: AnalyticsGraph): ClusteringResult[] {
  const adj = buildAdjacency(graph);

  return graph.nodes.map(node => {
    const neighbors = adj.get(node.id);
    if (!neighbors || neighbors.size < 2) {
      return { nodeId: node.id, coefficient: 0 };
    }

    const neighborIds = [...neighbors.keys()];
    const k = neighborIds.length;
    let triangles = 0;

    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (adj.get(neighborIds[i]!)?.has(neighborIds[j]!)) {
          triangles++;
        }
      }
    }

    const maxTriangles = (k * (k - 1)) / 2;
    return {
      nodeId: node.id,
      coefficient: maxTriangles > 0 ? triangles / maxTriangles : 0,
    };
  });
}

// ── Bridge Detection ──────────────────────────────────────────

export function findBridges(graph: AnalyticsGraph): BridgeEdge[] {
  const adj = buildAdjacency(graph);
  const nodeIds = graph.nodes.map(n => n.id);
  if (nodeIds.length < 2) return [];

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const visited = new Set<string>();
  const bridges: BridgeEdge[] = [];
  let timer = 0;

  function dfs(u: string, parent: string | null): void {
    visited.add(u);
    disc.set(u, timer);
    low.set(u, timer);
    timer++;

    const neighbors = adj.get(u);
    if (!neighbors) return;

    for (const [v] of neighbors) {
      if (!visited.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) {
          bridges.push({ source: u, target: v, componentDelta: 1 });
        }
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id, null);
  }

  return bridges;
}

// ── Connected Components ──────────────────────────────────────

export function connectedComponents(graph: AnalyticsGraph): string[][] {
  const adj = buildAdjacency(graph);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;

    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(u);
      const neighbors = adj.get(u);
      if (!neighbors) continue;
      for (const [v] of neighbors) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

// ── Influence Propagation Score ───────────────────────────────
// Models how much influence a node can exert across the network.
// Combines PageRank, betweenness, and degree into a composite score.

export function influenceScore(graph: AnalyticsGraph): Array<{ nodeId: string; score: number }> {
  const pr = pageRank(graph);
  const bc = betweennessCentrality(graph);
  const dc = degreeCentrality(graph);

  const prMap = new Map(pr.map(r => [r.nodeId, r.rank]));
  const bcMap = new Map(bc.map(r => [r.nodeId, r.normalized]));
  const dcMap = new Map(dc.map(r => [r.nodeId, r.normalized]));

  // Normalize each component to [0,1]
  const normalize = (map: Map<string, number>): Map<string, number> => {
    const vals = [...map.values()];
    const max = Math.max(...vals, 1e-10);
    const result = new Map<string, number>();
    for (const [k, v] of map) result.set(k, v / max);
    return result;
  };

  const nPr = normalize(prMap);
  const nBc = normalize(bcMap);
  const nDc = normalize(dcMap);

  // Weighted composite: PageRank 40%, Betweenness 35%, Degree 25%
  return graph.nodes.map(node => ({
    nodeId: node.id,
    score: (nPr.get(node.id) ?? 0) * 0.4 +
           (nBc.get(node.id) ?? 0) * 0.35 +
           (nDc.get(node.id) ?? 0) * 0.25,
  })).sort((a, b) => b.score - a.score);
}

// ── Comprehensive Graph Metrics ───────────────────────────────

export function computeMetrics(graph: AnalyticsGraph): GraphMetrics {
  const n = graph.nodes.length;
  const e = graph.edges.length;

  if (n === 0) {
    return {
      nodeCount: 0, edgeCount: 0, density: 0, avgDegree: 0,
      avgClustering: 0, componentCount: 0, diameter: 0, avgPathLength: 0,
    };
  }

  const maxEdges = (n * (n - 1)) / 2;
  const density = maxEdges > 0 ? e / maxEdges : 0;

  const dc = degreeCentrality(graph);
  const avgDegree = dc.reduce((sum, d) => sum + d.degree, 0) / n;

  const cc = clusteringCoefficient(graph);
  const avgClustering = cc.reduce((sum, c) => sum + c.coefficient, 0) / n;

  const components = connectedComponents(graph);

  // Diameter and avg path length (only for connected graphs ≤ 500 nodes)
  let diameter = 0;
  let avgPathLength = 0;
  if (n <= 500) {
    const apsp = allPairsShortestPaths(graph);
    let totalDist = 0;
    let pathCount = 0;
    for (const [u, row] of apsp) {
      for (const [v, d] of row) {
        if (u !== v && d < Infinity) {
          totalDist += d;
          pathCount++;
          if (d > diameter) diameter = d;
        }
      }
    }
    avgPathLength = pathCount > 0 ? totalDist / pathCount : 0;
  }

  return {
    nodeCount: n,
    edgeCount: e,
    density,
    avgDegree,
    avgClustering,
    componentCount: components.length,
    diameter,
    avgPathLength,
  };
}

// ── Full Analysis Suite ───────────────────────────────────────
// Runs all analytics and returns a complete intelligence picture.

export interface FullAnalysis {
  metrics: GraphMetrics;
  degree: DegreeCentrality[];
  betweenness: BetweennessResult[];
  pageRank: PageRankResult[];
  communities: { assignments: CommunityAssignment[]; communities: Community[]; modularity: number };
  clustering: ClusteringResult[];
  bridges: BridgeEdge[];
  influence: Array<{ nodeId: string; score: number }>;
}

export function analyzeGraph(graph: AnalyticsGraph): FullAnalysis {
  return {
    metrics: computeMetrics(graph),
    degree: degreeCentrality(graph),
    betweenness: betweennessCentrality(graph),
    pageRank: pageRank(graph),
    communities: detectCommunities(graph),
    clustering: clusteringCoefficient(graph),
    bridges: findBridges(graph),
    influence: influenceScore(graph),
  };
}
