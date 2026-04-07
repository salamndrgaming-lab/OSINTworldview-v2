/**
 * Intel Graph Panel — Interactive Intelligence Link Analysis
 *
 * A force-directed graph where users add entities (countries, people, events,
 * organizations, topics) and the system discovers connections between them.
 * Thicker connection lines = more shared intelligence signals.
 *
 * Architecture:
 *  - Canvas-based rendering (performant with 100+ nodes)
 *  - D3 force simulation for physics-based layout
 *  - Entity matching via existing entity-index service
 *  - AI analysis via /api/graph-analyze endpoint (Groq)
 *  - State persisted in localStorage
 */

import { Panel } from './Panel';
import * as d3 from 'd3';

// ── Types ──────────────────────────────────────────────────────

type NodeCategory = 'country' | 'person' | 'organization' | 'event' | 'topic';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  category: NodeCategory;
  /** Number of connections — used for sizing */
  weight: number;
  /** User-provided or auto-discovered notes */
  notes?: string;
  /** Pinned position (user dragged and released) */
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  /** Strength 1-10, controls line thickness */
  strength: number;
  /** What connects these two nodes */
  reason: string;
  /** Whether this edge was auto-discovered or manually added */
  autoDiscovered: boolean;
}

interface GraphState {
  nodes: Array<{ id: string; label: string; category: NodeCategory; notes?: string }>;
  edges: Array<{ id: string; sourceId: string; targetId: string; strength: number; reason: string; autoDiscovered: boolean }>;
}

// ── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'worldmonitor-intel-graph';
const CATEGORY_COLORS: Record<NodeCategory, string> = {
  country: '#3b82f6',      // blue
  person: '#8b5cf6',       // purple
  organization: '#14b8a6', // teal
  event: '#ef4444',        // red
  topic: '#f59e0b',        // amber
};
const CATEGORY_ICONS: Record<NodeCategory, string> = {
  country: '🌍',
  person: '👤',
  organization: '🏢',
  event: '⚡',
  topic: '🔍',
};
const NODE_BASE_RADIUS = 18;
const EDGE_MIN_WIDTH = 0.8;
const EDGE_MAX_WIDTH = 6;

// ── Known Connections Database ─────────────────────────────────
// This is a curated set of entity relationships used to auto-discover
// connections when users add nodes. In the future this would come from
// Neo4j or the entity graph API — for now it's a local lookup.

interface ConnectionTemplate {
  from: string;
  to: string;
  reason: string;
  strength: number;
}

