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
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Local YouTube embed server
// ---------------------------------------------------------------------------
// YouTube rejects embeds from file:// origins (Error 152). We serve a small
// HTML page from localhost that loads the YouTube IFrame API — YouTube
// accepts localhost as a valid origin. This mirrors the OSINT dashboard's
// Tauri sidecar approach.

let ytEmbedPort = 0;

function startYtEmbedServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url, 'http://localhost');
      const autoplay = parsed.searchParams.get('autoplay') === '0' ? '0' : '1';
      const mute = parsed.searchParams.get('mute') === '0' ? '0' : '1';
      const origin = 'http://localhost:' + ytEmbedPort;

      const resHeaders = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Permissions-Policy': 'autoplay=*, encrypted-media=*, storage-access=(self "https://www.youtube.com")',
        'Access-Control-Allow-Origin': '*',
      };

      if (parsed.pathname === '/youtube-embed') {
        const videoId = (parsed.searchParams.get('videoId') || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!videoId) { res.writeHead(400); res.end('Missing videoId'); return; }

        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}#player{width:100%;height:100%}#play-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.4)}#play-overlay svg{width:72px;height:72px;opacity:0.9;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5))}#play-overlay.hidden{display:none}</style></head><body><div id="player"></div><div id="play-overlay" class="hidden"><svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg></div><script>function tryStorageAccess(){if(document.requestStorageAccess){document.requestStorageAccess().catch(function(){})}}tryStorageAccess();var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);var player,overlay=document.getElementById('play-overlay'),started=false;var obs=new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var nodes=muts[i].addedNodes;for(var j=0;j<nodes.length;j++){if(nodes[j].tagName==='IFRAME'){nodes[j].setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen; storage-access');obs.disconnect();return}}}});obs.observe(document.getElementById('player'),{childList:true,subtree:true});function hideOverlay(){overlay.classList.add('hidden')}function onYouTubeIframeAPIReady(){player=new YT.Player('player',{videoId:'${videoId}',host:'https://www.youtube.com',playerVars:{autoplay:${autoplay},mute:${mute},playsinline:1,rel:0,controls:1,modestbranding:1,enablejsapi:1,origin:'${origin}',widget_referrer:'${origin}'},events:{onReady:function(){window.parent.postMessage({type:'yt-ready'},'*');if(${autoplay}===1){try{player.mute();player.playVideo()}catch(e){}}},onError:function(e){window.parent.postMessage({type:'yt-error',code:e.data},'*')},onStateChange:function(e){window.parent.postMessage({type:'yt-state',state:e.data},'*');if(e.data===1||e.data===3){hideOverlay();started=true}}}})}overlay.addEventListener('click',function(){tryStorageAccess();if(player&&player.playVideo){player.playVideo();player.unMute();hideOverlay()}});setTimeout(function(){if(!started)overlay.classList.remove('hidden')},4000)<\/script></body></html>`;
        res.writeHead(200, resHeaders);
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, 'localhost', () => {
      ytEmbedPort = server.address().port;
      console.log('[monitor] YouTube embed server on http://localhost:' + ytEmbedPort);
      resolve(ytEmbedPort);
    });
    server.on('error', () => resolve(0));
  });
}

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
// Settings store
// ---------------------------------------------------------------------------
// Persisted to userData/settings.json. Changes broadcast to every webContents
// so chrome + every tab can react (theme switch, search engine change, etc.).

const SEARCH_ENGINES = {
  google:      { label: 'Google',       url: 'https://www.google.com/search?q=%s' },
  duckduckgo:  { label: 'DuckDuckGo',   url: 'https://duckduckgo.com/?q=%s' },
  brave:       { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage:   { label: 'Startpage',    url: 'https://www.startpage.com/do/search?q=%s' },
  bing:        { label: 'Bing',         url: 'https://www.bing.com/search?q=%s' },
  kagi:        { label: 'Kagi',         url: 'https://kagi.com/search?q=%s' },
  ecosia:      { label: 'Ecosia',       url: 'https://www.ecosia.org/search?q=%s' },
};

const THEMES = {
  amber:    { label: 'Amber OSINT',    accent: '#d4a843' },
  cyber:    { label: 'Cyber Green',    accent: '#3aff8a' },
  palantir: { label: 'Palantir Blue',  accent: '#4a90e2' },
  crimson:  { label: 'Crimson Recon',  accent: '#ff4e4e' },
  mono:     { label: 'Monochrome',     accent: '#e8e8f0' },
};

const DEFAULT_SETTINGS = {
  searchEngine: 'duckduckgo',
  theme: 'amber',
  customHomepage: '',      // empty -> built-in Monitor Home
  useCustomHomepage: false,
  showBranding: true,      // false -> pure Chrome UA, no MonitorBrowser token
  httpsOnly: false,
  defaultZoom: 0,          // Electron zoom level (0 = 100%)
  startupBehavior: 'homepage', // 'homepage' | 'restore' | 'blank'
  adBlock: true,
  showBookmarksBar: false,
};

let settingsCache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    settingsCache = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }
  return settingsCache;
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  // Sanitize.
  if (!SEARCH_ENGINES[next.searchEngine]) next.searchEngine = DEFAULT_SETTINGS.searchEngine;
  if (!THEMES[next.theme]) next.theme = DEFAULT_SETTINGS.theme;
  settingsCache = next;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('[monitor] failed to persist settings', err);
  }
  broadcastSettings();
  try { applyBrandedUA(); } catch (err) { console.warn('[monitor] failed to reapply UA', err); }
  try { applyRequestFilters(); } catch (err) { console.warn('[monitor] failed to reapply filters', err); }
  return next;
}

function broadcastSettings() {
  const payload = loadSettings();
  // Chrome renderer.
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.webContents.send('settings:changed', payload);
  }
  // All tab contents (so homepage + open pages can retheme).
  for (const [, tab] of tabs) {
    try {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send('settings:changed', payload);
      }
    } catch { /* ignore */ }
  }
}

function getSearchUrl(query) {
  const s = loadSettings();
  const eng = SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.duckduckgo;
  return eng.url.replace('%s', encodeURIComponent(query));
}

// ---------------------------------------------------------------------------
// Session persistence (save open tabs on close, restore on startup)
// ---------------------------------------------------------------------------

function sessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function saveSession() {
  const urls = tabOrder
    .map((id) => {
      const t = tabs.get(id);
      if (!t) return null;
      return { url: t.url, pinned: !!t.pinned };
    })
    .filter(Boolean)
    .filter((e) => !isHomepageUrl(e.url));
  try {
    fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
    fs.writeFileSync(sessionPath(), JSON.stringify({ tabs: urls, activeIdx: tabOrder.indexOf(activeTabId) }, null, 2));
  } catch (err) {
    console.warn('[monitor] failed to save session', err);
  }
}

