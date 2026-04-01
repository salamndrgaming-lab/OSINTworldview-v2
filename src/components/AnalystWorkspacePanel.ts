import { Panel } from './Panel';
import { D3LinkGraph } from '../utils/D3LinkGraph';

export class AnalystWorkspacePanel extends Panel {
  private currentTab: string = 'entity-intel';
  private graphInstance: D3LinkGraph | null = null;
  private tabs =[
    { id: 'entity-intel', label: 'Entity Intel' },
    { id: 'link-graph', label: 'Link Graph' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'notepad', label: 'Notepad' },
    { id: 'osint-toolkit', label: 'OSINT Toolkit' }
  ];

  constructor(config: any) {
    super(config);
    this.content.innerHTML = '';
    this.buildUI();
  }

  protected buildUI() {
    this.content.innerHTML = `
      <div class="workspace-container" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
        <div class="workspace-tabs" style="display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid #333; overflow-x: auto;">
          ${this.tabs.map(t => `
            <button class="tab-btn ${this.currentTab === t.id ? 'active' : ''}" 
                    data-tab="${t.id}"
                    style="padding: 6px 12px; background: ${this.currentTab === t.id ? '#f59e0b' : '#222'}; color: ${this.currentTab === t.id ? '#000' : '#ccc'}; border: none; border-radius: 4px; cursor: pointer; font-family: 'Geist', sans-serif; white-space: nowrap;">
              ${t.label}
            </button>
          `).join('')}
        </div>
        <div id="workspace-content-area" style="flex: 1; position: relative; overflow: hidden; background: #0a0a0a;">
          <!-- Tab content injected here -->
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderTabContent();
  }

  private bindEvents() {
    const btns = this.content.querySelectorAll('.tab-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        this.currentTab = target.getAttribute('data-tab') || 'entity-intel';
        this.buildUI(); // Re-render shell
      });
    });
  }

  private renderTabContent() {
    const contentArea = this.content.querySelector('#workspace-content-area');
    if (!contentArea) return;

    contentArea.innerHTML = '';
    if (this.graphInstance) {
      this.graphInstance.destroy();
      this.graphInstance = null;
    }

    switch (this.currentTab) {
      case 'link-graph':
        contentArea.innerHTML = `<div id="link-graph-container" style="width: 100%; height: 100%;"></div>`;
        this.initLinkGraph();
        break;
      case 'entity-intel':
        contentArea.innerHTML = `<div style="padding: 16px; color: #888; font-family: 'JetBrains Mono', monospace;">Select an entity from the map or search to view intel...</div>`;
        break;
      case 'timeline':
        contentArea.innerHTML = `<div style="padding: 16px; color: #888;">Timeline events will appear here...</div>`;
        break;
      case 'notepad':
        contentArea.innerHTML = `<textarea style="width: 100%; height: 100%; background: transparent; border: none; color: #e5e7eb; padding: 16px; resize: none; font-family: 'JetBrains Mono', monospace;" placeholder="Analyst scratchpad..."></textarea>`;
        break;
      case 'osint-toolkit':
        contentArea.innerHTML = `<div style="padding: 16px; color: #888;">Toolkit integrations (WHOIS, Shodan, etc.) coming soon.</div>`;
        break;
    }
  }

  private async initLinkGraph() {
    try {
      this.graphInstance = new D3LinkGraph('link-graph-container');
      
      const res = await fetch('/api/intelligence/entity-graph');
      if (!res.ok) throw new Error('Failed to load graph data');
      
      const data = await res.json();
      
      if (!data.nodes || data.nodes.length === 0) {
        const container = document.getElementById('link-graph-container');
        if (container) container.innerHTML = '<div style="padding: 16px; color: #888;">No entity graph data available in Neo4j/Redis.</div>';
        return;
      }

      this.graphInstance.render(data.nodes, data.links);
    } catch (err) {
      console.error('[AnalystWorkspace] Graph error:', err);
    }
  }
}