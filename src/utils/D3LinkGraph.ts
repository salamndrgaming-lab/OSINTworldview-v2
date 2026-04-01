import * as d3 from 'd3';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'Person' | 'Organization' | 'Event' | 'Location' | string;
  group?: number;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship: string;
}

export class D3LinkGraph {
  private container: HTMLElement;
  private width: number;
  private height: number;
  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`[D3LinkGraph] Container #${containerId} not found`);
    this.container = el;
    
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 600;
  }

  public render(nodes: GraphNode[], links: GraphLink[]) {
    this.container.innerHTML = ''; // Clear previous renders

    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox',[0, 0, this.width, this.height])
      .style('background-color', 'transparent');

    const mainGroup = svg.append('g');

    // Semantic zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        mainGroup.attr('transform', event.transform);
      });
    svg.call(zoom);

    this.simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collide', d3.forceCollide().radius(30));

    // Links
    const link = mainGroup.append('g')
      .attr('stroke', '#444')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', 1.5);

    const linkLabels = mainGroup.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .text(d => d.relationship)
      .attr('font-size', '10px')
      .attr('fill', '#888')
      .attr('font-family', '"JetBrains Mono", monospace');

    // Nodes
    const node = mainGroup.append('g')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', 8)
      .attr('fill', d => this.getColorForType(d.type))
      .call(this.drag(this.simulation) as any);

    const nodeLabels = mainGroup.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.label)
      .attr('font-size', '12px')
      .attr('dx', 12)
      .attr('dy', 4)
      .attr('fill', '#e5e7eb')
      .attr('font-family', '"Geist", sans-serif');

    this.simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabels
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      nodeLabels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });
  }

  private getColorForType(type: string): string {
    switch (type.toLowerCase()) {
      case 'person': return '#f59e0b'; // Amber intel accent
      case 'organization': return '#3b82f6';
      case 'event': return '#ef4444';
      case 'location': return '#10b981';
      default: return '#9ca3af';
    }
  }

  private drag(simulation: d3.Simulation<GraphNode, GraphLink>) {
    return d3.drag()
      .on('start', (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  public destroy() {
    if (this.simulation) {
      this.simulation.stop();
    }
    this.container.innerHTML = '';
  }
}