import { Panel } from './Panel';

export interface CompoundTab {
  id: string;
  label: string;
  loader: () => Promise<Panel>;
}

const STORAGE_PREFIX = 'wm-compound-tab-';

/**
 * CompoundPanel — A single registered panel that internally renders
 * tabbed sub-panels. Reduces settings clutter from ~70 to ~25 toggles.
 *
 * Usage:
 *   class IntelHubPanel extends CompoundPanel {
 *     constructor() {
 *       super({ id: 'intel-hub', title: 'Intelligence Command' }, [
 *         { id: 'gdelt-feed', label: 'GDELT Feed', loader: () => import('./GdeltIntelPanel').then(m => new m.GdeltIntelPanel()) },
 *         ...
 *       ]);
 *     }
 *   }
 */
export class CompoundPanel extends Panel {
  private tabs: CompoundTab[];
  private activeTabId: string;
  private subPanels = new Map<string, Panel>();
  private tabStrip: HTMLElement | null = null;
  private contentArea: HTMLElement | null = null;
  private loading = false;

  constructor(
    options: { id: string; title: string; defaultRowSpan?: number },
    tabs: CompoundTab[],
  ) {
    super({ id: options.id, title: options.title, defaultRowSpan: options.defaultRowSpan ?? 2 });
    this.tabs = tabs;
    this.activeTabId = localStorage.getItem(STORAGE_PREFIX + options.id) || tabs[0]?.id || '';
    this.content.innerHTML = '';
    this.buildCompoundUI();
  }

  private buildCompoundUI(): void {
    this.content.innerHTML = '';
    this.content.style.display = 'flex';
    this.content.style.flexDirection = 'column';
    this.content.style.height = '100%';
    this.content.style.overflow = 'hidden';

    // Tab strip
    this.tabStrip = document.createElement('div');
    this.tabStrip.className = 'compound-tab-strip';
    this.renderTabStrip();
    this.content.appendChild(this.tabStrip);

    // Content area where sub-panel content mounts
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'compound-content-area';
    this.content.appendChild(this.contentArea);

    // Inject scoped styles once
    CompoundPanel.injectStyles();

    // Load initial tab
    void this.switchTab(this.activeTabId);
  }

  private renderTabStrip(): void {
    if (!this.tabStrip) return;
    this.tabStrip.innerHTML = this.tabs.map(tab =>
      '<button class="compound-tab' + (tab.id === this.activeTabId ? ' active' : '') + '" data-tab="' + tab.id + '">' + tab.label + '</button>'
    ).join('');

    this.tabStrip.querySelectorAll('.compound-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = (btn as HTMLElement).dataset.tab;
        if (tabId && tabId !== this.activeTabId && !this.loading) {
          void this.switchTab(tabId);
        }
      });
    });
  }

  private async switchTab(tabId: string): Promise<void> {
    this.activeTabId = tabId;
    localStorage.setItem(STORAGE_PREFIX + this.panelId, tabId);
    this.renderTabStrip();

    if (!this.contentArea) return;

    // Hide all mounted sub-panels
    for (const [id, panel] of this.subPanels) {
      const el = panel.getElement();
      el.style.display = id === tabId ? '' : 'none';
    }

    // If already loaded, just show it
    if (this.subPanels.has(tabId)) return;

    // Lazy-load the sub-panel
    const tabDef = this.tabs.find(t => t.id === tabId);
    if (!tabDef) return;

    this.loading = true;
    this.contentArea.insertAdjacentHTML('beforeend',
      '<div class="compound-loading" id="compound-load-' + tabId + '">Loading...</div>');

    try {
      const subPanel = await tabDef.loader();
      this.subPanels.set(tabId, subPanel);

      // Remove loading indicator
      this.contentArea.querySelector('#compound-load-' + tabId)?.remove();

      // Mount sub-panel: take its full element but hide its header
      const el = subPanel.getElement();
      el.style.display = '';
      const subHeader = el.querySelector('.panel-header') as HTMLElement | null;
      if (subHeader) subHeader.style.display = 'none';
      // Remove outer panel chrome (border, bg) since hub provides it
      el.style.border = 'none';
      el.style.background = 'transparent';
      el.style.borderRadius = '0';
      el.style.height = '100%';
      el.style.minHeight = '0';
      this.contentArea.appendChild(el);
    } catch (err) {
      console.error('[CompoundPanel] Failed to load tab "' + tabId + '":', err);
      const loadingEl = this.contentArea.querySelector('#compound-load-' + tabId);
      if (loadingEl) loadingEl.textContent = 'Failed to load tab';
    } finally {
      this.loading = false;
    }
  }

  /** Get all loaded sub-panels for data replay registration. */
  public getSubPanels(): Map<string, Panel> {
    return this.subPanels;
  }

  /** Get the sub-panel IDs this hub manages. */
  public getSubPanelIds(): string[] {
    return this.tabs.map(t => t.id);
  }

  /** Force-load a specific sub-panel (for data replay from panel-layout). */
  public async ensureSubPanel(tabId: string): Promise<Panel | null> {
    if (this.subPanels.has(tabId)) return this.subPanels.get(tabId)!;
    const tabDef = this.tabs.find(t => t.id === tabId);
    if (!tabDef) return null;
    try {
      const subPanel = await tabDef.loader();
      this.subPanels.set(tabId, subPanel);
      // Mount hidden
      const el = subPanel.getElement();
      el.style.display = 'none';
      const subHeader = el.querySelector('.panel-header') as HTMLElement | null;
      if (subHeader) subHeader.style.display = 'none';
      el.style.border = 'none';
      el.style.background = 'transparent';
      el.style.borderRadius = '0';
      el.style.height = '100%';
      el.style.minHeight = '0';
      this.contentArea?.appendChild(el);
      return subPanel;
    } catch {
      return null;
    }
  }

  private static stylesInjected = false;
  private static injectStyles(): void {
    if (CompoundPanel.stylesInjected) return;
    CompoundPanel.stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .compound-tab-strip {
        display: flex;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border, #222);
        overflow-x: auto;
        scrollbar-width: none;
        flex-shrink: 0;
      }
      .compound-tab-strip::-webkit-scrollbar { display: none; }
      .compound-tab {
        flex: 0 0 auto;
        padding: 5px 10px;
        background: transparent;
        color: var(--text-secondary, #888);
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'JetBrains Mono', 'Geist Mono', monospace;
        font-size: 11px;
        white-space: nowrap;
        transition: all 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .compound-tab:hover {
        background: var(--bg-tertiary, #1a1a2e);
        color: var(--text-primary, #e5e7eb);
      }
      .compound-tab.active {
        background: var(--accent-subtle, rgba(245, 158, 11, 0.12));
        color: var(--accent-color, #f59e0b);
        border-color: var(--accent-color, #f59e0b);
        font-weight: 600;
      }
      .compound-content-area {
        flex: 1;
        overflow: hidden;
        position: relative;
        min-height: 0;
      }
      .compound-loading {
        padding: 24px;
        color: var(--text-tertiary, #555);
        font-size: 12px;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }
}
