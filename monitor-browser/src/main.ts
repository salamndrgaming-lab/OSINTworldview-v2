import { BrowserChrome } from './browser/chrome';
import { tabManager } from './browser/tabs';
import { bus } from './events/bus';
import { Sidebar } from './sidebar/sidebar';
import { panelRegistry } from './sidebar/panel-registry';
import { ThreatFeedPanel } from './sidebar/panels/ThreatFeedPanel';
import { CommodityPanel } from './sidebar/panels/CommodityPanel';
import { ConflictPanel } from './sidebar/panels/ConflictPanel';
import { BreakingIntelPanel } from './sidebar/panels/BreakingIntelPanel';
import { OsintToolkitPanel } from './sidebar/panels/OsintToolkitPanel';
import './styles/main.css';

/**
 * Monitor Browser entry point.
 *
 * Boot sequence:
 *   1. Register panels
 *   2. Mount sidebar (left) + chrome (top)
 *   3. Bootstrap tab state from backend (opens homepage if empty)
 *   4. Wire global keyboard shortcuts
 *   5. Relay navigation messages from embedded content
 */

async function boot(): Promise<void> {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) throw new Error('#app root not found in index.html');

  const chromeEl = document.querySelector<HTMLElement>('#chrome');
  const sidebarEl = document.querySelector<HTMLElement>('#sidebar');
  const webviewHost = document.querySelector<HTMLElement>('#webview-host');
  const webviewFrame = document.querySelector<HTMLIFrameElement>('#webview-frame');
  const loadingBar = document.querySelector<HTMLElement>('#webview-loading');

  if (!chromeEl || !sidebarEl || !webviewHost || !webviewFrame) {
    throw new Error('Required shell elements missing from index.html');
  }

  // Register panels in the order they will render in the sidebar.
  panelRegistry.register((c) => new ThreatFeedPanel(c));
  panelRegistry.register((c) => new CommodityPanel(c));
  panelRegistry.register((c) => new ConflictPanel(c));
  panelRegistry.register((c) => new BreakingIntelPanel(c));
  panelRegistry.register((c) => new OsintToolkitPanel(c));

  // Mount UI
  const sidebar = new Sidebar(sidebarEl);
  sidebar.mount();

  const chrome = new BrowserChrome(chromeEl, webviewFrame);
  chrome.mount();

  // Load initial tab state
  await tabManager.bootstrap();
  const active = tabManager.activeTab;
  if (active) {
    loadWebview(webviewFrame, active.url);
  }

  // Keyboard shortcuts (global)
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    switch (key) {
      case 'b':
        e.preventDefault();
        sidebar.toggle();
        break;
      case 'i':
        e.preventDefault();
        sidebar.toggleOverlay();
        break;
      case 't':
        e.preventDefault();
        void tabManager.openTab();
        break;
      case 'w':
        e.preventDefault();
        if (tabManager.activeTabId) void tabManager.closeTab(tabManager.activeTabId);
        break;
      case 'l':
        e.preventDefault();
        bus.emit('shortcut:focus-url', {});
        break;
      case 'r':
        e.preventDefault();
        void tabManager.reload();
        break;
      case '[':
        e.preventDefault();
        void tabManager.back();
        break;
      case ']':
        e.preventDefault();
        void tabManager.forward();
        break;
      default:
        break;
    }
  });

  // Loading indicator
  if (loadingBar) {
    webviewFrame.addEventListener('load', () => {
      loadingBar.classList.remove('is-loading');
      loadingBar.classList.add('is-done');
      window.setTimeout(() => loadingBar.classList.remove('is-done'), 400);
      try {
        const url = webviewFrame.contentWindow?.location.href ?? webviewFrame.src;
        const title = webviewFrame.contentDocument?.title ?? '';
        bus.emit('webview:loaded', { url, title });
      } catch {
        // Cross-origin — cannot read contentDocument. Ignore.
        bus.emit('webview:loaded', { url: webviewFrame.src, title: '' });
      }
    });
    bus.on('nav:navigate', () => {
      loadingBar.classList.remove('is-done');
      loadingBar.classList.add('is-loading');
    });
  }

  // Messages from the embedded homepage (or any content) asking the shell to navigate.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; url?: string } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'monitor:navigate' && typeof data.url === 'string') {
      void tabManager.navigateActive(data.url);
    }
  });
}

function loadWebview(frame: HTMLIFrameElement, url: string): void {
  if (url.startsWith('asset://')) {
    frame.src = '/homepage/index.html';
    return;
  }
  frame.src = url;
}

boot().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[monitor-browser] boot failed', err);
});