const CONNECTION_TEMPLATES: ConnectionTemplate[] = [
  // Geopolitical alliances & conflicts
  { from: 'russia', to: 'ukraine', reason: 'Active military conflict since 2022', strength: 9 },
  { from: 'russia', to: 'china', reason: 'Strategic partnership, joint military exercises', strength: 7 },
  { from: 'russia', to: 'iran', reason: 'Military cooperation, drone/missile technology transfer', strength: 7 },
  { from: 'russia', to: 'north korea', reason: 'Arms transfers, UN sanctions evasion', strength: 6 },
  { from: 'russia', to: 'syria', reason: 'Military intervention since 2015, naval base at Tartus', strength: 7 },
  { from: 'russia', to: 'nato', reason: 'Primary adversarial relationship', strength: 8 },
  { from: 'china', to: 'taiwan', reason: 'Territorial claim, military pressure, semiconductor dependency', strength: 9 },
  { from: 'china', to: 'north korea', reason: 'Economic lifeline, buffer state strategy', strength: 6 },
  { from: 'china', to: 'iran', reason: 'Oil imports, Belt & Road partner', strength: 5 },
  { from: 'iran', to: 'israel', reason: 'Proxy conflict via Hezbollah/Hamas, nuclear program tensions', strength: 9 },
  { from: 'iran', to: 'saudi arabia', reason: 'Regional rivalry, proxy conflicts in Yemen', strength: 7 },
  { from: 'iran', to: 'hamas', reason: 'Financial and military support', strength: 8 },
  { from: 'iran', to: 'hezbollah', reason: 'Primary state sponsor, weapons supplier', strength: 9 },
  { from: 'israel', to: 'hamas', reason: 'Active conflict, Gaza operations', strength: 9 },
  { from: 'israel', to: 'hezbollah', reason: 'Cross-border conflict, Lebanon operations', strength: 8 },
  { from: 'usa', to: 'nato', reason: 'Founding member, largest military contributor', strength: 9 },
  { from: 'usa', to: 'china', reason: 'Strategic competition, trade war, tech restrictions', strength: 8 },
  { from: 'usa', to: 'russia', reason: 'Nuclear deterrence, sanctions regime', strength: 8 },
  { from: 'usa', to: 'israel', reason: 'Military alliance, $3.8B annual aid', strength: 8 },
  { from: 'usa', to: 'taiwan', reason: 'Strategic ambiguity, arms sales, chip dependency', strength: 7 },
  { from: 'usa', to: 'saudi arabia', reason: 'Oil partnership, arms sales, regional security', strength: 6 },
  { from: 'saudi arabia', to: 'yemen', reason: 'Military intervention, Houthi conflict', strength: 7 },
  { from: 'turkey', to: 'syria', reason: 'Border security, Kurdish operations, refugee crisis', strength: 7 },
  { from: 'turkey', to: 'nato', reason: 'Member since 1952, strategic Bosphorus position', strength: 6 },
  { from: 'india', to: 'pakistan', reason: 'Kashmir dispute, nuclear deterrence', strength: 7 },
  { from: 'india', to: 'china', reason: 'Border disputes (LAC), economic competition', strength: 6 },
  // People & organizations
  { from: 'putin', to: 'russia', reason: 'President since 2000/2012', strength: 10 },
  { from: 'xi jinping', to: 'china', reason: 'General Secretary of CPC since 2012', strength: 10 },
  { from: 'zelensky', to: 'ukraine', reason: 'President since 2019, wartime leader', strength: 10 },
  { from: 'netanyahu', to: 'israel', reason: 'Prime Minister, longest-serving leader', strength: 10 },
  { from: 'khamenei', to: 'iran', reason: 'Supreme Leader since 1989', strength: 10 },
  { from: 'kim jong un', to: 'north korea', reason: 'Supreme Leader since 2011', strength: 10 },
  { from: 'erdogan', to: 'turkey', reason: 'President since 2014', strength: 10 },
  { from: 'modi', to: 'india', reason: 'Prime Minister since 2014', strength: 10 },
  { from: 'putin', to: 'xi jinping', reason: '"No limits" partnership declaration 2022', strength: 6 },
  { from: 'putin', to: 'kim jong un', reason: 'Summit diplomacy, arms cooperation since 2023', strength: 5 },
  // Events
  { from: 'ukraine war', to: 'russia', reason: 'Invading force', strength: 10 },
  { from: 'ukraine war', to: 'ukraine', reason: 'Defending nation', strength: 10 },
  { from: 'ukraine war', to: 'nato', reason: 'Weapons supply, intelligence sharing', strength: 7 },
  { from: 'gaza conflict', to: 'israel', reason: 'Military operations in Gaza', strength: 10 },
  { from: 'gaza conflict', to: 'hamas', reason: 'Oct 7 attack initiator', strength: 10 },
  { from: 'gaza conflict', to: 'iran', reason: 'Hamas state sponsor', strength: 6 },
  { from: 'taiwan strait', to: 'china', reason: 'Military exercises, reunification claim', strength: 8 },
  { from: 'taiwan strait', to: 'taiwan', reason: 'Sovereignty defense', strength: 8 },
  { from: 'taiwan strait', to: 'usa', reason: 'Carrier group deployments, arms sales', strength: 6 },
];

// ── Helper: find matching connections ──────────────────────────

function findConnections(nodeA: string, nodeB: string): ConnectionTemplate | null {
  const a = nodeA.toLowerCase();
  const b = nodeB.toLowerCase();
  return CONNECTION_TEMPLATES.find(c =>
    (c.from === a && c.to === b) || (c.from === b && c.to === a)
  ) || null;
}

// ── Panel Class ───────────────────────────────────────────────

