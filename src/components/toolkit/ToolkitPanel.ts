// src/components/toolkit/ToolkitPanel.ts
//
// *** RENAME: delete ToolkitPanel.tsx → ToolkitPanel.ts ***
//
// FIXES:
//   - TS7016: @types/react not installed
//   - TS17004: --jsx not set
//   - TS6142: ToolFrame.tsx resolved but --jsx not set
//   - TS2307: Cannot find module './toolDefinitions' — now created
//   - TS7006: 'tool'/'t'/'e' implicitly any
//   - TS7026: No JSX.IntrinsicElements
//
// Rewritten as vanilla Panel class.

import { Panel } from '../Panel';
import { ToolFrame } from './ToolFrame';
import { toolDefinitions, type ToolDefinition } from './toolDefinitions';

export class ToolkitPanel extends Panel {
  private toolFrame: ToolFrame;
  private selectedToolId: string | null = null;
  private searchQuery = '';

  constructor() {
    super({ id: 'osint-toolkit', title: 'OSINT Toolkit' });
    this.toolFrame = new ToolFrame();
    this.render();
  }

  private getFilteredTools(): ToolDefinition[] {
    const q = this.searchQuery.toLowerCase();
    if (!q) return toolDefinitions;
    return toolDefinitions.filter(
      (t: ToolDefinition) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
    );
  }

  private render(): void {
    const filtered = this.getFilteredTools();
    const categories = [...new Set(toolDefinitions.map((t: ToolDefinition) => t.category))];

    const sidebarHtml = categories.map((category: string) => {
      const catTools = filtered.filter((t: ToolDefinition) => t.category === category);
      if (catTools.length === 0) return '';
      return `
        <div class="category-group">
          <h3>${category}</h3>
          <ul>
            ${catTools.map((tool: ToolDefinition) => `
              <li class="toolkit-tool-item${this.selectedToolId === tool.id ? ' active' : ''}"
                  data-tool-id="${tool.id}">
                <span class="tool-icon">${tool.icon}</span>
                <span class="tool-name">${tool.name}</span>
              </li>`).join('')}
          </ul>
        </div>`;
    }).join('');

    const mainHtml = this.selectedToolId
      ? '' // ToolFrame element inserted via DOM after render
      : `<div class="toolkit-welcome">
           <h3>Select a tool to get started</h3>
           <p>Choose from ${toolDefinitions.length} OSINT tools on the left</p>
         </div>`;

    this.content.innerHTML = `
      <div class="toolkit-panel">
        <div class="toolkit-header">
          <h2>OSINT Toolkit</h2>
          <input
            type="text"
            id="toolkit-search"
            placeholder="Search tools…"
            value="${this.searchQuery}"
            class="toolkit-search"
          />
        </div>
        <div class="toolkit-content">
          <div class="toolkit-sidebar">
            <div class="toolkit-categories">${sidebarHtml}</div>
          </div>
          <div class="toolkit-main" id="toolkit-main">${mainHtml}</div>
        </div>
      </div>`;

    // Mount ToolFrame if a tool is selected
    if (this.selectedToolId) {
      const mainContainer = this.content.querySelector<HTMLElement>('#toolkit-main');
      if (mainContainer) {
        mainContainer.appendChild(this.toolFrame.element);
      }
    }

    // Wire up search
    this.content.querySelector<HTMLInputElement>('#toolkit-search')
      ?.addEventListener('input', (e: Event) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        this.render();
      });

    // Wire up tool selection
    this.content.querySelectorAll<HTMLElement>('.toolkit-tool-item')
      .forEach((li: HTMLElement) => {
        li.addEventListener('click', () => {
          const id = li.dataset['toolId'];
          if (!id) return;
          this.selectedToolId = id;
          const tool = toolDefinitions.find((t: ToolDefinition) => t.id === id);
          if (tool) this.toolFrame.show(tool);
          this.render();
        });
      });
  }
}

export default ToolkitPanel;
