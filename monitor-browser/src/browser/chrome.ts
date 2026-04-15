import { bus, type Tab } from '../events/bus';
import { tabManager } from './tabs';
import * as bridge from './webview-bridge';

/**
 * Browser chrome — tab bar + nav controls + URL bar + window controls.
 * Rendered at the top of the window (32px tall via CSS).
 */
export class BrowserChrome {
  private root: HTMLElement;
  private tabsEl!: HTMLElement;
  private urlBar!: HTMLInputElement;
  private backBtn!: HTMLButtonElement;
  private fwdBtn!: HTMLButtonElement;
  private reloadBtn!: HTMLButtonElement;
  private intelBadge!: HTMLElement;
  private unreadCount = 0;
  private webviewFrame!: HTMLIFrameElement;

  constructor(root: HTMLElement, webviewFrame: HTMLIFrameElement) {
    this.root = root;
    this.webviewFrame = webviewFrame;
  }

  mount(): void {
    this.root.classList.add('chrome');
    this.root.innerHTML = '';
    this.root.appendChild(this.buildTitlebar());
    this.root.appendChild(this.buildToolbar());
    this.wireEvents();
    this.render();
  }

  private buildTitlebar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'chrome-titlebar';
    bar.setAttribute('data-tauri-drag-region', '');

    const left = document.createElement('div');
    left.className = 'chrome-titlebar-left';
    left.setAttribute('data-tauri-drag-region', '');

    const logo = document.createElement('div');
    logo.className = 'chrome-logo';
    logo.textContent = 'MONITOR';
    logo.setAttribute('data-tauri-drag-region', '');
    left.appendChild(logo);

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'chrome-tabs';
    left.appendChild(this.tabsEl);

    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'chrome-btn chrome-new-tab';
    newTabBtn.type = 'button';
    newTabBtn.title = 'New tab (⌘T)';
    newTabBtn.setAttribute('aria-label', 'New tab');
    newTabBtn.textContent = '+';
    newTabBtn.addEventListener('click', () => {
      void tabManager.openTab();
    });
    left.appendChild(newTabBtn);

    bar.appendChild(left);

    const controls = document.createElement('div');
    controls.className = 'chrome-window-controls';
    controls.appendChild(this.windowButton('minimize', '─', bridge.windowMinimize));
    controls.appendChild(this.windowButton('maximize', '▢', bridge.windowToggleMaximize));
    controls.appendChild(this.windowButton('close', '✕', bridge.windowClose));
    bar.appendChild(controls);

