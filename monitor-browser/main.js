// Monitor Browser — Electron main process.
//
// Architecture:
//   - One BaseWindow hosts two kinds of WebContentsView:
//       * chromeView   — the browser UI (tabs, URL bar, controls)
//       * one tab view per open tab, rendering real Chromium content
//   - The chrome view is stacked on top; the active tab view fills the
//     rest of the window beneath it. Inactive tab views are moved to a
//     zero-sized bounds rect so they stay alive but are invisible.
//   - Navigation, tab lifecycle, and window controls are driven from
//     the renderer via `ipcRenderer.invoke(...)` calls exposed through
//     `preload-chrome.js`.
//   - The homepage (new-tab page) pulls live OSINT data via an
//     `intel:fetch` IPC proxy in the main process (bypasses CORS).
//     The proxy is origin-gated so arbitrary browsed sites cannot
//     use it to exfiltrate data.

'use strict';

const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  shell,
  Menu,
  session,
} = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHROME_HEIGHT = 76; // titlebar (32) + toolbar (44)
// The homepage IS the Monitor Browser intelligence dashboard — a real
// customizable workspace with live panels (news, markets, map, intel,
// crypto, conflicts, …) backed by public OSINT data sources. Panels can
// be added/removed by the user; the map supports toggleable layers.
// This is a first-party dashboard, NOT a web view onto an external site.
const HOMEPAGE_PATH = path.join(__dirname, 'homepage', 'index.html');
const HOMEPAGE_URL = pathToFileURL(HOMEPAGE_PATH).toString();
const HOMEPAGE_FALLBACK_URL = HOMEPAGE_URL; // kept for compatibility
const CHROME_HTML = path.join(__dirname, 'renderer', 'index.html');

function isHomepageUrl(url) {
  if (!url) return false;
  if (url === HOMEPAGE_URL) return true;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:' && url.startsWith(HOMEPAGE_URL.split('#')[0].split('?')[0])) {
      return true;
    }
  } catch {
    /* not a URL */
  }
  return false;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {BaseWindow | null} */
let mainWindow = null;
/** @type {WebContentsView | null} */
let chromeView = null;

/**
 * @typedef {Object} Tab
 * @property {WebContentsView} view
 * @property {string} url
 * @property {string} title
 * @property {string | null} favicon
 * @property {boolean} isLoading
 * @property {boolean} canGoBack
 * @property {boolean} canGoForward
 */

/** @type {Map<string, Tab>} */
const tabs = new Map();
/** @type {string | null} */
let activeTabId = null;
/** Preserves tab insertion order for the chrome UI. */
const tabOrder = [];

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#060608',
    title: 'Monitor Browser',
    show: false,
  });

  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(chromeView);
  chromeView.webContents.loadFile(CHROME_HTML);

  layoutViews();
  mainWindow.on('resize', layoutViews);
  mainWindow.on('maximize', layoutViews);
  mainWindow.on('unmaximize', layoutViews);
  mainWindow.on('enter-full-screen', layoutViews);
  mainWindow.on('leave-full-screen', layoutViews);

  mainWindow.on('closed', () => {
    mainWindow = null;
    chromeView = null;
    tabs.clear();
    tabOrder.length = 0;
    activeTabId = null;
  });

  chromeView.webContents.once('did-finish-load', () => {
    mainWindow?.show();
    newTab(HOMEPAGE_URL);
  });

  // Surface chrome devtools on F12 / Ctrl+Shift+I in dev.
  chromeView.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      chromeView?.webContents.toggleDevTools();
    }
  });
}

function layoutViews() {
  if (!mainWindow || !chromeView) return;
  const { width, height } = mainWindow.getContentBounds();
  chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });

  for (const [id, tab] of tabs) {
    if (id === activeTabId) {
      tab.view.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width,
        height: Math.max(0, height - CHROME_HEIGHT),
      });
    } else {
      // Keep inactive tabs alive but off-screen.
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
}

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

function newTab(rawUrl) {
  if (!mainWindow) return null;

  const url = normalizeUrl(rawUrl);
  const id = randomUUID();

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-content.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  const tab = {
    view,
    url,
    title: 'New Tab',
    favicon: null,
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
  };
  tabs.set(id, tab);
  tabOrder.push(id);

  wireTabEvents(id, tab);

  mainWindow.contentView.addChildView(view);
  view.webContents.loadURL(url);

  switchTab(id);
  return id;
}

