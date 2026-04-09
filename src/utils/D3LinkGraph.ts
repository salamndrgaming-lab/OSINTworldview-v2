import * as d3 from 'd3';
import type {
  AnalyticsGraph, FullAnalysis, ShortestPath,
} from './graph-analytics';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'Person' | 'Organization' | 'Event' | 'Location' | 'Country' | string;
  group?: number;
  // Organic learning metadata
  confidence?: number;      // 0–1, how confident we are in this node
  source?: 'manual' | 'map-click' | 'api' | 'auto-discovered';
  lastSeen?: number;        // timestamp
  mentions?: number;
  country?: string;
  // Analytics overlays (populated by runAnalytics)
  _communityId?: number;
  _pageRank?: number;
  _influenceScore?: number;
  _betweenness?: number;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship: string;
  weight?: number;          // link strength 0–1
  source_type?: 'manual' | 'api' | 'inferred';
  /** Temporal assertion: edge is valid from this timestamp (ms) */
  validFrom?: number;
  /** Temporal assertion: edge is valid until this timestamp (ms), undefined = still active */
  validTo?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ── Module-level graph state ─────────────────────────────────
// Persisted in localStorage so manual edits survive tab switches

const STORAGE_KEY = 'osintview-link-graph-v2';

function loadStoredGraph(): GraphData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: [], links: [] };
    return JSON.parse(raw) as GraphData;
  } catch {
    return { nodes: [], links: [] };
  }
}

function saveGraph(data: GraphData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — silently ignore */ }
}