function loadSession() {
  try {
    const raw = fs.readFileSync(sessionPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
/** Stack of recently closed tab URLs for Ctrl+Shift+T. */
const closedTabStack = [];

// ---------------------------------------------------------------------------
// Operations (Investigation Compartments)
// ---------------------------------------------------------------------------
const operations = new Map();
let activeOperationId = null;

function operationsPath() {
  return path.join(app.getPath('userData'), 'operations.json');
}

function loadOperations() {
  try {
    const raw = JSON.parse(fs.readFileSync(operationsPath(), 'utf8'));
    for (const op of raw) {
      if (!operations.has(op.id)) {
        operations.set(op.id, { id: op.id, name: op.name, color: op.color, tabs: [], annotations: op.annotations || [], createdAt: op.createdAt });
      }
    }
  } catch {}
}

function saveOperations() {
  const arr = [];
  for (const [, op] of operations) {
    arr.push({
      id: op.id, name: op.name, color: op.color,
      annotations: op.annotations || [],
      createdAt: op.createdAt,
      tabUrls: tabOrder.filter((tid) => {
        const t = tabs.get(tid);
        return t && t.operationId === op.id;
      }).map((tid) => tabs.get(tid)?.url).filter(Boolean),
    });
  }
  try {
    fs.mkdirSync(path.dirname(operationsPath()), { recursive: true });
    fs.writeFileSync(operationsPath(), JSON.stringify(arr, null, 2));
  } catch {}
}

function createOperation(name, color) {
  const id = randomUUID();
  operations.set(id, { id, name: name || 'Unnamed Op', color: color || '#d4a843', tabs: [], annotations: [], createdAt: Date.now() });
  saveOperations();
  return id;
}

function deleteOperation(opId) {
  operations.delete(opId);
  for (const [, tab] of tabs) {
    if (tab.operationId === opId) tab.operationId = null;
  }
  if (activeOperationId === opId) activeOperationId = null;
  saveOperations();
  broadcastTabs();
}

function addAnnotation(opId, text, url) {
  const op = operations.get(opId);
  if (!op) return;
  op.annotations.push({ id: randomUUID(), text, url, createdAt: Date.now() });
  saveOperations();
}

function listOperations() {
  const result = [];
  for (const [, op] of operations) {
    const tabCount = tabOrder.filter((tid) => tabs.get(tid)?.operationId === op.id).length;
    result.push({ id: op.id, name: op.name, color: op.color, tabCount, annotationCount: (op.annotations || []).length, createdAt: op.createdAt });
  }
  return result;
}

function getOperation(opId) {
  const op = operations.get(opId);
  if (!op) return null;
  const opTabs = tabOrder.filter((tid) => tabs.get(tid)?.operationId === opId).map((tid) => {
    const t = tabs.get(tid);
    return { id: tid, url: t.url, title: t.title };
  });
  return { ...op, tabs: opTabs };
}

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

  mainWindow.on('close', () => {
    saveSession();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    chromeView = null;
    tabs.clear();
    tabOrder.length = 0;
    activeTabId = null;
  });

  chromeView.webContents.once('did-finish-load', () => {
    mainWindow?.show();
    const settings = loadSettings();
    const sess = settings.startupBehavior === 'restore' ? loadSession() : null;
    if (sess && sess.tabs && sess.tabs.length > 0) {
      for (const entry of sess.tabs) {
        const id = newTab(entry.url);
        if (entry.pinned && id) {
          const tab = tabs.get(id);
          if (tab) tab.pinned = true;
        }
      }
      if (sess.activeIdx >= 0 && sess.activeIdx < tabOrder.length) {
        switchTab(tabOrder[sess.activeIdx]);
      }
    } else if (settings.startupBehavior === 'blank') {
      newTab('about:blank');
    } else {
      newTab(resolveHomepageUrl());
    }
    try { chromeView.webContents.send('settings:changed', settings); } catch {}
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
  const homepage = isHomepageUrl(url);

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, homepage ? 'preload-content.js' : 'preload-content.js'),
      contextIsolation: true,
      sandbox: !homepage,
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
    pinned: false,
    muted: false,
    operationId: activeOperationId || null,
    dwellStart: Date.now(),
    dwellTime: 0,
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
    addToHistory(navUrl, tab.title);
  });

  // Fire initial settings push once the tab finishes loading.
  wc.once('dom-ready', () => {
    try { wc.send('settings:changed', loadSettings()); } catch {}
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

  // HTML5 fullscreen (e.g. YouTube video player fullscreen button)
  wc.on('enter-html-full-screen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(true);
      // Hide chrome, give tab full window
      if (chromeView) chromeView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      const { width, height } = mainWindow.getContentBounds();
      tab.view.setBounds({ x: 0, y: 0, width, height });
    }
  });

  wc.on('leave-html-full-screen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(false);
      layoutViews();
    }
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
  if (activeTabId && tabs.has(activeTabId)) {
    const prev = tabs.get(activeTabId);
    prev.dwellTime += Date.now() - prev.dwellStart;
  }
  activeTabId = id;
  const next = tabs.get(id);
  if (next) next.dwellStart = Date.now();
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
  if (tab.url && !isHomepageUrl(tab.url)) {
    closedTabStack.push({ url: tab.url, title: tab.title });
    if (closedTabStack.length > 25) closedTabStack.shift();
  }
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
      newTab(resolveHomepageUrl());
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

function resolveHomepageUrl() {
  const s = loadSettings();
  if (s.useCustomHomepage && s.customHomepage) {
    try {
      const u = new URL(s.customHomepage);
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') {
        return u.toString();
      }
    } catch { /* fall through */ }
  }
  return HOMEPAGE_URL;
}

function normalizeUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return resolveHomepageUrl();

  // Special shortcut: "monitor:home" navigates to the built-in homepage.
  if (/^monitor:\s*home$/i.test(trimmed)) return HOMEPAGE_URL;

  // Already-absolute URL.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(about|data|javascript|file|monitor):/i.test(trimmed)) return trimmed;

  // Localhost shortcuts.
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;

  // Bare IPv4.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) return `http://${trimmed}`;

  // Bare domain (has a dot, no whitespace, has a TLD-ish suffix).
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;

  // Everything else becomes a search on the user-selected engine.
  return getSearchUrl(trimmed);
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
      const op = t.operationId ? operations.get(t.operationId) : null;
      return {
        id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        isLoading: t.isLoading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        isHomepage: isHomepageUrl(t.url),
        pinned: !!t.pinned,
        muted: !!t.muted,
        audible: t.view.webContents.isCurrentlyAudible?.() ?? false,
        operationId: t.operationId || null,
        operationColor: op?.color || null,
        operationName: op?.name || null,
        dwellTime: t.dwellTime + (id === activeTabId ? (Date.now() - t.dwellStart) : 0),
      };
    })
    .filter(Boolean);
  chromeView.webContents.send('tabs:updated', {
    tabs: payload,
    activeId: activeTabId,
  });
}

ipcMain.handle('tab:new', (_e, url) => newTab(url || resolveHomepageUrl()));
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
  navigateActiveOr(id, resolveHomepageUrl());
});

// Settings IPC -----------------------------------------------------------
ipcMain.handle('settings:get', () => ({
  settings: loadSettings(),
  searchEngines: Object.fromEntries(
    Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, { label: v.label }])
  ),
  themes: Object.fromEntries(
    Object.entries(THEMES).map(([k, v]) => [k, { label: v.label, accent: v.accent }])
  ),
}));
ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch || {}));
ipcMain.handle('settings:reset', () => saveSettings({ ...DEFAULT_SETTINGS }));
ipcMain.handle('settings:clear-data', async () => {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'filesystem', 'serviceworkers', 'shadercache', 'websql', 'cachestorage'],
    });
    return true;
  } catch (err) {
    console.warn('[monitor] clear-data failed', err);
    return false;
  }
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

// ---------------------------------------------------------------------------
// Incognito / Private window
// ---------------------------------------------------------------------------
let incognitoCounter = 0;

ipcMain.handle('window:incognito', () => {
  createIncognitoWindow();
});