function wireTabEvents(id, tab) {
  const wc = tab.view.webContents;

  const updateNav = () => {
    // navigationHistory is the modern API; fall back to legacy names
    // if the user is on an older Electron.
    const hist = wc.navigationHistory ?? wc;
    tab.canGoBack = typeof hist.canGoBack === 'function' ? hist.canGoBack() : false;
    tab.canGoForward = typeof hist.canGoForward === 'function' ? hist.canGoForward() : false;
  };

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title || 'Untitled';
    broadcastTabs();
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = Array.isArray(favicons) && favicons.length > 0 ? favicons[0] : null;
    broadcastTabs();
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    broadcastTabs();
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    updateNav();
    broadcastTabs();
  });

  wc.on('did-navigate', (_e, navUrl) => {
    tab.url = navUrl;
    updateNav();
    broadcastTabs();
  });

  wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = navUrl;
    updateNav();
    broadcastTabs();
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 is ABORTED (user-initiated navigation). Don't surface.
    if (errorCode === -3) return;
    const escaped = escapeHtml(errorDescription || 'Page could not be loaded');
    const escapedUrl = escapeHtml(validatedURL || '');
    const html = renderErrorPage(escaped, escapedUrl, errorCode);
    wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  // Route popups into new tabs.
  wc.setWindowOpenHandler(({ url: openUrl, disposition }) => {
    if (disposition === 'foreground-tab' || disposition === 'background-tab' ||
        disposition === 'new-window' || disposition === 'default') {
      newTab(openUrl);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // Intercept middle-click / ctrl-click link semantics by opening in new tab.
  wc.on('will-navigate', (_e, navUrl) => {
    tab.url = navUrl;
    tab.isLoading = true;
    broadcastTabs();
  });
}

function switchTab(id) {
  if (!tabs.has(id) || !mainWindow) return;
  activeTabId = id;
  layoutViews();
  // Bring active view to front so it paints above inactive ones.
  const tab = tabs.get(id);
  if (tab) {
    mainWindow.contentView.removeChildView(tab.view);
    mainWindow.contentView.addChildView(tab.view);
    // Chrome must always remain on top.
    if (chromeView) {
      mainWindow.contentView.removeChildView(chromeView);
      mainWindow.contentView.addChildView(chromeView);
    }
    tab.view.webContents.focus();
  }
  broadcastTabs();
}

function closeTab(id) {
  if (!tabs.has(id) || !mainWindow) return;
  const tab = tabs.get(id);
  try {
    mainWindow.contentView.removeChildView(tab.view);
  } catch {
    /* view may already be removed */
  }
  try {
    tab.view.webContents.close();
  } catch {
    /* ignore */
  }
  tabs.delete(id);
  const orderIdx = tabOrder.indexOf(id);
  if (orderIdx >= 0) tabOrder.splice(orderIdx, 1);

  if (activeTabId === id) {
    if (tabOrder.length > 0) {
      const nextIdx = Math.min(orderIdx, tabOrder.length - 1);
      switchTab(tabOrder[nextIdx]);
    } else {
      activeTabId = null;
      newTab(HOMEPAGE_URL);
    }
  } else {
    broadcastTabs();
  }
}

function navigateActiveOr(id, rawUrl) {
  const tabId = id ?? activeTabId;
  if (!tabId) return;
  const tab = tabs.get(tabId);
  if (!tab) return;
  const url = normalizeUrl(rawUrl);
  tab.view.webContents.loadURL(url);
}

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

function normalizeUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return HOMEPAGE_URL;

  // Already-absolute URL.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(about|data|javascript|file|monitor):/i.test(trimmed)) return trimmed;

  // Localhost shortcuts.
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;

  // Bare IPv4.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) return `http://${trimmed}`;

  // Bare domain (has a dot, no whitespace, has a TLD-ish suffix).
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;

  // Everything else becomes a Google search.
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderErrorPage(description, url, code) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Page unavailable</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #060608; color: #e8e8f0;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .panel { max-width: 560px; padding: 48px; text-align: center; }
  .code { font-family: "JetBrains Mono", Consolas, monospace; color: #d4a843;
    font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase;
    margin-bottom: 16px; }
  h1 { font-size: 24px; font-weight: 500; margin: 0 0 12px; }
  p { color: #8888a0; margin: 0 0 24px; }
  .url { font-family: "JetBrains Mono", Consolas, monospace; color: #a0c8ff;
    font-size: 12px; word-break: break-all; background: #0e0e14;
    padding: 10px 14px; border-radius: 6px; border: 1px solid #2a2a3a; }
</style></head>
<body><div class="panel">
  <div class="code">ERROR ${code}</div>
  <h1>This page can't be reached.</h1>
  <p>${description}</p>
  <div class="url">${url}</div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Chrome <-> Main IPC
// ---------------------------------------------------------------------------

function broadcastTabs() {
  if (!chromeView || chromeView.webContents.isDestroyed()) return;
  const payload = tabOrder
    .map((id) => {
      const t = tabs.get(id);
      if (!t) return null;
      return {
        id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        isLoading: t.isLoading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        isHomepage: isHomepageUrl(t.url),
      };
    })
    .filter(Boolean);
  chromeView.webContents.send('tabs:updated', {
    tabs: payload,
    activeId: activeTabId,
  });
}

ipcMain.handle('tab:new', (_e, url) => newTab(url || HOMEPAGE_URL));
ipcMain.handle('tab:close', (_e, id) => closeTab(id));
ipcMain.handle('tab:switch', (_e, id) => switchTab(id));
ipcMain.handle('tab:navigate', (_e, id, url) => navigateActiveOr(id, url));

ipcMain.handle('tab:back', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (!tab) return;
  const hist = tab.view.webContents.navigationHistory ?? tab.view.webContents;
  if (typeof hist.canGoBack === 'function' && hist.canGoBack()) {
    hist.goBack();
  }
});

ipcMain.handle('tab:forward', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (!tab) return;
  const hist = tab.view.webContents.navigationHistory ?? tab.view.webContents;
  if (typeof hist.canGoForward === 'function' && hist.canGoForward()) {
    hist.goForward();
  }
});

ipcMain.handle('tab:reload', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (tab) tab.view.webContents.reload();
});

ipcMain.handle('tab:stop', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (tab) tab.view.webContents.stop();
});

