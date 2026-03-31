// src/components/Sidebar/Sidebar.ts
//
// *** RENAME: delete Sidebar.tsx → Sidebar.ts ***
//
// FIXES:
//   - TS7016: @types/react not installed
//   - TS17004: --jsx not set
//   - TS7026: No JSX.IntrinsicElements
//   - TS6142: usePanelRegistration.tsx resolved but --jsx not set
//   - TS2307: Cannot find module './SidebarItem'
//   - TS7031: 'onToggle' implicitly any
//   - TS7006: 'panel' implicitly any
//   - TS2345: Array.from(categories.entries()).map destructure type error
//
// Rewritten as a vanilla class that builds DOM directly.

import { panelRegistry, type PanelCategory } from '../../utils/panelRegistry';

export class Sidebar {
  readonly element: HTMLElement;
  private collapsed = false;

  constructor(onToggle?: () => void) {
    this.element = document.createElement('aside');
    this.element.className = 'sidebar';
    this.render(onToggle);
  }

  private render(onToggle?: () => void): void {
    const panels = panelRegistry.getEnabledPanels();
    const categoryMap = new Map<PanelCategory, typeof panels>();

    panels.forEach(panel => {
      const cat = panel.category;
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(panel);
    });

    const headerHtml = `
      <div class="sidebar-header">
        <h2 class="sidebar-title">${this.collapsed ? 'O' : 'OSINT Worldview'}</h2>
        <button class="toggle-button" id="sidebar-toggle">
          ${this.collapsed ? '→' : '←'}
        </button>
      </div>`;

    const categoriesHtml = Array.from(categoryMap.entries()).map(([category, categoryPanels]) => `
      <div class="sidebar-category">
        ${!this.collapsed ? `<h3 class="category-title">${category.charAt(0).toUpperCase() + category.slice(1)}</h3>` : ''}
        <ul class="category-items">
          ${categoryPanels.map(panel => `
            <li class="sidebar-item" data-panel-id="${panel.id}" title="${panel.description}">
              <span class="sidebar-icon">${panel.icon}</span>
              ${!this.collapsed ? `<span class="sidebar-label">${panel.name}</span>` : ''}
            </li>`).join('')}
        </ul>
      </div>`).join('');

    const emptyHtml = panels.length === 0
      ? '<div class="sidebar-empty"><p>No panels registered</p></div>'
      : '';

    this.element.className = `sidebar${this.collapsed ? ' collapsed' : ''}`;
    this.element.innerHTML = `
      ${headerHtml}
      <nav class="sidebar-nav">
        ${categoriesHtml}
        ${emptyHtml}
      </nav>`;

    this.element.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      onToggle?.();
      this.render(onToggle);
    });
  }
}