function createIncognitoWindow() {
  incognitoCounter++;
  const partitionName = 'incognito-' + incognitoCounter + '-' + Date.now();

  const win = new BaseWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0a0a10',
    title: 'Monitor Browser — Private',
  });

  const chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      partition: partitionName,
    },
  });
  win.contentView.addChildView(chrome);
  chrome.webContents.loadFile(CHROME_HTML);

  const incTabs = new Map();
  const incOrder = [];
  let incActiveId = null;

  function incLayoutViews() {
    const { width, height } = win.getContentBounds();
    chrome.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
    for (const [id, tab] of incTabs) {
      if (id === incActiveId) {
        tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
  }

  function incBroadcastTabs() {
    const payload = incOrder.filter((id) => incTabs.has(id)).map((id) => {
      const t = incTabs.get(id);
      const wc = t.view.webContents;
      return {
        id, url: t.url, title: t.title, favicon: t.favicon,
        isLoading: t.isLoading, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward(),
        isHomepage: t.url.startsWith('file://') && t.url.includes('homepage'),
        pinned: t.pinned || false, muted: t.muted || false, audible: wc.isCurrentlyAudible(),
      };
    });
    try { chrome.webContents.send('tabs:updated', { tabs: payload, activeId: incActiveId, incognito: true }); } catch {}
  }

  function incNewTab(rawUrl) {
    const url = normalizeUrl(rawUrl || resolveHomepageUrl());
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload-content.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        partition: partitionName,
      },
    });
    const tab = { view, url, title: 'New Tab', favicon: null, isLoading: true, canGoBack: false, canGoForward: false, pinned: false, muted: false };
    incTabs.set(id, tab);
    incOrder.push(id);

    const wc = view.webContents;
    wc.on('did-start-navigation', () => { tab.isLoading = true; incBroadcastTabs(); });
    wc.on('did-navigate', (_e, navUrl) => { tab.url = navUrl; tab.isLoading = false; incBroadcastTabs(); });
    wc.on('did-navigate-in-page', (_e, navUrl) => { tab.url = navUrl; incBroadcastTabs(); });
    wc.on('page-title-updated', (_e, title) => { tab.title = title; incBroadcastTabs(); });
    wc.on('page-favicon-updated', (_e, favicons) => { tab.favicon = favicons[0] || null; incBroadcastTabs(); });
    wc.on('did-fail-load', () => { tab.isLoading = false; incBroadcastTabs(); });
    wc.on('did-finish-load', () => { tab.isLoading = false; incBroadcastTabs(); });

    win.contentView.addChildView(view);
    wc.loadURL(url);
    incActiveId = id;
    incLayoutViews();
    incBroadcastTabs();
    return id;
  }

  function incSwitchTab(id) {
    if (!incTabs.has(id)) return;
    incActiveId = id;
    incLayoutViews();
    incBroadcastTabs();
  }

  function incCloseTab(id) {
    const tab = incTabs.get(id);
    if (!tab) return;
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    incTabs.delete(id);
    const idx = incOrder.indexOf(id);
    if (idx >= 0) incOrder.splice(idx, 1);
    if (incActiveId === id) {
      if (incOrder.length > 0) {
        incSwitchTab(incOrder[Math.min(idx, incOrder.length - 1)]);
      } else {
        win.close();
        return;
      }
    }
    incBroadcastTabs();
  }

  // Route IPC from this incognito chrome to local tab management
  const wcId = chrome.webContents.id;
  const incIpc = {
    'tab:new': (_e, url) => incNewTab(url),
    'tab:close': (_e, id) => incCloseTab(id ?? incActiveId),
    'tab:switch': (_e, id) => incSwitchTab(id),
    'tab:navigate': (_e, _id, url) => {
      const t = incTabs.get(incActiveId);
      if (t) t.view.webContents.loadURL(normalizeUrl(url));
    },
    'tab:back': () => { const t = incTabs.get(incActiveId); if (t) t.view.webContents.goBack(); },
    'tab:forward': () => { const t = incTabs.get(incActiveId); if (t) t.view.webContents.goForward(); },
    'tab:reload': () => { const t = incTabs.get(incActiveId); if (t) t.view.webContents.reload(); },
    'tab:home': () => { const t = incTabs.get(incActiveId); if (t) t.view.webContents.loadURL(resolveHomepageUrl()); },
    'window:minimize': () => win.minimize(),
    'window:maximize-toggle': () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); },
    'window:close': () => win.close(),
    'window:is-maximized': () => win.isMaximized(),
  };

  // Intercept IPC from this window's chrome
  chrome.webContents.ipc.handle = chrome.webContents.ipc.handle || (() => {});
  for (const [channel, handler] of Object.entries(incIpc)) {
    chrome.webContents.ipc.handle(channel, handler);
  }

  win.on('resize', incLayoutViews);
  win.on('maximize', incLayoutViews);
  win.on('unmaximize', incLayoutViews);

  win.on('closed', () => {
    for (const [, tab] of incTabs) {
      try { tab.view.webContents.close(); } catch {}
    }
    incTabs.clear();
    incOrder.length = 0;
  });

  chrome.webContents.once('did-finish-load', () => {
    win.show();
    incNewTab(resolveHomepageUrl());
    try { chrome.webContents.send('settings:changed', { ...loadSettings(), incognito: true }); } catch {}
  });
}

// Settings overlay: expand the chromeView to full window height so the
// settings card isn't clipped by the normal 76px chrome height.
ipcMain.handle('window:settings-expand', () => {
  if (!mainWindow || !chromeView) return;
  const { width, height } = mainWindow.getContentBounds();
  chromeView.setBounds({ x: 0, y: 0, width, height });
  // Park all tabs so they don't peek through.
  for (const [, tab] of tabs) {
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
});
ipcMain.handle('window:settings-collapse', () => layoutViews());

// ---------------------------------------------------------------------------
// Tab: duplicate, pin, mute
// ---------------------------------------------------------------------------
ipcMain.handle('tab:duplicate', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (tab) return newTab(tab.url);
  return null;
});

ipcMain.handle('tab:pin', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (tab) {
    tab.pinned = !tab.pinned;
    broadcastTabs();
    return tab.pinned;
  }
  return false;
});

ipcMain.handle('tab:reorder', (_e, fromId, toId) => {
  const fromIdx = tabOrder.indexOf(fromId);
  const toIdx = tabOrder.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  tabOrder.splice(fromIdx, 1);
  tabOrder.splice(toIdx, 0, fromId);
  broadcastTabs();
});

ipcMain.handle('tab:reopen', () => {
  if (closedTabStack.length === 0) return null;
  const entry = closedTabStack.pop();
  return newTab(entry.url);
});