    return bar;
  }

  private windowButton(
    kind: 'minimize' | 'maximize' | 'close',
    glyph: string,
    handler: () => Promise<void>,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `chrome-wb chrome-wb-${kind}`;
    btn.type = 'button';
    btn.setAttribute('aria-label', kind);
    btn.textContent = glyph;
    btn.addEventListener('click', () => {
      void handler();
    });
    return btn;
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'chrome-toolbar';

    const navGroup = document.createElement('div');
    navGroup.className = 'chrome-nav';

    this.backBtn = this.navButton('←', 'Back', () => void tabManager.back());
    this.fwdBtn = this.navButton('→', 'Forward', () => void tabManager.forward());
    this.reloadBtn = this.navButton('↻', 'Reload', () => void tabManager.reload());
    navGroup.appendChild(this.backBtn);
    navGroup.appendChild(this.fwdBtn);
    navGroup.appendChild(this.reloadBtn);
    bar.appendChild(navGroup);

    const urlWrap = document.createElement('div');
    urlWrap.className = 'chrome-url-wrap';

    this.urlBar = document.createElement('input');
    this.urlBar.className = 'chrome-url';
    this.urlBar.type = 'text';
    this.urlBar.spellcheck = false;
    this.urlBar.autocomplete = 'off';
    this.urlBar.placeholder = 'Search or enter address';
    this.urlBar.addEventListener('focus', () => {
      this.urlBar.select();
    });
    this.urlBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = this.urlBar.value.trim();
        if (value) void this.navigateTo(value);
      } else if (e.key === 'Escape') {
        const active = tabManager.activeTab;
        this.urlBar.value = active?.url ?? '';
        this.urlBar.blur();
      }
    });
    urlWrap.appendChild(this.urlBar);
    bar.appendChild(urlWrap);

    const right = document.createElement('div');
    right.className = 'chrome-actions';

    const intelBtn = document.createElement('button');
    intelBtn.className = 'chrome-btn chrome-intel';
    intelBtn.type = 'button';
    intelBtn.title = 'Toggle Intel overlay (⌘I)';
    intelBtn.setAttribute('aria-label', 'Toggle Intel overlay');
    intelBtn.textContent = '⚡';
    intelBtn.addEventListener('click', () => bus.emit('shortcut:intel-overlay', {}));
    right.appendChild(intelBtn);

    const bell = document.createElement('button');
    bell.className = 'chrome-btn chrome-bell';
    bell.type = 'button';
    bell.title = 'Breaking intel';
    bell.setAttribute('aria-label', 'Breaking intel');
    bell.textContent = '🔔';
    this.intelBadge = document.createElement('span');
    this.intelBadge.className = 'chrome-bell-badge';
    this.intelBadge.hidden = true;
    bell.appendChild(this.intelBadge);
    bell.addEventListener('click', () => bus.emit('shortcut:intel-overlay', {}));
    right.appendChild(bell);

    const settings = document.createElement('button');
    settings.className = 'chrome-btn';
    settings.type = 'button';
    settings.title = 'Settings';
    settings.setAttribute('aria-label', 'Settings');
    settings.textContent = '⚙';
    settings.addEventListener('click', () => void bridge.openDevtools());
    right.appendChild(settings);

    bar.appendChild(right);

    return bar;
  }

  private navButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'chrome-btn chrome-nav-btn';
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = glyph;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private wireEvents(): void {
    bus.on('tab:opened', () => this.render());
    bus.on('tab:closed', () => this.render());
    bus.on('tab:activated', () => this.render());
    bus.on('tab:updated', () => this.render());
    bus.on('nav:navigate', ({ url }) => this.loadInWebview(url));
    bus.on('nav:back', () => {
      const active = tabManager.activeTab;
      if (active) this.loadInWebview(active.url);
    });
    bus.on('nav:forward', () => {
      const active = tabManager.activeTab;
      if (active) this.loadInWebview(active.url);
    });
    bus.on('nav:reload', () => {
      try {
        const src = this.webviewFrame.src;
        this.webviewFrame.src = 'about:blank';
        requestAnimationFrame(() => {
          this.webviewFrame.src = src;
        });
      } catch {
        /* ignore */
      }
    });
    bus.on('intel:count', ({ unread }) => {
      this.unreadCount = unread;
      if (unread > 0) {
        this.intelBadge.hidden = false;
        this.intelBadge.textContent = unread > 99 ? '99+' : String(unread);
      } else {
        this.intelBadge.hidden = true;
        this.intelBadge.textContent = '';
      }
    });
    bus.on('shortcut:focus-url', () => {
      this.urlBar.focus();
      this.urlBar.select();
    });
  }

  private async navigateTo(raw: string): Promise<void> {
    const updated = await tabManager.navigateActive(raw);
    if (updated) this.loadInWebview(updated.url);
  }

  private loadInWebview(url: string): void {
    if (url.startsWith('asset://')) {
      // Asset protocol is not available in vite dev; fall back to local path.
      if (import.meta.env.DEV) {
        this.webviewFrame.src = '/homepage/index.html';
        return;
      }
      // Tauri v2 asset URLs are loaded via the asset.localhost convertFileSrc pattern.
      // For bundled homepage, we ship it under dist/homepage/index.html.
      this.webviewFrame.src = '/homepage/index.html';
      return;
    }
    this.webviewFrame.src = url;
  }

  private render(): void {
    this.renderTabs();
    this.renderUrlBar();
    this.renderNavState();
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = '';
    for (const tab of tabManager.tabs) {
      this.tabsEl.appendChild(this.renderTab(tab));
    }
  }

  private renderTab(tab: Tab): HTMLElement {
    const el = document.createElement('div');
    el.className = 'chrome-tab';
    el.dataset['tabId'] = tab.id;
    if (tab.id === tabManager.activeTabId) el.classList.add('is-active');
    if (tab.isLoading) el.classList.add('is-loading');

    const favicon = document.createElement('span');
    favicon.className = 'chrome-tab-favicon';
    if (tab.favicon) {
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.alt = '';
      favicon.appendChild(img);
    } else {
      favicon.textContent = tab.url.startsWith('asset://') ? '◉' : '○';
    }
    el.appendChild(favicon);

    const title = document.createElement('span');
    title.className = 'chrome-tab-title';
    title.textContent = tab.title || this.prettyUrl(tab.url);
    el.appendChild(title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'chrome-tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.setAttribute('aria-label', 'Close tab');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void tabManager.closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => {
      void tabManager.activateTab(tab.id);
      const active = tabManager.tabs.find((t) => t.id === tab.id);
      if (active) this.loadInWebview(active.url);
    });

    return el;
  }

  private renderUrlBar(): void {
    const active = tabManager.activeTab;
    if (!active) {
      this.urlBar.value = '';
      return;
    }
    if (document.activeElement !== this.urlBar) {
      this.urlBar.value = active.url.startsWith('asset://') ? '' : active.url;
    }
  }

  private renderNavState(): void {
    const active = tabManager.activeTab;
    const canBack = !!active && active.history.length > 1;
    const canFwd = !!active && active.forward.length > 0;
    this.backBtn.disabled = !canBack;
    this.fwdBtn.disabled = !canFwd;
    this.reloadBtn.disabled = !active;
  }

  private prettyUrl(url: string): string {
    if (url.startsWith('asset://')) return 'Homepage';
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '') || 'New Tab';
    } catch {
      return url.slice(0, 40);
    }
  }

  get unread(): number {
    return this.unreadCount;
  }
}