export class IntelGraphPanel extends Panel {
  private canvas!: HTMLCanvasElement;
  private ctx2d!: CanvasRenderingContext2D;
  private simulation!: d3.Simulation<GraphNode, GraphEdge>;
  private graphNodes: GraphNode[] = [];
  private graphEdges: GraphEdge[] = [];
  private hoveredNode: GraphNode | null = null;
  private dragNode: GraphNode | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private width = 600;
  private height = 450;
  private animFrameId = 0;
  private analysisEl!: HTMLElement;
  private isAnalyzing = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({
      id: 'intel-graph',
      title: 'Intelligence Link Graph',
      closable: true,
      className: 'intel-graph-panel',
    });
    this.buildUI();
    this.loadState();
    this.initSimulation();
    this.startRenderLoop();
  }

  // ── UI Construction ──────────────────────────────────────────

  private buildUI(): void {
    const content = this.content;
    // Clear the base-class loading spinner before building our UI
    content.innerHTML = '';
    content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'igp-toolbar';
    toolbar.innerHTML = `
      <div class="igp-add-group">
        <select class="igp-category-select" id="igpCategorySelect">
          <option value="country">🌍 Country</option>
          <option value="person">👤 Person</option>
          <option value="organization">🏢 Organization</option>
          <option value="event">⚡ Event</option>
          <option value="topic">🔍 Topic</option>
        </select>
        <input type="text" class="igp-add-input" id="igpAddInput" placeholder="Add entity..." spellcheck="false" />
        <button class="igp-add-btn" id="igpAddBtn" title="Add entity">+</button>
      </div>
      <div class="igp-action-group">
        <button class="igp-action-btn" id="igpAnalyzeBtn" title="AI Analysis">🧠 Analyze</button>
        <button class="igp-action-btn" id="igpClearBtn" title="Clear graph">Clear</button>
        <button class="igp-action-btn" id="igpTemplateBtn" title="Load example graph">Template</button>
        <button class="igp-action-btn" id="igpLiveBtn" title="Load live intelligence graph">📡 Live</button>
      </div>
    `;
    content.appendChild(toolbar);

    // Canvas container
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'igp-canvas-wrap';
    canvasWrap.style.cssText = 'flex:1;position:relative;min-height:0;';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'igp-canvas';
    this.canvas.style.cssText = 'width:100%;height:100%;cursor:grab;display:block;';
    canvasWrap.appendChild(this.canvas);

    // Node tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'igp-tooltip';
    tooltip.id = 'igpTooltip';
    tooltip.style.display = 'none';
    canvasWrap.appendChild(tooltip);

    content.appendChild(canvasWrap);

    // Analysis panel (collapsible)
    this.analysisEl = document.createElement('div');
    this.analysisEl.className = 'igp-analysis';
    this.analysisEl.id = 'igpAnalysis';
    this.analysisEl.style.display = 'none';
    content.appendChild(this.analysisEl);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'igp-legend';
    legend.innerHTML = Object.entries(CATEGORY_COLORS).map(([cat, color]) =>
      `<span class="igp-legend-item"><span class="igp-legend-dot" style="background:${color}"></span>${cat}</span>`
    ).join('');
    content.appendChild(legend);

    // Event bindings
    this.bindToolbarEvents(toolbar);
    this.bindCanvasEvents(canvasWrap);

    // Resize observer to keep canvas sized correctly
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvasWrap);
  }

  // ── Event Bindings ───────────────────────────────────────────

  private bindToolbarEvents(toolbar: HTMLElement): void {
    const input = toolbar.querySelector('#igpAddInput') as HTMLInputElement;
    const select = toolbar.querySelector('#igpCategorySelect') as HTMLSelectElement;
    const addBtn = toolbar.querySelector('#igpAddBtn')!;
    const analyzeBtn = toolbar.querySelector('#igpAnalyzeBtn')!;
    const clearBtn = toolbar.querySelector('#igpClearBtn')!;
    const templateBtn = toolbar.querySelector('#igpTemplateBtn')!;

    const addEntity = () => {
      const label = input.value.trim();
      if (!label) return;
      const category = select.value as NodeCategory;
      this.addNode(label, category);
      input.value = '';
      input.focus();
    };

    addBtn.addEventListener('click', addEntity);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addEntity(); });
    analyzeBtn.addEventListener('click', () => this.runAnalysis());
    clearBtn.addEventListener('click', () => { if (confirm('Clear entire graph?')) this.clearGraph(); });
    templateBtn.addEventListener('click', () => this.loadTemplate());
    const liveBtn = toolbar.querySelector('#igpLiveBtn')!;
    liveBtn.addEventListener('click', () => this.loadLiveData());
  }

  private bindCanvasEvents(wrap: HTMLElement): void {
    const tooltip = wrap.querySelector('#igpTooltip') as HTMLElement;

    this.canvas.addEventListener('mousedown', (e) => {
      const node = this.hitTest(e.offsetX, e.offsetY);
      if (node) {
        this.dragNode = node;
        this.dragOffsetX = e.offsetX - (node.x || 0);
        this.dragOffsetY = e.offsetY - (node.y || 0);
        this.canvas.style.cursor = 'grabbing';
        // Pin the node while dragging
        node.fx = node.x;
        node.fy = node.y;
        this.simulation.alphaTarget(0.3).restart();
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragNode) {
        this.dragNode.fx = e.offsetX - this.dragOffsetX;
        this.dragNode.fy = e.offsetY - this.dragOffsetY;
        return;
      }

      const node = this.hitTest(e.offsetX, e.offsetY);
      this.hoveredNode = node;
      this.canvas.style.cursor = node ? 'pointer' : 'grab';

      if (node) {
        const connections = this.graphEdges.filter(edge => {
          const s = typeof edge.source === 'object' ? edge.source.id : edge.source;
          const t = typeof edge.target === 'object' ? edge.target.id : edge.target;
          return s === node.id || t === node.id;
        });
        tooltip.innerHTML = `
          <div class="igp-tooltip-header">${CATEGORY_ICONS[node.category]} ${this.escHtml(node.label)}</div>
          <div class="igp-tooltip-cat">${node.category}</div>
          <div class="igp-tooltip-conn">${connections.length} connection${connections.length !== 1 ? 's' : ''}</div>
          ${node.notes ? `<div class="igp-tooltip-notes">${this.escHtml(node.notes)}</div>` : ''}
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = `${Math.min(e.offsetX + 14, this.width - 200)}px`;
        tooltip.style.top = `${Math.max(e.offsetY - 10, 0)}px`;
      } else {
        tooltip.style.display = 'none';
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      if (this.dragNode) {
        // Keep it pinned where user dropped it
        this.simulation.alphaTarget(0);
        this.dragNode = null;
        this.canvas.style.cursor = 'grab';
        this.saveState();
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
      this.hoveredNode = null;
    });

    // Double-click to unpin a node
    this.canvas.addEventListener('dblclick', (e) => {
      const node = this.hitTest(e.offsetX, e.offsetY);
      if (node) {
        node.fx = null;
        node.fy = null;
        this.simulation.alpha(0.3).restart();
        this.saveState();
      }
    });

    // Right-click to remove a node
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = this.hitTest(e.offsetX, e.offsetY);
      if (node) {
        this.removeNode(node.id);
      }
    });
  }

  // ── Canvas Sizing ────────────────────────────────────────────

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.ctx2d.scale(dpr, dpr);

    // Update force center
    if (this.simulation) {
      this.simulation
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .alpha(0.1)
        .restart();
    }
  }

  // ── Force Simulation ─────────────────────────────────────────

  private initSimulation(): void {
    this.simulation = d3.forceSimulation<GraphNode>(this.graphNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(this.graphEdges)
        .id(d => d.id)
        .distance(120)
        .strength(e => Math.min(0.8, (e as GraphEdge).strength / 12))
      )
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(400))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => this.nodeRadius(d) + 8))
      .force('x', d3.forceX(this.width / 2).strength(0.03))
      .force('y', d3.forceY(this.height / 2).strength(0.03))
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .on('tick', () => {}); // rendering handled by our own rAF loop
  }

  private restartSimulation(): void {
    this.simulation.nodes(this.graphNodes);
    (this.simulation.force('link') as d3.ForceLink<GraphNode, GraphEdge>)
      .links(this.graphEdges);
    this.simulation.alpha(0.6).restart();
  }

  // ── Render Loop (Canvas) ─────────────────────────────────────

  private startRenderLoop(): void {
    const render = () => {
      this.draw();
      this.animFrameId = requestAnimationFrame(render);
    };
    // Defer first frame so canvas has dimensions
    requestAnimationFrame(() => {
      this.resizeCanvas();
      render();
    });
  }

  private draw(): void {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const w = this.width;
    const h = this.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw subtle grid
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.06)';
    ctx.lineWidth = 0.5;
    const gridSize = 40;
    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw edges
    for (const edge of this.graphEdges) {
      const source = edge.source as GraphNode;
      const target = edge.target as GraphNode;
      if (!source.x || !source.y || !target.x || !target.y) continue;

      const isHovered = this.hoveredNode &&
        (source.id === this.hoveredNode.id || target.id === this.hoveredNode.id);

      // Line width based on strength (1-10 mapped to EDGE_MIN_WIDTH-EDGE_MAX_WIDTH)
      const lineWidth = EDGE_MIN_WIDTH + ((edge.strength - 1) / 9) * (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH);

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = isHovered
        ? 'rgba(255, 255, 255, 0.6)'
        : `rgba(120, 120, 140, ${0.15 + (edge.strength / 10) * 0.35})`;
      ctx.lineWidth = isHovered ? lineWidth + 1 : lineWidth;
      ctx.stroke();

      // Draw edge label at midpoint for hovered connections
      if (isHovered && edge.reason) {
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200, 200, 210, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Background for readability
        const metrics = ctx.measureText(edge.reason);
        const pad = 4;
        ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
        ctx.fillRect(mx - metrics.width / 2 - pad, my - 7 - pad, metrics.width + pad * 2, 14 + pad * 2);
        ctx.fillStyle = 'rgba(200, 200, 210, 0.95)';
        ctx.fillText(edge.reason, mx, my);
      }
    }

    // Draw nodes
    for (const node of this.graphNodes) {
      if (node.x == null || node.y == null) continue;
      const r = this.nodeRadius(node);
      const color = CATEGORY_COLORS[node.category];
      const isHovered = this.hoveredNode?.id === node.id;
      const isConnectedToHovered = this.hoveredNode && this.graphEdges.some(e => {
        const s = (e.source as GraphNode).id;
        const t = (e.target as GraphNode).id;
        return (s === this.hoveredNode!.id && t === node.id) ||
               (t === this.hoveredNode!.id && s === node.id);
      });
      const dimmed = this.hoveredNode && !isHovered && !isConnectedToHovered;

      // Outer glow for hovered node
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? `${color}44` : `${color}cc`;
      ctx.fill();
      ctx.strokeStyle = dimmed ? `${color}33` : `${color}`;
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.stroke();

      // Pinned indicator
      if (node.fx != null) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      // Label
      ctx.font = `${isHovered ? '600' : '500'} 11px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dimmed ? 'rgba(160, 160, 170, 0.4)' : 'rgba(220, 220, 230, 0.95)';
      ctx.fillText(node.label, node.x, node.y + r + 4, 120);
    }

    // Empty state
    if (this.graphNodes.length === 0) {
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(140, 140, 155, 0.5)';
      ctx.fillText('Add entities to build your intelligence graph', w / 2, h / 2 - 14);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(140, 140, 155, 0.35)';
      ctx.fillText('or click "Template" to load an example', w / 2, h / 2 + 10);
    }
  }

  private nodeRadius(node: GraphNode): number {
    return NODE_BASE_RADIUS + Math.min(node.weight * 2, 14);
  }

  private hitTest(x: number, y: number): GraphNode | null {
    // Iterate in reverse so topmost (last-drawn) nodes get priority
    for (let i = this.graphNodes.length - 1; i >= 0; i--) {
      const node = this.graphNodes[i]!;
      if (node.x == null || node.y == null) continue;
      const r = this.nodeRadius(node) + 4; // slightly forgiving hit area
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  }

  // ── Node / Edge Management ───────────────────────────────────

  addNode(label: string, category: NodeCategory, notes?: string): GraphNode {
    // Deduplicate by label (case-insensitive)
    const existing = this.graphNodes.find(n => n.label.toLowerCase() === label.toLowerCase());
    if (existing) return existing;

    const node: GraphNode = {
      id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      label,
      category,
      weight: 0,
      notes,
      // Start near center with slight random offset
      x: this.width / 2 + (Math.random() - 0.5) * 80,
      y: this.height / 2 + (Math.random() - 0.5) * 80,
    };
    this.graphNodes.push(node);

    // Auto-discover connections to existing nodes
    this.autoDiscoverEdges(node);

    this.restartSimulation();
    this.saveState();
    return node;
  }

  private removeNode(id: string): void {
    this.graphNodes = this.graphNodes.filter(n => n.id !== id);
    this.graphEdges = this.graphEdges.filter(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      return sId !== id && tId !== id;
    });
    this.recalcWeights();
    this.restartSimulation();
    this.saveState();
  }

  private addEdge(sourceId: string, targetId: string, strength: number, reason: string, auto: boolean): void {
    // Prevent duplicates
    const exists = this.graphEdges.some(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      return (sId === sourceId && tId === targetId) || (sId === targetId && tId === sourceId);
    });
    if (exists) return;

    this.graphEdges.push({
      id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      source: sourceId,
      target: targetId,
      strength: Math.max(1, Math.min(10, strength)),
      reason,
      autoDiscovered: auto,
    });
    this.recalcWeights();
  }

  private autoDiscoverEdges(newNode: GraphNode): void {
    for (const existing of this.graphNodes) {
      if (existing.id === newNode.id) continue;
      const conn = findConnections(newNode.label, existing.label);
      if (conn) {
        this.addEdge(newNode.id, existing.id, conn.strength, conn.reason, true);
      }
    }
  }

  private recalcWeights(): void {
    // Reset all weights
    for (const n of this.graphNodes) n.weight = 0;
    // Count connections per node
    for (const e of this.graphEdges) {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      const sNode = this.graphNodes.find(n => n.id === sId);
      const tNode = this.graphNodes.find(n => n.id === tId);
      if (sNode) sNode.weight++;
      if (tNode) tNode.weight++;
    }
  }

  private clearGraph(): void {
    this.graphNodes = [];
    this.graphEdges = [];
    this.hoveredNode = null;
    this.analysisEl.style.display = 'none';
    this.restartSimulation();
    this.saveState();
  }

  // ── Template ─────────────────────────────────────────────────

  private loadTemplate(): void {
    this.clearGraph();

    // Build a sample geopolitical graph
    const entities: Array<[string, NodeCategory]> = [
      ['Russia', 'country'], ['Ukraine', 'country'], ['USA', 'country'],
      ['China', 'country'], ['Iran', 'country'], ['Israel', 'country'],
      ['NATO', 'organization'], ['Taiwan', 'country'],
      ['Putin', 'person'], ['Xi Jinping', 'person'], ['Zelensky', 'person'],
      ['Ukraine War', 'event'], ['Taiwan Strait', 'event'],
    ];

    for (const [label, cat] of entities) {
      this.addNode(label, cat);
    }
  }

  // ── Live Data Loading ────────────────────────────────────────

  private async loadLiveData(): Promise<void> {
    this.showAnalysis('<div class="igp-analyzing">Loading live intelligence graph...</div>', false);
    try {
      const resp = await fetch('/api/intelligence/entity-graph', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.nodes?.length) {
        this.showAnalysis('No entity graph data available. Seed pipeline may not have run yet.', true);
        return;
      }

      // Also persist to perpetual intelligence DB
      try {
        const { ingestBatch } = await import('../services/intel-graph-db');
        const result = await ingestBatch('neo4j', data.nodes, data.links || []);
        const dbInfo = `(+${result.newNodes} new, ${result.updatedNodes} updated in perpetual DB)`;
        this.ingestGraphData(data.nodes, data.links || []);
        this.showAnalysis(
          `<div class="igp-analysis-section"><strong>Live graph loaded:</strong> ${data.nodes.length} entities, ${(data.links || []).length} connections ${dbInfo}</div>` +
          (data.builtAt ? `<div class="igp-analysis-section">Last updated: ${new Date(data.builtAt).toLocaleString()}</div>` : ''),
          false
        );
      } catch {
        // Perpetual DB failed — still show the graph
        this.ingestGraphData(data.nodes, data.links || []);
        this.showAnalysis(
          `<div class="igp-analysis-section"><strong>Live graph loaded:</strong> ${data.nodes.length} entities, ${(data.links || []).length} connections</div>` +
          (data.builtAt ? `<div class="igp-analysis-section">Last updated: ${new Date(data.builtAt).toLocaleString()}</div>` : ''),
          false
        );
      }
    } catch (err) {
      this.showAnalysis('Failed to load live graph: ' + (err instanceof Error ? err.message : 'Unknown error'), true);
    }
  }

  public setData(data: { nodes: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> }): void {
    if (!data.nodes?.length) return;
    this.ingestGraphData(data.nodes, data.links || []);
  }

  private ingestGraphData(nodes: Array<Record<string, unknown>>, links: Array<Record<string, unknown>>): void {
    this.clearGraph();
    const typeMap: Record<string, NodeCategory> = {
      'Person': 'person',
      'Country': 'country',
      'Event': 'event',
      'Region': 'organization',
    };

    for (const n of nodes) {
      const category = typeMap[n.type as string] || 'topic';
      const parts: string[] = [];
      if (n.role) parts.push(String(n.role));
      if (n.riskLevel) parts.push('Risk: ' + String(n.riskLevel));
      if (n.source) parts.push('Source: ' + String(n.source));
      const notes = parts.length ? parts.join(' · ') : undefined;
      this.addNode(String(n.label || n.id), category, notes);
    }

    for (const link of links) {
      const sourceLabel = String(link.source);
      const targetLabel = String(link.target);
      // Find node IDs by matching labels/ids
      const sourceNode = this.graphNodes.find(n =>
        n.id === sourceLabel || n.label.toLowerCase() === sourceLabel.toLowerCase()
      );
      const targetNode = this.graphNodes.find(n =>
        n.id === targetLabel || n.label.toLowerCase() === targetLabel.toLowerCase()
      );
      if (sourceNode && targetNode) {
        this.addEdge(
          sourceNode.id,
          targetNode.id,
          Math.min(10, Math.max(1, Number(link.weight) || 3)),
          String(link.type || 'related'),
          true
        );
      }
    }

    this.recalcWeights();
    this.restartSimulation();
    this.saveState();
  }

  // ── AI Analysis ──────────────────────────────────────────────

  private async runAnalysis(): Promise<void> {
    if (this.graphNodes.length < 2) {
      this.showAnalysis('Add at least 2 entities to run AI analysis.', true);
      return;
    }
    if (this.isAnalyzing) return;
    this.isAnalyzing = true;
    this.showAnalysis('<div class="igp-analyzing">Analyzing graph connections...</div>', false);

    try {
      // Build the graph description for the AI
      const graphDesc = this.buildGraphDescription();

      const resp = await fetch('/api/graph-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: graphDesc }),
        signal: AbortSignal.timeout(25_000),
      });

      if (!resp.ok) {
        // Fallback to local analysis if API is unavailable
        this.showAnalysis(this.localAnalysis(), false);
        return;
      }

      const data = await resp.json();
      if (data.analysis) {
        this.showAnalysis(this.formatAnalysis(data.analysis), false);
      } else {
        this.showAnalysis(this.localAnalysis(), false);
      }
    } catch {
      // Fallback to local analysis
      this.showAnalysis(this.localAnalysis(), false);
    } finally {
      this.isAnalyzing = false;
    }
  }

  private buildGraphDescription(): string {
    const nodeDescs = this.graphNodes.map(n => `${n.label} (${n.category})`).join(', ');
    const edgeDescs = this.graphEdges.map(e => {
      const s = (typeof e.source === 'object' ? (e.source as GraphNode).label : e.source);
      const t = (typeof e.target === 'object' ? (e.target as GraphNode).label : e.target);
      return `${s} ↔ ${t} [strength: ${e.strength}/10, reason: ${e.reason}]`;
    }).join('\n');

    return `ENTITIES: ${nodeDescs}\n\nCONNECTIONS:\n${edgeDescs || '(no connections discovered)'}`;
  }

  /** Fallback analysis when API is unavailable — runs locally */
  private localAnalysis(): string {
    const nodeCount = this.graphNodes.length;
    const edgeCount = this.graphEdges.length;
    const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;

    // Find most connected node
    const sorted = [...this.graphNodes].sort((a, b) => b.weight - a.weight);
    const hub = sorted[0];

    // Find strongest edge
    const strongestEdge = [...this.graphEdges].sort((a, b) => b.strength - a.strength)[0];

    // Category distribution
    const catCounts: Record<string, number> = {};
    for (const n of this.graphNodes) catCounts[n.category] = (catCounts[n.category] || 0) + 1;

    let html = `<div class="igp-analysis-section"><strong>Graph overview:</strong> ${nodeCount} entities, ${edgeCount} connections, density ${(density * 100).toFixed(0)}%</div>`;

    if (hub && hub.weight > 0) {
      html += `<div class="igp-analysis-section"><strong>Central hub:</strong> ${hub.label} (${hub.weight} connections) — this entity is the most interconnected node in your graph, suggesting it plays a pivotal role in the intelligence picture.</div>`;
    }

    if (strongestEdge) {
      const s = (typeof strongestEdge.source === 'object') ? (strongestEdge.source as GraphNode).label : strongestEdge.source;
      const t = (typeof strongestEdge.target === 'object') ? (strongestEdge.target as GraphNode).label : strongestEdge.target;
      html += `<div class="igp-analysis-section"><strong>Strongest link:</strong> ${s} ↔ ${t} (${strongestEdge.strength}/10) — ${strongestEdge.reason}</div>`;
    }

    // Isolated nodes
    const isolated = this.graphNodes.filter(n => n.weight === 0);
    if (isolated.length > 0) {
      html += `<div class="igp-analysis-section"><strong>Isolated entities:</strong> ${isolated.map(n => n.label).join(', ')} — no discovered connections. Consider adding related entities to reveal hidden links.</div>`;
    }

    html += `<div class="igp-analysis-note">Connect Groq API key for AI-powered analysis with pattern detection, risk assessment, and predictive insights.</div>`;
    return html;
  }

  private formatAnalysis(text: string): string {
    // Convert newlines to paragraphs
    return text.split('\n\n').map(p => `<div class="igp-analysis-section">${this.escHtml(p.trim())}</div>`).join('');
  }

  private showAnalysis(html: string, isError: boolean): void {
    this.analysisEl.style.display = 'block';
    this.analysisEl.innerHTML = `
      <div class="igp-analysis-header">
        <span>🧠 AI Analysis</span>
        <button class="igp-analysis-close" onclick="this.closest('.igp-analysis').style.display='none'">×</button>
      </div>
      <div class="igp-analysis-body${isError ? ' igp-analysis-error' : ''}">${html}</div>
    `;
  }

  // ── State Persistence ────────────────────────────────────────

  private saveState(): void {
    const state: GraphState = {
      nodes: this.graphNodes.map(n => ({
        id: n.id,
        label: n.label,
        category: n.category,
        notes: n.notes,
      })),
      edges: this.graphEdges.map(e => ({
        id: e.id,
        sourceId: typeof e.source === 'object' ? (e.source as GraphNode).id : e.source,
        targetId: typeof e.target === 'object' ? (e.target as GraphNode).id : e.target,
        strength: e.strength,
        reason: e.reason,
        autoDiscovered: e.autoDiscovered,
      })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* quota exceeded — ignore */ }
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state: GraphState = JSON.parse(raw);
      if (!state.nodes?.length) return;

      for (const n of state.nodes) {
        this.graphNodes.push({
          id: n.id,
          label: n.label,
          category: n.category,
          weight: 0,
          notes: n.notes,
          x: this.width / 2 + (Math.random() - 0.5) * 200,
          y: this.height / 2 + (Math.random() - 0.5) * 200,
        });
      }

      for (const e of state.edges) {
        this.graphEdges.push({
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          strength: e.strength,
          reason: e.reason,
          autoDiscovered: e.autoDiscovered,
        });
      }

      this.recalcWeights();
    } catch { /* corrupted state — start fresh */ }
  }

  // ── Utilities ────────────────────────────────────────────────

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Lifecycle ────────────────────────────────────────────────

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    this.simulation?.stop();
    this.resizeObserver?.disconnect();
    super.destroy();
  }
}
