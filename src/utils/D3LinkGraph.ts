import * as d3 from 'd3';

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
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship: string;
  weight?: number;          // link strength 0–1
  source_type?: 'manual' | 'api' | 'inferred';
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

// ── D3 Graph Renderer ────────────────────────────────────────

export class D3LinkGraph {
  private container: HTMLElement;
  private width: number;
  private height: number;
  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private mainGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  // Live selections updated on re-render
  private linkSel: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null = null;
  private nodeSel: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null = null;
  private labelSel: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown> | null = null;
  private linkLabelSel: d3.Selection<SVGTextElement, GraphLink, SVGGElement, unknown> | null = null;

  // Tooltip element
  private tooltip: HTMLDivElement | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`[D3LinkGraph] Container #${containerId} not found`);
    this.container = el;

    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 600;
  }

  public render(nodes: GraphNode[], links: GraphLink[]): void {
    this.container.innerHTML = '';

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
      maxWidth: '250px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      backdropFilter: 'blur(8px)',
    });
    this.container.style.position = 'relative';
    this.container.appendChild(this.tooltip);

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, this.width, this.height].join(' '))
      .style('background-color', 'transparent');

    // Defs for gradients and markers
    const defs = this.svg.append('defs');

    // Arrowhead marker
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -3 8 6')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-3L8,0L0,3')
      .attr('fill', '#555');

    // Glow filter for hovered/high-confidence nodes
    const glow = defs.append('filter').attr('id', 'glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    glow.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode')
      .attr('in', d => d);

    // Subtle grid pattern
    const pattern = defs.append('pattern')
      .attr('id', 'grid')
      .attr('width', 40).attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');
    pattern.append('rect')
      .attr('width', 40).attr('height', 40)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(128,128,160,0.05)')
      .attr('stroke-width', 0.5);

    // Grid background
    this.svg.append('rect')
      .attr('width', this.width).attr('height', this.height)
      .attr('fill', 'url(#grid)');

    this.mainGroup = this.svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .on('zoom', (event) => {
        this.mainGroup?.attr('transform', event.transform);
      });
    this.svg.call(zoom);

    // Link group (rendered below nodes)
    const linkG = this.mainGroup.append('g').attr('class', 'links');
    const linkLabelG = this.mainGroup.append('g').attr('class', 'link-labels');
    const nodeG = this.mainGroup.append('g').attr('class', 'nodes');
    const labelG = this.mainGroup.append('g').attr('class', 'node-labels');

    this.simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance(d => 100 + (1 - (d.weight ?? 0.5)) * 80)
        .strength(d => d.weight ?? 0.5)
      )
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collide', d3.forceCollide().radius(32))
      .force('x', d3.forceX(this.width / 2).strength(0.02))
      .force('y', d3.forceY(this.height / 2).strength(0.02))
      .alphaDecay(0.02);

    this.updateSelections(linkG, linkLabelG, nodeG, labelG, nodes, links);

    this.simulation.on('tick', () => this.tick());
  }

  // Add nodes/links to a live simulation (without full re-render)
  public addToGraph(newNodes: GraphNode[], newLinks: GraphLink[]): void {
    if (!this.simulation || !this.mainGroup) return;

    const existingNodes = this.simulation.nodes();
    const existingLinks = (this.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links();

    // Deduplicate
    const existingIds = new Set(existingNodes.map(n => n.id));
    const toAddNodes = newNodes.filter(n => !existingIds.has(n.id));

    // Seed new nodes near the center of the graph
    const cx = this.width / 2;
    const cy = this.height / 2;
    toAddNodes.forEach(n => {
      n.x = cx + (Math.random() - 0.5) * 100;
      n.y = cy + (Math.random() - 0.5) * 100;
    });

    const allNodes = [...existingNodes, ...toAddNodes];
    const allIds = new Set(allNodes.map(n => n.id));

    const existingLinkKeys = new Set(existingLinks.map(l => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return `${s}:${t}`;
    }));
    const toAddLinks = newLinks.filter(l => {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      return allIds.has(s) && allIds.has(t) && !existingLinkKeys.has(`${s}:${t}`) && !existingLinkKeys.has(`${t}:${s}`);
    });

    const allLinks = [...existingLinks, ...toAddLinks];

    // Update simulation
    this.simulation.nodes(allNodes);
    (this.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(allLinks);
    this.simulation.alpha(0.4).restart();

    // Update DOM selections
    const linkG = this.mainGroup.select<SVGGElement>('.links');
    const linkLabelG = this.mainGroup.select<SVGGElement>('.link-labels');
    const nodeG = this.mainGroup.select<SVGGElement>('.nodes');
    const labelG = this.mainGroup.select<SVGGElement>('.node-labels');
    this.updateSelections(linkG, linkLabelG, nodeG, labelG, allNodes, allLinks);
  }

  private updateSelections(
    linkG: d3.Selection<SVGGElement, unknown, null, unknown>,
    linkLabelG: d3.Selection<SVGGElement, unknown, null, unknown>,
    nodeG: d3.Selection<SVGGElement, unknown, null, unknown>,
    labelG: d3.Selection<SVGGElement, unknown, null, unknown>,
    nodes: GraphNode[],
    links: GraphLink[],
  ): void {
    if (!this.simulation) return;

    // Links
    this.linkSel = linkG.selectAll<SVGLineElement, GraphLink>('line')
      .data(links, d => {
        const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return `${s}:${t}`;
      })
      .join('line')
      .attr('stroke', d => d.source_type === 'inferred' ? '#2a3a4a' : d.source_type === 'api' ? '#2a6a4a' : '#444')
      .attr('stroke-opacity', d => 0.3 + (d.weight ?? 0.5) * 0.5)
      .attr('stroke-width', d => 1 + (d.weight ?? 0.5) * 3)
      .attr('stroke-dasharray', d => d.source_type === 'inferred' ? '4,3' : 'none')
      .attr('marker-end', 'url(#arrowhead)');

    // Link labels
    this.linkLabelSel = linkLabelG.selectAll<SVGTextElement, GraphLink>('text')
      .data(links, d => {
        const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return `${s}:${t}`;
      })
      .join('text')
      .text(d => d.relationship)
      .attr('font-size', '9px')
      .attr('fill', '#666')
      .attr('font-family', '"JetBrains Mono", monospace')
      .attr('text-anchor', 'middle')
      .attr('dy', -3);

    // Nodes — use <g> groups for richer rendering
    this.nodeSel = nodeG.selectAll<SVGGElement, GraphNode>('g.node-group')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const groups = enter.append('g')
            .attr('class', 'node-group')
            .style('cursor', 'grab')
            .call(this.drag(this.simulation!) as any);

          // Outer glow ring for high-confidence nodes
          groups.append('circle')
            .attr('class', 'node-glow')
            .attr('r', 0)
            .attr('fill', 'none')
            .attr('stroke', d => this.getColorForType(d.type))
            .attr('stroke-opacity', d => (d.confidence ?? 0.5) > 0.8 ? 0.25 : 0)
            .attr('stroke-width', 2)
            .transition().duration(500)
            .attr('r', d => this.getRadiusForNode(d) + 6);

          // Main node circle
          groups.append('circle')
            .attr('class', 'node-main')
            .attr('r', 0)
            .attr('fill', d => this.getColorForType(d.type))
            .attr('fill-opacity', d => 0.15 + (d.confidence ?? 0.8) * 0.35)
            .attr('stroke', d => this.getColorForType(d.type))
            .attr('stroke-width', d => {
              if (d.source === 'auto-discovered') return 1;
              if (d.source === 'api') return 1.5;
              return 2;
            })
            .attr('stroke-dasharray', d => d.source === 'auto-discovered' ? '3,2' : 'none')
            .transition().duration(400)
            .attr('r', d => this.getRadiusForNode(d));

          // Inner icon text
          groups.append('text')
            .attr('class', 'node-icon')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .attr('font-size', d => `${Math.max(9, this.getRadiusForNode(d) - 2)}px`)
            .attr('pointer-events', 'none')
            .text(d => TYPE_ICONS[(d.type ?? '').toLowerCase()] || '●');

          // Source badge (small dot)
          groups.append('circle')
            .attr('class', 'source-badge')
            .attr('r', 3)
            .attr('cx', d => this.getRadiusForNode(d) - 2)
            .attr('cy', d => -(this.getRadiusForNode(d) - 2))
            .attr('fill', d => {
              if (d.source === 'api') return '#22c55e';
              if (d.source === 'auto-discovered') return '#f59e0b';
              if (d.source === 'map-click') return '#3b82f6';
              return '#888';
            })
            .attr('stroke', '#0a0a0f')
            .attr('stroke-width', 1);

          // Tooltip on hover
          groups.on('mouseenter', (event, d) => this.showTooltip(event, d))
            .on('mouseleave', () => this.hideTooltip());

          return groups;
        },
        update => {
          update.select('.node-main')
            .attr('fill', d => this.getColorForType(d.type))
            .attr('fill-opacity', d => 0.15 + (d.confidence ?? 0.8) * 0.35)
            .attr('stroke', d => this.getColorForType(d.type));
          return update;
        },
        exit => exit.transition().duration(300)
          .style('opacity', 0)
          .remove()
      );

    // Node labels
    this.labelSel = labelG.selectAll<SVGTextElement, GraphNode>('text')
      .data(nodes, d => d.id)
      .join('text')
      .text(d => d.label)
      .attr('font-size', '11px')
      .attr('dx', d => this.getRadiusForNode(d) + 4)
      .attr('dy', 4)
      .attr('fill', d => {
        if (d.source === 'auto-discovered') return '#888';
        const c = this.getColorForType(d.type);
        return c + 'cc';
      })
      .attr('font-family', '"Geist", sans-serif')
      .attr('font-weight', d => (d.confidence ?? 0.5) > 0.8 ? '600' : '400')
      .style('pointer-events', 'none')
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)');
  }

  private showTooltip(event: MouseEvent, d: GraphNode): void {
    if (!this.tooltip) return;
    const icon = TYPE_ICONS[(d.type ?? '').toLowerCase()] || '●';
    const color = this.getColorForType(d.type);
    const age = d.lastSeen ? this.formatAge(d.lastSeen) : 'unknown';
    const conf = Math.round((d.confidence ?? 0.8) * 100);

    this.tooltip.innerHTML = `
      <div style="font-weight:600;color:${color};margin-bottom:4px">${icon} ${this.esc(d.label)}</div>
      <div style="font-size:10px;color:#888;margin-bottom:3px">${d.type}${d.country ? ' · ' + d.country : ''}</div>
      <div style="font-size:10px;display:flex;gap:8px;color:#aaa">
        <span>Conf: <span style="color:${conf > 70 ? '#22c55e' : '#f59e0b'}">${conf}%</span></span>
        <span>Source: ${d.source || 'manual'}</span>
      </div>
      ${d.mentions ? `<div style="font-size:10px;color:#aaa;margin-top:2px">Mentions: ${d.mentions}</div>` : ''}
      <div style="font-size:9px;color:#666;margin-top:3px">Last seen: ${age}</div>
    `;
    this.tooltip.style.display = 'block';

    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${event.clientX - rect.left + 12}px`;
    this.tooltip.style.top = `${event.clientY - rect.top - 10}px`;
  }

  private hideTooltip(): void {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  private tick(): void {
    this.linkSel
      ?.attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    this.linkLabelSel
      ?.attr('x', (d: any) => (d.source.x + d.target.x) / 2)
      .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

    this.nodeSel
      ?.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

    this.labelSel
      ?.attr('x', (d: any) => d.x)
      .attr('y', (d: any) => d.y);
  }

  private getColorForType(type: string): string {
    return TYPE_COLORS[(type ?? '').toLowerCase()] || '#9ca3af';
  }

  private getRadiusForNode(node: GraphNode): number {
    const base = 10;
    const mentionBoost = Math.min(8, Math.log10((node.mentions ?? 0) + 1) * 3);
    const confBoost = (node.confidence ?? 0.5) * 4;
    return base + mentionBoost + confBoost;
  }

  private drag(simulation: d3.Simulation<GraphNode, GraphLink>) {
    return d3.drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
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

  public destroy(): void {
    stopAutoDiscovery();
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    this.container.innerHTML = '';
  }

  // Kick the simulation (call when new nodes added)
  public reheat(): void {
    this.simulation?.alpha(0.4).restart();
  }
}