ipcMain.handle('tab:mute', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (tab) {
    const wc = tab.view.webContents;
    const muted = !wc.isAudioMuted();
    wc.setAudioMuted(muted);
    tab.muted = muted;
    broadcastTabs();
    return muted;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Operations IPC
// ---------------------------------------------------------------------------
ipcMain.handle('ops:list', () => listOperations());
ipcMain.handle('ops:get', (_e, id) => getOperation(id));
ipcMain.handle('ops:create', (_e, name, color) => createOperation(name, color));
ipcMain.handle('ops:delete', (_e, id) => deleteOperation(id));
ipcMain.handle('ops:rename', (_e, id, name) => {
  const op = operations.get(id);
  if (op) { op.name = name; saveOperations(); broadcastTabs(); }
});
ipcMain.handle('ops:set-color', (_e, id, color) => {
  const op = operations.get(id);
  if (op) { op.color = color; saveOperations(); broadcastTabs(); }
});
ipcMain.handle('ops:assign-tab', (_e, tabId, opId) => {
  const tab = tabs.get(tabId);
  if (tab) { tab.operationId = opId || null; broadcastTabs(); saveOperations(); }
});
ipcMain.handle('ops:set-active', (_e, opId) => {
  activeOperationId = opId || null;
});
ipcMain.handle('ops:annotate', (_e, opId, text, url) => {
  addAnnotation(opId, text, url);
});

// Mute all tabs at once (Noise Gate)
ipcMain.handle('tabs:mute-all', () => {
  let allMuted = true;
  for (const [, tab] of tabs) {
    if (!tab.view.webContents.isAudioMuted()) { allMuted = false; break; }
  }
  for (const [, tab] of tabs) {
    tab.view.webContents.setAudioMuted(!allMuted);
    tab.muted = !allMuted;
  }
  broadcastTabs();
  return !allMuted;
});

// Dwell time for current tab
ipcMain.handle('tab:dwell-time', (_e, id) => {
  const tab = tabs.get(id ?? activeTabId);
  if (!tab) return 0;
  return tab.dwellTime + (id === activeTabId ? (Date.now() - tab.dwellStart) : 0);
});

// Reading time estimate
ipcMain.handle('page:reading-time', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  try {
    return await tab.view.webContents.executeJavaScript(`
      (function() {
        const text = (document.body ? document.body.innerText : '');
        const words = text.trim().split(/\\s+/).length;
        const minutes = Math.ceil(words / 230);
        return { words, minutes };
      })()
    `);
  } catch { return null; }
});

// ---------------------------------------------------------------------------
// Session export as report (#31)
// ---------------------------------------------------------------------------
ipcMain.handle('session:export', async () => {
  const { dialog } = require('electron');
  if (!mainWindow) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `monitor-report-${timestamp}.html`,
    filters: [{ name: 'HTML Report', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const allTabs = tabOrder.map((id) => {
    const t = tabs.get(id);
    if (!t) return null;
    const op = t.operationId ? operations.get(t.operationId) : null;
    return { url: t.url, title: t.title, operation: op?.name || 'None', dwell: t.dwellTime };
  }).filter(Boolean);

  const opsArr = listOperations();
  const hist = loadHistory().slice(0, 100);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Monitor Browser Report — ${timestamp}</title>
<style>
  :root{color-scheme:dark}body{margin:0;background:#060608;color:#e8e8f0;font:14px/1.6 system-ui,sans-serif;padding:40px 60px}
  h1{font-size:28px;color:#d4a843;margin:0 0 8px}h2{font-size:18px;margin:32px 0 12px;border-bottom:1px solid #2a2a3a;padding-bottom:8px}
  .meta{color:#8888a0;font-size:12px;margin-bottom:32px}table{width:100%;border-collapse:collapse;margin:12px 0}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #1a1a2a}th{color:#d4a843;font-size:11px;text-transform:uppercase;letter-spacing:1px}
  td{font-size:13px}a{color:#a0c8ff;text-decoration:none}a:hover{text-decoration:underline}
  .badge{font-size:10px;padding:2px 6px;border-radius:3px;background:#1a1a2a}
</style></head><body>
<h1>&#9673; Monitor Browser — Session Report</h1>
<div class="meta">Generated ${new Date().toUTCString()}</div>
<h2>Open Tabs (${allTabs.length})</h2>
<table><tr><th>Title</th><th>URL</th><th>Operation</th><th>Dwell</th></tr>
${allTabs.map((t) => '<tr><td>' + escapeHtml(t.title) + '</td><td><a href="' + escapeHtml(t.url) + '">' + escapeHtml(t.url) + '</a></td><td><span class="badge">' + escapeHtml(t.operation) + '</span></td><td>' + Math.round(t.dwell / 1000) + 's</td></tr>').join('')}
</table>
<h2>Operations (${opsArr.length})</h2>
<table><tr><th>Name</th><th>Tabs</th><th>Notes</th></tr>
${opsArr.map((o) => '<tr><td>' + escapeHtml(o.name) + '</td><td>' + o.tabCount + '</td><td>' + o.annotationCount + '</td></tr>').join('')}
</table>
<h2>Recent History</h2>
<table><tr><th>Title</th><th>URL</th><th>Visited</th></tr>
${hist.map((h) => '<tr><td>' + escapeHtml(h.title || '') + '</td><td><a href="' + escapeHtml(h.url) + '">' + escapeHtml(h.url) + '</a></td><td>' + new Date(h.visitedAt).toLocaleString() + '</td></tr>').join('')}
</table>
</body></html>`;

  try {
    fs.writeFileSync(result.filePath, html, 'utf8');
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  } catch (err) { return null; }
});

// ---------------------------------------------------------------------------
// Operation export as zip (#33)
// ---------------------------------------------------------------------------
ipcMain.handle('ops:export', async (_e, opId) => {
  const op = operations.get(opId);
  if (!op) return null;
  const { dialog } = require('electron');
  if (!mainWindow) return null;
  const safeName = (op.name || 'operation').replace(/[^a-zA-Z0-9_-]/g, '_');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${safeName}-export.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const opTabs = tabOrder.filter((tid) => tabs.get(tid)?.operationId === opId).map((tid) => {
    const t = tabs.get(tid);
    return { url: t.url, title: t.title };
  });
  const payload = { name: op.name, color: op.color, annotations: op.annotations, tabs: opTabs, exportedAt: Date.now() };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  } catch { return null; }
});

// ---------------------------------------------------------------------------
// Automatic page archiving (#32)
// ---------------------------------------------------------------------------
const pageArchives = new Map();

ipcMain.handle('page:archive', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  try {
    const content = await tab.view.webContents.executeJavaScript(`
      (function() { return { html: document.documentElement.outerHTML, url: location.href, title: document.title }; })()
    `);
    const archiveDir = path.join(app.getPath('userData'), 'archives');
    fs.mkdirSync(archiveDir, { recursive: true });
    const ts = Date.now();
    const filename = 'archive-' + ts + '.html';
    const filepath = path.join(archiveDir, filename);
    fs.writeFileSync(filepath, content.html, 'utf8');
    pageArchives.set(ts, { url: content.url, title: content.title, path: filepath, archivedAt: ts });
    return { path: filepath, url: content.url };
  } catch { return null; }
});

ipcMain.handle('page:archives-list', () => {
  const arr = [];
  for (const [, a] of pageArchives) arr.push(a);
  return arr.sort((a, b) => b.archivedAt - a.archivedAt).slice(0, 100);
});

// ---------------------------------------------------------------------------
// Tab preview on hover (#40)
// ---------------------------------------------------------------------------
ipcMain.handle('tab:preview', async (_e, tabId) => {
  const tab = tabs.get(tabId);
  if (!tab) return null;
  try {
    const img = await tab.view.webContents.capturePage();
    const resized = img.resize({ width: 240 });
    return 'data:image/png;base64,' + resized.toPNG().toString('base64');
  } catch { return null; }
});

// ---------------------------------------------------------------------------
// Dead tab detector (#37)
// ---------------------------------------------------------------------------
ipcMain.handle('tabs:detect-dead', () => {
  const idleThreshold = 5 * 60 * 1000;
  const now = Date.now();
  const dead = [];
  for (const id of tabOrder) {
    if (id === activeTabId) continue;
    const tab = tabs.get(id);
    if (!tab || isHomepageUrl(tab.url)) continue;
    const lastActive = tab.dwellStart || 0;
    const idle = now - lastActive;
    if (idle > idleThreshold) {
      dead.push({ id, url: tab.url, title: tab.title, idleMs: idle });
    }
  }
  return dead;
});

// ---------------------------------------------------------------------------
// Find in page
// ---------------------------------------------------------------------------
ipcMain.handle('find:start', (_e, text, opts) => {
  const tab = tabs.get(activeTabId);
  if (!tab || !text) return;
  tab.view.webContents.findInPage(text, opts || {});
});

ipcMain.handle('find:next', (_e, text, forward) => {
  const tab = tabs.get(activeTabId);
  if (!tab || !text) return;
  tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: true });
});

ipcMain.handle('find:stop', () => {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
});

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
ipcMain.handle('zoom:in', () => {
  const tab = tabs.get(activeTabId);
  if (tab) {
    const wc = tab.view.webContents;
    wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    return wc.getZoomLevel();
  }
});
ipcMain.handle('zoom:out', () => {
  const tab = tabs.get(activeTabId);
  if (tab) {
    const wc = tab.view.webContents;
    wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
    return wc.getZoomLevel();
  }
});
ipcMain.handle('zoom:reset', () => {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.setZoomLevel(0);
});

// ---------------------------------------------------------------------------
// Print / Fullscreen
// ---------------------------------------------------------------------------
ipcMain.handle('page:print', () => {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.print();
});

ipcMain.handle('window:fullscreen', () => {
  if (!mainWindow) return false;
  const fs = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(fs);
  return fs;
});

// Save as PDF
ipcMain.handle('page:save-pdf', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab || !mainWindow) return false;
  const { dialog } = require('electron');
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save as PDF',
    defaultPath: (tab.title || 'page').replace(/[/\\?%*:|"<>]/g, '_') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return false;
  try {
    const data = await tab.view.webContents.printToPDF({
      printBackground: true,
      landscape: false,
    });
    fs.writeFileSync(filePath, data);
    return true;
  } catch (err) {
    console.warn('[monitor] save-pdf failed', err);
    return false;
  }
});

// Picture-in-Picture (inject JS into page to trigger PiP on first playing video)
ipcMain.handle('page:pip', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return false;
  try {
    await tab.view.webContents.executeJavaScript(`
      (function() {
        const v = document.querySelector('video');
        if (!v) return false;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
          return true;
        }
        v.requestPictureInPicture().catch(() => {});
        return true;
      })()
    `);
    return true;
  } catch { return false; }
});

// ---------------------------------------------------------------------------
// Entity extraction — auto-detect IPs, domains, emails, hashes on page load
// ---------------------------------------------------------------------------
ipcMain.handle('page:extract-entities', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  try {
    return await tab.view.webContents.executeJavaScript(`
      (function() {
        const text = document.body ? document.body.innerText : '';
        const entities = { ips: [], domains: [], emails: [], hashes: [], urls: [], names: [] };
        const ipRe = /\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b/g;
        const emailRe = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g;
        const md5Re = /\\b[a-fA-F0-9]{32}\\b/g;
        const sha256Re = /\\b[a-fA-F0-9]{64}\\b/g;
        const domainRe = /\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|io|gov|edu|mil|co|info|biz|xyz|dev|app|me|us|uk|de|fr|ru|cn|jp|au|ca|br|in|za|ng|ke)\\b/gi;
        const urlRe = /https?:\\/\\/[^\\s<>"']+/g;
        let m;
        const seen = new Set();
        function add(arr, val) { if (!seen.has(val)) { seen.add(val); arr.push(val); } }
        while ((m = ipRe.exec(text))) add(entities.ips, m[0]);
        while ((m = emailRe.exec(text))) add(entities.emails, m[0]);
        while ((m = sha256Re.exec(text))) add(entities.hashes, m[0]);
        while ((m = md5Re.exec(text))) add(entities.hashes, m[0]);
        while ((m = domainRe.exec(text))) add(entities.domains, m[0]);
        while ((m = urlRe.exec(text))) add(entities.urls, m[0]);
        entities.ips = entities.ips.slice(0, 50);
        entities.domains = entities.domains.slice(0, 50);
        entities.emails = entities.emails.slice(0, 50);
        entities.hashes = entities.hashes.slice(0, 30);
        entities.urls = entities.urls.slice(0, 50);
        const total = entities.ips.length + entities.domains.length + entities.emails.length + entities.hashes.length;
        return { entities, total, url: location.href, title: document.title };
      })()
    `);
  } catch { return null; }
});

// Source credibility — rate domains based on known tier lists
const CREDIBILITY_TIERS = {
  high: new Set([
    'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'washingtonpost.com',
    'theguardian.com', 'economist.com', 'nature.com', 'science.org', 'ft.com',
    'wsj.com', 'bloomberg.com', 'aljazeera.com', 'dw.com', 'france24.com',
    'npr.org', 'pbs.org', 'c-span.org', 'arstechnica.com', 'theintercept.com',
    'propublica.org', 'foreignaffairs.com', 'cfr.org', 'brookings.edu', 'rand.org',
    'iiss.org', 'sipri.org', 'icij.org', 'bellingcat.com', 'csis.org',
  ]),
  medium: new Set([
    'cnn.com', 'cnbc.com', 'abc.net.au', 'nbcnews.com', 'cbsnews.com',
    'politico.com', 'axios.com', 'thehill.com', 'vox.com', 'slate.com',
    'time.com', 'newsweek.com', 'usatoday.com', 'vice.com', 'wired.com',
    'techcrunch.com', 'theverge.com', 'engadget.com', 'zdnet.com',
    'foxnews.com', 'nypost.com', 'dailymail.co.uk', 'independent.co.uk',
    'thedailybeast.com', 'buzzfeed.com', 'huffpost.com', 'salon.com',
    'bild.de', 'corriere.it', 'lemonde.fr', 'elpais.com', 'repubblica.it',
  ]),
  low: new Set([
    'rt.com', 'sputniknews.com', 'tass.com', 'globalresearch.ca', 'zerohedge.com',
    'infowars.com', 'breitbart.com', 'oann.com', 'newsmax.com', 'thegatewaypundit.com',
    'naturalnews.com', 'beforeitsnews.com', 'worldtruth.tv', 'collective-evolution.com',
    'yournewswire.com', 'neonnettle.com', 'theblaze.com',
  ]),
  government: new Set([
    'state.gov', 'whitehouse.gov', 'mod.uk', 'gov.uk', 'kremlin.ru',
    'mfa.gov.cn', 'mofa.go.jp', 'diplomatie.gouv.fr', 'un.org', 'who.int',
    'nato.int', 'europa.eu', 'osce.org',
  ]),
};

function getCredibility(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [tier, domains] of Object.entries(CREDIBILITY_TIERS)) {
      if (domains.has(host)) return tier;
      const parts = host.split('.');
      if (parts.length > 2) {
        const base = parts.slice(-2).join('.');
        if (domains.has(base)) return tier;
      }
    }
    return 'unknown';
  } catch { return 'unknown'; }
}

ipcMain.handle('page:credibility', (_e, url) => {
  const targetUrl = url || (tabs.get(activeTabId)?.url);
  if (!targetUrl) return { tier: 'unknown', url: '' };
  return { tier: getCredibility(targetUrl), url: targetUrl };
});

// Contextual counterfactual trigger — surface related scenarios
const COUNTERFACTUAL_TRIGGERS = [
  { keywords: ['hormuz', 'strait of hormuz', 'persian gulf'], scenario: 'Strait of Hormuz closure scenario: 20% of global oil transits here. Closure would spike crude 40-80% within 48h.', region: 'Middle East' },
  { keywords: ['taiwan', 'taiwan strait', 'pla navy'], scenario: 'Taiwan contingency: PLA amphibious capability assessed at 2-3 divisions. TSMC produces 90% of advanced chips — disruption cascades globally.', region: 'Asia-Pacific' },
  { keywords: ['suez canal', 'suez'], scenario: 'Suez disruption scenario: 12% of global trade. 2021 Ever Given blockage cost $9.6B/day. Houthi attacks already rerouting traffic.', region: 'Middle East' },
  { keywords: ['arctic', 'northern sea route', 'svalbard'], scenario: 'Arctic sea route opening: 40% shorter than Suez. Russian icebreaker fleet dominance. NATO surveillance gap above 75°N.', region: 'Europe' },
  { keywords: ['south china sea', 'spratly', 'scarborough'], scenario: 'South China Sea escalation: $5.3T in annual trade transits. 7 PRC artificial islands with military installations. UNCLOS ruling ignored.', region: 'Asia-Pacific' },
  { keywords: ['nuclear', 'icbm', 'nuclear weapon'], scenario: 'Nuclear escalation ladder: tactical → theater → strategic. Current global stockpile ~12,500 warheads. Launch-to-impact 15-30 min.', region: 'Global' },
  { keywords: ['ransomware', 'cyberattack', 'apt'], scenario: 'Critical infrastructure cyber scenario: Colonial Pipeline precedent. Average ransomware dwell time 11 days before detection.', region: 'Global' },
  { keywords: ['famine', 'food crisis', 'grain'], scenario: 'Global food security: Ukraine/Russia = 30% of global wheat exports. El Niño compounds drought across Horn of Africa.', region: 'Global' },
  { keywords: ['kashmir', 'line of control', 'india pakistan'], scenario: 'Kashmir flashpoint: Two nuclear powers, 740K Indian troops deployed. Potential for conventional→nuclear escalation.', region: 'Asia-Pacific' },
  { keywords: ['wagner', 'africa corps', 'pmc'], scenario: 'Russian PMC expansion: Active in 10+ African states. Resource extraction model funds operations. Displaces Western influence.', region: 'Africa' },
];

ipcMain.handle('page:counterfactual', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  try {
    const text = await tab.view.webContents.executeJavaScript(`
      (document.body ? document.body.innerText.substring(0, 5000).toLowerCase() : '')
    `);
    const matches = COUNTERFACTUAL_TRIGGERS.filter((t) =>
      t.keywords.some((kw) => text.includes(kw))
    );
    return matches.length > 0 ? matches : null;
  } catch { return null; }
});

// Reader mode — extract main content and render in a clean overlay
ipcMain.handle('page:reader', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  try {
    const result = await tab.view.webContents.executeJavaScript(`
      (function() {
        // Heuristic: grab article or main or largest text container
        const article = document.querySelector('article')
          || document.querySelector('[role="main"]')
          || document.querySelector('main')
          || document.querySelector('.post-content, .entry-content, .article-body');
        if (!article) return null;
        return {
          title: document.title,
          content: article.innerHTML,
          url: location.href,
        };
      })()
    `);
    return result;
  } catch { return null; }
});

// ---------------------------------------------------------------------------
// Certificate / security info
// ---------------------------------------------------------------------------
ipcMain.handle('page:security-info', async () => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  const url = tab.url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return { secure: false, protocol: parsed.protocol, host: parsed.hostname, url };
    }
    const tls = require('tls');
    return await new Promise((resolve) => {
      const sock = tls.connect(parsed.port || 443, parsed.hostname, { servername: parsed.hostname }, () => {
        const cert = sock.getPeerCertificate();
        sock.destroy();
        resolve({
          secure: true,
          protocol: 'https:',
          host: parsed.hostname,
          url,
          cert: {
            subject: cert.subject || {},
            issuer: cert.issuer || {},
            valid_from: cert.valid_from,
            valid_to: cert.valid_to,
            fingerprint: cert.fingerprint,
            serialNumber: cert.serialNumber,
          },
        });
      });
      sock.on('error', () => {
        resolve({ secure: false, protocol: 'https:', host: parsed.hostname, url, error: 'TLS error' });
      });
      setTimeout(() => { sock.destroy(); resolve({ secure: false, protocol: 'https:', host: parsed.hostname, url, error: 'Timeout' }); }, 5000);
    });
  } catch {
    return { secure: false, protocol: 'unknown', host: '', url };
  }
});

// ---------------------------------------------------------------------------
// Per-site permissions
// ---------------------------------------------------------------------------
const PERMISSION_TYPES = ['camera', 'microphone', 'geolocation', 'notifications', 'media'];

function permissionsPath() {
  return path.join(app.getPath('userData'), 'permissions.json');
}

function loadPermissions() {
  try {
    return JSON.parse(fs.readFileSync(permissionsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function savePermissions(perms) {
  try {
    fs.mkdirSync(path.dirname(permissionsPath()), { recursive: true });
    fs.writeFileSync(permissionsPath(), JSON.stringify(perms, null, 2));
  } catch (err) {
    console.warn('[monitor] failed to save permissions', err);
  }
}

function getOriginPerms(origin) {
  const all = loadPermissions();
  return all[origin] || {};
}

function setOriginPerm(origin, perm, value) {
  const all = loadPermissions();
  if (!all[origin]) all[origin] = {};
  all[origin][perm] = value;
  savePermissions(all);
}

ipcMain.handle('permissions:get', (_e, origin) => {
  return getOriginPerms(origin);
});

ipcMain.handle('permissions:set', (_e, origin, perm, value) => {
  setOriginPerm(origin, perm, value);
});

ipcMain.handle('permissions:list', () => {
  return loadPermissions();
});

ipcMain.handle('permissions:remove-site', (_e, origin) => {
  const all = loadPermissions();
  delete all[origin];
  savePermissions(all);
});

const ALWAYS_ALLOW_PERMISSIONS = new Set(['media', 'fullscreen', 'pointerLock', 'display-capture']);

function setupPermissionHandlers() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    try {
      if (ALWAYS_ALLOW_PERMISSIONS.has(permission)) { callback(true); return; }
      const url = wc.getURL();
      const origin = new URL(url).origin;
      const perms = getOriginPerms(origin);
      if (perms[permission] === 'allow') { callback(true); return; }
      if (perms[permission] === 'deny') { callback(false); return; }
      callback(false);
    } catch {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (ALWAYS_ALLOW_PERMISSIONS.has(permission)) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Bookmarks store
// ---------------------------------------------------------------------------
function bookmarksPath() {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}
function loadBookmarks() {
  try {
    return JSON.parse(fs.readFileSync(bookmarksPath(), 'utf8'));
  } catch { return []; }
}
function saveBookmarks(bm) {
  try {
    fs.mkdirSync(path.dirname(bookmarksPath()), { recursive: true });
    fs.writeFileSync(bookmarksPath(), JSON.stringify(bm, null, 2));
  } catch (err) { console.warn('[monitor] bookmarks save failed', err); }
}

ipcMain.handle('bookmarks:list', () => loadBookmarks());
ipcMain.handle('bookmarks:add', (_e, entry) => {
  const bm = loadBookmarks();
  const existing = bm.find((b) => b.url === entry.url);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    bm.push({ ...entry, id: randomUUID(), createdAt: Date.now() });
  }
  saveBookmarks(bm);
  return bm;
});
ipcMain.handle('bookmarks:remove', (_e, url) => {
  const bm = loadBookmarks().filter((b) => b.url !== url);
  saveBookmarks(bm);
  return bm;
});
ipcMain.handle('bookmarks:move', (_e, url, folder) => {
  const bm = loadBookmarks();
  const entry = bm.find((b) => b.url === url);
  if (entry) entry.folder = folder || '';
  saveBookmarks(bm);
  return bm;
});

// ---------------------------------------------------------------------------
// History store
// ---------------------------------------------------------------------------
function historyPath() {
  return path.join(app.getPath('userData'), 'history.json');
}
let historyCache = null;
function loadHistory() {
  if (historyCache) return historyCache;
  try {
    historyCache = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
  } catch { historyCache = []; }
  return historyCache;
}
function addToHistory(url, title) {
  if (!url || url.startsWith('file://') || url.startsWith('data:')) return;
  const hist = loadHistory();
  hist.unshift({ url, title, visitedAt: Date.now() });
  if (hist.length > 5000) hist.length = 5000;
  historyCache = hist;
  try {
    fs.mkdirSync(path.dirname(historyPath()), { recursive: true });
    fs.writeFileSync(historyPath(), JSON.stringify(hist));
  } catch (err) { console.warn('[monitor] history write failed', err); }
}

ipcMain.handle('history:list', (_e, query, limit) => {
  let hist = loadHistory();
  if (query) {
    const q = String(query).toLowerCase();
    hist = hist.filter((h) => (h.url + ' ' + (h.title || '')).toLowerCase().includes(q));
  }
  return hist.slice(0, limit || 200);
});
ipcMain.handle('history:clear', (_e, since) => {
  if (since) {
    historyCache = loadHistory().filter((h) => h.visitedAt < since);
  } else {
    historyCache = [];
  }
  try {
    fs.writeFileSync(historyPath(), JSON.stringify(historyCache));
  } catch (err) { console.warn('[monitor] history clear failed', err); }
  return true;
});

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
const activeDownloads = new Map();

function setupDownloadListener() {
  session.defaultSession.on('will-download', (_e, item) => {
    const id = randomUUID();
    const entry = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      savePath: item.getSavePath(),
      startedAt: Date.now(),
    };
    activeDownloads.set(id, { item, entry });
    broadcastDownloads();

    item.on('updated', (_ev, state) => {
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.state = state;
      entry.savePath = item.getSavePath();
      broadcastDownloads();
    });

    item.once('done', (_ev, state) => {
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
      broadcastDownloads();
    });
  });
}

function broadcastDownloads() {
  const list = [];
  for (const [, { entry }] of activeDownloads) list.push(entry);
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.webContents.send('downloads:updated', list);
  }
}

ipcMain.handle('downloads:list', () => {
  const list = [];
  for (const [, { entry }] of activeDownloads) list.push(entry);
  return list;
});

ipcMain.handle('downloads:cancel', (_e, id) => {
  const dl = activeDownloads.get(id);
  if (dl && dl.item && dl.item.getState() === 'progressing') {
    dl.item.cancel();
  }
});

ipcMain.handle('downloads:reveal', (_e, id) => {
  const dl = activeDownloads.get(id);
  if (dl && dl.entry.savePath) {
    shell.showItemInFolder(dl.entry.savePath);
  }
});

// ---------------------------------------------------------------------------
// Chrome Extensions
// ---------------------------------------------------------------------------
const loadedExtensions = new Map();

function extensionsDir() {
  return path.join(app.getPath('userData'), 'extensions');
}

async function loadAllExtensions() {
  const dir = extensionsDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const extPath = path.join(dir, entry.name);
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const ext = await session.defaultSession.loadExtension(extPath, { allowFileAccess: true });
      loadedExtensions.set(ext.id, { ext, path: extPath });
      console.log('[monitor] loaded extension:', ext.name);
    } catch (err) {
      console.warn('[monitor] failed to load extension at', extPath, err.message);
    }
  }
}

async function installExtensionFromPath(extPath) {
  const manifestPath = path.join(extPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { error: 'No manifest.json found' };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const safeName = (manifest.name || 'extension').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
    const destDir = path.join(extensionsDir(), safeName);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    copyDirSync(extPath, destDir);
    const ext = await session.defaultSession.loadExtension(destDir, { allowFileAccess: true });
    loadedExtensions.set(ext.id, { ext, path: destDir });
    return { id: ext.id, name: ext.name };
  } catch (err) {
    return { error: err.message };
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function removeExtension(extId) {
  const loaded = loadedExtensions.get(extId);
  if (!loaded) return false;
  try { session.defaultSession.removeExtension(extId); } catch {}
  try { fs.rmSync(loaded.path, { recursive: true, force: true }); } catch {}
  loadedExtensions.delete(extId);
  return true;
}

function listExtensions() {
  const exts = session.defaultSession.getAllExtensions();
  return exts.map((ext) => ({
    id: ext.id,
    name: ext.name,
    version: ext.version,
    url: ext.url,
  }));
}

ipcMain.handle('extensions:list', () => listExtensions());
ipcMain.handle('extensions:install', async (_e, extPath) => installExtensionFromPath(extPath));
ipcMain.handle('extensions:remove', (_e, extId) => removeExtension(extId));
ipcMain.handle('extensions:open-dir', () => {
  const dir = extensionsDir();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return dir;
});
ipcMain.handle('extensions:pick-folder', async () => {
  if (!mainWindow) return null;
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select unpacked extension folder',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return installExtensionFromPath(result.filePaths[0]);
});

// ---------------------------------------------------------------------------
// Privacy: HTTPS-only mode
// ── Request filters: ad blocking + HTTPS-only ─────────────────────
const AD_DOMAINS = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com',
  'facebook.net', 'connect.facebook.net', 'pixel.facebook.com',
  'analytics.twitter.com', 'ads-twitter.com', 'static.ads-twitter.com',
  'ad.doubleclick.net', 'stats.g.doubleclick.net',
  'adnxs.com', 'adsrvr.org', 'adsymptotic.com',
  'amazon-adsystem.com', 'aax.amazon-adsystem.com',
  'criteo.com', 'criteo.net', 'static.criteo.net',
  'outbrain.com', 'taboola.com', 'widgets.outbrain.com',
  'scorecardresearch.com', 'sb.scorecardresearch.com',
  'quantserve.com', 'pixel.quantserve.com',
  'hotjar.com', 'static.hotjar.com', 'script.hotjar.com',
  'mouseflow.com', 'fullstory.com',
  'optimizely.com', 'cdn.optimizely.com',
  'rubiconproject.com', 'fastclick.net',
  'pubmatic.com', 'openx.net', 'casalemedia.com',
  'moatads.com', 'serving-sys.com', 'smartadserver.com',
  'turn.com', 'mathtag.com', 'rlcdn.com', 'bluekai.com',
  'demdex.net', 'krxd.net', 'exelator.com', 'eyeota.net',
  'tapad.com', 'agkn.com', 'bidswitch.net',
  'chartbeat.com', 'chartbeat.net',
  'mixpanel.com', 'cdn.mxpnl.com',
  'segment.com', 'cdn.segment.com', 'api.segment.io',
  'amplitude.com', 'cdn.amplitude.com',
  'newrelic.com', 'js-agent.newrelic.com', 'bam.nr-data.net',
  'sentry.io', 'browser.sentry-cdn.com',
  'intercom.io', 'widget.intercom.io',
  'drift.com', 'js.driftt.com',
  'popads.net', 'popcash.net', 'propellerads.com',
  'revcontent.com', 'mgid.com', 'zergnet.com',
  'buysellads.com', 'carbonads.com', 'carbonads.net',
  'adroll.com', 'd.adroll.com',
  'mediavine.com', 'ads.mediavine.com',
  'adskeeper.co.uk', 'adsterra.com',
]);

function applyRequestFilters() {
  const s = loadSettings();
  const doBlock = s.adBlock;
  const doHttps = s.httpsOnly;

  if (!doBlock && !doHttps) {
    session.defaultSession.webRequest.onBeforeRequest(null);
    return;
  }

  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    // Never block localhost (our embed server)
    try {
      const h = new URL(details.url).hostname;
      if (h === '127.0.0.1' || h === 'localhost') { cb({}); return; }
    } catch { /* ignore */ }

    // Ad / tracker blocking
    if (doBlock) {
      try {
        const host = new URL(details.url).hostname;
        for (const domain of AD_DOMAINS) {
          if (host === domain || host.endsWith('.' + domain)) {
            cb({ cancel: true });
            return;
          }
        }
      } catch { /* ignore */ }
    }
    // HTTPS-only redirect
    if (doHttps && details.url.startsWith('http://')) {
      if (!details.url.startsWith('http://localhost') && !details.url.startsWith('http://127.0.0.1')) {
        cb({ redirectURL: details.url.replace(/^http:/, 'https:') });
        return;
      }
    }
    cb({});
  });
}

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

ipcMain.handle('yt:embed-port', () => ytEmbedPort);

// ---------------------------------------------------------------------------
// intel:fetch — per-domain rate limiter + response cache + retry
// ---------------------------------------------------------------------------
// OSINT dashboards fan out many concurrent requests at startup. Without
// throttling, APIs like GDELT return 429s and flood the console. We keep a
// small per-domain queue that serialises requests and holds a response cache
// to deduplicate identical URLs.

const _intelQueue = new Map();   // domain -> Promise chain
const _intelCache = new Map();   // url -> { ts, body }
const INTEL_CACHE_TTL = 5 * 60_000;  // 5 min — serve fresh
const INTEL_STALE_TTL = 30 * 60_000; // 30 min — serve stale on error
const INTEL_DOMAIN_DELAY = 400;  // ms between requests to the same domain

function _enqueueIntelFetch(domain, fn) {
  const prev = _intelQueue.get(domain) || Promise.resolve();
  const next = prev
    .then(fn)
    .finally(() => new Promise((r) => setTimeout(r, INTEL_DOMAIN_DELAY)));
  _intelQueue.set(domain, next.catch(() => {}));
  return next;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

ipcMain.handle('intel:fetch', async (event, url) => {
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

  // Return fresh cache hit immediately
  const cached = _intelCache.get(url);
  if (cached && Date.now() - cached.ts < INTEL_CACHE_TTL) {
    return cached.body;
  }

  const isRss = url.includes('/rss') || url.includes('/feed') || url.includes('/xml') ||
                url.includes('.xml') || url.includes('rdf/rss');
  const accept = isRss
    ? 'application/rss+xml, application/xml, text/xml, */*'
    : 'application/json, text/html, text/plain, */*';

  return _enqueueIntelFetch(parsed.hostname, async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(parsed.toString(), {
          headers: {
            'Accept': accept,
            'User-Agent': BROWSER_UA,
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: controller.signal,
          redirect: 'follow',
        });
        const body = await res.text();
        if (!res.ok) {
          if (res.status === 429) {
            console.warn(`[intel] 429 from ${parsed.hostname}`);
            // On 429, return stale cache if available
            if (cached && Date.now() - cached.ts < INTEL_STALE_TTL) {
              return cached.body;
            }
          }
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        _intelCache.set(url, { ts: Date.now(), body });
        return body;
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') {
          lastErr = new Error(`Timeout fetching ${parsed.hostname}`);
          break;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    // All retries failed — return stale cache if available
    if (cached && Date.now() - cached.ts < INTEL_STALE_TTL) {
      return cached.body;
    }
    throw lastErr || new Error('Fetch failed');
  });
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
 * to serve modern web UIs) but strip Electron's fingerprint. When branding is
 * enabled, append our product token `MonitorBrowser/1.0`; otherwise present
 * as a stock Chromium UA.
 */
function buildBrandedUA(baseUA) {
  const clean = String(baseUA)
    .replace(/\s*Electron\/\S+/g, '')
    .replace(/\s*monitor-browser\/\S+/gi, '')
    .replace(/\s*MonitorBrowser\/\S+/g, '')
    .trim();
  const s = loadSettings();
  return s.showBranding ? clean + ' MonitorBrowser/1.0' : clean;
}

let baseUACache = null;
function applyBrandedUA() {
  try {
    if (!baseUACache) baseUACache = session.defaultSession.getUserAgent();
    const ua = buildBrandedUA(baseUACache);
    session.defaultSession.setUserAgent(ua);
  } catch (err) {
    console.warn('[monitor] failed to set branded user-agent', err);
  }
}

app.whenReady().then(() => {
  // Ensure settings are loaded so UA can honor showBranding.
  loadSettings();

  // Single combined header-injection hook covering:
  //  - OSM tiles: requires a valid Referer per their tile usage policy.
  //  - YouTube embeds: Error 153 occurs when Referer/Origin are from
  //    file:// — YouTube rejects embeds without a web origin.
  //  - googlevideo (HLS streams): needs same YouTube referer.
  try {
    const filter = {
      urls: [
        'https://*.tile.openstreetmap.org/*',
        'https://tile.openstreetmap.org/*',
        'https://*.youtube.com/*',
        'https://youtube.com/*',
        'https://*.youtube-nocookie.com/*',
        'https://youtube-nocookie.com/*',
        'https://*.googlevideo.com/*',
        'https://*.ytimg.com/*',
      ],
    };
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
      const headers = { ...details.requestHeaders };
      const url = details.url || '';
      if (url.includes('openstreetmap.org')) {
        headers['Referer'] = 'https://www.openstreetmap.org/';
      } else if (url.includes('youtube.com') || url.includes('youtube-nocookie.com') || url.includes('googlevideo.com') || url.includes('ytimg.com')) {
        headers['Referer'] = 'https://www.youtube.com/';
        headers['Origin'] = 'https://www.youtube.com';
      }
      cb({ requestHeaders: headers });
    });

    // Strip X-Frame-Options and CSP frame-ancestors from YouTube responses
    // so embeds work when the parent page is file:// (Error 152 fix).
    const embedFilter = {
      urls: [
        'https://*.youtube.com/*',
        'https://youtube.com/*',
        'https://*.youtube-nocookie.com/*',
        'https://youtube-nocookie.com/*',
        'https://*.googlevideo.com/*',
      ],
    };
    session.defaultSession.webRequest.onHeadersReceived(embedFilter, (details, cb) => {
      const headers = { ...details.responseHeaders };
      // Remove all frame-blocking headers
      const keysToRemove = Object.keys(headers).filter(
        (k) => k.toLowerCase() === 'x-frame-options'
      );
      for (const k of keysToRemove) delete headers[k];
      // Rewrite all CSP headers to allow any embedder
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-security-policy') {
          headers[key] = headers[key].map(
            (v) => v.replace(/frame-ancestors[^;]*(;|$)/gi, 'frame-ancestors * $1')
          );
        }
      }
      cb({ responseHeaders: headers });
    });
  } catch (err) {
    console.warn('[monitor] failed to register header injection hook', err);
  }

  applyBrandedUA();
  applyRequestFilters();
  setupDownloadListener();
  setupPermissionHandlers();
  loadOperations();
  loadAllExtensions().catch((err) => console.warn('[monitor] extension load failed', err));

  // Start local YouTube embed server, then create window
  startYtEmbedServer().then(() => {
    createWindow();
  });
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