ipcMain.handle('tab:home', (_e, id) => {
  navigateActiveOr(id, HOMEPAGE_URL);
});

ipcMain.handle('tab:devtools', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (!tab) return;
  const wc = tab.view.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach' });
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('shell:open-external', (_e, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return shell.openExternal(url);
    }
  } catch {
    /* ignore */
  }
  return undefined;
});

// ---------------------------------------------------------------------------
// Intel fetch proxy (used by homepage only)
// ---------------------------------------------------------------------------

ipcMain.handle('intel:fetch', async (event, url) => {
  // Only the homepage (loaded from the app bundle over file://) may use
  // this proxy. Arbitrary websites visited in tabs cannot.
  const senderUrl = event.sender.getURL();
  if (!senderUrl.startsWith('file://')) {
    throw new Error('intel:fetch is not available on this origin');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`invalid URL: ${err.message}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported scheme: ${parsed.protocol}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        accept: 'application/json, text/plain, */*',
        'user-agent': 'MonitorBrowser/1.0 (+https://osint-worldview.vercel.app)',
      },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Disable the default application menu — we're a browser, the chrome
// handles everything.
Menu.setApplicationMenu(null);

// Branding — the app is Chromium-powered but presents as Monitor Browser.
app.setName('Monitor Browser');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.osint.monitor-browser');
}

/**
 * Build a branded user-agent. We keep the full Chrome UA (so servers continue
 * to serve modern web UIs) but strip Electron's fingerprint and append our
 * product token: `MonitorBrowser/1.0`.
 */
function buildBrandedUA(baseUA) {
  return baseUA
    .replace(/\s*Electron\/\S+/g, '')
    .replace(/\s*monitor-browser\/\S+/gi, '')
    .trim()
    + ' MonitorBrowser/1.0';
}

app.whenReady().then(() => {
  // Rewrite the default session's user-agent so every tab (and the chrome
  // renderer) presents as "Chrome … MonitorBrowser/1.0".
  try {
    const defaultSession = session.defaultSession;
    const ua = buildBrandedUA(defaultSession.getUserAgent());
    defaultSession.setUserAgent(ua);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[monitor] failed to set branded user-agent', err);
  }

  createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Prevent rogue web content from opening arbitrary new Electron windows.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (contents === chromeView?.webContents) return { action: 'deny' };
    newTab(url);
    return { action: 'deny' };
  });
});