export function clearStoredGraph(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function addNodeToGraph(node: Omit<GraphNode, 'x' | 'y' | 'vx' | 'vy'>): void {
  const data = loadStoredGraph();
  if (data.nodes.find(n => n.id === node.id)) return; // dedupe
  data.nodes.push({ ...node });
  saveGraph(data);
}

export function addLinkToGraph(link: GraphLink): void {
  const data = loadStoredGraph();
  const srcId = typeof link.source === 'string' ? link.source : link.source.id;
  const tgtId = typeof link.target === 'string' ? link.target : link.target.id;
  const exists = data.links.find(l => {
    const ls = typeof l.source === 'string' ? l.source : l.source.id;
    const lt = typeof l.target === 'string' ? l.target : l.target.id;
    return (ls === srcId && lt === tgtId) || (ls === tgtId && lt === srcId);
  });
  if (!exists) {
    data.links.push({ source: srcId, target: tgtId, relationship: link.relationship, weight: link.weight ?? 0.5, source_type: link.source_type ?? 'manual' });
    saveGraph(data);
  }
}

export function getStoredGraph(): GraphData {
  return loadStoredGraph();
}

// ── Auto-Discovery Engine ────────────────────────────────────
// Periodically fetches POI + entity-graph data and merges new
// nodes/links into the user's graph in the background.

let autoDiscoveryTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoDiscovery(onUpdate: (data: GraphData) => void): void {
  if (autoDiscoveryTimer) return; // already running
  void runAutoDiscovery(onUpdate);
  autoDiscoveryTimer = setInterval(() => void runAutoDiscovery(onUpdate), 60_000);
}

export function stopAutoDiscovery(): void {
  if (autoDiscoveryTimer) {
    clearInterval(autoDiscoveryTimer);
    autoDiscoveryTimer = null;
  }
}

async function runAutoDiscovery(onUpdate: (data: GraphData) => void): Promise<void> {
  const current = loadStoredGraph();
  if (current.nodes.length === 0) return; // only enrich if user has started a graph

  let changed = false;

  try {
    // 1. Pull entity graph from Redis/Neo4j
    const egResp = await fetch('/api/intelligence/entity-graph', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (egResp?.ok) {
      const egData = await egResp.json() as GraphData;
      const apiNodes: GraphNode[] = egData.nodes || [];
      const apiLinks: GraphLink[] = egData.links || [];

      // Find nodes in current graph that appear in the API graph, then pull in their neighbors
      const currentIds = new Set(current.nodes.map(n => n.id));
      for (const apiLink of apiLinks) {
        const srcId = typeof apiLink.source === 'string' ? apiLink.source : (apiLink.source as GraphNode).id;
        const tgtId = typeof apiLink.target === 'string' ? apiLink.target : (apiLink.target as GraphNode).id;

        const srcInGraph = currentIds.has(srcId);
        const tgtInGraph = currentIds.has(tgtId);

        if (srcInGraph || tgtInGraph) {
          // Pull the other node in automatically (auto-discovery)
          const otherNodeId = srcInGraph ? tgtId : srcId;
          const alreadyHave = current.nodes.find(n => n.id === otherNodeId);
          if (!alreadyHave) {
            const apiNode = apiNodes.find(n => n.id === otherNodeId);
            if (apiNode) {
              current.nodes.push({ ...apiNode, source: 'auto-discovered', confidence: 0.7 });
              currentIds.add(otherNodeId);
              changed = true;
            }
          }

          // Add the link if it doesn't exist
          const linkExists = current.links.find(l => {
            const ls = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const lt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            return (ls === srcId && lt === tgtId) || (ls === tgtId && lt === srcId);
          });
          if (!linkExists && currentIds.has(srcId) && currentIds.has(tgtId)) {
            current.links.push({
              source: srcId,
              target: tgtId,
              relationship: String(apiLink.relationship || 'associated'),
              weight: Number(apiLink.weight ?? 0.5),
              source_type: 'api',
            });
            changed = true;
          }
        }
      }
    }
  } catch { /* swallow — non-critical background task */ }

  try {
    // 2. Pull POI data and enrich existing Person nodes with fresh mention counts
    const poiResp = await fetch('/api/poi', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (poiResp?.ok) {
      const poiData = await poiResp.json() as { persons?: Record<string, unknown>[] };
      const persons = poiData?.persons || [];
      for (const person of persons) {
        const name = String(person.name || '');
        const existing = current.nodes.find(n => n.label.toLowerCase() === name.toLowerCase() && n.type === 'Person');
        if (existing) {
          const newMentions = Number(person.mentions || 0);
          if (existing.mentions !== newMentions) {
            existing.mentions = newMentions;
            existing.lastSeen = Date.now();
            changed = true;
          }
        }
      }
    }
  } catch { /* swallow */ }

  if (changed) {
    saveGraph(current);
    onUpdate(current);
  }
}

// ── Type colors and node rendering ──────────────────────────

const TYPE_COLORS: Record<string, string> = {
  person: '#f59e0b',
  organization: '#3b82f6',
  event: '#ef4444',
  location: '#10b981',
  country: '#8b5cf6',
};

const TYPE_ICONS: Record<string, string> = {
  person: '👤',
  organization: '🏢',
  event: '⚡',
  location: '📍',
  country: '🌍',
};

// ── Community palette (10 distinct hues for Louvain clusters) ──

const COMMUNITY_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7',
];

// ── D3 Canvas Graph Renderer (Palantir-grade) ────────────────
// High-performance Canvas renderer supporting 1000+ nodes.
// Replaces prior SVG implementation for enterprise-scale graphs.

export type ColorMode = 'type' | 'community' | 'influence';

export class D3LinkGraph {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 800;
  private height = 600;

  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];

  // Interaction state
  private hoveredNode: GraphNode | null = null;
  private dragNode: GraphNode | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private animFrameId = 0;
  private resizeObserver: ResizeObserver | null = null;

  // Camera transform (pan + zoom)
  private transform = { x: 0, y: 0, k: 1 };

  // Tooltip element
  private tooltip: HTMLDivElement;

  // Analytics overlays
  private colorMode: ColorMode = 'type';
  private highlightedPath: Set<string> | null = null;
  private highlightedPathEdges: Set<string> | null = null;
  private lastAnalysis: FullAnalysis | null = null;

  // Callback for analytics completion
  public onAnalysis: ((analysis: FullAnalysis) => void) | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`[D3LinkGraph] Container #${containerId} not found`);
    this.container = el;
    this.container.style.position = 'relative';
    this.container.innerHTML = '';

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:grab;';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Create tooltip
    this.tooltip = document.createElement('div');
    Object.assign(this.tooltip.style, {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '100',
      background: 'rgba(8, 8, 16, 0.95)',
      border: '1px solid rgba(100, 100, 140, 0.3)',
      borderRadius: '6px',
      padding: '8px 10px',
      fontSize: '11px',
      fontFamily: '"JetBrains Mono", monospace',
      color: '#e5e7eb',
      maxWidth: '280px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      backdropFilter: 'blur(8px)',
    });
    this.container.appendChild(this.tooltip);

    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.container);
    this.resizeCanvas();
  }

  // ── Public API ──────────────────────────────────────────────

  public render(nodes: GraphNode[], links: GraphLink[]): void {
    this.nodes = nodes;
    this.links = links;

    if (this.simulation) this.simulation.stop();
    cancelAnimationFrame(this.animFrameId);

    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(this.links)
        .id(d => d.id)
        .distance(d => 100 + (1 - (d.weight ?? 0.5)) * 80)
        .strength(d => d.weight ?? 0.5)
      )
      .force('charge', d3.forceManyBody()
        .strength(d => -250 - ((d as GraphNode)._influenceScore ?? 0) * 200)
        .distanceMax(500)
      )
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius(d => this.getRadiusForNode(d) + 6))
      .force('x', d3.forceX(this.width / 2).strength(0.02))
      .force('y', d3.forceY(this.height / 2).strength(0.02))
      .alphaDecay(0.02)
      .velocityDecay(0.35)
      .on('tick', () => {});

    this.startRenderLoop();
    this.runAnalytics();
  }

  public addToGraph(newNodes: GraphNode[], newLinks: GraphLink[]): void {
    if (!this.simulation) return;

    const existingIds = new Set(this.nodes.map(n => n.id));
    const toAdd = newNodes.filter(n => !existingIds.has(n.id));

    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const n of toAdd) {
      n.x = cx + (Math.random() - 0.5) * 100;
      n.y = cy + (Math.random() - 0.5) * 100;
      this.nodes.push(n);
    }

    const allIds = new Set(this.nodes.map(n => n.id));
    const existingLinkKeys = new Set(this.links.map(l => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return `${s}:${t}`;
    }));

    for (const l of newLinks) {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (allIds.has(s) && allIds.has(t) && !existingLinkKeys.has(`${s}:${t}`) && !existingLinkKeys.has(`${t}:${s}`)) {
        this.links.push(l);
      }
    }

    this.simulation.nodes(this.nodes);
    (this.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(this.links);
    this.simulation.alpha(0.4).restart();
    this.runAnalytics();
  }

  public destroy(): void {
    stopAutoDiscovery();
    cancelAnimationFrame(this.animFrameId);
    this.simulation?.stop();
    this.simulation = null;
    this.resizeObserver?.disconnect();
    this.container.innerHTML = '';
  }

  public reheat(): void {
    this.simulation?.alpha(0.4).restart();
  }

  /** Switch node coloring: 'type' (default), 'community' (Louvain), 'influence' (composite score) */
  public setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
  }

  /** Highlight a specific path between two nodes */
  public highlightPath(path: ShortestPath | null): void {
    if (!path) {
      this.highlightedPath = null;
      this.highlightedPathEdges = null;
      return;
    }
    this.highlightedPath = new Set(path.path);
    this.highlightedPathEdges = new Set<string>();
    for (let i = 0; i < path.path.length - 1; i++) {
      const a = path.path[i]!;
      const b = path.path[i + 1]!;
      this.highlightedPathEdges.add(`${a}:${b}`);
      this.highlightedPathEdges.add(`${b}:${a}`);
    }
  }

  /** Get the latest analytics results */
  public getAnalysis(): FullAnalysis | null {
    return this.lastAnalysis;
  }

  /** Convert current graph to AnalyticsGraph format */
  public toAnalyticsGraph(): AnalyticsGraph {
    return {
      nodes: this.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      edges: this.links.map(l => ({
        source: typeof l.source === 'string' ? l.source : l.source.id,
        target: typeof l.target === 'string' ? l.target : l.target.id,
        weight: l.weight ?? 0.5,
      })),
    };
  }

  // ── Analytics ───────────────────────────────────────────────

  private async runAnalytics(): Promise<void> {
    if (this.nodes.length < 2) return;

    // Dynamic import to avoid blocking initial render
    const { analyzeGraph } = await import('./graph-analytics');
    const ag = this.toAnalyticsGraph();
    const analysis = analyzeGraph(ag);
    this.lastAnalysis = analysis;

    // Apply community assignments to nodes
    const communityMap = new Map(analysis.communities.assignments.map(a => [a.nodeId, a.communityId]));
    const prMap = new Map(analysis.pageRank.map(r => [r.nodeId, r.rank]));
    const inflMap = new Map(analysis.influence.map(r => [r.nodeId, r.score]));
    const bcMap = new Map(analysis.betweenness.map(r => [r.nodeId, r.normalized]));

    for (const node of this.nodes) {
      node._communityId = communityMap.get(node.id);
      node._pageRank = prMap.get(node.id);
      node._influenceScore = inflMap.get(node.id);
      node._betweenness = bcMap.get(node.id);
    }

    this.onAnalysis?.(analysis);
  }

  // ── Canvas sizing ───────────────────────────────────────────

  private resizeCanvas(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 800;
    this.height = rect.height || 600;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);

    if (this.simulation) {
      this.simulation
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .force('x', d3.forceX(this.width / 2).strength(0.02))
        .force('y', d3.forceY(this.height / 2).strength(0.02));
      this.simulation.alpha(0.1).restart();
    }
  }

  // ── Render loop ─────────────────────────────────────────────

  private startRenderLoop(): void {
    const loop = () => {
      this.draw();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private draw(): void {
    const { ctx, width: w, height: h } = this;
    const { x: tx, y: ty, k } = this.transform;

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.save();
    ctx.strokeStyle = 'rgba(128, 128, 160, 0.04)';
    ctx.lineWidth = 0.5;
    const gridSize = 40 * k;
    const offsetX = tx % gridSize;
    const offsetY = ty % gridSize;
    for (let x = offsetX; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = offsetY; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(k, k);

    const now = Date.now();

    // ── Draw edges ──
    for (const link of this.links) {
      const src = link.source as GraphNode;
      const tgt = link.target as GraphNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

      const srcId = src.id;
      const tgtId = tgt.id;
      const isPathEdge = this.highlightedPathEdges?.has(`${srcId}:${tgtId}`);
      const isHovered = this.hoveredNode && (srcId === this.hoveredNode.id || tgtId === this.hoveredNode.id);
      const dimmed = (this.hoveredNode && !isHovered) || (this.highlightedPath && !isPathEdge);

      // Temporal edge styling: expired edges are dashed and faded
      const isExpired = link.validTo != null && link.validTo < now;
      const isFuture = link.validFrom != null && link.validFrom > now;

      const w = 1 + (link.weight ?? 0.5) * 3;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isPathEdge) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = w + 2;
        ctx.setLineDash([]);
      } else if (isHovered) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = w + 1;
        ctx.setLineDash([]);
      } else if (isExpired) {
        ctx.strokeStyle = 'rgba(100, 60, 60, 0.25)';
        ctx.lineWidth = w * 0.7;
        ctx.setLineDash([4, 4]);
      } else if (isFuture) {
        ctx.strokeStyle = 'rgba(60, 100, 140, 0.25)';
        ctx.lineWidth = w * 0.7;
        ctx.setLineDash([2, 6]);
      } else {
        const baseAlpha = dimmed ? 0.08 : 0.15 + (link.weight ?? 0.5) * 0.35;
        const color = link.source_type === 'inferred' ? '80, 100, 140'
          : link.source_type === 'api' ? '80, 180, 120'
          : '120, 120, 140';
        ctx.strokeStyle = `rgba(${color}, ${baseAlpha})`;
        ctx.lineWidth = w;
        ctx.setLineDash(link.source_type === 'inferred' ? [4, 3] : []);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead
      if (!dimmed) {
        const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        const r = this.getRadiusForNode(tgt);
        const ax = tgt.x - Math.cos(angle) * (r + 4);
        const ay = tgt.y - Math.sin(angle) * (r + 4);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay - 6 * Math.sin(angle - 0.4));
        ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay - 6 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = isPathEdge ? '#22c55e' : 'rgba(120, 120, 140, 0.4)';
        ctx.fill();
      }

      // Edge label on hover
      if (isHovered && link.relationship) {
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.font = '9px "JetBrains Mono", monospace';
        const metrics = ctx.measureText(link.relationship);
        const pad = 3;
        ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
        ctx.fillRect(mx - metrics.width / 2 - pad, my - 7, metrics.width + pad * 2, 14);
        ctx.fillStyle = 'rgba(200, 200, 210, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(link.relationship, mx, my);
      }
    }

    // ── Draw nodes ──
    for (const node of this.nodes) {
      if (node.x == null || node.y == null) continue;

      const r = this.getRadiusForNode(node);
      const color = this.getNodeColor(node);
      const isHovered = this.hoveredNode?.id === node.id;
      const isOnPath = this.highlightedPath?.has(node.id);
      const isConnectedToHovered = this.hoveredNode && this.links.some(l => {
        const s = (l.source as GraphNode).id;
        const t = (l.target as GraphNode).id;
        return (s === this.hoveredNode!.id && t === node.id) || (t === this.hoveredNode!.id && s === node.id);
      });
      const dimmed = (this.hoveredNode && !isHovered && !isConnectedToHovered) ||
                     (this.highlightedPath && !isOnPath);

      // Outer glow for high-confidence or hovered nodes
      if (isHovered || isOnPath || (node.confidence ?? 0.5) > 0.85) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = isOnPath ? 'rgba(34, 197, 94, 0.15)' : `${color}22`;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? `${color}33` : `${color}cc`;
      ctx.fill();
      ctx.strokeStyle = dimmed ? `${color}44` : color;
      ctx.lineWidth = isHovered ? 2.5 : node.source === 'auto-discovered' ? 1 : 2;
      if (node.source === 'auto-discovered') ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Source badge
      const badgeX = node.x + r * 0.7;
      const badgeY = node.y - r * 0.7;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 3, 0, Math.PI * 2);
      ctx.fillStyle = node.source === 'api' ? '#22c55e'
        : node.source === 'auto-discovered' ? '#f59e0b'
        : node.source === 'map-click' ? '#3b82f6'
        : '#888';
      ctx.fill();
      ctx.strokeStyle = '#0a0a0f';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.font = `${(node.confidence ?? 0.5) > 0.8 ? '600' : '400'} 11px "Geist", system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dimmed ? 'rgba(160, 160, 170, 0.3)' : `${color}cc`;
      ctx.fillText(node.label, node.x + r + 5, node.y, 140);
    }

    // Empty state
    if (this.nodes.length === 0) {
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(140, 140, 155, 0.5)';
      ctx.fillText('Add entities to build your intelligence graph', w / (2 * k), h / (2 * k) - 14);
    }

    ctx.restore();
  }

  // ── Node coloring ───────────────────────────────────────────

  private getNodeColor(node: GraphNode): string {
    if (this.colorMode === 'community' && node._communityId != null) {
      return COMMUNITY_PALETTE[node._communityId % COMMUNITY_PALETTE.length]!;
    }
    if (this.colorMode === 'influence' && node._influenceScore != null) {
      // Red (high influence) → blue (low)
      const t = Math.min(1, node._influenceScore * 2);
      const r = Math.round(59 + t * 196);
      const g = Math.round(130 - t * 80);
      const b = Math.round(246 - t * 200);
      return `rgb(${r}, ${g}, ${b})`;
    }
    return TYPE_COLORS[(node.type ?? '').toLowerCase()] || '#9ca3af';
  }

  private getRadiusForNode(node: GraphNode): number {
    const base = 10;
    const mentionBoost = Math.min(8, Math.log10((node.mentions ?? 0) + 1) * 3);
    const confBoost = (node.confidence ?? 0.5) * 4;
    const influenceBoost = (node._influenceScore ?? 0) * 6;
    return base + mentionBoost + confBoost + influenceBoost;
  }

  // ── Hit testing ─────────────────────────────────────────────

  private screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.transform.x) / this.transform.k, (sy - this.transform.y) / this.transform.k];
  }

  private hitTest(sx: number, sy: number): GraphNode | null {
    const [wx, wy] = this.screenToWorld(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]!;
      if (n.x == null || n.y == null) continue;
      const r = this.getRadiusForNode(n) + 4;
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  // ── Event binding ───────────────────────────────────────────

  private bindEvents(): void {
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;

    this.canvas.addEventListener('mousedown', (e) => {
      const node = this.hitTest(e.offsetX, e.offsetY);
      if (node) {
        this.dragNode = node;
        const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
        this.dragOffsetX = wx - (node.x ?? 0);
        this.dragOffsetY = wy - (node.y ?? 0);
        node.fx = node.x;
        node.fy = node.y;
        this.simulation?.alphaTarget(0.3).restart();
        this.canvas.style.cursor = 'grabbing';
      } else {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragNode) {
        const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
        this.dragNode.fx = wx - this.dragOffsetX;
        this.dragNode.fy = wy - this.dragOffsetY;
        return;
      }

      if (isPanning) {
        this.transform.x += e.clientX - panStartX;
        this.transform.y += e.clientY - panStartY;
        panStartX = e.clientX;
        panStartY = e.clientY;
        return;
      }

      const node = this.hitTest(e.offsetX, e.offsetY);
      this.hoveredNode = node;
      this.canvas.style.cursor = node ? 'pointer' : 'grab';

      if (node) {
        this.showTooltip(e, node);
      } else {
        this.tooltip.style.display = 'none';
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      if (this.dragNode) {
        this.simulation?.alphaTarget(0);
        this.dragNode = null;
      }
      isPanning = false;
      this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredNode = null;
      this.tooltip.style.display = 'none';
      if (isPanning) {
        isPanning = false;
        this.canvas.style.cursor = 'grab';
      }
    });

    // Double-click to unpin
    this.canvas.addEventListener('dblclick', (e) => {
      const node = this.hitTest(e.offsetX, e.offsetY);
      if (node) {
        node.fx = null;
        node.fy = null;
        this.simulation?.alpha(0.3).restart();
      }
    });

    // Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newK = Math.max(0.05, Math.min(5, this.transform.k * factor));
      const ratio = newK / this.transform.k;
      this.transform.x = e.offsetX - (e.offsetX - this.transform.x) * ratio;
      this.transform.y = e.offsetY - (e.offsetY - this.transform.y) * ratio;
      this.transform.k = newK;
    }, { passive: false });

    // Right-click shows contextual info
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  // ── Tooltip ─────────────────────────────────────────────────

  private showTooltip(event: MouseEvent, d: GraphNode): void {
    const icon = TYPE_ICONS[(d.type ?? '').toLowerCase()] || '&#9679;';
    const color = this.getNodeColor(d);
    const age = d.lastSeen ? this.formatAge(d.lastSeen) : 'unknown';
    const conf = Math.round((d.confidence ?? 0.8) * 100);

    let analyticsHtml = '';
    if (d._influenceScore != null) {
      const infl = Math.round(d._influenceScore * 100);
      const btwn = Math.round((d._betweenness ?? 0) * 1000) / 10;
      const pr = d._pageRank != null ? (d._pageRank * 100).toFixed(1) : '—';
      const comId = d._communityId ?? '—';
      analyticsHtml = `
        <div style="font-size:10px;color:#aaa;margin-top:4px;padding-top:4px;border-top:1px solid rgba(100,100,140,0.2)">
          <div style="display:flex;gap:8px">
            <span>Influence: <span style="color:${infl > 60 ? '#ef4444' : '#3b82f6'}">${infl}%</span></span>
            <span>PageRank: ${pr}%</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:2px">
            <span>Betweenness: ${btwn}%</span>
            <span>Community: ${comId}</span>
          </div>
        </div>
      `;
    }

    this.tooltip.innerHTML = `
      <div style="font-weight:600;color:${color};margin-bottom:4px">${icon} ${this.esc(d.label)}</div>
      <div style="font-size:10px;color:#888;margin-bottom:3px">${d.type}${d.country ? ' &middot; ' + d.country : ''}</div>
      <div style="font-size:10px;display:flex;gap:8px;color:#aaa">
        <span>Conf: <span style="color:${conf > 70 ? '#22c55e' : '#f59e0b'}">${conf}%</span></span>
        <span>Source: ${d.source || 'manual'}</span>
      </div>
      ${d.mentions ? `<div style="font-size:10px;color:#aaa;margin-top:2px">Mentions: ${d.mentions}</div>` : ''}
      <div style="font-size:9px;color:#666;margin-top:3px">Last seen: ${age}</div>
      ${analyticsHtml}
    `;
    this.tooltip.style.display = 'block';

    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(event.clientX - rect.left + 12, this.width - 290)}px`;
    this.tooltip.style.top = `${Math.max(event.clientY - rect.top - 10, 0)}px`;
  }

  private formatAge(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
