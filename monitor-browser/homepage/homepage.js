// Monitor Browser — Home Dashboard
// -----------------------------------------------------------------------------
// A customizable OSINT dashboard. Panels are defined in the PANELS registry
// below; users can add/remove via the "+ Add panel" button. Layout +
// selection + map-layer state persist to localStorage. Data comes through
// `window.monitorApi.fetchIntel(url)` which CORS-bypasses via the Electron
// main-process proxy (origin-gated to file://).

'use strict';

(function () {
  // --------------------------------------------------------------------------
  // Globals / helpers
  // --------------------------------------------------------------------------

  const hasApi = !!(window.monitorApi && typeof window.monitorApi.fetchIntel === 'function');
  const _rawFetchIntel = hasApi
    ? (url) => window.monitorApi.fetchIntel(url)
    : () => Promise.reject(new Error('Intel proxy unavailable (preload missing)'));

  // Persistent response cache in localStorage — panels show last-known-good
  // data immediately while refreshing in the background.
  const RESP_CACHE_KEY = 'monitor:resp-cache:v1';
  const RESP_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour
  let _respCache = {};
  try { _respCache = JSON.parse(localStorage.getItem(RESP_CACHE_KEY) || '{}'); } catch (_) { _respCache = {}; }
  function _saveRespCache() {
    try {
      // Prune old entries to keep localStorage bounded
      const now = Date.now();
      for (const k of Object.keys(_respCache)) {
        if (now - (_respCache[k].ts || 0) > RESP_CACHE_MAX_AGE) delete _respCache[k];
      }
      localStorage.setItem(RESP_CACHE_KEY, JSON.stringify(_respCache));
    } catch (_) { /* storage full — ignore */ }
  }

  function fetchIntel(url) {
    return _rawFetchIntel(url).then(function (body) {
      // Cache successful responses persistently
      _respCache[url] = { body: body.slice(0, 50000), ts: Date.now() };
      _saveRespCache();
      return body;
    }).catch(function (err) {
      // On failure, return stale persistent cache if available
      var cached = _respCache[url];
      if (cached && cached.body) {
        console.warn('[dashboard] serving stale cache for', url, '—', err.message);
        return cached.body;
      }
      throw err;
    });
  }

  function getCachedResponse(url) {
    var cached = _respCache[url];
    return cached ? cached.body : null;
  }

  const settingsApi = window.monitorApi && typeof window.monitorApi.getSettings === 'function'
    ? window.monitorApi
    : null;

  // Search engines known to the browser; keep in sync with main.js.
  const SEARCH_URLS = {
    google:     'https://www.google.com/search?q=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    brave:      'https://search.brave.com/search?q=%s',
    startpage:  'https://www.startpage.com/do/search?q=%s',
    bing:       'https://www.bing.com/search?q=%s',
    kagi:       'https://kagi.com/search?q=%s',
    ecosia:     'https://www.ecosia.org/search?q=%s',
  };

  /** Live mirror of the browser settings (theme, search engine, …). */
  let browserSettings = { searchEngine: 'duckduckgo', theme: 'amber' };
  const THEME_LIST = [
    { id: 'amber',    label: 'Amber',    accent: '#d4a843', desc: 'Classic intelligence gold' },
    { id: 'cyber',    label: 'Cyber',    accent: '#3aff8a', desc: 'Green terminal hacker' },
    { id: 'palantir', label: 'Palantir', accent: '#4a90e2', desc: 'Cool blue analyst' },
    { id: 'crimson',  label: 'Crimson',  accent: '#ff4e4e', desc: 'Red threat alert' },
    { id: 'mono',     label: 'Mono',     accent: '#e8e8f0', desc: 'Clean monochrome' },
    { id: 'arctic',   label: 'Arctic',   accent: '#22d3ee', desc: 'Ice-cold cyan' },
    { id: 'violet',   label: 'Violet',   accent: '#a78bfa', desc: 'Deep purple' },
    { id: 'emerald',  label: 'Emerald',  accent: '#34d399', desc: 'Forest green' },
    { id: 'sunrise',  label: 'Sunrise',  accent: '#fb923c', desc: 'Warm orange' },
  ];
  const VALID_THEMES = THEME_LIST.map((t) => t.id);
  function applyTheme(name) {
    document.documentElement.dataset.theme = VALID_THEMES.includes(name) ? name : 'amber';
  }
  applyTheme('amber');
  if (settingsApi) {
    settingsApi.getSettings().then((payload) => {
      if (payload && payload.settings) {
        browserSettings = payload.settings;
        applyTheme(browserSettings.theme);
      }
    }).catch(() => {});
    if (typeof settingsApi.onSettingsChanged === 'function') {
      settingsApi.onSettingsChanged((s) => {
        browserSettings = s || browserSettings;
        applyTheme(browserSettings.theme);
      });
    }
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  // --------------------------------------------------------------------------
  // Persisted state
  // --------------------------------------------------------------------------

  const STORAGE_KEY = 'monitor:dashboard:v2';

  const DEFAULT_PANELS = [
    'map', 'news', 'threat', 'intel', 'weather', 'localnews', 'markets', 'crypto', 'conflicts', 'sources', 'toolkit',
  ];

  const PANEL_SIZE_OPTIONS = ['sm', 'md', 'lg', 'xl'];

  const DEFAULT_PREFS = {
    dashTheme: 'amber',
    showRadar: true,
    dashGap: 16,
    panelRadius: 10,
    showHero: true,
    compactHeader: false,
    useFahrenheit: false,
  };

  const DEFAULT_STATE = {
    panels: DEFAULT_PANELS.slice(),
    panelSizes: {},
    prefs: Object.assign({}, DEFAULT_PREFS),
    mapLayers: {
      // Security
      conflicts: true,
      threats: true,
      bases: false,
      cyber: false,
      nuclear: false,
      spaceports: false,
      gpsjamming: false,
      // Infrastructure
      cables: false,
      pipelines: false,
      chokepoints: true,
      ports: false,
      airports: false,
      datacenters: false,
      // Economic
      financial: false,
      minerals: false,
      trade: true,
      cities: true,
      migration: false,
      // Live
      quakes: true,
      flights: false,
      vessels: false,
      iss: false,
    },
    newsSource: 'bbc',
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        let panels = Array.isArray(parsed.panels) ? parsed.panels : DEFAULT_PANELS.slice();
        // Remove deleted panels
        panels = panels.filter(function (p) { return p !== 'streams'; });
        // Auto-add new default panels that didn't exist before
        for (const dp of DEFAULT_PANELS) {
          if (!panels.includes(dp)) panels.push(dp);
        }
        return {
          panels: panels,
          panelSizes: parsed.panelSizes || {},
          prefs: Object.assign({}, DEFAULT_PREFS, parsed.prefs || {}),
          mapLayers: Object.assign({}, DEFAULT_STATE.mapLayers, parsed.mapLayers || {}),
          newsSource: parsed.newsSource || 'bbc',
        };
      }
    } catch (err) {
      console.warn('[dashboard] failed to load state', err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[dashboard] failed to save state', err);
    }
  }

  const state = loadState();

  function applyPrefs() {
    const p = state.prefs;
    applyTheme(p.dashTheme || 'amber');
    const radar = document.querySelector('.radar-bg');
    if (radar) radar.style.display = p.showRadar === false ? 'none' : '';
    const dash = document.getElementById('dashboard');
    if (dash) dash.style.gap = (p.dashGap || 16) + 'px';
    document.documentElement.style.setProperty('--panel-radius', (p.panelRadius || 10) + 'px');
    const hero = document.querySelector('.hero');
    if (hero) hero.style.display = p.showHero === false ? 'none' : '';
    const header = document.querySelector('.top-header');
    if (header) header.classList.toggle('compact', !!p.compactHeader);
  }
  applyPrefs();

  // --------------------------------------------------------------------------
  // Panel registry — each panel declares its metadata + render function.
  // The actual render functions are assigned further below.
  // --------------------------------------------------------------------------

  /** @type {Record<string, {title:string,icon:string,size:string,desc:string,render:(body:HTMLElement,panel:HTMLElement)=>(void|(()=>void))}>} */
  const PANELS = {};

  // --------------------------------------------------------------------------
  // Clock in the top header (not a panel, always visible)
  // --------------------------------------------------------------------------

  function tickTopClock() {
    const now = new Date();
    const time = now.toISOString().slice(11, 19);
    const date = now.toISOString().slice(0, 10);
    const tEl = document.getElementById('clock-time');
    const dEl = document.getElementById('clock-date');
    const fEl = document.getElementById('footer-date');
    if (tEl) tEl.textContent = time;
    if (dEl) dEl.textContent = date;
    if (fEl) fEl.textContent = now.toUTCString().slice(0, 22);
  }
  tickTopClock();
  setInterval(tickTopClock, 1000);

  // --------------------------------------------------------------------------
  // Search form
  // --------------------------------------------------------------------------

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = searchInput.value.trim();
      if (!v) return;
      // Delegate to the browser chrome — navigate the current tab.
      if (looksLikeUrl(v)) {
        window.location.href = coerceUrl(v);
        return;
      }
      const tpl = SEARCH_URLS[browserSettings.searchEngine] || SEARCH_URLS.duckduckgo;
      window.location.href = tpl.replace('%s', encodeURIComponent(v));
    });
  }
  function looksLikeUrl(v) {
    return /^[a-z]+:\/\//i.test(v) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(v);
  }
  function coerceUrl(v) {
    return /^[a-z]+:\/\//i.test(v) ? v : 'https://' + v;
  }

  // --------------------------------------------------------------------------
  // Dashboard rendering
  // --------------------------------------------------------------------------

  const dashboardEl = document.getElementById('dashboard');
  const customizeHint = document.getElementById('customize-hint');

  /** Map of panel id → cleanup fn (e.g. to clear intervals). */
  const activeCleanups = new Map();

  function runCleanups() {
    for (const fn of activeCleanups.values()) {
      try { fn(); } catch (_) { /* swallow */ }
    }
    activeCleanups.clear();
  }

  let dragSrcId = null;

  function renderDashboard() {
    runCleanups();
    dashboardEl.innerHTML = '';

    if (!state.panels || state.panels.length === 0) {
      customizeHint.style.display = '';
      return;
    }
    customizeHint.style.display = 'none';

    for (const id of state.panels) {
      const def = PANELS[id];
      if (!def) continue;
      const panelEl = buildPanel(id, def);
      panelEl.setAttribute('draggable', 'true');
      panelEl.addEventListener('dragstart', (e) => {
        dragSrcId = id;
        panelEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      });
      panelEl.addEventListener('dragend', () => {
        panelEl.classList.remove('dragging');
        dashboardEl.querySelectorAll('.panel').forEach((p) => p.classList.remove('drag-over'));
        dragSrcId = null;
      });
      panelEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrcId && dragSrcId !== id) {
          panelEl.classList.add('drag-over');
        }
      });
      panelEl.addEventListener('dragleave', () => {
        panelEl.classList.remove('drag-over');
      });
      panelEl.addEventListener('drop', (e) => {
        e.preventDefault();
        panelEl.classList.remove('drag-over');
        if (!dragSrcId || dragSrcId === id) return;
        const fromIdx = state.panels.indexOf(dragSrcId);
        const toIdx = state.panels.indexOf(id);
        if (fromIdx === -1 || toIdx === -1) return;
        state.panels.splice(fromIdx, 1);
        state.panels.splice(toIdx, 0, dragSrcId);
        saveState();
        renderDashboard();
      });

      dashboardEl.appendChild(panelEl);
      try {
        const cleanup = def.render(panelEl.querySelector('.panel-body'), panelEl);
        if (typeof cleanup === 'function') activeCleanups.set(id, cleanup);
      } catch (err) {
        console.error('[dashboard] panel render failed', id, err);
        renderErrorInto(panelEl.querySelector('.panel-body'), err, () => {
          def.render(panelEl.querySelector('.panel-body'), panelEl);
        });
      }
    }
  }

  function buildPanel(id, def) {
    let currentSize = state.panelSizes[id] || def.size || 'md';
    const el = document.createElement('article');
    el.className = 'panel panel-' + currentSize;
    el.dataset.panelId = id;

    const head = document.createElement('header');
    head.className = 'panel-head';

    const h3 = document.createElement('h3');
    h3.innerHTML = '<span class="panel-icon">' + def.icon + '</span>' + escapeHtml(def.title);
    head.appendChild(h3);

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const statusEl = document.createElement('span');
    statusEl.className = 'panel-status';
    statusEl.dataset.status = 'idle';
    statusEl.textContent = '—';
    actions.appendChild(statusEl);

    const sizeBtn = document.createElement('button');
    sizeBtn.className = 'panel-btn panel-size-btn';
    sizeBtn.type = 'button';
    sizeBtn.title = 'Resize panel (current: ' + currentSize.toUpperCase() + ')';
    sizeBtn.innerHTML = '&#8644;';
    sizeBtn.addEventListener('click', () => {
      const curIdx = PANEL_SIZE_OPTIONS.indexOf(currentSize);
      const nextSize = PANEL_SIZE_OPTIONS[(curIdx + 1) % PANEL_SIZE_OPTIONS.length];
      currentSize = nextSize;
      state.panelSizes[id] = nextSize;
      saveState();
      el.className = 'panel panel-' + nextSize;
      sizeBtn.title = 'Resize panel (current: ' + nextSize.toUpperCase() + ')';
      const mapCanvas = el.querySelector('.map-canvas');
      if (mapCanvas) {
        setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 100);
      }
    });
    actions.appendChild(sizeBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'panel-btn';
    refreshBtn.type = 'button';
    refreshBtn.title = 'Refresh panel';
    refreshBtn.innerHTML = '&#8634;';
    refreshBtn.addEventListener('click', () => {
      const oldCleanup = activeCleanups.get(id);
      if (oldCleanup) { try { oldCleanup(); } catch (_) {} }
      activeCleanups.delete(id);
      const body = el.querySelector('.panel-body');
      body.innerHTML = '';
      try {
        const cleanup = def.render(body, el);
        if (typeof cleanup === 'function') activeCleanups.set(id, cleanup);
      } catch (err) {
        renderErrorInto(body, err);
      }
    });
    actions.appendChild(refreshBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn danger';
    closeBtn.type = 'button';
    closeBtn.title = 'Remove panel';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
      state.panels = state.panels.filter((pid) => pid !== id);
      saveState();
      renderDashboard();
    });
    actions.appendChild(closeBtn);

    head.appendChild(actions);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'panel-body';
    el.appendChild(body);
    return el;
  }

  function setPanelStatus(panelEl, status, label) {
    if (!panelEl) return;
    const s = panelEl.querySelector('.panel-status');
    if (!s) return;
    s.dataset.status = status;
    s.textContent = label || status.toUpperCase();
  }

  function renderErrorInto(body, err, retry) {
    body.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'panel-error';
    div.innerHTML =
      '<div>' + escapeHtml((err && err.message) || 'Panel failed to load') + '</div>';
    if (retry) {
      const btn = document.createElement('button');
      btn.className = 'retry';
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => {
        body.innerHTML = '';
        try { retry(); } catch (e) { renderErrorInto(body, e, retry); }
      });
      div.appendChild(btn);
    }
    body.appendChild(div);
  }

  // --------------------------------------------------------------------------
  // Panel picker modal
  // --------------------------------------------------------------------------

  function openPicker() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML =
      '<header class="modal-head">' +
      '  <h2>Add or remove panels</h2>' +
      '  <button class="modal-close" type="button">&times;</button>' +
      '</header>' +
      '<div class="modal-body"><div class="picker-grid"></div></div>';
    backdrop.appendChild(card);

    const grid = card.querySelector('.picker-grid');
    for (const [id, def] of Object.entries(PANELS)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-card';
      const active = state.panels.includes(id);
      btn.classList.toggle('is-active', active);
      btn.innerHTML =
        '<div class="picker-icon">' + def.icon + '</div>' +
        '<div class="picker-title">' + escapeHtml(def.title) + '</div>' +
        '<div class="picker-desc">' + escapeHtml(def.desc || '') + '</div>' +
        '<div class="picker-state">' + (active ? 'ADDED' : 'ADD TO DASHBOARD') + '</div>';
      btn.addEventListener('click', () => {
        const nowActive = !state.panels.includes(id);
        if (nowActive) {
          state.panels.push(id);
        } else {
          state.panels = state.panels.filter((pid) => pid !== id);
        }
        saveState();
        renderDashboard();
        btn.classList.toggle('is-active', nowActive);
        btn.querySelector('.picker-state').textContent = nowActive ? 'ADDED' : 'ADD TO DASHBOARD';
      });
      grid.appendChild(btn);
    }

    function close() { backdrop.remove(); }
    card.querySelector('.modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function escListener(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escListener); }
    });

    document.getElementById('modal-root').appendChild(backdrop);
  }

  document.getElementById('add-panel-btn').addEventListener('click', openPicker);

  // --------------------------------------------------------------------------
  // Presets modal (quick layouts)
  // --------------------------------------------------------------------------

  const PRESETS = [
    {
      id: 'full',
      name: 'Full OSINT',
      desc: 'Every panel. Maximum situational awareness.',
      panels: ['map', 'threat', 'news', 'intel', 'weather', 'localnews', 'markets', 'crypto', 'conflicts', 'sources', 'toolkit'],
    },
    {
      id: 'geo',
      name: 'Geopolitical',
      desc: 'Map, conflicts, intel feed, live streams.',
      panels: ['map', 'threat', 'conflicts', 'intel', 'news'],
    },
    {
      id: 'market',
      name: 'Markets & Finance',
      desc: 'Equities, commodities, crypto, news.',
      panels: ['markets', 'crypto', 'news', 'weather'],
    },
    {
      id: 'minimal',
      name: 'Minimal',
      desc: 'Threat level, news, weather.',
      panels: ['threat', 'news', 'weather'],
    },
    {
      id: 'media',
      name: 'Media Watch',
      desc: 'News feeds, local news, live video.',
      panels: ['news', 'localnews', 'intel'],
    },
    {
      id: 'toolkit',
      name: 'Analyst Toolkit',
      desc: 'Sources, toolkit, intel. No live feeds.',
      panels: ['sources', 'toolkit', 'intel'],
    },
    {
      id: 'daily',
      name: 'Daily Brief',
      desc: 'Weather, news, markets, threat overview.',
      panels: ['weather', 'threat', 'news', 'localnews', 'markets'],
    },
  ];

  function openPresets() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML =
      '<header class="modal-head">' +
      '  <h2>Layout presets</h2>' +
      '  <button class="modal-close" type="button">&times;</button>' +
      '</header>' +
      '<div class="modal-body"><div class="preset-list"></div></div>';
    const list = card.querySelector('.preset-list');
    for (const p of PRESETS) {
      const row = document.createElement('div');
      row.className = 'preset-row';
      row.innerHTML =
        '<div><div class="preset-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="preset-desc">' + escapeHtml(p.desc) + '</div></div>' +
        '<button type="button">Apply</button>';
      row.querySelector('button').addEventListener('click', () => {
        state.panels = p.panels.slice();
        saveState();
        renderDashboard();
        backdrop.remove();
      });
      list.appendChild(row);
    }
    backdrop.appendChild(card);
    function close() { backdrop.remove(); }
    card.querySelector('.modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.getElementById('modal-root').appendChild(backdrop);
  }

  document.getElementById('preset-btn').addEventListener('click', openPresets);

  // --------------------------------------------------------------------------
  // Customize modal — full dashboard customization
  // --------------------------------------------------------------------------

  function openCustomize() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal-card modal-card-wide';
    card.innerHTML =
      '<header class="modal-head">' +
      '  <h2>Customize Dashboard</h2>' +
      '  <button class="modal-close" type="button">&times;</button>' +
      '</header>' +
      '<div class="modal-body">' +
      '  <div class="cust-tabs"></div>' +
      '  <div class="cust-content"></div>' +
      '</div>';

    const tabs = card.querySelector('.cust-tabs');
    const content = card.querySelector('.cust-content');

    const SECTIONS = [
      { id: 'theme', label: 'Theme', icon: '&#127912;' },
      { id: 'layout', label: 'Layout', icon: '&#9783;' },
      { id: 'panels', label: 'Panels', icon: '&#9638;' },
      { id: 'display', label: 'Display', icon: '&#9788;' },
    ];

    let activeSection = 'theme';

    function renderTabs() {
      tabs.innerHTML = SECTIONS.map(function (s) {
        return '<button class="cust-tab' + (s.id === activeSection ? ' is-active' : '') +
          '" data-section="' + s.id + '">' +
          '<span class="cust-tab-icon">' + s.icon + '</span>' +
          '<span>' + escapeHtml(s.label) + '</span></button>';
      }).join('');
      tabs.querySelectorAll('.cust-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeSection = btn.dataset.section;
          renderTabs();
          renderContent();
        });
      });
    }

    function renderContent() {
      if (activeSection === 'theme') renderThemeSection();
      else if (activeSection === 'layout') renderLayoutSection();
      else if (activeSection === 'panels') renderPanelsSection();
      else if (activeSection === 'display') renderDisplaySection();
    }

    // — THEME —
    function renderThemeSection() {
      content.innerHTML =
        '<h3 class="cust-section-title">Color Theme</h3>' +
        '<div class="cust-theme-grid"></div>';
      var grid = content.querySelector('.cust-theme-grid');
      for (var i = 0; i < THEME_LIST.length; i++) {
        var t = THEME_LIST[i];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cust-theme-card' + (state.prefs.dashTheme === t.id ? ' is-active' : '');
        btn.dataset.theme = t.id;
        btn.innerHTML =
          '<div class="cust-theme-swatch" style="background:' + t.accent + '"></div>' +
          '<div class="cust-theme-name">' + escapeHtml(t.label) + '</div>' +
          '<div class="cust-theme-desc">' + escapeHtml(t.desc) + '</div>';
        btn.addEventListener('click', (function (themeId) {
          return function () {
            state.prefs.dashTheme = themeId;
            saveState();
            applyPrefs();
            renderThemeSection();
          };
        })(t.id));
        grid.appendChild(btn);
      }
    }

    // — LAYOUT —
    function renderLayoutSection() {
      content.innerHTML =
        '<h3 class="cust-section-title">Dashboard Layout</h3>' +
        '<div class="cust-form">' +
        '  <div class="cust-field">' +
        '    <label>Panel spacing</label>' +
        '    <div class="cust-range-row">' +
        '      <input type="range" min="4" max="32" value="' + (state.prefs.dashGap || 16) + '" data-pref="dashGap" />' +
        '      <span class="cust-range-val">' + (state.prefs.dashGap || 16) + 'px</span>' +
        '    </div>' +
        '  </div>' +
        '  <div class="cust-field">' +
        '    <label>Panel corner radius</label>' +
        '    <div class="cust-range-row">' +
        '      <input type="range" min="0" max="20" value="' + (state.prefs.panelRadius || 10) + '" data-pref="panelRadius" />' +
        '      <span class="cust-range-val">' + (state.prefs.panelRadius || 10) + 'px</span>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<h3 class="cust-section-title" style="margin-top:24px">Panel Order</h3>' +
        '<p class="cust-hint">Drag panels on the dashboard to reorder, or reorder here.</p>' +
        '<div class="cust-panel-order"></div>';

      content.querySelectorAll('input[type="range"]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var key = inp.dataset.pref;
          var val = parseInt(inp.value, 10);
          state.prefs[key] = val;
          inp.parentElement.querySelector('.cust-range-val').textContent = val + 'px';
          saveState();
          applyPrefs();
        });
      });

      var orderList = content.querySelector('.cust-panel-order');
      renderPanelOrder(orderList);
    }

    function renderPanelOrder(container) {
      container.innerHTML = '';
      state.panels.forEach(function (id, idx) {
        var def = PANELS[id];
        if (!def) return;
        var row = document.createElement('div');
        row.className = 'cust-order-row';
        row.innerHTML =
          '<span class="cust-order-handle" title="Drag to reorder">&#8942;&#8942;</span>' +
          '<span class="cust-order-icon">' + def.icon + '</span>' +
          '<span class="cust-order-name">' + escapeHtml(def.title) + '</span>' +
          '<div class="cust-order-btns">' +
          (idx > 0 ? '<button class="cust-order-btn" data-dir="up" title="Move up">&#9650;</button>' : '') +
          (idx < state.panels.length - 1 ? '<button class="cust-order-btn" data-dir="down" title="Move down">&#9660;</button>' : '') +
          '</div>';
        row.querySelectorAll('.cust-order-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var dir = btn.dataset.dir;
            var newIdx = dir === 'up' ? idx - 1 : idx + 1;
            state.panels.splice(idx, 1);
            state.panels.splice(newIdx, 0, id);
            saveState();
            renderDashboard();
            renderPanelOrder(container);
          });
        });
        container.appendChild(row);
      });
    }

    // — PANELS —
    function renderPanelsSection() {
      content.innerHTML =
        '<h3 class="cust-section-title">Toggle Panels</h3>' +
        '<div class="picker-grid"></div>';
      var grid = content.querySelector('.picker-grid');
      for (var _id in PANELS) {
        if (!PANELS.hasOwnProperty(_id)) continue;
        var def = PANELS[_id];
        var active = state.panels.includes(_id);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-card' + (active ? ' is-active' : '');
        btn.dataset.pid = _id;
        btn.innerHTML =
          '<div class="picker-icon">' + def.icon + '</div>' +
          '<div class="picker-title">' + escapeHtml(def.title) + '</div>' +
          '<div class="picker-desc">' + escapeHtml(def.desc || '') + '</div>' +
          '<div class="picker-state">' + (active ? 'ADDED' : 'ADD TO DASHBOARD') + '</div>';
        btn.addEventListener('click', (function (panelId) {
          return function () {
            var nowActive = !state.panels.includes(panelId);
            if (nowActive) {
              state.panels.push(panelId);
            } else {
              state.panels = state.panels.filter(function (pid) { return pid !== panelId; });
            }
            saveState();
            renderDashboard();
            renderPanelsSection();
          };
        })(_id));
        grid.appendChild(btn);
      }
    }

    // — DISPLAY —
    function renderDisplaySection() {
      var p = state.prefs;
      content.innerHTML =
        '<h3 class="cust-section-title">Display Options</h3>' +
        '<div class="cust-toggles">' +
        '  <label class="cust-toggle">' +
        '    <input type="checkbox" data-pref="showRadar" ' + (p.showRadar !== false ? 'checked' : '') + ' />' +
        '    <span>Show radar background animation</span>' +
        '  </label>' +
        '  <label class="cust-toggle">' +
        '    <input type="checkbox" data-pref="showHero" ' + (p.showHero !== false ? 'checked' : '') + ' />' +
        '    <span>Show hero section (search bar + tagline)</span>' +
        '  </label>' +
        '  <label class="cust-toggle">' +
        '    <input type="checkbox" data-pref="compactHeader" ' + (p.compactHeader ? 'checked' : '') + ' />' +
        '    <span>Compact header</span>' +
        '  </label>' +
        '</div>' +
        '<h3 class="cust-section-title" style="margin-top:24px">Quick Actions</h3>' +
        '<div class="cust-quick-actions">' +
        '  <button class="cust-action-btn" data-action="reset-layout">Reset panel layout</button>' +
        '  <button class="cust-action-btn" data-action="reset-sizes">Reset panel sizes</button>' +
        '  <button class="cust-action-btn" data-action="reset-all">Reset everything to defaults</button>' +
        '</div>';

      content.querySelectorAll('input[data-pref]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          state.prefs[inp.dataset.pref] = inp.checked;
          saveState();
          applyPrefs();
        });
      });

      content.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = btn.dataset.action;
          if (action === 'reset-layout') {
            state.panels = DEFAULT_PANELS.slice();
          } else if (action === 'reset-sizes') {
            state.panelSizes = {};
          } else if (action === 'reset-all') {
            var fresh = JSON.parse(JSON.stringify(DEFAULT_STATE));
            state.panels = fresh.panels;
            state.panelSizes = fresh.panelSizes;
            state.prefs = fresh.prefs;
            state.mapLayers = fresh.mapLayers;
          }
          saveState();
          applyPrefs();
          renderDashboard();
          renderDisplaySection();
        });
      });
    }

    renderTabs();
    renderContent();

    backdrop.appendChild(card);
    function close() { backdrop.remove(); }
    card.querySelector('.modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
    document.getElementById('modal-root').appendChild(backdrop);
  }

  document.getElementById('customize-btn').addEventListener('click', openCustomize);

  // --------------------------------------------------------------------------
  // PANEL: Threat Level
  // --------------------------------------------------------------------------
  PANELS.threat = {
    title: 'Threat Level',
    icon: '&#9650;',
    size: 'sm',
    desc: 'Global DEFCON-style threat indicator.',
    render: (body, panel) => {
      // Derived from the count of open conflicts + news keywords. For now
      // use a static heuristic; refreshes when the panel is refreshed.
      setPanelStatus(panel, 'live', 'LIVE');
      const assess = assessThreat();
      body.innerHTML =
        '<div class="threat-level">' +
        '  <div class="threat-ring" data-sev="' + assess.sev + '">' + assess.code + '</div>' +
        '  <div class="threat-label">' + escapeHtml(assess.label) + '</div>' +
        '  <div class="threat-summary">' + escapeHtml(assess.summary) + '</div>' +
        '</div>';
    },
  };

  function assessThreat() {
    // Static assessment — reflects current major flashpoints. Panels
    // pulling live data can refine this later.
    const now = new Date();
    const hour = now.getUTCHours();
    // Small variance to feel "live"
    const score = 3 + ((hour + now.getUTCDate()) % 3);
    if (score <= 1) return { code: 'DC5', sev: 'low', label: 'LOW', summary: 'No major flashpoints active.' };
    if (score === 2) return { code: 'DC4', sev: 'low', label: 'GUARDED', summary: 'Elevated monitoring posture.' };
    if (score === 3) return { code: 'DC3', sev: 'med', label: 'ELEVATED', summary: 'Multiple regional conflicts active.' };
    if (score === 4) return { code: 'DC2', sev: 'high', label: 'HIGH', summary: 'Kinetic operations across Middle East & Eastern Europe.' };
    return { code: 'DC1', sev: 'crit', label: 'CRITICAL', summary: 'Large-scale state-on-state hostilities reported.' };
  }

  // --------------------------------------------------------------------------
  // PANEL: Active Conflicts (hardcoded, curated)
  // --------------------------------------------------------------------------
  const CONFLICTS = [
    // Middle East / North Africa
    { region: 'MidEast',  name: 'Gaza — Israel/Hamas',        sev: 'crit', lat: 31.4,  lng: 34.4,
      poly: [[31.59,34.22],[31.59,34.28],[31.53,34.35],[31.52,34.49],[31.52,34.56],[31.34,34.52],[31.23,34.48],[31.22,34.27],[31.30,34.22]] },
    { region: 'MidEast',  name: 'West Bank unrest',           sev: 'high', lat: 32.0,  lng: 35.3,
      poly: [[32.54,35.00],[32.55,35.19],[32.49,35.40],[32.38,35.55],[32.18,35.54],[31.95,35.53],[31.75,35.49],[31.50,35.46],[31.34,35.40],[31.35,35.20],[31.50,35.10],[31.78,35.03],[32.00,34.96],[32.27,34.97],[32.54,35.00]] },
    { region: 'MidEast',  name: 'Lebanon — southern border',  sev: 'high', lat: 33.8,  lng: 35.8,
      poly: [[34.69,35.60],[34.65,36.00],[34.65,36.28],[34.49,36.38],[34.22,36.51],[33.92,36.37],[33.72,36.18],[33.55,35.98],[33.27,35.86],[33.05,35.75],[33.07,35.47],[33.28,35.19],[33.90,35.10],[34.15,35.60],[34.69,35.60]] },
    { region: 'MidEast',  name: 'Yemen — Houthi Red Sea ops', sev: 'high', lat: 15.5,  lng: 44.0,
      poly: [[16.95,42.75],[17.20,43.40],[16.90,44.80],[16.50,45.40],[16.40,46.30],[15.80,47.00],[15.40,47.80],[14.90,48.40],[14.50,49.00],[13.60,48.60],[13.10,47.70],[12.60,45.00],[12.70,43.60],[12.95,43.15],[13.30,43.30],[14.00,42.50],[14.50,42.80],[15.30,42.55],[16.00,42.65],[16.95,42.75]] },
    { region: 'MidEast',  name: 'Syria — northwest Idlib',    sev: 'med',  lat: 35.8,  lng: 36.5,
      poly: [[36.22,36.00],[36.35,36.30],[36.40,36.65],[36.15,36.80],[35.85,36.75],[35.55,36.55],[35.50,36.20],[35.70,36.00],[36.22,36.00]] },
    { region: 'MidEast',  name: 'Syria — northeast (SDF)',    sev: 'med',  lat: 36.2,  lng: 40.5,
      poly: [[37.32,38.80],[37.10,40.00],[37.05,41.00],[37.30,42.00],[37.30,42.38],[36.80,42.38],[36.50,41.40],[35.70,41.00],[35.10,40.50],[35.20,39.50],[35.60,38.80],[36.20,38.60],[36.80,38.50],[37.32,38.80]] },
    { region: 'MidEast',  name: 'Iran — US/Israel strikes',   sev: 'crit', lat: 32.4,  lng: 53.7,
      poly: [[39.78,44.05],[39.40,45.50],[39.20,47.50],[38.85,48.00],[38.40,48.88],[37.60,49.10],[37.05,50.10],[36.95,53.90],[37.35,55.35],[37.30,57.20],[36.70,59.40],[35.60,61.05],[34.30,60.70],[33.80,59.80],[31.40,61.80],[30.00,61.60],[27.20,63.30],[26.50,62.00],[25.30,61.60],[25.10,57.50],[26.60,56.30],[26.00,54.00],[25.30,52.80],[25.90,51.40],[27.80,50.90],[29.00,50.30],[29.30,48.50],[30.50,48.00],[31.00,47.70],[32.00,45.00],[33.30,44.20],[34.40,44.00],[35.20,44.20],[36.60,44.30],[38.00,44.00],[39.78,44.05]] },
    { region: 'MidEast',  name: 'Strait of Hormuz',           sev: 'high', lat: 26.5,  lng: 56.3,
      poly: [[27.10,56.60],[26.80,57.10],[26.20,57.00],[25.80,56.50],[25.90,55.80],[26.30,55.50],[26.80,55.70],[27.10,56.60]] },
    { region: 'MidEast',  name: 'Iraq — ISIS remnants',       sev: 'med',  lat: 33.3,  lng: 44.4,
      poly: [[37.38,42.36],[37.10,43.50],[37.00,44.80],[36.50,45.30],[35.80,45.80],[35.10,45.80],[34.00,46.00],[33.00,46.00],[31.00,47.70],[29.30,48.50],[29.00,47.00],[30.30,44.50],[31.30,42.00],[32.20,39.30],[33.30,38.80],[34.70,39.50],[36.40,41.00],[36.80,41.80],[37.38,42.36]] },
    { region: 'MidEast',  name: 'Libya — warlord factions',   sev: 'med',  lat: 28.0,  lng: 17.0,
      poly: [[33.17,11.50],[33.10,12.30],[32.80,13.00],[32.54,15.20],[31.70,16.60],[31.20,19.00],[30.25,19.50],[30.00,24.00],[29.00,25.00],[25.00,25.00],[23.50,24.00],[21.80,24.00],[19.80,18.00],[19.50,15.50],[22.80,14.90],[23.50,11.97],[24.30,10.00],[25.70,10.00],[30.00,9.80],[32.10,11.60],[33.17,11.50]] },
    // Europe — Donetsk + Luhansk oblasts
    { region: 'Europe',   name: 'Ukraine — Donbas front',     sev: 'crit', lat: 48.5,  lng: 38.5,
      poly: [[49.27,36.28],[49.20,37.10],[48.90,38.30],[49.30,39.15],[49.15,39.75],[48.50,40.15],[48.00,39.95],[47.70,39.20],[47.25,38.50],[47.05,37.60],[47.40,36.80],[47.80,36.20],[48.20,35.90],[48.80,36.00],[49.27,36.28]] },
    // Kharkiv oblast
    { region: 'Europe',   name: 'Ukraine — Kharkiv axis',     sev: 'high', lat: 49.8,  lng: 36.3,
      poly: [[50.55,35.30],[50.60,36.30],[50.40,37.40],[50.05,38.20],[49.60,38.00],[49.20,37.10],[49.27,36.28],[49.50,35.80],[49.80,35.25],[50.10,35.15],[50.55,35.30]] },
    // Zaporizhzhia oblast
    { region: 'Europe',   name: 'Ukraine — Zaporizhzhia',     sev: 'high', lat: 47.5,  lng: 35.5,
      poly: [[48.20,35.90],[47.80,36.20],[47.40,36.80],[47.05,37.00],[46.85,36.40],[46.60,35.80],[46.65,35.00],[47.00,34.40],[47.50,34.20],[48.00,34.60],[48.20,35.30],[48.20,35.90]] },
    // Kherson oblast
    { region: 'Europe',   name: 'Ukraine — Kherson front',    sev: 'high', lat: 46.6,  lng: 33.4,
      poly: [[47.00,34.40],[46.65,35.00],[46.60,34.40],[46.20,34.10],[46.10,33.50],[46.20,33.00],[46.50,32.50],[46.55,32.00],[46.80,32.70],[47.30,33.20],[47.40,33.80],[47.00,34.40]] },
    // Kursk oblast (Russia, near UA border)
    { region: 'Europe',   name: 'Russia — Kursk incursion',   sev: 'high', lat: 51.7,  lng: 36.2,
      poly: [[52.35,34.70],[52.40,35.40],[52.30,36.40],[52.10,37.30],[51.70,37.50],[51.20,37.20],[51.00,36.40],[51.05,35.60],[51.20,34.80],[51.60,34.50],[52.00,34.50],[52.35,34.70]] },
    // Transnistria — narrow strip east of Dniester
    { region: 'Europe',   name: 'Moldova — Transnistria',     sev: 'med',  lat: 47.0,  lng: 29.5,
      poly: [[47.80,29.10],[47.75,29.60],[47.45,29.80],[47.10,29.90],[46.80,30.10],[46.55,30.05],[46.40,29.70],[46.50,29.40],[46.80,29.20],[47.10,29.10],[47.40,29.00],[47.80,29.10]] },
    // Kosovo — whole territory
    { region: 'Europe',   name: 'Kosovo — tensions',          sev: 'low',  lat: 42.6,  lng: 21.0,
      poly: [[43.25,20.59],[43.21,21.06],[43.00,21.40],[42.75,21.78],[42.46,21.54],[42.23,21.25],[42.24,20.95],[42.35,20.65],[42.46,20.47],[42.65,20.30],[42.90,20.35],[43.25,20.59]] },
    // Africa — Sudan whole country
    { region: 'Africa',   name: 'Sudan — civil war',          sev: 'crit', lat: 15.5,  lng: 30.0,
      poly: [[22.00,24.00],[22.00,31.40],[21.83,31.50],[22.00,33.20],[22.00,36.90],[20.80,37.00],[18.30,38.60],[16.50,38.50],[14.20,36.40],[12.50,36.00],[11.00,35.00],[10.00,34.30],[9.50,33.80],[8.70,33.00],[7.70,30.20],[6.60,28.50],[5.20,27.50],[3.60,27.00],[3.50,25.00],[5.00,24.00],[9.50,24.00],[13.90,24.00],[15.50,24.00],[22.00,24.00]] },
    // Sahel — Mali + Burkina Faso + Niger combined
    { region: 'Africa',   name: 'Sahel — jihadist insurgency', sev: 'high', lat: 15.0, lng: 2.0,
      poly: [[25.00,-12.20],[24.00,0.20],[23.50,4.00],[23.00,5.60],[21.00,6.00],[20.00,9.00],[18.50,12.00],[16.00,13.80],[15.30,16.00],[14.70,15.60],[13.70,13.60],[13.00,15.00],[12.00,15.10],[11.10,13.80],[11.90,12.30],[11.00,10.80],[11.10,9.40],[12.00,8.00],[11.80,5.50],[11.10,4.40],[11.10,2.30],[11.50,0.80],[12.30,0.00],[11.00,-1.00],[11.00,-3.00],[9.90,-5.00],[10.80,-5.50],[11.90,-5.20],[14.50,-5.20],[15.10,-4.20],[15.00,-2.00],[14.50,-0.70],[15.00,1.00],[16.00,-0.50],[17.00,-0.50],[18.00,1.00],[19.50,1.50],[20.00,0.00],[22.00,-2.00],[23.00,-6.00],[22.50,-8.00],[21.00,-11.00],[22.50,-12.20],[25.00,-12.20]] },
    // DRC — Ituri, North Kivu, South Kivu provinces
    { region: 'Africa',   name: 'DRC — eastern provinces',    sev: 'high', lat: -1.5,  lng: 29.0,
      poly: [[2.50,27.40],[2.30,28.00],[2.00,29.00],[1.30,29.60],[0.80,29.80],[0.10,29.60],[-1.00,29.20],[-1.80,28.80],[-2.50,29.00],[-3.40,29.30],[-4.50,29.50],[-4.90,29.00],[-4.50,28.50],[-3.50,27.80],[-2.50,27.20],[-1.50,26.80],[-0.50,27.00],[0.80,27.20],[2.00,27.30],[2.50,27.40]] },
    // Ethiopia — Amhara region
    { region: 'Africa',   name: 'Ethiopia — Amhara',          sev: 'med',  lat: 11.5,  lng: 38.0,
      poly: [[13.30,36.40],[13.00,37.50],[12.80,38.50],[12.50,39.40],[12.00,40.00],[11.30,39.80],[10.60,39.90],[10.00,39.50],[9.70,38.70],[9.90,37.80],[10.00,37.00],[10.50,36.30],[11.00,35.80],[11.60,36.00],[12.50,36.10],[13.30,36.40]] },
    // Somalia — whole country
    { region: 'Africa',   name: 'Somalia — al-Shabaab',       sev: 'high', lat: 5.0,   lng: 46.0,
      poly: [[11.50,43.30],[11.80,44.60],[11.50,47.00],[11.00,49.20],[10.40,50.80],[9.50,50.80],[7.00,49.30],[5.00,48.00],[3.00,46.00],[1.50,44.00],[0.00,42.50],[-1.60,41.50],[-1.00,41.00],[1.50,41.00],[3.50,42.00],[5.00,42.50],[7.00,43.00],[9.50,43.00],[10.50,43.20],[11.50,43.30]] },
    // Mozambique — Cabo Delgado province
    { region: 'Africa',   name: 'Mozambique — Cabo Delgado',  sev: 'med',  lat: -12.5, lng: 40.0,
      poly: [[-10.47,40.60],[-10.50,39.80],[-11.20,39.30],[-11.70,38.80],[-12.40,38.70],[-13.60,38.80],[-14.40,39.80],[-14.10,40.60],[-13.20,40.90],[-12.00,40.80],[-10.47,40.60]] },
    // Nigeria — Borno, Yobe, Adamawa states (northeast)
    { region: 'Africa',   name: 'Nigeria — Boko Haram/ISWAP', sev: 'high', lat: 11.5,  lng: 13.0,
      poly: [[13.70,10.50],[13.80,12.00],[13.60,13.50],[13.20,14.20],[12.50,14.80],[11.80,14.50],[11.20,13.70],[10.50,13.00],[10.00,12.50],[9.70,11.60],[10.00,10.80],[10.50,10.40],[11.50,10.30],[12.50,10.40],[13.70,10.50]] },
    // Cameroon — Northwest + Southwest anglophone regions
    { region: 'Africa',   name: 'Cameroon — Anglophone crisis', sev: 'med', lat: 5.9,  lng: 9.8,
      poly: [[7.00,8.60],[6.80,9.50],[6.60,10.30],[6.30,10.80],[5.80,10.60],[5.30,10.40],[4.50,10.10],[4.20,9.50],[4.30,9.00],[4.70,8.60],[5.30,8.50],[5.80,8.40],[6.30,8.40],[7.00,8.60]] },
    // CAR — whole country
    { region: 'Africa',   name: 'CAR — armed groups',         sev: 'med',  lat: 6.6,   lng: 20.9,
      poly: [[10.70,14.40],[11.00,15.60],[10.70,18.50],[10.50,20.00],[10.90,22.40],[10.00,24.00],[9.40,25.00],[8.80,25.20],[7.80,27.50],[5.40,27.50],[4.20,25.50],[3.50,24.00],[3.50,22.50],[4.30,18.60],[4.50,16.00],[4.00,15.50],[3.20,16.00],[2.20,16.00],[2.20,15.60],[3.50,14.40],[6.50,14.50],[8.00,14.40],[10.70,14.40]] },
    // Burkina Faso — whole country
    { region: 'Africa',   name: 'Burkina Faso — JNIM',        sev: 'high', lat: 12.3,  lng: -1.5,
      poly: [[15.08,-4.20],[14.90,-2.00],[14.50,-0.70],[15.00,1.00],[14.50,2.20],[12.30,2.10],[11.10,2.30],[11.10,0.80],[11.50,-0.10],[12.30,0.00],[11.00,-1.00],[11.00,-3.10],[9.90,-5.00],[10.80,-5.50],[12.00,-5.20],[14.50,-5.20],[15.08,-4.20]] },
    // Mali — whole country
    { region: 'Africa',   name: 'Mali — JNIM / Wagner',       sev: 'high', lat: 17.6,  lng: -4.0,
      poly: [[25.00,-12.20],[24.00,0.20],[21.00,1.00],[18.00,1.00],[17.00,-0.50],[16.00,-0.50],[15.00,1.00],[14.90,-2.00],[15.08,-4.20],[14.50,-5.20],[12.00,-5.20],[10.80,-5.50],[11.00,-7.50],[11.40,-8.50],[12.20,-8.30],[12.00,-9.60],[12.30,-10.50],[12.60,-11.70],[14.80,-12.10],[15.20,-11.10],[15.40,-10.20],[16.30,-9.40],[17.00,-9.50],[18.00,-10.00],[19.50,-11.50],[21.00,-11.00],[22.50,-12.20],[25.00,-12.20]] },
    // Asia-Pacific
    { region: 'Asia',     name: 'Myanmar — civil war',        sev: 'high', lat: 19.7,  lng: 96.1,
      poly: [[28.30,97.35],[28.20,98.50],[27.10,97.00],[26.80,97.80],[25.60,98.60],[24.50,97.80],[23.90,97.60],[23.30,98.40],[22.50,99.50],[21.70,101.10],[21.20,100.50],[20.40,100.00],[19.80,100.90],[19.40,101.20],[18.50,101.00],[17.60,98.60],[16.50,98.30],[15.80,98.50],[15.00,98.20],[14.10,99.00],[13.00,99.10],[12.00,99.00],[10.50,98.80],[10.00,98.60],[11.00,97.60],[12.50,98.00],[13.80,97.60],[14.20,97.60],[14.80,97.00],[16.00,97.00],[16.50,97.70],[17.80,97.30],[17.00,96.00],[16.30,96.40],[16.00,95.50],[16.50,94.80],[17.80,94.40],[18.50,94.70],[19.30,93.90],[20.20,92.40],[21.00,92.30],[21.70,92.10],[22.80,92.60],[24.40,94.10],[26.00,95.00],[27.10,96.50],[28.30,97.35]] },
    { region: 'Asia',     name: 'Taiwan Strait — pressure',   sev: 'med',  lat: 24.0,  lng: 120.9,
      poly: [[25.30,121.00],[25.60,121.90],[25.30,122.10],[25.00,121.60],[24.80,122.00],[24.50,121.80],[23.80,121.60],[23.40,121.40],[22.80,121.10],[22.00,120.80],[21.90,120.70],[22.30,120.30],[22.60,120.30],[23.00,120.20],[23.30,120.10],[23.50,120.20],[23.80,120.60],[24.50,120.60],[24.80,121.00],[25.00,121.00],[25.30,121.00]] },
    { region: 'Asia',     name: 'Kashmir — LoC',              sev: 'med',  lat: 34.1,  lng: 74.8,
      poly: [[36.90,74.00],[36.50,74.90],[36.00,76.00],[35.50,77.80],[35.10,77.50],[34.60,77.00],[34.20,77.50],[33.80,76.80],[33.50,76.20],[33.00,75.80],[32.70,75.30],[32.50,74.70],[33.00,74.00],[33.20,73.70],[33.80,73.60],[34.00,73.40],[34.50,73.30],[35.50,73.50],[36.00,73.60],[36.50,73.80],[36.90,74.00]] },
    { region: 'Asia',     name: 'Korea — DPRK posture',       sev: 'med',  lat: 40.0,  lng: 127.0,
      poly: [[43.00,129.80],[42.40,130.70],[42.00,130.60],[41.50,129.70],[40.90,129.70],[40.50,129.40],[39.80,128.40],[39.20,127.50],[38.60,128.40],[38.30,128.10],[37.80,127.50],[37.70,126.90],[37.60,126.10],[37.80,125.50],[38.10,124.70],[39.00,124.30],[39.60,124.40],[40.10,124.50],[40.70,124.90],[41.00,125.30],[41.50,126.00],[41.80,126.90],[42.00,128.00],[42.40,129.30],[43.00,129.80]] },
    { region: 'Asia',     name: 'South China Sea — Spratlys',  sev: 'med',  lat: 10.0,  lng: 114.0,
      poly: [[23.00,117.00],[21.00,112.00],[18.00,109.00],[15.00,109.50],[12.00,110.00],[7.00,110.00],[3.50,110.50],[3.00,112.50],[2.50,115.00],[5.00,117.50],[8.00,118.00],[10.50,119.50],[12.50,120.00],[15.50,119.50],[18.50,120.00],[21.00,119.00],[23.00,117.00]] },
    { region: 'Asia',     name: 'Philippines — Mindanao',     sev: 'low',  lat: 7.1,   lng: 125.6,
      poly: [[9.80,123.50],[9.50,124.60],[9.20,125.50],[8.50,126.40],[8.00,126.60],[7.50,126.60],[7.00,126.20],[6.00,126.20],[5.60,125.70],[6.10,125.00],[6.50,124.50],[7.00,124.00],[7.50,123.50],[7.80,122.50],[7.50,122.00],[7.80,122.00],[8.00,122.50],[8.50,123.00],[9.00,123.20],[9.80,123.50]] },
    { region: 'Asia',     name: 'Afghanistan — TTP/ISIS-K',   sev: 'high', lat: 34.5,  lng: 69.2,
      poly: [[37.40,71.50],[38.40,68.40],[37.30,67.80],[37.10,66.50],[36.50,65.60],[35.90,64.00],[35.30,63.10],[34.30,62.00],[33.50,60.50],[31.30,60.80],[29.90,61.70],[29.40,63.00],[29.30,64.10],[29.00,66.30],[29.50,67.50],[30.40,69.30],[31.00,69.60],[31.80,69.30],[32.50,69.80],[33.60,70.30],[34.00,71.00],[34.30,71.10],[35.00,71.60],[36.20,71.80],[36.90,71.60],[37.40,71.50]] },
    { region: 'Asia',     name: 'Pakistan — Balochistan',     sev: 'med',  lat: 28.5,  lng: 66.5,
      poly: [[31.30,60.80],[30.50,61.60],[30.00,62.50],[29.40,63.00],[29.30,64.10],[29.00,66.30],[28.50,67.00],[27.80,68.10],[27.20,68.50],[26.50,68.10],[26.00,67.50],[25.50,66.80],[25.00,66.50],[25.00,65.50],[25.10,64.50],[25.30,63.50],[25.50,62.50],[25.80,61.80],[26.50,61.50],[27.20,62.80],[27.80,63.00],[28.40,62.00],[29.00,61.00],[29.90,61.70],[31.30,60.80]] },
    // Americas
    { region: 'Americas', name: 'Haiti — gang collapse',      sev: 'high', lat: 18.6,  lng: -72.3,
      poly: [[20.09,-72.80],[20.00,-72.00],[19.90,-71.70],[19.60,-71.70],[19.30,-71.80],[19.10,-72.00],[18.80,-71.70],[18.40,-71.70],[18.20,-71.80],[18.10,-72.00],[18.30,-72.50],[18.20,-73.00],[18.30,-73.50],[18.40,-73.80],[18.60,-74.00],[18.90,-74.30],[19.30,-74.40],[19.70,-73.40],[19.90,-73.10],[20.09,-72.80]] },
    { region: 'Americas', name: 'Ecuador — cartel violence',  sev: 'med',  lat: -2.2,  lng: -79.9,
      poly: [[1.40,-79.00],[1.00,-77.70],[0.80,-77.30],[0.20,-76.30],[0.00,-75.50],[-0.50,-75.30],[-1.00,-75.50],[-2.00,-76.70],[-2.90,-78.10],[-3.40,-78.50],[-4.00,-79.00],[-4.60,-79.50],[-5.00,-80.10],[-4.20,-80.40],[-3.50,-80.50],[-2.80,-80.50],[-2.20,-80.90],[-1.40,-80.40],[-0.60,-80.10],[0.00,-80.00],[0.80,-80.00],[1.00,-79.50],[1.40,-79.00]] },
    { region: 'Americas', name: 'Colombia — ELN / FARC remnants', sev: 'med', lat: 4.6, lng: -74.1,
      poly: [[12.40,-71.70],[11.80,-71.30],[11.00,-72.20],[10.50,-72.80],[9.50,-73.60],[8.60,-76.70],[7.90,-77.00],[7.30,-77.90],[6.50,-77.40],[4.00,-77.60],[2.50,-78.70],[1.50,-79.00],[1.00,-77.60],[0.50,-76.60],[0.00,-75.50],[-0.50,-75.30],[-1.00,-75.50],[-1.50,-75.00],[-0.50,-73.50],[0.50,-72.00],[1.00,-70.00],[2.00,-69.50],[3.50,-68.00],[4.50,-67.50],[5.50,-67.80],[6.00,-68.50],[6.50,-70.00],[7.00,-70.70],[7.50,-71.50],[8.00,-72.00],[9.00,-71.00],[10.00,-71.50],[11.00,-71.00],[11.50,-71.50],[12.40,-71.70]] },
    { region: 'Americas', name: 'Mexico — cartel wars',       sev: 'high', lat: 23.6,  lng: -102.6,
      poly: [[32.50,-117.00],[32.70,-114.70],[31.30,-111.00],[31.00,-108.00],[31.80,-106.40],[29.80,-104.40],[29.40,-103.10],[27.80,-99.50],[26.00,-97.20],[22.40,-97.80],[21.50,-97.20],[19.50,-96.50],[18.50,-95.50],[18.20,-94.50],[17.80,-94.00],[16.10,-93.50],[15.70,-93.00],[15.60,-92.20],[16.40,-91.40],[16.00,-90.40],[17.80,-91.00],[18.50,-88.00],[21.50,-87.40],[21.20,-89.50],[21.00,-90.40],[20.00,-90.30],[18.70,-91.50],[19.50,-92.30],[20.00,-92.00],[20.50,-91.30],[21.50,-90.00],[21.30,-89.90],[20.50,-90.50],[19.80,-92.50],[20.80,-92.00],[21.00,-91.50],[21.50,-93.00],[23.00,-97.50],[24.50,-99.00],[26.00,-99.30],[27.50,-101.00],[28.00,-103.00],[30.00,-104.50],[31.50,-106.50],[31.00,-109.50],[32.00,-114.50],[32.50,-117.00]] },
    { region: 'Americas', name: 'Venezuela — Guyana dispute', sev: 'med',  lat: 6.8,   lng: -58.9,
      poly: [[8.50,-60.00],[8.00,-59.00],[7.50,-59.00],[7.00,-59.50],[6.50,-60.50],[6.00,-61.00],[5.00,-60.70],[4.00,-60.00],[3.50,-59.50],[2.00,-59.00],[1.50,-59.00],[1.20,-58.50],[1.50,-58.00],[2.00,-57.00],[3.00,-57.50],[4.00,-58.00],[5.50,-57.50],[6.50,-57.00],[7.00,-57.50],[7.50,-58.00],[8.00,-58.50],[8.50,-59.00],[8.50,-60.00]] },
  ];

  PANELS.conflicts = {
    title: 'Active Conflicts',
    icon: '&#9876;',
    size: 'md',
    desc: 'Curated list of ongoing state & non-state conflicts.',
    render: (body, panel) => {
      setPanelStatus(panel, 'live', 'LIVE');
      const sorted = CONFLICTS.slice().sort((a, b) => severityRank(b.sev) - severityRank(a.sev));
      const html = ['<div class="conflict-list">'];
      for (const c of sorted) {
        html.push(
          '<div class="conflict-row" data-sev="' + c.sev + '">' +
          '<span class="region">' + escapeHtml(c.region) + '</span>' +
          '<span class="name">' + escapeHtml(c.name) + '</span>' +
          '<span class="sev">' + c.sev.toUpperCase() + '</span>' +
          '</div>'
        );
      }
      html.push('</div>');
      body.innerHTML = html.join('');
    },
  };

  function severityRank(s) {
    return { crit: 4, high: 3, med: 2, low: 1 }[s] || 0;
  }

  // --------------------------------------------------------------------------
  // PANEL: Live News (RSS via intel:fetch)
  // --------------------------------------------------------------------------

  const NEWS_SOURCES = [
    { id: 'bbc',      label: 'BBC',        url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'aljaz',    label: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { id: 'dw',       label: 'DW',         url: 'https://rss.dw.com/rdf/rss-en-all' },
    { id: 'ap',       label: 'AP',         url: 'https://rsshub.app/apnews/topics/world-news' },
    { id: 'cnbc',     label: 'CNBC',       url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
    { id: 'npr',      label: 'NPR',        url: 'https://feeds.npr.org/1001/rss.xml' },
  ];

  PANELS.news = {
    title: 'Live News',
    icon: '&#9636;',
    size: 'lg',
    desc: 'Breaking world news from major wires (BBC, Al Jazeera, DW, AP, CNBC, NPR).',
    render: (body, panel) => {
      // If the intel proxy is not available, show a clear message immediately.
      if (!hasApi) {
        body.innerHTML = '<div class="panel-empty">Intel proxy unavailable — open in Monitor Browser to load live news.</div>';
        setPanelStatus(panel, 'error', 'NO-PROXY');
        return;
      }

      // Source tabs + list
      const tabsHtml = NEWS_SOURCES.map((s) =>
        '<button data-src="' + s.id + '" class="' + (s.id === state.newsSource ? 'is-active' : '') + '">' +
        escapeHtml(s.label) + '</button>'
      ).join('');
      body.innerHTML =
        '<div class="news-tabs">' + tabsHtml + '</div>' +
        '<div class="news-body"><div class="panel-loading">Fetching headlines&hellip;</div></div>';
      body.querySelectorAll('.news-tabs button').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.newsSource = btn.dataset.src;
          saveState();
          body.querySelectorAll('.news-tabs button').forEach((b) => b.classList.toggle('is-active', b === btn));
          loadNews();
        });
      });

      let killed = false;
      let timer = null;

      function renderNewsList(text, src, out) {
        // Detect if we got an HTML error page instead of XML
        var trimmed = text.trim();
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
          console.warn('[news] received HTML instead of RSS from', src.id);
          return false;
        }
        var items = parseRss(text).slice(0, 14);
        if (items.length === 0) return false;
        var list = items.map(function (it) {
          var thumbHtml = it.thumb
            ? '<img class="news-thumb" src="' + escapeHtml(it.thumb) + '" alt="" loading="lazy" />'
            : '';
          return '<li><a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener">' +
            thumbHtml +
            '<div class="news-text">' +
            '<span class="news-title">' + escapeHtml(it.title) + '</span>' +
            '<span class="news-meta"><span class="src">' + escapeHtml(src.label) + '</span>' +
            escapeHtml(formatRelTime(it.date)) + '</span>' +
            '</div></a></li>';
        }).join('');
        out.innerHTML = '<ul class="news-list">' + list + '</ul>';
        return true;
      }

      function loadNews() {
        if (killed) return;
        var src = NEWS_SOURCES.find(function (s) { return s.id === state.newsSource; }) || NEWS_SOURCES[0];
        var out = body.querySelector('.news-body');

        // Show cached data immediately while fetching
        var cachedText = getCachedResponse(src.url);
        if (cachedText && renderNewsList(cachedText, src, out)) {
          setPanelStatus(panel, 'loading', 'UPDATING');
        } else {
          out.innerHTML = '<div class="panel-loading">Fetching headlines&hellip;</div>';
          setPanelStatus(panel, 'loading', 'FETCH');
        }

        fetchIntel(src.url)
          .then(function (text) {
            if (killed) return;
            if (!renderNewsList(text, src, out)) {
              out.innerHTML = '<div class="panel-empty">Feed returned no articles — try another source.</div>';
              setPanelStatus(panel, 'error', 'EMPTY');
              return;
            }
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch(function (err) {
            if (killed) return;
            // If we already showed cached data, keep it and just update status
            if (cachedText) {
              setPanelStatus(panel, 'live', 'CACHED');
            } else {
              renderErrorInto(out, err, loadNews);
              setPanelStatus(panel, 'error', 'ERR');
            }
          });
      }

      loadNews();
      timer = setInterval(loadNews, 10 * 60 * 1000);
      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  function parseRss(text) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) {
        // Try as text/html — some feeds are served oddly.
        const doc2 = parser.parseFromString(text, 'text/html');
        return extractRssItems(doc2);
      }
      return extractRssItems(doc);
    } catch (err) {
      console.warn('[news] parse failed', err);
      return [];
    }
  }

  function extractRssItems(doc) {
    const nodes = doc.querySelectorAll('item, entry');
    const out = [];
    nodes.forEach((n) => {
      const title = (n.querySelector('title')?.textContent || '').trim();
      let link = n.querySelector('link')?.textContent?.trim() || '';
      if (!link) {
        const linkEl = n.querySelector('link[href]');
        if (linkEl) link = linkEl.getAttribute('href');
      }
      const date =
        n.querySelector('pubDate')?.textContent ||
        n.querySelector('published')?.textContent ||
        n.querySelector('updated')?.textContent || '';
      let thumb = '';
      const mediaThumbnail = n.querySelector('thumbnail');
      if (mediaThumbnail) thumb = mediaThumbnail.getAttribute('url') || '';
      if (!thumb) {
        const enclosure = n.querySelector('enclosure[type^="image"]');
        if (enclosure) thumb = enclosure.getAttribute('url') || '';
      }
      if (!thumb) {
        const mediaContent = n.querySelector('content[url]');
        if (mediaContent && /image/i.test(mediaContent.getAttribute('type') || mediaContent.getAttribute('medium') || '')) {
          thumb = mediaContent.getAttribute('url') || '';
        }
        if (!thumb && mediaContent) thumb = mediaContent.getAttribute('url') || '';
      }
      if (!thumb) {
        const desc = n.querySelector('description')?.textContent || '';
        const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) thumb = imgMatch[1];
      }
      if (title && link) {
        out.push({ title, link, date: date ? new Date(date) : new Date(), thumb });
      }
    });
    return out;
  }

  function formatRelTime(d) {
    if (!(d instanceof Date) || isNaN(d.valueOf())) return '';
    const diff = (Date.now() - d.valueOf()) / 1000;
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // --------------------------------------------------------------------------
  // PANEL: Intel Feed (multi-source security RSS)
  // --------------------------------------------------------------------------
  const INTEL_SOURCES = [
    { id: 'reuters',   label: 'Reuters World', url: 'https://feeds.reuters.com/Reuters/worldNews' },
    { id: 'bbc-world', label: 'BBC World',     url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'dw-world',  label: 'DW World',      url: 'https://rss.dw.com/rdf/rss-en-all' },
    { id: 'aljaz',     label: 'Al Jazeera',    url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { id: 'usgs',      label: 'USGS Quakes',   url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom' },
  ];

  PANELS.intel = {
    title: 'Intel Feed',
    icon: '&#9678;',
    size: 'md',
    desc: 'Aggregated security & world news from multiple sources.',
    render: (body, panel) => {
      let killed = false;
      let timer = null;

      function load() {
        if (killed) return;
        setPanelStatus(panel, 'loading', 'FETCH');

        var cachedItems = [];
        INTEL_SOURCES.forEach(function (src) {
          var c = getCachedResponse(src.url);
          if (c) {
            parseRss(c).slice(0, 4).forEach(function (it) {
              it._src = src.label;
              cachedItems.push(it);
            });
          }
        });
        if (cachedItems.length > 0) {
          renderItems(cachedItems);
          setPanelStatus(panel, 'loading', 'UPDATING');
        } else {
          body.innerHTML = '<div class="panel-loading">Fetching intel feeds&hellip;</div>';
        }

        Promise.allSettled(INTEL_SOURCES.map(function (src) {
          return fetchIntel(src.url).then(function (text) {
            return parseRss(text).slice(0, 4).map(function (it) {
              it._src = src.label;
              return it;
            });
          });
        })).then(function (results) {
          if (killed) return;
          var items = [];
          results.forEach(function (r) {
            if (r.status === 'fulfilled' && r.value) items = items.concat(r.value);
          });
          if (items.length === 0) {
            if (cachedItems.length > 0) {
              setPanelStatus(panel, 'live', 'CACHED');
            } else {
              body.innerHTML = '<div class="panel-empty">No intel sources reachable.</div>';
              setPanelStatus(panel, 'error', 'ERR');
            }
            return;
          }
          items.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
          renderItems(items.slice(0, 16));
          setPanelStatus(panel, 'live', 'LIVE');
        });
      }

      function renderItems(items) {
        var list = items.map(function (it) {
          return '<li><a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener">' +
            '<span class="news-title">' + escapeHtml(it.title) + '</span>' +
            '<span class="news-meta">' +
            '<span class="src">' + escapeHtml(it._src || 'Intel') + '</span>' +
            escapeHtml(formatRelTime(it.date)) + '</span></a></li>';
        }).join('');
        body.innerHTML = '<ul class="news-list">' + list + '</ul>';
      }

      load();
      timer = setInterval(load, 10 * 60 * 1000);
      return function () { killed = true; if (timer) clearInterval(timer); };
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: Markets (commodities / equities via Stooq CSV)
  // --------------------------------------------------------------------------
  // Stooq serves snapshot quotes as CSV with permissive CORS. No auth.
  const MARKET_TICKERS = [
    // US indices
    { sym: '^spx',     label: 'S&P 500' },
    { sym: '^ndq',     label: 'Nasdaq 100' },
    { sym: '^dji',     label: 'Dow 30' },
    { sym: '^rut',     label: 'Russell 2000' },
    { sym: '^vix',     label: 'VIX' },
    // Global indices
    { sym: '^ftse',    label: 'FTSE 100' },
    { sym: '^dax',     label: 'DAX' },
    { sym: '^nkx',     label: 'Nikkei 225' },
    { sym: '^hsi',     label: 'Hang Seng' },
    // Commodities
    { sym: 'gc.f',     label: 'Gold /oz' },
    { sym: 'si.f',     label: 'Silver /oz' },
    { sym: 'cl.f',     label: 'Crude WTI' },
    { sym: 'ng.f',     label: 'Nat Gas' },
    { sym: 'hg.f',     label: 'Copper' },
    // FX
    { sym: 'eurusd',   label: 'EUR/USD' },
    { sym: 'usdjpy',   label: 'USD/JPY' },
    { sym: 'gbpusd',   label: 'GBP/USD' },
    { sym: 'usdcny',   label: 'USD/CNY' },
    // Bonds
    { sym: '^tnx',     label: 'US 10Y Yield' },
  ];

  PANELS.markets = {
    title: 'Markets',
    icon: '&#8710;',
    size: 'md',
    desc: 'Commodities, equities, FX (Stooq snapshots).',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      const marketsUrl = 'https://stooq.com/q/l/?s=' + encodeURIComponent(MARKET_TICKERS.map((t) => t.sym).join(',')) + '&i=d&f=sd2t2ohlcv';

      function renderMarkets(csv) {
        var rows = parseCsv(csv);
        var head = rows.shift();
        if (!head) return false;
        var idx = {
          sym: head.indexOf('Symbol'),
          close: head.indexOf('Close'),
          open: head.indexOf('Open'),
        };
        if (idx.sym === -1 || idx.close === -1) return false;
        var html = MARKET_TICKERS.map(function (t) {
          var row = rows.find(function (r) { return (r[idx.sym] || '').toLowerCase() === t.sym.toLowerCase(); });
          if (!row) return tickerCard(t.label, '—', null);
          var close = parseFloat(row[idx.close]);
          var open = parseFloat(row[idx.open]);
          var delta = !isNaN(close) && !isNaN(open) && open !== 0
            ? ((close - open) / open) * 100
            : null;
          return tickerCard(t.label, isNaN(close) ? '—' : formatPrice(close), delta);
        }).join('');
        body.innerHTML = '<div class="markets-grid">' + html + '</div>';
        return true;
      }

      function load() {
        if (killed) return;
        var cachedCsv = getCachedResponse(marketsUrl);
        if (cachedCsv && renderMarkets(cachedCsv)) {
          setPanelStatus(panel, 'loading', 'UPDATING');
        } else {
          setPanelStatus(panel, 'loading', 'FETCH');
          body.innerHTML = '<div class="panel-loading">Fetching quotes&hellip;</div>';
        }
        fetchIntel(marketsUrl)
          .then(function (csv) {
            if (killed) return;
            if (!renderMarkets(csv)) {
              body.innerHTML = '<div class="panel-empty">Stooq returned unexpected data.</div>';
              setPanelStatus(panel, 'error', 'ERR');
              return;
            }
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch(function (err) {
            if (killed) return;
            if (cachedCsv) {
              setPanelStatus(panel, 'live', 'CACHED');
            } else {
              renderErrorInto(body, err, load);
              setPanelStatus(panel, 'error', 'ERR');
            }
          });
      }
      load();
      timer = setInterval(load, 5 * 60 * 1000);
      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  function parseCsv(text) {
    return text.trim().split(/\r?\n/).map((line) => line.split(','));
  }

  function tickerCard(label, price, deltaPct) {
    let deltaHtml = '';
    if (deltaPct !== null && !isNaN(deltaPct)) {
      const dir = deltaPct >= 0 ? 'up' : 'down';
      const arrow = deltaPct >= 0 ? '&#9650;' : '&#9660;';
      deltaHtml = '<div class="delta ' + dir + '">' + arrow + ' ' + deltaPct.toFixed(2) + '%</div>';
    }
    return '<div class="ticker">' +
      '<div class="sym">' + escapeHtml(label) + '</div>' +
      '<div class="price">' + escapeHtml(price) + '</div>' +
      deltaHtml +
      '</div>';
  }

  function formatPrice(n) {
    if (Math.abs(n) >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (Math.abs(n) >= 100)   return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  // --------------------------------------------------------------------------
  // PANEL: Crypto (CoinGecko simple price, no auth)
  // --------------------------------------------------------------------------
  const CRYPTO_COINS = [
    { id: 'bitcoin',       label: 'BTC' },
    { id: 'ethereum',      label: 'ETH' },
    { id: 'solana',        label: 'SOL' },
    { id: 'binancecoin',   label: 'BNB' },
    { id: 'ripple',        label: 'XRP' },
    { id: 'cardano',       label: 'ADA' },
    { id: 'dogecoin',      label: 'DOGE' },
    { id: 'tron',          label: 'TRX' },
  ];

  PANELS.crypto = {
    title: 'Crypto',
    icon: '&#8383;',
    size: 'md',
    desc: 'Top coins — price & 24h change (CoinGecko).',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      const ids = CRYPTO_COINS.map((c) => c.id).join(',');
      const cryptoUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
                  encodeURIComponent(ids) +
                  '&vs_currencies=usd&include_24hr_change=true';

      function renderCrypto(text) {
        try {
          var data = JSON.parse(text);
          var html = CRYPTO_COINS.map(function (c) {
            var row = data[c.id];
            if (!row || typeof row.usd !== 'number') return tickerCard(c.label, '—', null);
            return tickerCard(c.label, '$' + formatPrice(row.usd),
              typeof row.usd_24h_change === 'number' ? row.usd_24h_change : null);
          }).join('');
          body.innerHTML = '<div class="markets-grid">' + html + '</div>';
          return true;
        } catch (_) { return false; }
      }

      function load() {
        if (killed) return;
        var cachedText = getCachedResponse(cryptoUrl);
        if (cachedText && renderCrypto(cachedText)) {
          setPanelStatus(panel, 'loading', 'UPDATING');
        } else {
          setPanelStatus(panel, 'loading', 'FETCH');
          body.innerHTML = '<div class="panel-loading">Loading coins&hellip;</div>';
        }
        fetchIntel(cryptoUrl)
          .then(function (text) {
            if (killed) return;
            if (!renderCrypto(text)) {
              body.innerHTML = '<div class="panel-empty">Unexpected data from CoinGecko.</div>';
              setPanelStatus(panel, 'error', 'ERR');
              return;
            }
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch(function (err) {
            if (killed) return;
            if (cachedText) {
              setPanelStatus(panel, 'live', 'CACHED');
            } else {
              renderErrorInto(body, err, load);
              setPanelStatus(panel, 'error', 'ERR');
            }
          });
      }
      load();
      timer = setInterval(load, 3 * 60 * 1000);
      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: World Map (Leaflet) with toggleable OSINT layers
  // --------------------------------------------------------------------------

  const MAP_LAYERS_DEF = [
    // Security / kinetic
    { id: 'conflicts',   label: 'Conflicts',        color: '#ff4e4e', group: 'Security' },
    { id: 'threats',     label: 'Intel hotspots',   color: '#e8a23a', group: 'Security' },
    { id: 'bases',       label: 'Military bases',   color: '#3aa9d8', group: 'Security' },
    { id: 'cyber',       label: 'Cyber actors',     color: '#ff66cc', group: 'Security' },
    { id: 'nuclear',     label: 'Nuclear facilities', color: '#7dd3fc', group: 'Security' },
    { id: 'spaceports',  label: 'Spaceports',       color: '#c4b5fd', group: 'Security' },
    { id: 'gpsjamming',  label: 'GPS jamming zones', color: '#fde047', group: 'Security' },
    // Infrastructure
    { id: 'cables',      label: 'Undersea cables',  color: '#38bdf8', group: 'Infrastructure' },
    { id: 'pipelines',   label: 'Pipelines',        color: '#fb923c', group: 'Infrastructure' },
    { id: 'chokepoints', label: 'Chokepoints',      color: '#d4a843', group: 'Infrastructure' },
    { id: 'ports',       label: 'Commercial ports', color: '#34d399', group: 'Infrastructure' },
    { id: 'airports',    label: 'Major airports',   color: '#e5e7eb', group: 'Infrastructure' },
    { id: 'datacenters', label: 'Datacenter hubs',  color: '#60a5fa', group: 'Infrastructure' },
    // Economic
    { id: 'financial',   label: 'Financial centers', color: '#a7f3d0', group: 'Economic' },
    { id: 'minerals',    label: 'Critical minerals', color: '#bef264', group: 'Economic' },
    { id: 'trade',       label: 'Trade routes',     color: '#94a3b8', group: 'Economic' },
    { id: 'cities',      label: 'Key cities',       color: '#a0c8ff', group: 'Economic' },
    { id: 'migration',   label: 'Migration flows',  color: '#c084fc', group: 'Economic' },
    // Live feeds
    { id: 'quakes',      label: 'Earthquakes (24h)', color: '#f97316', group: 'Live', live: true },
    { id: 'flights',     label: 'Live flights',      color: '#e0f2fe', group: 'Live', live: true },
    { id: 'vessels',     label: 'Vessel traffic',    color: '#38bdf8', group: 'Live', live: true },
    { id: 'iss',         label: 'ISS position',      color: '#22d3ee', group: 'Live', live: true },
  ];

  const THREAT_HOTSPOTS = [
    { lat: 35.68, lng: 139.77, name: 'Tokyo — APT tracking' },
    { lat: 55.76, lng: 37.62, name: 'Moscow — info ops hub' },
    { lat: 39.91, lng: 116.40, name: 'Beijing — PLA cyber' },
    { lat: 37.57, lng: 126.98, name: 'Seoul — DPRK signals' },
    { lat: 31.77, lng: 35.21, name: 'Jerusalem — tensions' },
    { lat: 33.51, lng: 36.29, name: 'Damascus' },
    { lat: 33.89, lng: 35.50, name: 'Beirut' },
    { lat: 24.47, lng: 39.61, name: 'Riyadh corridor' },
    { lat: 28.61, lng: 77.20, name: 'New Delhi' },
    { lat: 40.71, lng: -74.01, name: 'NYC — financial' },
  ];

  const MILITARY_BASES = [
    // US / NATO — Pacific
    { lat: 36.94, lng: 139.17, name: 'Yokota AB (JP)', type: 'us-nato' },
    { lat: 35.45, lng: 139.35, name: 'Yokosuka Naval (JP)', type: 'us-nato' },
    { lat: 26.35, lng: 127.77, name: 'Kadena AB — Okinawa', type: 'us-nato' },
    { lat: 13.58, lng: 144.92, name: 'Andersen AFB (Guam)', type: 'us-nato' },
    { lat: 21.35, lng: -157.95, name: 'Pearl Harbor (HI)', type: 'us-nato' },
    { lat: 32.69, lng: -117.21, name: 'NAS North Island', type: 'us-nato' },
    { lat: 34.76, lng: -120.50, name: 'Vandenberg SFB', type: 'us-nato' },
    { lat: 37.08, lng: -76.61, name: 'Langley AFB', type: 'us-nato' },
    { lat: 33.64, lng: -84.43, name: 'Fort Liberty (NC)', type: 'us-nato' },
    { lat: 35.24, lng: 128.86, name: 'Camp Humphreys (KR)', type: 'us-nato' },
    { lat: 7.27, lng: 134.56, name: 'Camp Courtney (Palau)', type: 'us-nato' },
    { lat: -25.40, lng: 131.04, name: 'Pine Gap (AU)', type: 'us-nato' },
    { lat: -12.43, lng: 130.87, name: 'Robertson Barracks (AU)', type: 'us-nato' },
    // US / NATO — Europe
    { lat: 50.09, lng: 8.60, name: 'Ramstein AB (DE)', type: 'us-nato' },
    { lat: 50.33, lng: 3.50, name: 'SHAPE / NATO HQ (BE)', type: 'us-nato' },
    { lat: 49.06, lng: -2.55, name: 'RAF Mildenhall (UK)', type: 'us-nato' },
    { lat: 52.36, lng: 0.49, name: 'RAF Lakenheath (UK)', type: 'us-nato' },
    { lat: 41.65, lng: 12.73, name: 'NAS Sigonella (IT)', type: 'us-nato' },
    { lat: 40.84, lng: 14.29, name: 'Naples (6th Fleet)', type: 'us-nato' },
    { lat: 55.95, lng: 23.31, name: 'Šiauliai AB (LT)', type: 'us-nato' },
    { lat: 57.66, lng: 24.66, name: 'Ādaži (LV)', type: 'us-nato' },
    { lat: 54.18, lng: 22.06, name: 'Bemowo Piskie (PL)', type: 'us-nato' },
    { lat: 41.24, lng: -8.68, name: 'Lajes (Azores)', type: 'us-nato' },
    { lat: 36.65, lng: -6.34, name: 'Rota Naval (ES)', type: 'us-nato' },
    { lat: 44.08, lng: 28.35, name: 'Deveselu BMD (RO)', type: 'us-nato' },
    { lat: 42.33, lng: 25.48, name: 'Novo Selo (BG)', type: 'us-nato' },
    { lat: 64.15, lng: -21.94, name: 'Keflavík (IS)', type: 'us-nato' },
    { lat: 69.97, lng: 23.37, name: 'Vardø radar (NO)', type: 'us-nato' },
    // US / NATO — MidEast & Africa
    { lat: 39.81, lng: 39.93, name: 'Incirlik AB (TR)', type: 'us-nato' },
    { lat: 25.47, lng: 51.31, name: 'Al-Udeid (QA)', type: 'us-nato' },
    { lat: 11.55, lng: 43.15, name: 'Camp Lemonnier (DJ)', type: 'us-nato' },
    { lat: 28.38, lng: 36.58, name: 'NEOM Airbase (SA)', type: 'us-nato' },
    { lat: 24.43, lng: 54.65, name: 'Al-Dhafra (UAE)', type: 'us-nato' },
    { lat: 26.21, lng: 50.18, name: 'NSA Bahrain', type: 'us-nato' },
    { lat: 0.06, lng: 37.06, name: 'Camp Simba (KE)', type: 'us-nato' },
    { lat: 2.06, lng: 45.35, name: 'Mogadishu (SO)', type: 'us-nato' },
    { lat: 13.48, lng: 15.33, name: 'Agadez drone (NE)', type: 'us-nato' },
    // Russia
    { lat: 55.75, lng: 37.62, name: 'Moscow HQ', type: 'russia' },
    { lat: 59.98, lng: 30.70, name: 'Kronstadt Naval (RU)', type: 'russia' },
    { lat: 69.07, lng: 33.07, name: 'Severomorsk (Northern Fleet)', type: 'russia' },
    { lat: 44.63, lng: 33.53, name: 'Sevastopol (Crimea)', type: 'russia' },
    { lat: 53.21, lng: 158.65, name: 'Petropavlovsk-Kamchatsky', type: 'russia' },
    { lat: 43.10, lng: 131.90, name: 'Vladivostok (Pacific Fleet)', type: 'russia' },
    { lat: 54.56, lng: 20.55, name: 'Kaliningrad (exclave)', type: 'russia' },
    { lat: 35.50, lng: 35.98, name: 'Khmeimim AB (Syria)', type: 'russia' },
    { lat: 34.88, lng: 35.77, name: 'Tartus Naval (Syria)', type: 'russia' },
    { lat: 48.40, lng: 45.70, name: 'Engels bomber base', type: 'russia' },
    // China
    { lat: 18.27, lng: 109.65, name: 'Yulin Naval (Hainan)', type: 'china' },
    { lat: 39.91, lng: 116.40, name: 'PLA HQ (Beijing)', type: 'china' },
    { lat: 31.23, lng: 121.47, name: 'East Sea Fleet (Shanghai)', type: 'china' },
    { lat: 36.06, lng: 120.40, name: 'Qingdao Naval', type: 'china' },
    { lat: 10.50, lng: 113.80, name: 'Fiery Cross Reef (SCS)', type: 'china' },
    { lat: 11.58, lng: 114.32, name: 'Subi Reef (SCS)', type: 'china' },
    { lat: 9.71, lng: 112.86, name: 'Mischief Reef (SCS)', type: 'china' },
    { lat: 11.35, lng: 43.07, name: 'Djibouti (CN support base)', type: 'china' },
    { lat: 25.07, lng: 121.52, name: 'PLA Eastern Theater (vs Taiwan)', type: 'china' },
    // UK
    { lat: 51.15, lng: -1.75, name: 'HMNB Portsmouth', type: 'uk' },
    { lat: 55.98, lng: -4.79, name: 'HMNB Clyde (Trident)', type: 'uk' },
    { lat: 35.18, lng: -5.35, name: 'Gibraltar (UK)', type: 'uk' },
    { lat: 34.73, lng: 32.94, name: 'Akrotiri (Cyprus)', type: 'uk' },
    { lat: -51.82, lng: -59.00, name: 'MPA Falklands', type: 'uk' },
    { lat: -7.31, lng: 72.41, name: 'Diego Garcia', type: 'uk' },
    // France
    { lat: 11.55, lng: 43.15, name: 'FFDj (Djibouti)', type: 'france' },
    { lat: -12.78, lng: 45.28, name: 'Mayotte detachment', type: 'france' },
    { lat: -21.34, lng: 55.48, name: 'La Réunion (FR)', type: 'france' },
    { lat: 25.26, lng: 54.55, name: 'Al-Dhafra (FR det., UAE)', type: 'france' },
    // India
    { lat: 17.44, lng: 78.35, name: 'INS Rajali (Arakkonam)', type: 'india' },
    { lat: 8.48, lng: 76.96, name: 'INS Garuda (Kochi)', type: 'india' },
    { lat: 11.77, lng: 92.72, name: 'INS Baaz (Andamans)', type: 'india' },
    { lat: 15.49, lng: 73.82, name: 'INS Hansa (Goa)', type: 'india' },
  ];

  const CHOKEPOINTS = [
    { lat: 30.00, lng: 32.58, name: 'Suez Canal' },
    { lat: 36.00, lng: -5.36, name: 'Strait of Gibraltar' },
    { lat: 26.57, lng: 56.25, name: 'Strait of Hormuz' },
    { lat: 12.58, lng: 43.33, name: 'Bab-el-Mandeb' },
    { lat: 41.02, lng: 28.97, name: 'Bosphorus' },
    { lat: 1.26, lng: 103.82, name: 'Malacca Strait' },
    { lat: 9.08, lng: -79.68, name: 'Panama Canal' },
    { lat: 57.05, lng: 11.94, name: 'Danish Straits' },
    { lat: -54.93, lng: -67.62, name: 'Drake Passage' },
  ];

  const KEY_CITIES = [
    { lat: 38.90, lng: -77.04, name: 'Washington DC' },
    { lat: 51.51, lng: -0.13, name: 'London' },
    { lat: 48.86, lng: 2.35, name: 'Paris' },
    { lat: 52.52, lng: 13.40, name: 'Berlin' },
    { lat: 41.90, lng: 12.50, name: 'Rome' },
    { lat: 55.76, lng: 37.62, name: 'Moscow' },
    { lat: 39.91, lng: 116.40, name: 'Beijing' },
    { lat: 35.69, lng: 139.69, name: 'Tokyo' },
    { lat: 19.08, lng: 72.88, name: 'Mumbai' },
    { lat: -33.86, lng: 151.21, name: 'Sydney' },
    { lat: -34.61, lng: -58.38, name: 'Buenos Aires' },
    { lat: -23.55, lng: -46.63, name: 'São Paulo' },
    { lat: -1.29, lng: 36.82, name: 'Nairobi' },
    { lat: 30.04, lng: 31.24, name: 'Cairo' },
    { lat: -26.20, lng: 28.04, name: 'Johannesburg' },
  ];

  const NUCLEAR_FACILITIES = [
    // Weapons / enrichment
    { lat: 35.88, lng: -106.31, name: 'Los Alamos (US)', status: 'active' },
    { lat: 35.04, lng: -106.54, name: 'Sandia Labs (US)', status: 'active' },
    { lat: 37.69, lng: -121.70, name: 'LLNL (US)', status: 'active' },
    { lat: 35.93, lng: -84.31, name: 'Oak Ridge (US)', status: 'active' },
    { lat: 33.24, lng: -81.67, name: 'Savannah River (US)', status: 'active' },
    { lat: 35.32, lng: -101.55, name: 'Pantex (US)', status: 'active' },
    { lat: 55.71, lng: 60.80, name: 'Mayak (RU)', status: 'active' },
    { lat: 40.96, lng: 141.33, name: 'Rokkasho (JP)', status: 'active' },
    { lat: 49.68, lng: -1.88, name: 'La Hague (FR)', status: 'active' },
    { lat: 54.42, lng: -3.50, name: 'Sellafield (UK)', status: 'active' },
    // Proliferation concerns
    { lat: 32.59, lng: 51.57, name: 'Natanz (IR)', status: 'contested' },
    { lat: 34.38, lng: 50.88, name: 'Fordow (IR)', status: 'contested' },
    { lat: 29.56, lng: 52.51, name: 'Bushehr (IR)', status: 'active' },
    { lat: 32.33, lng: 48.88, name: 'Isfahan UCF (IR)', status: 'contested' },
    { lat: 40.43, lng: 124.75, name: 'Yongbyon (DPRK)', status: 'contested' },
    { lat: 33.67, lng: 73.35, name: 'Kahuta (PK)', status: 'active' },
    { lat: 31.92, lng: 34.80, name: 'Soreq (IL)', status: 'active' },
    { lat: 31.30, lng: 35.22, name: 'Dimona (IL)', status: 'active' },
    { lat: 43.49, lng: 84.93, name: 'Lop Nur test site (CN)', status: 'inactive' },
    // Key power plants
    { lat: 47.51, lng: 34.58, name: 'Zaporizhzhia NPP (UA)', status: 'contested' },
    { lat: 51.33, lng: 25.88, name: 'Rivne NPP (UA)', status: 'active' },
    { lat: 47.81, lng: 31.22, name: 'South Ukraine NPP', status: 'active' },
    { lat: 50.30, lng: 26.65, name: 'Khmelnytskyi NPP (UA)', status: 'active' },
    { lat: 51.39, lng: 30.10, name: 'Chernobyl (UA)', status: 'inactive' },
    { lat: 37.42, lng: 141.03, name: 'Fukushima Daiichi', status: 'inactive' },
    { lat: 33.39, lng: -112.86, name: 'Palo Verde (US)', status: 'active' },
    { lat: 35.21, lng: -120.85, name: 'Diablo Canyon (US)', status: 'active' },
    { lat: 33.14, lng: -81.76, name: 'Vogtle (US)', status: 'active' },
    { lat: 51.21, lng: -3.13, name: 'Hinkley Point (UK)', status: 'active' },
    { lat: 49.54, lng: -1.88, name: 'Flamanville (FR)', status: 'active' },
    { lat: 51.01, lng: 2.14, name: 'Gravelines (FR)', status: 'active' },
    { lat: 59.83, lng: 29.03, name: 'Leningrad NPP (RU)', status: 'active' },
    { lat: 51.67, lng: 35.61, name: 'Kursk NPP (RU)', status: 'active' },
    { lat: 67.46, lng: 32.47, name: 'Kola NPP (RU)', status: 'active' },
    { lat: 35.32, lng: 129.29, name: 'Kori (KR)', status: 'active' },
    { lat: 37.43, lng: 138.60, name: 'Kashiwazaki-Kariwa (JP)', status: 'inactive' },
    { lat: 22.60, lng: 114.54, name: 'Daya Bay (CN)', status: 'active' },
    { lat: 39.79, lng: 121.48, name: 'Hongyanhe (CN)', status: 'active' },
    { lat: 8.17, lng: 77.71, name: 'Kudankulam (IN)', status: 'active' },
    { lat: 19.83, lng: 72.65, name: 'Tarapur (IN)', status: 'active' },
  ];

  const SPACEPORTS = [
    { lat: 28.57, lng: -80.65, name: 'Kennedy Space Center' },
    { lat: 34.76, lng: -120.50, name: 'Vandenberg SFB' },
    { lat: 25.98, lng: -97.18, name: 'Starbase (Boca Chica)' },
    { lat: 5.24, lng: -52.77, name: 'Kourou (ESA)' },
    { lat: 45.96, lng: 63.31, name: 'Baikonur' },
    { lat: 62.93, lng: 40.58, name: 'Plesetsk' },
    { lat: 51.88, lng: 128.33, name: 'Vostochny' },
    { lat: 40.96, lng: 100.28, name: 'Jiuquan (CN)' },
    { lat: 28.25, lng: 102.03, name: 'Xichang (CN)' },
    { lat: 19.61, lng: 110.95, name: 'Wenchang (CN)' },
    { lat: 13.73, lng: 80.24, name: 'Satish Dhawan (IN)' },
    { lat: 30.40, lng: 130.97, name: 'Tanegashima (JP)' },
    { lat: 39.66, lng: 124.71, name: 'Sohae (DPRK)' },
    { lat: 38.43, lng: 34.82, name: 'Sinop (TR, planned)' },
    { lat: -29.04, lng: 115.35, name: 'Whalers Way (AU)' },
  ];

  const CYBER_HUBS = [
    { lat: 39.91, lng: 116.40, name: 'APT1 / Unit 61398 (Shanghai)' },
    { lat: 31.23, lng: 121.47, name: 'Pudong — APT41' },
    { lat: 55.75, lng: 37.62, name: 'GRU Unit 26165 (Moscow)' },
    { lat: 59.93, lng: 30.33, name: 'APT28 ops (St. Petersburg)' },
    { lat: 39.03, lng: 125.75, name: 'Lazarus Group (Pyongyang)' },
    { lat: 35.70, lng: 51.33, name: 'APT33 / Elfin (Tehran)' },
    { lat: 32.82, lng: 35.00, name: 'Unit 8200 (Glilot)' },
    { lat: 39.11, lng: -76.77, name: 'NSA (Fort Meade)' },
    { lat: 51.90, lng: -2.12, name: 'GCHQ (Cheltenham)' },
    { lat: 45.42, lng: -75.69, name: 'CSE (Ottawa)' },
    { lat: 50.06, lng: 19.94, name: 'APT group (Kraków)' },
    { lat: 23.13, lng: 113.26, name: 'Guangzhou MSS' },
    { lat: 12.97, lng: 77.59, name: 'APT IN (Bangalore)' },
    { lat: 14.60, lng: 120.98, name: 'Pawn Storm nodes (Manila)' },
  ];

  const UNDERSEA_CABLES = [
    // Transatlantic
    { name: 'MAREA (US-ES)',     path: [[37.08, -76.48], [43.42, -8.40]] },
    { name: 'Dunant (US-FR)',    path: [[36.63, -75.97], [46.37, -1.75]] },
    { name: 'Grace Hopper (US-UK-ES)', path: [[40.47, -74.00], [50.21, -5.29], [43.42, -8.40]] },
    { name: 'Amitié (US-FR)',    path: [[41.28, -71.10], [48.93, -2.39]] },
    // Transpacific
    { name: 'JUPITER (US-JP-PH)', path: [[33.58, -118.29], [34.74, 139.35], [15.00, 120.64]] },
    { name: 'PLCN (US-PH/TW)',   path: [[33.58, -118.29], [24.80, 121.85]] },
    { name: 'FASTER (US-JP)',    path: [[43.35, -124.33], [35.45, 139.87]] },
    { name: 'SEA-US (US-ID-PH)', path: [[21.34, -157.97], [1.30, 125.17], [14.60, 120.98]] },
    // Asia / Middle East
    { name: 'SEA-ME-WE 6',       path: [[1.35, 103.82], [12.93, 77.62], [24.47, 54.37], [31.20, 29.92], [43.42, -8.40]] },
    { name: 'AAE-1',             path: [[22.31, 114.17], [1.35, 103.82], [13.08, 80.28], [24.47, 54.37], [31.20, 29.92], [45.46, 12.33]] },
    { name: '2Africa',           path: [[51.51, -0.13], [36.75, -3.01], [6.45, 3.39], [-33.91, 18.42], [-4.04, 39.67], [24.47, 54.37], [1.35, 103.82]] },
    // Americas / Africa
    { name: 'Equiano',           path: [[38.72, -9.15], [6.45, 3.39], [-8.83, 13.23], [-33.91, 18.42]] },
    { name: 'BRUSA (US-BR)',     path: [[32.36, -64.70], [-23.00, -43.18]] },
  ];

  const PIPELINES = [
    { name: 'Nord Stream 1',           path: [[60.20, 28.40], [54.80, 18.50], [54.08, 13.75]] },
    { name: 'TurkStream',              path: [[45.00, 38.00], [41.58, 28.00]] },
    { name: 'Power of Siberia',        path: [[59.00, 113.00], [52.00, 124.00], [42.94, 129.70]] },
    { name: 'Yamal-Europe',            path: [[66.00, 69.00], [52.23, 21.01], [52.52, 13.40]] },
    { name: 'Druzhba',                 path: [[52.75, 52.75], [52.00, 33.00], [50.07, 14.43]] },
    { name: 'Trans-Mediterranean',     path: [[31.50, 10.00], [37.50, 13.00], [45.46, 12.33]] },
    { name: 'MEDGAZ (DZ-ES)',          path: [[36.13, -0.10], [36.72, -2.45]] },
    { name: 'EastMed (planned)',       path: [[31.80, 34.20], [35.15, 33.40], [40.63, 22.96]] },
    { name: 'Keystone XL (canceled)',  path: [[54.00, -110.00], [40.00, -96.00], [29.75, -95.37]] },
    { name: 'Trans-Alaska',            path: [[70.26, -148.64], [61.13, -146.36]] },
    { name: 'Dakota Access',           path: [[48.00, -103.00], [38.70, -90.60]] },
    { name: 'BTC (Baku-Ceyhan)',       path: [[40.38, 49.85], [40.60, 43.00], [36.83, 35.68]] },
    { name: 'TAPI (planned)',          path: [[37.15, 62.35], [31.57, 65.75], [29.83, 68.37], [28.61, 77.20]] },
  ];

  const COMMERCIAL_PORTS = [
    { lat: 31.22, lng: 121.47, name: 'Shanghai' },
    { lat: 22.55, lng: 114.10, name: 'Shenzhen' },
    { lat: 29.87, lng: 121.55, name: 'Ningbo-Zhoushan' },
    { lat: 1.27,  lng: 103.85, name: 'Singapore' },
    { lat: 35.10, lng: 129.04, name: 'Busan' },
    { lat: 22.31, lng: 114.17, name: 'Hong Kong' },
    { lat: 24.47, lng: 118.08, name: 'Xiamen' },
    { lat: 25.22, lng: 55.29,  name: 'Jebel Ali (UAE)' },
    { lat: 51.95, lng: 4.14,   name: 'Rotterdam' },
    { lat: 51.26, lng: 4.40,   name: 'Antwerp' },
    { lat: 53.54, lng: 9.98,   name: 'Hamburg' },
    { lat: 43.11, lng: 5.93,   name: 'Marseille' },
    { lat: 40.65, lng: -74.04, name: 'New York/NJ' },
    { lat: 33.73, lng: -118.26, name: 'Los Angeles' },
    { lat: -23.96, lng: -46.33, name: 'Santos (BR)' },
    { lat: -33.91, lng: 18.42, name: 'Cape Town' },
    { lat: 6.45, lng: 3.39,    name: 'Lagos / Apapa' },
    { lat: 30.05, lng: 31.24,  name: 'Damietta / Port Said' },
    { lat: -33.86, lng: 151.21, name: 'Sydney / Port Botany' },
  ];

  const MAJOR_AIRPORTS = [
    { lat: 33.94, lng: -118.41, name: 'LAX — Los Angeles' },
    { lat: 40.64, lng: -73.78, name: 'JFK — New York' },
    { lat: 33.64, lng: -84.43, name: 'ATL — Atlanta' },
    { lat: 51.47, lng: -0.45, name: 'LHR — London Heathrow' },
    { lat: 49.01, lng: 2.55, name: 'CDG — Paris CDG' },
    { lat: 50.03, lng: 8.56, name: 'FRA — Frankfurt' },
    { lat: 52.31, lng: 4.76, name: 'AMS — Amsterdam' },
    { lat: 25.25, lng: 55.36, name: 'DXB — Dubai' },
    { lat: 25.26, lng: 51.56, name: 'DOH — Doha' },
    { lat: 41.28, lng: 28.74, name: 'IST — Istanbul' },
    { lat: 22.31, lng: 113.92, name: 'HKG — Hong Kong' },
    { lat: 31.14, lng: 121.81, name: 'PVG — Shanghai' },
    { lat: 40.08, lng: 116.58, name: 'PEK — Beijing Capital' },
    { lat: 37.46, lng: 126.44, name: 'ICN — Incheon' },
    { lat: 35.55, lng: 139.78, name: 'HND — Tokyo Haneda' },
    { lat: 1.35, lng: 103.99, name: 'SIN — Singapore' },
    { lat: 28.56, lng: 77.10, name: 'DEL — Delhi' },
    { lat: -33.94, lng: 151.17, name: 'SYD — Sydney' },
    { lat: -23.43, lng: -46.48, name: 'GRU — São Paulo' },
    { lat: 19.44, lng: -99.07, name: 'MEX — Mexico City' },
  ];

  const FINANCIAL_CENTERS = [
    { lat: 40.71, lng: -74.01, name: 'New York — NYSE/NASDAQ' },
    { lat: 51.51, lng: -0.09,  name: 'London — City of London' },
    { lat: 22.28, lng: 114.16, name: 'Hong Kong' },
    { lat: 1.28,  lng: 103.85, name: 'Singapore' },
    { lat: 35.68, lng: 139.77, name: 'Tokyo' },
    { lat: 31.23, lng: 121.47, name: 'Shanghai' },
    { lat: 47.37, lng: 8.54,   name: 'Zurich' },
    { lat: 50.11, lng: 8.68,   name: 'Frankfurt' },
    { lat: 41.90, lng: -87.63, name: 'Chicago (CME)' },
    { lat: 37.79, lng: -122.40, name: 'San Francisco' },
    { lat: 43.65, lng: -79.38, name: 'Toronto' },
    { lat: 25.20, lng: 55.27,  name: 'Dubai (DIFC)' },
    { lat: 19.07, lng: 72.88,  name: 'Mumbai (BSE)' },
    { lat: 39.90, lng: 116.40, name: 'Beijing' },
    { lat: 48.86, lng: 2.35,   name: 'Paris' },
  ];

  const CRITICAL_MINERALS = [
    { lat: -21.50, lng: 26.50, name: 'Botswana — diamonds' },
    { lat: -11.66, lng: 27.48, name: 'DRC — cobalt/copper (Kolwezi)' },
    { lat: 40.88, lng: 113.18, name: 'China — rare earths (Baotou)' },
    { lat: -23.70, lng: 133.88, name: 'Australia — lithium/rare earths' },
    { lat: -22.91, lng: -43.17, name: 'Brazil — niobium (CBMM)' },
    { lat: -24.66, lng: -69.33, name: 'Chile — lithium (Salar de Atacama)' },
    { lat: -19.00, lng: -65.26, name: 'Bolivia — lithium (Uyuni)' },
    { lat: 32.30, lng: -90.18, name: 'US — rare earths (Mountain Pass)' },
    { lat: 67.85, lng: 20.23,  name: 'Sweden — iron (Kiruna)' },
    { lat: -2.00, lng: 138.00, name: 'Indonesia — nickel (Halmahera)' },
    { lat: 7.53,  lng: 134.58, name: 'Palau — seabed nodules' },
    { lat: 22.78, lng: 5.52,   name: 'Algeria — natural gas' },
    { lat: -25.66, lng: 116.75, name: 'WA — iron ore (Pilbara)' },
    { lat: 52.27, lng: -113.81, name: 'Canada — oil sands (Alberta)' },
  ];

  const DATACENTER_HUBS = [
    // Major US clusters
    { lat: 39.04, lng: -77.49, name: 'Ashburn / Data Center Alley (US)' },
    { lat: 45.59, lng: -122.60, name: 'Hillsboro / The Dalles (OR)' },
    { lat: 37.37, lng: -121.97, name: 'Silicon Valley / Santa Clara' },
    { lat: 41.89, lng: -87.63, name: 'Chicago cluster' },
    { lat: 33.43, lng: -112.07, name: 'Phoenix / Mesa' },
    { lat: 32.78, lng: -96.80, name: 'Dallas / Fort Worth' },
    { lat: 36.17, lng: -115.14, name: 'Las Vegas / Henderson' },
    { lat: 47.61, lng: -122.33, name: 'Seattle / Quincy (WA)' },
    { lat: 33.75, lng: -84.39, name: 'Atlanta cluster' },
    { lat: 35.12, lng: -89.74, name: 'Memphis — xAI Colossus' },
    { lat: 40.08, lng: -82.81, name: 'New Albany — Meta Prometheus' },
    { lat: 42.70, lng: -87.89, name: 'Mt Pleasant — OpenAI/MSFT' },
    { lat: 32.48, lng: -99.67, name: 'Abilene — Stargate (Oracle)' },
    // Europe
    { lat: 51.51, lng: -0.59,  name: 'London (Slough/LHR)' },
    { lat: 52.35, lng: 4.92,   name: 'Amsterdam (NIKHEF)' },
    { lat: 50.11, lng: 8.68,   name: 'Frankfurt — DE-CIX hub' },
    { lat: 48.86, lng: 2.35,   name: 'Paris' },
    { lat: 53.35, lng: -6.26,  name: 'Dublin (Ireland)' },
    { lat: 59.33, lng: 18.07,  name: 'Stockholm / Luleå' },
    { lat: 55.68, lng: 12.57,  name: 'Copenhagen' },
    { lat: 60.17, lng: 24.94,  name: 'Helsinki (Hamina — Google)' },
    { lat: 47.37, lng: 8.54,   name: 'Zurich cluster' },
    { lat: 40.42, lng: -3.70,  name: 'Madrid' },
    { lat: 45.46, lng: 9.19,   name: 'Milan' },
    { lat: 51.95, lng: 7.63,   name: 'Münster / NRW region' },
    { lat: 52.52, lng: 13.40,  name: 'Berlin' },
    // Asia-Pacific
    { lat: 35.68, lng: 139.69, name: 'Tokyo (Inzai/Mitaka)' },
    { lat: 22.31, lng: 114.17, name: 'Hong Kong' },
    { lat: 1.35,  lng: 103.82, name: 'Singapore — Tuas' },
    { lat: 28.61, lng: 77.20,  name: 'Delhi / Noida (India)' },
    { lat: 19.07, lng: 72.88,  name: 'Mumbai (India)' },
    { lat: 12.97, lng: 77.59,  name: 'Bangalore (India)' },
    { lat: 37.57, lng: 126.98, name: 'Seoul / Pangyo' },
    { lat: 31.23, lng: 121.47, name: 'Shanghai' },
    { lat: 39.91, lng: 116.40, name: 'Beijing / Zhangbei' },
    { lat: 22.55, lng: 113.95, name: 'Shenzhen (Guiyang link)' },
    { lat: -33.86, lng: 151.21, name: 'Sydney' },
    { lat: -37.81, lng: 144.96, name: 'Melbourne' },
    // Other
    { lat: -23.55, lng: -46.63, name: 'São Paulo' },
    { lat: 43.65, lng: -79.38, name: 'Toronto (Canada)' },
    { lat: 25.20, lng: 55.27,  name: 'Dubai (UAE)' },
    { lat: 24.47, lng: 54.37,  name: 'Abu Dhabi — G42' },
    { lat: -1.29, lng: 36.82,  name: 'Nairobi (Africa hub)' },
    { lat: -33.92, lng: 18.42, name: 'Cape Town' },
    { lat: 46.23, lng: 2.71,   name: 'France — FluidStack GW campus' },
    { lat: 20.59, lng: 79.46,  name: 'India — Reliance AI cluster' },
  ];

  // Persistent GPS / GNSS interference regions per open reporting
  // (e.g. GPSJam.org, aviation NOTAMs). Radii are illustrative.
  const GPS_JAMMING_ZONES = [
    { lat: 36.19, lng: 37.16, name: 'Northern Syria', radiusKm: 280 },
    { lat: 34.89, lng: 35.88, name: 'Eastern Mediterranean', radiusKm: 260 },
    { lat: 32.08, lng: 34.78, name: 'Tel Aviv sector', radiusKm: 140 },
    { lat: 54.70, lng: 20.51, name: 'Kaliningrad oblast', radiusKm: 220 },
    { lat: 59.44, lng: 24.75, name: 'Estonia / Gulf of Finland', radiusKm: 200 },
    { lat: 60.17, lng: 24.94, name: 'Helsinki approach', radiusKm: 160 },
    { lat: 44.00, lng: 37.70, name: 'Black Sea / Crimea', radiusKm: 260 },
    { lat: 47.02, lng: 28.84, name: 'Moldova / Odesa approach', radiusKm: 200 },
    { lat: 36.50, lng: 53.00, name: 'Caspian / N. Iran', radiusKm: 240 },
    { lat: 24.47, lng: 54.37, name: 'Persian Gulf', radiusKm: 220 },
    { lat: 36.80, lng: 10.18, name: 'Tunis / Libya approach', radiusKm: 180 },
    { lat: 35.18, lng: 33.36, name: 'Cyprus', radiusKm: 120 },
    { lat: 31.77, lng: 35.21, name: 'Jerusalem / Gaza', radiusKm: 120 },
    { lat: 47.22, lng: 39.72, name: 'Rostov-on-Don', radiusKm: 180 },
  ];

  // Major migration corridors (origin → transit → destination).
  const MIGRATION_FLOWS = [
    { name: 'Central Mediterranean',  path: [[14.00, 13.20], [32.89, 13.18], [36.85, 14.30]] },
    { name: 'Western Mediterranean',  path: [[10.20, -7.98], [33.57, -7.61], [36.13, -5.45]] },
    { name: 'Eastern Mediterranean',  path: [[33.51, 36.29], [36.20, 36.20], [38.25, 26.30]] },
    { name: 'Balkan Route',           path: [[41.00, 28.98], [42.00, 21.75], [45.25, 19.83], [48.21, 16.37]] },
    { name: 'Darién Gap',             path: [[4.60, -74.08], [8.00, -77.50], [9.08, -79.68], [15.78, -86.79], [19.43, -99.13]] },
    { name: 'US Southwest border',    path: [[14.63, -90.51], [19.43, -99.13], [31.75, -106.49], [32.54, -117.04]] },
    { name: 'Horn of Africa → Gulf',  path: [[9.15, 40.49], [11.59, 43.15], [15.35, 44.21], [24.47, 39.61]] },
    { name: 'Afghanistan → Europe',   path: [[34.53, 69.17], [35.69, 51.39], [39.92, 32.85], [41.00, 28.98]] },
    { name: 'Rohingya (MM → BD)',     path: [[20.15, 92.90], [21.20, 92.18]] },
    { name: 'Venezuela diaspora',     path: [[10.48, -66.90], [4.71, -74.07], [-12.04, -77.03], [-33.45, -70.67]] },
  ];

  // Great-circle paths between major ports/chokepoints to illustrate trade.
  const TRADE_ROUTES = [
    { name: 'Asia–Europe (Suez)',     path: [[31.22, 121.47], [1.35, 103.82], [11.59, 43.15], [30.00, 32.58], [45.46, 12.33], [51.95, 4.14]] },
    { name: 'Trans-Pacific',          path: [[31.22, 121.47], [21.30, -157.86], [33.73, -118.26]] },
    { name: 'Cape Route',             path: [[1.35, 103.82], [-33.91, 18.42], [51.95, 4.14]] },
    { name: 'North Atlantic',         path: [[40.65, -74.04], [51.51, -0.13]] },
    { name: 'Arctic (NSR)',           path: [[31.22, 121.47], [50.00, 180], [72.00, 60.00], [69.00, 33.40], [51.95, 4.14]] },
    { name: 'Panama Canal',           path: [[33.73, -118.26], [9.08, -79.68], [40.65, -74.04]] },
    { name: 'Hormuz oil route',       path: [[26.57, 56.25], [12.58, 43.33], [30.00, 32.58], [45.46, 12.33]] },
  ];

  PANELS.map = {
    title: 'World Situation Map',
    icon: '&#9673;',
    size: 'xl',
    desc: 'Live global map with toggleable OSINT layers.',
    render: (body, panel) => {
      if (typeof window.L === 'undefined') {
        renderErrorInto(body, new Error('Leaflet failed to load (no network?). Retry when online.'));
        setPanelStatus(panel, 'error', 'NO-LEAFLET');
        return;
      }

      setPanelStatus(panel, 'live', 'LIVE');
      const mapId = uid('map');
      body.innerHTML =
        '<div class="map-wrap">' +
        '  <div id="' + mapId + '" class="map-canvas"></div>' +
        '  <div class="map-layers"></div>' +
        '</div>';

      // Render grouped legend so the 15+ layers stay scannable.
      const layersBox = body.querySelector('.map-layers');
      const grouped = MAP_LAYERS_DEF.reduce((acc, def) => {
        (acc[def.group || 'Layers'] = acc[def.group || 'Layers'] || []).push(def);
        return acc;
      }, {});
      for (const [group, defs] of Object.entries(grouped)) {
        const section = document.createElement('div');
        section.className = 'map-layer-group';
        section.innerHTML = '<h4>' + escapeHtml(group) + '</h4>';
        for (const def of defs) {
          const row = document.createElement('label');
          row.innerHTML =
            '<input type="checkbox" data-layer="' + def.id + '" ' +
            (state.mapLayers[def.id] ? 'checked' : '') + ' />' +
            '<span class="layer-swatch" style="background:' + def.color + '"></span>' +
            '<span>' + escapeHtml(def.label) + '</span>' +
            (def.live ? '<span class="layer-live">LIVE</span>' : '');
          section.appendChild(row);
        }
        layersBox.appendChild(section);
      }

      const map = L.map(mapId, {
        attributionControl: true,
        zoomControl: true,
        worldCopyJump: true,
      }).setView([25, 15], 2);

      // CartoDB dark basemap — no Referer policy issues, already styled dark.
      // Subdomains a/b/c/d spread the load. Fallback to OpenStreetMap if
      // Carto is unreachable (Referer hook in main.js covers OSM's policy).
      const tilePrimary = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        {
          maxZoom: 10,
          minZoom: 2,
          subdomains: 'abcd',
          attribution: '&copy; OpenStreetMap &copy; CARTO',
        }
      );
      tilePrimary.on('tileerror', () => {
        // One-shot fallback to OSM if Carto errors out.
        if (!map.hasLayer(tileFallback)) {
          map.removeLayer(tilePrimary);
          tileFallback.addTo(map);
        }
      });
      const tileFallback = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 10,
          minZoom: 2,
          attribution: '&copy; OpenStreetMap contributors',
        }
      );
      tilePrimary.addTo(map);

      const groups = {};
      for (const def of MAP_LAYERS_DEF) groups[def.id] = L.layerGroup();

      // DivIcon markers with OSINT-dashboard-style glow and pulse.
      function dot(lat, lng, size, cssClass, popup, label) {
        var html = '<div class="osint-marker ' + cssClass + '" style="width:' + size + 'px;height:' + size + 'px">' +
          (label ? '<span class="osint-marker-label">' + escapeHtml(label) + '</span>' : '') + '</div>';
        return L.marker([lat, lng], {
          icon: L.divIcon({ className: '', html: html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        }).bindPopup(popup);
      }
      const line = (coords, color, popup, weight) => {
        return L.polyline(coords, {
          color, weight: weight || 2, opacity: 0.7, smoothFactor: 1.5,
        }).bindPopup(popup);
      };

      for (const c of CONFLICTS) {
        if (c.poly) {
          L.polygon(c.poly, {
            color: c.sev === 'crit' ? '#ff2020' : c.sev === 'high' ? '#ff6b35' : c.sev === 'med' ? '#e8a23a' : '#888',
            weight: 1.5, opacity: 0.7,
            fillColor: c.sev === 'crit' ? '#ff2020' : c.sev === 'high' ? '#ff6b35' : c.sev === 'med' ? '#e8a23a' : '#888',
            fillOpacity: c.sev === 'crit' ? 0.18 : 0.12,
            className: 'conflict-zone',
          }).bindPopup('<b>' + escapeHtml(c.name) + '</b><br>' + escapeHtml(c.region) +
            ' &middot; severity ' + c.sev.toUpperCase()).addTo(groups.conflicts);
        } else {
          const sz = c.sev === 'crit' ? 14 : c.sev === 'high' ? 11 : c.sev === 'med' ? 9 : 7;
          dot(c.lat, c.lng, sz, 'conflict ' + c.sev,
            '<b>' + escapeHtml(c.name) + '</b><br>' + escapeHtml(c.region) +
            ' &middot; severity ' + c.sev.toUpperCase(), c.name).addTo(groups.conflicts);
        }
      }
      for (const t of THREAT_HOTSPOTS) {
        dot(t.lat, t.lng, 10, 'threat',
          '<b>' + escapeHtml(t.name) + '</b>', t.name).addTo(groups.threats);
      }
      for (const b of MILITARY_BASES) {
        dot(b.lat, b.lng, 8, 'base ' + (b.type || ''),
          '<b>' + escapeHtml(b.name) + '</b><br>military installation (' + (b.type || '').replace('-', '/') + ')', b.name).addTo(groups.bases);
      }
      for (const n of NUCLEAR_FACILITIES) {
        dot(n.lat, n.lng, 10, 'nuclear ' + (n.status || 'active'),
          '<b>' + escapeHtml(n.name) + '</b><br>nuclear facility — ' + (n.status || 'active'), n.name).addTo(groups.nuclear);
      }
      for (const s of SPACEPORTS) {
        dot(s.lat, s.lng, 10, 'spaceport',
          '<b>' + escapeHtml(s.name) + '</b><br>spaceport', s.name).addTo(groups.spaceports);
      }
      for (const c of CYBER_HUBS) {
        dot(c.lat, c.lng, 8, 'cyber',
          '<b>' + escapeHtml(c.name) + '</b><br>cyber threat actor', c.name).addTo(groups.cyber);
      }
      for (const cp of CHOKEPOINTS) {
        dot(cp.lat, cp.lng, 12, 'chokepoint',
          '<b>' + escapeHtml(cp.name) + '</b><br>maritime chokepoint', cp.name).addTo(groups.chokepoints);
      }
      for (const p of COMMERCIAL_PORTS) {
        dot(p.lat, p.lng, 8, 'port',
          '<b>' + escapeHtml(p.name) + '</b><br>commercial port', p.name).addTo(groups.ports);
      }
      for (const a of MAJOR_AIRPORTS) {
        dot(a.lat, a.lng, 6, 'airport',
          '<b>' + escapeHtml(a.name) + '</b>').addTo(groups.airports);
      }
      for (const f of FINANCIAL_CENTERS) {
        dot(f.lat, f.lng, 8, 'financial',
          '<b>' + escapeHtml(f.name) + '</b><br>financial hub', f.name).addTo(groups.financial);
      }
      for (const m of CRITICAL_MINERALS) {
        dot(m.lat, m.lng, 8, 'mineral',
          '<b>' + escapeHtml(m.name) + '</b>').addTo(groups.minerals);
      }
      for (const city of KEY_CITIES) {
        dot(city.lat, city.lng, 6, 'city',
          '<b>' + escapeHtml(city.name) + '</b>').addTo(groups.cities);
      }

      for (const cable of UNDERSEA_CABLES) {
        line(cable.path, '#38bdf8',
          '<b>' + escapeHtml(cable.name) + '</b><br>undersea cable', 2)
          .addTo(groups.cables);
      }
      for (const p of PIPELINES) {
        line(p.path, '#fb923c',
          '<b>' + escapeHtml(p.name) + '</b><br>oil / gas pipeline', 2.5)
          .addTo(groups.pipelines);
      }
      for (const tr of TRADE_ROUTES) {
        line(tr.path, '#94a3b8',
          '<b>' + escapeHtml(tr.name) + '</b><br>trade route', 1.5)
          .addTo(groups.trade);
      }
      for (const d of DATACENTER_HUBS) {
        dot(d.lat, d.lng, 8, 'datacenter',
          '<b>' + escapeHtml(d.name) + '</b><br>datacenter cluster', d.name).addTo(groups.datacenters);
      }
      for (const z of GPS_JAMMING_ZONES) {
        L.circle([z.lat, z.lng], {
          radius: z.radiusKm * 1000,
          color: '#fde047', weight: 1.5, opacity: 0.6,
          fillColor: '#fde047', fillOpacity: 0.10,
          className: 'gps-jamming',
        }).bindPopup('<b>' + escapeHtml(z.name) + '</b><br>GPS/GNSS interference zone').addTo(groups.gpsjamming);
      }
      for (const mf of MIGRATION_FLOWS) {
        line(mf.path, '#c084fc',
          '<b>' + escapeHtml(mf.name) + '</b><br>migration corridor', 2)
          .addTo(groups.migration);
      }

      // Live: USGS earthquakes (past 24h, M2.5+).
      let quakesTimer = null;
      function loadQuakes() {
        groups.quakes.clearLayers();
        fetchIntel('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
          .then((text) => {
            const data = JSON.parse(text);
            for (const f of (data.features || [])) {
              const [lng, lat] = f.geometry?.coordinates || [];
              if (typeof lat !== 'number' || typeof lng !== 'number') continue;
              const mag = f.properties?.mag ?? 0;
              const sz = Math.max(8, Math.min(22, mag * 3.2));
              dot(lat, lng, sz, 'quake',
                '<b>M' + mag.toFixed(1) + '</b><br>' + escapeHtml(f.properties?.place || '') +
                '<br><small>' + new Date(f.properties?.time || 0).toISOString().slice(0, 16).replace('T', ' ') + ' UTC</small>')
                .addTo(groups.quakes);
            }
          })
          .catch((err) => {
            console.warn('[map] quake feed failed', err);
          });
      }
      loadQuakes();
      quakesTimer = setInterval(loadQuakes, 10 * 60 * 1000);

      // Live: OpenSky Network — aircraft positions (no auth, public API).
      // Fetches ~60s. Large payload so we cluster at low zoom.
      let flightsTimer = null;
      function loadFlights() {
        groups.flights.clearLayers();
        // Bounding box: whole world. Skip if layer is off (saves bandwidth).
        if (!state.mapLayers.flights) return;
        fetchIntel('https://opensky-network.org/api/states/all?lamin=-90&lomin=-180&lamax=90&lomax=180')
          .then((text) => {
            const data = JSON.parse(text);
            const states = data.states || [];
            const sample = states.filter((s) => s[5] != null && s[6] != null).slice(0, 1200);
            for (const s of sample) {
              const lng = s[5], lat = s[6];
              const callsign = (s[1] || '').trim() || '?';
              const alt = s[7] != null ? Math.round(s[7]) + ' m' : '—';
              const vel = s[9] != null ? Math.round(s[9] * 3.6) + ' km/h' : '—';
              L.circleMarker([lat, lng], {
                radius: 2, color: '#e0f2fe', weight: 1, opacity: 0.8,
                fillColor: '#e0f2fe', fillOpacity: 0.5,
              }).bindPopup('<b>' + escapeHtml(callsign) + '</b><br>Alt ' + alt + ' · ' + vel)
                .addTo(groups.flights);
            }
          })
          .catch((err) => console.warn('[map] flights feed failed', err));
      }
      loadFlights();
      flightsTimer = setInterval(loadFlights, 60 * 1000);

      // Live: International Space Station position via wheretheiss.at
      // (no auth, permissive CORS). Refreshes every 10s for a smooth track.
      let issTimer = null;
      let issMarker = null;
      let issTrail = [];
      function loadIss() {
        if (!state.mapLayers.iss) return;
        fetchIntel('https://api.wheretheiss.at/v1/satellites/25544')
          .then((text) => {
            const d = JSON.parse(text);
            const lat = Number(d.latitude);
            const lng = Number(d.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            const alt = d.altitude != null ? Math.round(d.altitude) + ' km' : '—';
            const vel = d.velocity != null ? Math.round(d.velocity) + ' km/h' : '—';
            const popup = '<b>ISS (ZARYA)</b><br>Alt ' + alt + ' · ' + vel +
              '<br><small>' + lat.toFixed(2) + ', ' + lng.toFixed(2) + '</small>';
            if (!issMarker) {
              issMarker = L.marker([lat, lng], {
                icon: L.divIcon({
                  className: '',
                  html: '<div class="osint-marker iss" style="width:14px;height:14px"><span class="osint-marker-label">ISS</span></div>',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                }),
              }).bindPopup(popup);
              issMarker.addTo(groups.iss);
            } else {
              issMarker.setLatLng([lat, lng]);
              issMarker.setPopupContent(popup);
            }
            issTrail.push([lat, lng]);
            if (issTrail.length > 60) issTrail.shift();
            // Redraw trail as a polyline, skipping antimeridian jumps.
            groups.iss.eachLayer((ly) => {
              if (ly !== issMarker) groups.iss.removeLayer(ly);
            });
            for (let i = 1; i < issTrail.length; i++) {
              const a = issTrail[i - 1], b = issTrail[i];
              if (Math.abs(a[1] - b[1]) > 180) continue;
              L.polyline([a, b], {
                color: '#22d3ee', weight: 1.5, opacity: 0.35,
              }).addTo(groups.iss);
            }
          })
          .catch((err) => console.warn('[map] ISS feed failed', err));
      }
      loadIss();
      issTimer = setInterval(loadIss, 10 * 1000);

      // Live: Vessel / ship traffic — WikiVoyage + major port AIS positions
      // We use a static set of major shipping lanes & known vessel-dense areas
      // plus periodic fetch from public vessel tracking APIs when available.
      let vesselsTimer = null;
      const VESSEL_LANES = [
        { name: 'Suez Canal transit', lat: 30.5, lng: 32.3 },
        { name: 'Panama Canal transit', lat: 9.1, lng: -79.7 },
        { name: 'Strait of Malacca', lat: 2.5, lng: 101.5 },
        { name: 'Strait of Gibraltar', lat: 35.95, lng: -5.6 },
        { name: 'Bab el-Mandeb', lat: 12.6, lng: 43.3 },
        { name: 'English Channel', lat: 50.8, lng: 1.3 },
        { name: 'Cape of Good Hope', lat: -34.4, lng: 18.5 },
        { name: 'South China Sea shipping', lat: 14.0, lng: 115.0 },
        { name: 'Taiwan Strait shipping', lat: 24.5, lng: 119.5 },
        { name: 'Gulf of Aden', lat: 12.0, lng: 47.0 },
        { name: 'North Sea traffic', lat: 56.0, lng: 3.0 },
        { name: 'Bay of Bengal route', lat: 13.0, lng: 85.0 },
        { name: 'East Med shipping', lat: 33.5, lng: 32.0 },
        { name: 'Persian Gulf traffic', lat: 27.0, lng: 51.0 },
        { name: 'Lombok Strait', lat: -8.5, lng: 115.7 },
        { name: 'Korea Strait', lat: 34.5, lng: 129.0 },
        { name: 'Baltic Sea route', lat: 58.0, lng: 20.0 },
        { name: 'Gulf of Mexico shipping', lat: 25.5, lng: -90.0 },
        { name: 'US East Coast lane', lat: 38.0, lng: -73.0 },
        { name: 'US West Coast lane', lat: 34.0, lng: -119.5 },
      ];

      function loadVessels() {
        groups.vessels.clearLayers();
        if (!state.mapLayers.vessels) return;
        for (const v of VESSEL_LANES) {
          L.circleMarker([v.lat, v.lng], {
            radius: 5, color: '#38bdf8', weight: 1, opacity: 0.8,
            fillColor: '#38bdf8', fillOpacity: 0.4,
          }).bindPopup('<b>' + escapeHtml(v.name) + '</b><br>Major shipping zone')
            .addTo(groups.vessels);
        }
        fetchIntel('https://meri.digitraffic.fi/api/ais/v1/locations?latitude=60.2&longitude=25.0&radius=200&from=' + (Date.now() - 600000))
          .then((text) => {
            const data = JSON.parse(text);
            const features = data.features || [];
            for (const f of features.slice(0, 200)) {
              const props = f.properties || {};
              const coords = (f.geometry && f.geometry.coordinates) || [];
              if (coords.length < 2) continue;
              L.circleMarker([coords[1], coords[0]], {
                radius: 3, color: '#38bdf8', weight: 1, opacity: 0.7,
                fillColor: '#38bdf8', fillOpacity: 0.3,
              }).bindPopup('<b>MMSI ' + escapeHtml(String(props.mmsi || '?')) + '</b><br>SOG ' + (props.sog != null ? (props.sog / 10).toFixed(1) + ' kn' : '—'))
                .addTo(groups.vessels);
            }
          })
          .catch(() => {});
      }
      loadVessels();
      vesselsTimer = setInterval(loadVessels, 3 * 60 * 1000);

      // Apply persisted layer state
      for (const def of MAP_LAYERS_DEF) {
        if (state.mapLayers[def.id]) groups[def.id].addTo(map);
      }

      // Toggle handler
      body.querySelectorAll('input[data-layer]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = input.dataset.layer;
          state.mapLayers[id] = input.checked;
          if (input.checked) {
            groups[id].addTo(map);
            if (id === 'flights') loadFlights();
            if (id === 'iss') loadIss();
            if (id === 'vessels') loadVessels();
          } else {
            map.removeLayer(groups[id]);
          }
          saveState();
        });
      });

      // Invalidate size after layout (panel sizing may shift after init)
      setTimeout(() => map.invalidateSize(), 60);
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(body);

      return () => {
        if (quakesTimer) clearInterval(quakesTimer);
        if (flightsTimer) clearInterval(flightsTimer);
        if (issTimer) clearInterval(issTimer);
        if (vesselsTimer) clearInterval(vesselsTimer);
        ro.disconnect();
        map.remove();
      };
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: OSINT Sources — quick-launch tiles
  // --------------------------------------------------------------------------
  const SOURCES = [
    { name: 'Bellingcat',         host: 'www.bellingcat.com',          desc: 'Open-source investigation platform & casework.' },
    { name: 'ACLED',              host: 'acleddata.com',               desc: 'Armed Conflict Location & Event Data.' },
    { name: 'Global Incident Map', host: 'www.globalincidentmap.com',  desc: 'Real-time mapping of terrorism & incidents.' },
    { name: 'Flightradar24',      host: 'www.flightradar24.com',       desc: 'Live global flight tracking, ADS-B.' },
    { name: 'MarineTraffic',      host: 'www.marinetraffic.com',       desc: 'Live AIS tracking of commercial vessels.' },
    { name: 'OSINT Framework',    host: 'osintframework.com',          desc: 'Curated directory of OSINT tools.' },
    { name: 'IntelligenceX',      host: 'intelx.io',                   desc: 'Darknet & breach data search engine.' },
    { name: 'Shodan',             host: 'www.shodan.io',               desc: 'Internet-connected devices search.' },
    { name: 'GreyNoise',          host: 'viz.greynoise.io',            desc: 'Internet background noise intel.' },
    { name: 'Recorded Future',    host: 'www.recordedfuture.com/free-tools', desc: 'Free threat-intel lookup tools.' },
    { name: 'ISW',                host: 'www.understandingwar.org',    desc: 'Institute for the Study of War.' },
    { name: 'GDELT',              host: 'www.gdeltproject.org',        desc: 'Global events database, 100+ languages.' },
    { name: 'Liveuamap',          host: 'liveuamap.com',               desc: 'Live conflict map with event feed.' },
    { name: 'NASA FIRMS',         host: 'firms.modaps.eosdis.nasa.gov', desc: 'Active fire/thermal anomalies.' },
    { name: 'EMSC Seismic',       host: 'www.emsc-csem.org',           desc: 'Real-time earthquake reports.' },
    { name: 'Spaceweather',       host: 'www.spaceweather.com',        desc: 'Solar activity & geomagnetic storms.' },
  ];

  PANELS.sources = {
    title: 'OSINT Sources',
    icon: '&#9672;',
    size: 'lg',
    desc: 'Quick-launch tiles for top OSINT reference sites.',
    render: (body, panel) => {
      setPanelStatus(panel, 'live', 'LINKS');
      const html = SOURCES.map((s) =>
        '<a class="source-card" href="https://' + escapeHtml(s.host) + '/" target="_blank" rel="noopener">' +
        '<div class="source-head"><span class="source-dot"></span>' + escapeHtml(s.name) + '</div>' +
        '<div class="source-host">' + escapeHtml(s.host) + '</div>' +
        '<div class="source-desc">' + escapeHtml(s.desc) + '</div>' +
        '</a>'
      ).join('');
      body.innerHTML = '<div class="source-grid">' + html + '</div>';
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: OSINT Toolkit (Domain / IP / DNS / Subnet)
  // --------------------------------------------------------------------------
  PANELS.toolkit = {
    title: 'OSINT Toolkit',
    icon: '&#9096;',
    size: 'lg',
    desc: 'Inline Domain, IP geo, DNS, and Subnet calculator tools.',
    render: (body, panel) => {
      setPanelStatus(panel, 'live', 'READY');
      body.innerHTML =
        '<div class="toolkit-tabs">' +
        '  <button class="toolkit-tab is-active" data-tool="domain">Domain</button>' +
        '  <button class="toolkit-tab" data-tool="ip">IP Geo</button>' +
        '  <button class="toolkit-tab" data-tool="dns">DNS</button>' +
        '  <button class="toolkit-tab" data-tool="subnet">Subnet</button>' +
        '</div>' +
        '<div class="toolkit-form-wrap"></div>';

      const formWrap = body.querySelector('.toolkit-form-wrap');
      let active = 'domain';
      function render() {
        formWrap.innerHTML = RENDER_TOOL[active]();
        wireTool(formWrap, active);
      }
      body.querySelectorAll('.toolkit-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          active = btn.dataset.tool;
          body.querySelectorAll('.toolkit-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
          render();
        });
      });
      render();
    },
  };

  const RENDER_TOOL = {
    domain: () =>
      '<form class="toolkit-form" data-k="domain">' +
      '  <input type="text" placeholder="example.com" />' +
      '  <button type="submit">Lookup</button>' +
      '</form><div class="toolkit-out"></div>',
    ip: () =>
      '<form class="toolkit-form" data-k="ip">' +
      '  <input type="text" placeholder="8.8.8.8" />' +
      '  <button type="submit">Geolocate</button>' +
      '</form><div class="toolkit-out"></div>',
    dns: () =>
      '<form class="toolkit-form" data-k="dns">' +
      '  <input type="text" placeholder="example.com" />' +
      '  <button type="submit">Resolve A/AAAA/MX/TXT</button>' +
      '</form><div class="toolkit-out"></div>',
    subnet: () =>
      '<form class="toolkit-form" data-k="subnet">' +
      '  <input type="text" placeholder="10.0.0.0/24" />' +
      '  <button type="submit">Calc</button>' +
      '</form><div class="toolkit-out"></div>',
  };

  function wireTool(wrap, kind) {
    const form = wrap.querySelector('form');
    const input = form.querySelector('input');
    const out = wrap.querySelector('.toolkit-out');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      out.textContent = 'Working…';
      runTool(kind, v)
        .then((html) => { out.innerHTML = html; })
        .catch((err) => { out.innerHTML = '<span style="color:#ff4e4e">' + escapeHtml(err.message) + '</span>'; });
    });
  }

  async function runTool(kind, value) {
    if (kind === 'domain') {
      // Parse domain from URL-ish input
      const host = normalizeHost(value);
      const dns = await dnsLookup(host, 'A');
      const dnsv6 = await dnsLookup(host, 'AAAA').catch(() => ({ Answer: [] }));
      const lines = [];
      lines.push('<dt>Host</dt><dd>' + escapeHtml(host) + '</dd>');
      const ips = (dns.Answer || []).filter((r) => r.type === 1).map((r) => r.data);
      lines.push('<dt>IPv4</dt><dd>' + (ips.length ? ips.map(escapeHtml).join(', ') : '—') + '</dd>');
      const ips6 = (dnsv6.Answer || []).filter((r) => r.type === 28).map((r) => r.data);
      lines.push('<dt>IPv6</dt><dd>' + (ips6.length ? ips6.map(escapeHtml).join(', ') : '—') + '</dd>');
      if (ips[0]) {
        const geo = await ipGeo(ips[0]).catch(() => null);
        if (geo && geo.status === 'success') {
          lines.push('<dt>Geo</dt><dd>' + escapeHtml([geo.city, geo.regionName, geo.country].filter(Boolean).join(', ')) + '</dd>');
          lines.push('<dt>ASN</dt><dd>' + escapeHtml(geo.as || '—') + '</dd>');
          lines.push('<dt>ISP</dt><dd>' + escapeHtml(geo.isp || '—') + '</dd>');
        }
      }
      return '<dl>' + lines.join('') + '</dl>';
    }
    if (kind === 'ip') {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) throw new Error('Not a valid IPv4 address');
      const geo = await ipGeo(value);
      if (geo.status !== 'success') throw new Error(geo.message || 'Geo lookup failed');
      return '<dl>' +
        '<dt>IP</dt><dd>' + escapeHtml(geo.query) + '</dd>' +
        '<dt>Country</dt><dd>' + escapeHtml(geo.country || '—') + ' (' + escapeHtml(geo.countryCode || '') + ')</dd>' +
        '<dt>Region</dt><dd>' + escapeHtml(geo.regionName || '—') + '</dd>' +
        '<dt>City</dt><dd>' + escapeHtml(geo.city || '—') + '</dd>' +
        '<dt>Lat/Lng</dt><dd>' + escapeHtml(String(geo.lat) + ', ' + String(geo.lon)) + '</dd>' +
        '<dt>ISP</dt><dd>' + escapeHtml(geo.isp || '—') + '</dd>' +
        '<dt>Org</dt><dd>' + escapeHtml(geo.org || '—') + '</dd>' +
        '<dt>AS</dt><dd>' + escapeHtml(geo.as || '—') + '</dd>' +
      '</dl>';
    }
    if (kind === 'dns') {
      const host = normalizeHost(value);
      const [a, aaaa, mx, txt] = await Promise.all([
        dnsLookup(host, 'A').catch(() => ({})),
        dnsLookup(host, 'AAAA').catch(() => ({})),
        dnsLookup(host, 'MX').catch(() => ({})),
        dnsLookup(host, 'TXT').catch(() => ({})),
      ]);
      const out = (arr) => (arr || []).map((r) => escapeHtml(r.data)).join('<br>') || '—';
      return '<dl>' +
        '<dt>A</dt><dd>' + out(a.Answer) + '</dd>' +
        '<dt>AAAA</dt><dd>' + out(aaaa.Answer) + '</dd>' +
        '<dt>MX</dt><dd>' + out(mx.Answer) + '</dd>' +
        '<dt>TXT</dt><dd>' + out(txt.Answer) + '</dd>' +
      '</dl>';
    }
    if (kind === 'subnet') return renderSubnetCalc(value);
    throw new Error('Unknown tool');
  }

  function normalizeHost(v) {
    try {
      if (/^[a-z]+:\/\//i.test(v)) return new URL(v).hostname;
    } catch (_) { /* ignore */ }
    return v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  }

  async function dnsLookup(host, type) {
    const url = 'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=' + encodeURIComponent(type);
    const text = await fetchIntel(url);
    return JSON.parse(text);
  }

  async function ipGeo(ip) {
    const url = 'https://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=66846719';
    const text = await fetchIntel(url);
    return JSON.parse(text);
  }

  function renderSubnetCalc(input) {
    const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(input.trim());
    if (!m) throw new Error('Use CIDR form: 10.0.0.0/24');
    const ip = m[1];
    const bits = parseInt(m[2], 10);
    if (bits < 0 || bits > 32) throw new Error('Prefix must be 0–32');
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) throw new Error('Invalid IP');
    const ipInt = (parts[0] << 24 >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const net = (ipInt & mask) >>> 0;
    const bcast = (net | (~mask >>> 0)) >>> 0;
    const hosts = bits >= 31 ? 0 : (bcast - net - 1);
    const fmt = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    return '<dl>' +
      '<dt>Network</dt><dd>' + fmt(net) + '/' + bits + '</dd>' +
      '<dt>Netmask</dt><dd>' + fmt(mask) + '</dd>' +
      '<dt>Wildcard</dt><dd>' + fmt((~mask) >>> 0) + '</dd>' +
      '<dt>Broadcast</dt><dd>' + fmt(bcast) + '</dd>' +
      '<dt>First host</dt><dd>' + (bits >= 31 ? '—' : fmt(net + 1)) + '</dd>' +
      '<dt>Last host</dt><dd>' + (bits >= 31 ? '—' : fmt(bcast - 1)) + '</dd>' +
      '<dt>Usable hosts</dt><dd>' + hosts.toLocaleString() + '</dd>' +
      '<dt>Total addrs</dt><dd>' + (bcast - net + 1).toLocaleString() + '</dd>' +
    '</dl>';
  }

  // --------------------------------------------------------------------------
  // PANEL: Weather (open-meteo.com — free, no API key)
  // --------------------------------------------------------------------------
  PANELS.weather = {
    title: 'Local Weather',
    icon: '&#9729;',
    size: 'md',
    desc: 'Current conditions & 5-day forecast via Open-Meteo.',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      let lastData = null;
      let lastLocName = '';

      const WMO_CODES = {
        0: ['Clear sky', '&#9728;'], 1: ['Mainly clear', '&#9728;'],
        2: ['Partly cloudy', '&#9925;'], 3: ['Overcast', '&#9729;'],
        45: ['Fog', '&#127787;'], 48: ['Rime fog', '&#127787;'],
        51: ['Light drizzle', '&#127782;'], 53: ['Drizzle', '&#127782;'], 55: ['Heavy drizzle', '&#127782;'],
        61: ['Light rain', '&#127783;'], 63: ['Rain', '&#127783;'], 65: ['Heavy rain', '&#127783;'],
        71: ['Light snow', '&#127784;'], 73: ['Snow', '&#127784;'], 75: ['Heavy snow', '&#127784;'],
        77: ['Snow grains', '&#127784;'],
        80: ['Light showers', '&#127782;'], 81: ['Showers', '&#127782;'], 82: ['Heavy showers', '&#127782;'],
        85: ['Light snow showers', '&#127784;'], 86: ['Snow showers', '&#127784;'],
        95: ['Thunderstorm', '&#9889;'], 96: ['Thunderstorm + hail', '&#9889;'], 99: ['Severe thunderstorm', '&#9889;'],
      };

      function wmoLabel(code) { return WMO_CODES[code] || ['Unknown', '&#63;']; }
      function cToF(c) { return Math.round(c * 9 / 5 + 32); }
      function tempStr(c) {
        var useF = state.prefs.useFahrenheit;
        return useF ? cToF(c) + '&deg;F' : Math.round(c) + '&deg;C';
      }
      function tempShort(c) {
        var useF = state.prefs.useFahrenheit;
        return useF ? cToF(c) + '&deg;' : Math.round(c) + '&deg;';
      }
      function windStr(kmh) {
        if (state.prefs.useFahrenheit) return Math.round(kmh * 0.621371) + ' mph';
        return Math.round(kmh) + ' km/h';
      }

      function renderWeather(data, locName) {
        if (killed) return;
        lastData = data;
        lastLocName = locName;
        const cur = data.current;
        const daily = data.daily;
        const [desc, icon] = wmoLabel(cur.weather_code);
        const windDir = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        const wd = windDir[Math.round((cur.wind_direction_10m || 0) / 22.5) % 16] || '';
        const unitLabel = state.prefs.useFahrenheit ? 'F' : 'C';

        let html = '<div class="weather-unit-toggle">' +
          '<button class="weather-unit-btn' + (state.prefs.useFahrenheit ? '' : ' is-active') + '" data-unit="C">&deg;C</button>' +
          '<button class="weather-unit-btn' + (state.prefs.useFahrenheit ? ' is-active' : '') + '" data-unit="F">&deg;F</button>' +
        '</div>' +
        '<div class="weather-current">' +
          '<div class="weather-icon">' + icon + '</div>' +
          '<div class="weather-main">' +
            '<div class="weather-temp">' + tempStr(cur.temperature_2m) + '</div>' +
            '<div class="weather-desc">' + escapeHtml(desc) + '</div>' +
            '<div class="weather-loc">' + escapeHtml(locName) + '</div>' +
          '</div>' +
          '<div class="weather-details">' +
            '<div>Feels like ' + tempStr(cur.apparent_temperature) + '</div>' +
            '<div>Humidity ' + cur.relative_humidity_2m + '%</div>' +
            '<div>Wind ' + windStr(cur.wind_speed_10m) + ' ' + wd + '</div>' +
            '<div>Pressure ' + Math.round(cur.surface_pressure) + ' hPa</div>' +
          '</div>' +
        '</div>';

        if (daily && daily.time) {
          html += '<div class="weather-forecast">';
          for (let i = 0; i < Math.min(daily.time.length, 5); i++) {
            const [dDesc, dIcon] = wmoLabel(daily.weather_code[i]);
            const dayName = i === 0 ? 'Today' : new Date(daily.time[i] + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' });
            html += '<div class="weather-day">' +
              '<div class="weather-day-name">' + escapeHtml(dayName) + '</div>' +
              '<div class="weather-day-icon">' + dIcon + '</div>' +
              '<div class="weather-day-temps">' +
                '<span class="weather-hi">' + tempShort(daily.temperature_2m_max[i]) + '</span>' +
                '<span class="weather-lo">' + tempShort(daily.temperature_2m_min[i]) + '</span>' +
              '</div>' +
            '</div>';
          }
          html += '</div>';
        }
        body.innerHTML = html;
        setPanelStatus(panel, 'live', 'LIVE');

        body.querySelectorAll('.weather-unit-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.prefs.useFahrenheit = btn.dataset.unit === 'F';
            saveState();
            if (lastData) renderWeather(lastData, lastLocName);
          });
        });
      }

      function fetchWeather(lat, lon, locName) {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
          '&longitude=' + lon +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5';
        setPanelStatus(panel, 'loading', 'FETCH');
        fetchIntel(url)
          .then((text) => { renderWeather(JSON.parse(text), locName); })
          .catch((err) => {
            if (killed) return;
            renderErrorInto(body, err, () => fetchWeather(lat, lon, locName));
            setPanelStatus(panel, 'error', 'ERR');
          });
      }

      function reverseGeo(lat, lon) {
        return fetchIntel('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=json&zoom=10')
          .then((t) => {
            const d = JSON.parse(t);
            return d.address ? [d.address.city || d.address.town || d.address.village || d.address.county || '', d.address.country || ''].filter(Boolean).join(', ') : (lat.toFixed(2) + ', ' + lon.toFixed(2));
          })
          .catch(() => lat.toFixed(2) + ', ' + lon.toFixed(2));
      }

      function start(lat, lon) {
        reverseGeo(lat, lon).then((locName) => {
          fetchWeather(lat, lon, locName);
          timer = setInterval(() => fetchWeather(lat, lon, locName), 15 * 60 * 1000);
        });
      }

      body.innerHTML = '<div class="panel-loading">Detecting location&hellip;</div>';
      setPanelStatus(panel, 'loading', 'GEO');

      function tryIpGeoFallback() {
        fetchIntel('https://ip-api.com/json/?fields=lat,lon,city,country')
          .then((t) => { const d = JSON.parse(t); if (!killed) start(d.lat, d.lon); })
          .catch((err) => { if (!killed) { renderErrorInto(body, err); setPanelStatus(panel, 'error', 'ERR'); } });
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { if (!killed) start(pos.coords.latitude, pos.coords.longitude); },
          (geoErr) => {
            // Geolocation denied or unavailable — fall back to IP-based location
            console.warn('[weather] geolocation failed:', geoErr.message, '— falling back to IP geo');
            tryIpGeoFallback();
          },
          { timeout: 12000, enableHighAccuracy: false, maximumAge: 300000 }
        );
      } else {
        tryIpGeoFallback();
      }

      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: Local News (geolocation-based RSS feeds)
  // --------------------------------------------------------------------------
  const LOCAL_NEWS_REGIONS = {
    US: [
      { label: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
      { label: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
      { label: 'Fox', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
    ],
    GB: [
      { label: 'BBC UK', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
      { label: 'Guardian', url: 'https://www.theguardian.com/uk/rss' },
    ],
    DE: [
      { label: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all' },
    ],
    FR: [
      { label: 'France24', url: 'https://www.france24.com/en/rss' },
    ],
    AU: [
      { label: 'ABC AU', url: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
    ],
    CA: [
      { label: 'CBC', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
    ],
    IN: [
      { label: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms' },
    ],
    _default: [
      { label: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { label: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { label: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all' },
    ],
  };

  PANELS.localnews = {
    title: 'Local News',
    icon: '&#128240;',
    size: 'md',
    desc: 'News feeds based on your detected region.',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      let activeSrc = 0;

      function detectCountry() {
        return fetchIntel('https://ip-api.com/json/?fields=countryCode')
          .then(function (t) { return JSON.parse(t).countryCode || '_default'; })
          .catch(function () { return '_default'; });
      }

      function renderFeed(feeds, country) {
        if (killed) return;
        var tabs = feeds.map(function (f, i) {
          return '<button class="' + (i === activeSrc ? 'is-active' : '') + '" data-idx="' + i + '">' +
            escapeHtml(f.label) + '</button>';
        }).join('');

        function loadSource(idx) {
          activeSrc = idx;
          body.querySelectorAll('.news-tabs button').forEach(function (b) {
            b.classList.toggle('is-active', parseInt(b.dataset.idx, 10) === idx);
          });
          var listEl = body.querySelector('.localnews-list');
          listEl.innerHTML = '<div class="panel-loading">Loading&hellip;</div>';
          setPanelStatus(panel, 'loading', 'FETCH');
          fetchIntel(feeds[idx].url)
            .then(function (text) {
              if (killed) return;
              var items = parseRss(text).slice(0, 12);
              if (items.length === 0) {
                listEl.innerHTML = '<div class="panel-empty">No items found.</div>';
                setPanelStatus(panel, 'live', 'EMPTY');
                return;
              }
              listEl.innerHTML = '<ul class="news-list">' + items.map(function (it) {
                var thumbHtml = it.thumb
                  ? '<img class="news-thumb" src="' + escapeHtml(it.thumb) + '" alt="" loading="lazy" />'
                  : '';
                return '<li><a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener">' +
                  thumbHtml +
                  '<div class="news-text">' +
                  '<span class="news-title">' + escapeHtml(it.title) + '</span>' +
                  '<span class="news-meta"><span class="src">' + escapeHtml(feeds[idx].label) + '</span>' +
                  escapeHtml(formatRelTime(it.date)) + '</span>' +
                  '</div></a></li>';
              }).join('') + '</ul>';
              setPanelStatus(panel, 'live', country);
            })
            .catch(function (err) {
              if (killed) return;
              listEl.innerHTML = '<div class="panel-error">' + escapeHtml(err.message) + '</div>';
              setPanelStatus(panel, 'error', 'ERR');
            });
        }

        body.innerHTML = '<div class="news-tabs">' + tabs + '</div><div class="localnews-list"></div>';
        body.querySelectorAll('.news-tabs button').forEach(function (btn) {
          btn.addEventListener('click', function () { loadSource(parseInt(btn.dataset.idx, 10)); });
        });
        loadSource(activeSrc);
        timer = setInterval(function () { loadSource(activeSrc); }, 10 * 60 * 1000);
      }

      body.innerHTML = '<div class="panel-loading">Detecting region&hellip;</div>';
      setPanelStatus(panel, 'loading', 'GEO');
      detectCountry().then(function (cc) {
        if (killed) return;
        var feeds = LOCAL_NEWS_REGIONS[cc] || LOCAL_NEWS_REGIONS._default;
        renderFeed(feeds, cc);
      });

      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  // --------------------------------------------------------------------------
  // Kick off initial render
  // --------------------------------------------------------------------------
  renderDashboard();

  window.__monitorDashboard = { state, PANELS, renderDashboard, fetchIntel, escapeHtml, uid, setPanelStatus, renderErrorInto, CONFLICTS };
})();
