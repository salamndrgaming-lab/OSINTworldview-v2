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

const STORAGE_KEY = 'worldmonitor-link-graph-v2';

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
  private nodeSel: d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown> | null = null;
  private labelSel: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown> | null = null;
  private linkLabelSel: d3.Selection<SVGTextElement, GraphLink, SVGGElement, unknown> | null = null;

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

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, this.width, this.height].join(' '))
      .style('background-color', 'transparent');

    // Defs for link markers
    const defs = this.svg.append('defs');
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
      .attr('stroke', d => d.source_type === 'inferred' ? '#2a3a4a' : d.source_type === 'api' ? '#2a4a3a' : '#444')
      .attr('stroke-opacity', d => 0.3 + (d.weight ?? 0.5) * 0.5)
      .attr('stroke-width', d => 1 + (d.weight ?? 0.5) * 2)
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

    // Nodes
    this.nodeSel = nodeG.selectAll<SVGCircleElement, GraphNode>('circle')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const circles = enter.append('circle')
            .attr('r', 0)
            .attr('fill', d => this.getColorForType(d.type))
            .attr('stroke', d => d.source === 'auto-discovered' ? '#f59e0b44' : '#fff')
            .attr('stroke-width', d => d.source === 'auto-discovered' ? 2 : 1.5)
            .attr('opacity', d => 0.5 + (d.confidence ?? 1) * 0.5)
            .call(this.drag(this.simulation!) as any);

          // Tooltip
          circles.append('title').text(d =>
            `${d.label}\nType: ${d.type}\nSource: ${d.source ?? 'manual'}${d.mentions ? '\nMentions: ' + d.mentions : ''}${d.confidence ? '\nConfidence: ' + Math.round(d.confidence * 100) + '%' : ''}`
          );

          // Animate in
          circles.transition().duration(400).attr('r', d => this.getRadiusForNode(d));

          return circles;
        },
        update => update
          .attr('fill', d => this.getColorForType(d.type))
          .attr('opacity', d => 0.5 + (d.confidence ?? 1) * 0.5),
        exit => exit.transition().duration(300).attr('r', 0).remove()
      );

    // Node labels
    this.labelSel = labelG.selectAll<SVGTextElement, GraphNode>('text')
      .data(nodes, d => d.id)
      .join('text')
      .text(d => d.label)
      .attr('font-size', '11px')
      .attr('dx', 14)
      .attr('dy', 4)
      .attr('fill', d => d.source === 'auto-discovered' ? '#aaa' : '#e5e7eb')
      .attr('font-family', '"Geist", sans-serif')
      .style('pointer-events', 'none');
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
      ?.attr('cx', (d: any) => d.x)
      .attr('cy', (d: any) => d.y);

    this.labelSel
      ?.attr('x', (d: any) => d.x)
      .attr('y', (d: any) => d.y);
  }

  private getColorForType(type: string): string {
    switch ((type ?? '').toLowerCase()) {
      case 'person': return '#f59e0b';
      case 'organization': return '#3b82f6';
      case 'event': return '#ef4444';
      case 'location': return '#10b981';
      case 'country': return '#8b5cf6';
      default: return '#9ca3af';
    }
  }

  private getRadiusForNode(node: GraphNode): number {
    const base = 8;
    const mentionBoost = Math.min(6, Math.log10((node.mentions ?? 0) + 1) * 3);
    return base + mentionBoost;
  }

  private drag(simulation: d3.Simulation<GraphNode, GraphLink>) {
    return d3.drag<SVGCircleElement, GraphNode>()
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
