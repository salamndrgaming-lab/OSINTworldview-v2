import { GraphNode, GraphLink } from '../utils/D3LinkGraph';

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type Subscriber = (data: GraphData) => void;

class WorkspaceService {
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private subscribers: Subscriber[] = [];
  private isInitialLoadComplete = false;

  constructor() {
    this.loadInitialGraph();
  }

  public async loadInitialGraph() {
    if (this.isInitialLoadComplete) return;
    try {
      const res = await fetch('/api/intelligence/entity-graph');
      if (!res.ok) throw new Error('Failed to fetch initial entity graph');
      const data: GraphData = await res.json();
      
      this.nodes = data.nodes || [];
      this.links = data.links || [];
      
      this.isInitialLoadComplete = true;
      this.notify();
    } catch (error) {
      console.error('[WorkspaceService] Error loading initial graph:', error);
    }
  }

  public addEntity(entity: any) {
    // Basic validation
    if (!entity || !entity.id || !entity.label) {
      console.warn('[WorkspaceService] Attempted to add invalid entity:', entity);
      return;
    }

    // Prevent duplicate nodes
    const exists = this.nodes.some(n => n.id === entity.id);
    if (!exists) {
      const newNode: GraphNode = {
        id: entity.id,
        label: entity.label,
        type: entity.type || 'Unknown',
      };
      this.nodes.push(newNode);
      this.notify();
      console.log(`[WorkspaceService] Added entity to graph: ${entity.label}`);
    } else {
      console.log(`[WorkspaceService] Entity already in graph: ${entity.label}`);
    }
  }

  public subscribe(callback: Subscriber) {
    this.subscribers.push(callback);
    // Immediately notify new subscriber with current state
    callback({ nodes: this.nodes, links: this.links });
  }

  public unsubscribe(callback: Subscriber) {
    this.subscribers = this.subscribers.filter(sub => sub !== callback);
  }

  private notify() {
    const data = { nodes: this.nodes, links: this.links };
    for (const subscriber of this.subscribers) {
      try {
        subscriber(data);
      } catch (error) {
        console.error('[WorkspaceService] Error notifying subscriber:', error);
      }
    }
  }
}

export const workspaceService = new WorkspaceService();