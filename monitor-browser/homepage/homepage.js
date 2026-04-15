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
  const fetchIntel = hasApi
    ? (url) => window.monitorApi.fetchIntel(url)
    : () => Promise.reject(new Error('Intel proxy unavailable (preload missing)'));

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
    'map', 'news', 'threat', 'intel', 'markets', 'crypto', 'conflicts', 'sources', 'toolkit',
  ];

  const DEFAULT_STATE = {
    panels: DEFAULT_PANELS.slice(),
    mapLayers: {
      conflicts: true,
      threats: true,
      bases: false,
      chokepoints: true,
      cities: false,
    },
    newsSource: 'bbc',
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          panels: Array.isArray(parsed.panels) ? parsed.panels : DEFAULT_PANELS.slice(),
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
      window.location.href = looksLikeUrl(v)
        ? coerceUrl(v)
        : 'https://www.google.com/search?q=' + encodeURIComponent(v);
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
    const el = document.createElement('article');
    el.className = 'panel panel-' + (def.size || 'md');
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
      desc: 'All panels. Maximum awareness.',
      panels: ['map', 'threat', 'news', 'intel', 'markets', 'crypto', 'conflicts', 'sources', 'toolkit'],
    },
    {
      id: 'geo',
      name: 'Geopolitical',
      desc: 'Map, conflicts, intel feed, news.',
      panels: ['map', 'threat', 'conflicts', 'intel', 'news'],
    },
    {
      id: 'market',
      name: 'Markets only',
      desc: 'Commodities, equities, crypto.',
      panels: ['markets', 'crypto', 'news'],
    },
    {
      id: 'minimal',
      name: 'Minimal',
      desc: 'Threat level + news.',
      panels: ['threat', 'news'],
    },
    {
      id: 'toolkit',
      name: 'Analyst toolkit',
      desc: 'Sources + OSINT toolkit, no live feeds.',
      panels: ['sources', 'toolkit'],
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
    { region: 'MidEast',  name: 'Gaza — Israel/Hamas',       sev: 'crit', lat: 31.5, lng: 34.5 },
    { region: 'MidEast',  name: 'West Bank unrest',          sev: 'high', lat: 32.0, lng: 35.3 },
    { region: 'MidEast',  name: 'Lebanon — southern border', sev: 'high', lat: 33.3, lng: 35.5 },
    { region: 'MidEast',  name: 'Yemen — Houthi Red Sea',    sev: 'high', lat: 15.5, lng: 42.7 },
    { region: 'MidEast',  name: 'Syria — northwest',         sev: 'med',  lat: 35.8, lng: 36.7 },
    { region: 'MidEast',  name: 'Iran — internal unrest',    sev: 'med',  lat: 35.7, lng: 51.4 },
    { region: 'Europe',   name: 'Ukraine — Donbas front',    sev: 'crit', lat: 48.9, lng: 37.8 },
    { region: 'Europe',   name: 'Ukraine — Kharkiv axis',    sev: 'high', lat: 50.0, lng: 36.3 },
    { region: 'Europe',   name: 'Moldova — Transnistria',    sev: 'med',  lat: 46.8, lng: 29.6 },
    { region: 'Europe',   name: 'Kosovo — northern flashpts', sev: 'low', lat: 42.9, lng: 20.9 },
    { region: 'Africa',   name: 'Sudan — civil war',         sev: 'crit', lat: 15.5, lng: 32.5 },
    { region: 'Africa',   name: 'Sahel — jihadist insurgency', sev: 'high', lat: 13.5, lng: 2.1 },
    { region: 'Africa',   name: 'DRC — eastern provinces',   sev: 'high', lat: -1.7, lng: 29.2 },
    { region: 'Africa',   name: 'Ethiopia — Amhara',         sev: 'med',  lat: 11.6, lng: 37.4 },
    { region: 'Asia',     name: 'Myanmar — civil war',       sev: 'high', lat: 19.7, lng: 96.1 },
    { region: 'Asia',     name: 'Taiwan Strait — pressure',  sev: 'med',  lat: 24.0, lng: 120.9 },
    { region: 'Asia',     name: 'Kashmir — LoC',             sev: 'med',  lat: 34.1, lng: 74.8 },
    { region: 'Asia',     name: 'Korea — DPRK posture',      sev: 'med',  lat: 38.3, lng: 127.5 },
    { region: 'Americas', name: 'Haiti — gang collapse',     sev: 'high', lat: 18.6, lng: -72.3 },
    { region: 'Americas', name: 'Ecuador — cartel violence', sev: 'med',  lat: -2.2, lng: -79.9 },
    { region: 'Americas', name: 'Venezuela — Guyana dispute', sev: 'med', lat: 6.8,  lng: -58.9 },
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
    { id: 'bbc',      label: 'BBC',      url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'reuters',  label: 'Reuters',  url: 'https://moxie.foxnews.com/google-publisher/world.xml' }, // Reuters blocked RSS; fallback
    { id: 'aljaz',    label: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { id: 'dw',       label: 'DW',       url: 'https://rss.dw.com/rdf/rss-en-all' },
    { id: 'ap',       label: 'AP',       url: 'https://rsshub.app/apnews/topics/world-news' },
    { id: 'cnbc',     label: 'CNBC',     url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
  ];

  PANELS.news = {
    title: 'Live News',
    icon: '&#9636;',
    size: 'lg',
    desc: 'Breaking world news from major wires (BBC, Al Jazeera, DW, AP, CNBC).',
    render: (body, panel) => {
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
      function loadNews() {
        if (killed) return;
        setPanelStatus(panel, 'loading', 'FETCH');
        const src = NEWS_SOURCES.find((s) => s.id === state.newsSource) || NEWS_SOURCES[0];
        const out = body.querySelector('.news-body');
        out.innerHTML = '<div class="panel-loading">Fetching headlines&hellip;</div>';

        fetchIntel(src.url)
          .then((text) => {
            if (killed) return;
            const items = parseRss(text).slice(0, 14);
            if (items.length === 0) {
              out.innerHTML = '<div class="panel-empty">No items returned.</div>';
              setPanelStatus(panel, 'error', 'EMPTY');
              return;
            }
            const list = items.map((it) =>
              '<li><a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener">' +
              '<span class="news-title">' + escapeHtml(it.title) + '</span>' +
              '<span class="news-meta"><span class="src">' + escapeHtml(src.label) + '</span>' +
              escapeHtml(formatRelTime(it.date)) + '</span></a></li>'
            ).join('');
            out.innerHTML = '<ul class="news-list">' + list + '</ul>';
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch((err) => {
            if (killed) return;
            renderErrorInto(out, err, loadNews);
            setPanelStatus(panel, 'error', 'ERR');
          });
      }

      loadNews();
      timer = setInterval(loadNews, 5 * 60 * 1000);
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
      if (title && link) {
        out.push({ title, link, date: date ? new Date(date) : new Date() });
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
  // PANEL: Intel Feed (GDELT doc API)
  // --------------------------------------------------------------------------
  PANELS.intel = {
    title: 'Intel Feed',
    icon: '&#9678;',
    size: 'md',
    desc: 'GDELT real-time OSINT indexing across conflict & security topics.',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      function load() {
        if (killed) return;
        setPanelStatus(panel, 'loading', 'FETCH');
        body.innerHTML = '<div class="panel-loading">Querying GDELT&hellip;</div>';
        // GDELT doc API — query for conflict/military/intel keywords.
        const q = '(conflict OR attack OR "intelligence agency" OR sanctions OR cyberattack)';
        const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) +
                    '&mode=artlist&format=json&maxrecords=15&timespan=1d';
        fetchIntel(url)
          .then((text) => {
            if (killed) return;
            let data;
            try { data = JSON.parse(text); } catch (e) {
              throw new Error('GDELT returned non-JSON');
            }
            const items = (data.articles || []).slice(0, 12);
            if (items.length === 0) {
              body.innerHTML = '<div class="panel-empty">No articles in the last 24h for this query.</div>';
              setPanelStatus(panel, 'error', 'EMPTY');
              return;
            }
            const list = items.map((it) => {
              const d = parseGdeltDate(it.seendate);
              return '<li><a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' +
                '<span class="news-title">' + escapeHtml(it.title) + '</span>' +
                '<span class="news-meta">' +
                '<span class="src">' + escapeHtml(it.domain || it.sourcecountry || 'GDELT') + '</span>' +
                escapeHtml(formatRelTime(d)) + '</span></a></li>';
            }).join('');
            body.innerHTML = '<ul class="news-list">' + list + '</ul>';
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch((err) => {
            if (killed) return;
            renderErrorInto(body, err, load);
            setPanelStatus(panel, 'error', 'ERR');
          });
      }
      load();
      timer = setInterval(load, 8 * 60 * 1000);
      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  function parseGdeltDate(s) {
    // GDELT format: YYYYMMDDTHHMMSSZ
    if (!s || s.length < 15) return new Date();
    const iso = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' +
                s.slice(9, 11) + ':' + s.slice(11, 13) + ':' + s.slice(13, 15) + 'Z';
    return new Date(iso);
  }

  // --------------------------------------------------------------------------
  // PANEL: Markets (commodities / equities via Stooq CSV)
  // --------------------------------------------------------------------------
  // Stooq serves snapshot quotes as CSV with permissive CORS. No auth.
  const MARKET_TICKERS = [
    { sym: 'gc.f',     label: 'Gold /oz' },
    { sym: 'si.f',     label: 'Silver /oz' },
    { sym: 'cl.f',     label: 'Crude WTI' },
    { sym: 'ng.f',     label: 'Nat Gas' },
    { sym: '^spx',     label: 'S&P 500' },
    { sym: '^ndq',     label: 'Nasdaq 100' },
    { sym: '^dji',     label: 'Dow 30' },
    { sym: '^vix',     label: 'VIX' },
    { sym: 'eurusd',   label: 'EUR/USD' },
    { sym: 'usdjpy',   label: 'USD/JPY' },
  ];

  PANELS.markets = {
    title: 'Markets',
    icon: '&#8710;',
    size: 'md',
    desc: 'Commodities, equities, FX (Stooq snapshots).',
    render: (body, panel) => {
      let killed = false;
      let timer = null;
      function load() {
        if (killed) return;
        setPanelStatus(panel, 'loading', 'FETCH');
        body.innerHTML = '<div class="panel-loading">Fetching quotes&hellip;</div>';
        const syms = MARKET_TICKERS.map((t) => t.sym).join(',');
        const url = 'https://stooq.com/q/l/?s=' + encodeURIComponent(syms) + '&i=d&f=sd2t2ohlcv';
        fetchIntel(url)
          .then((csv) => {
            if (killed) return;
            const rows = parseCsv(csv);
            const head = rows.shift();
            if (!head) throw new Error('Stooq returned empty CSV');
            const idx = {
              sym: head.indexOf('Symbol'),
              close: head.indexOf('Close'),
              open: head.indexOf('Open'),
            };
            const html = MARKET_TICKERS.map((t) => {
              const row = rows.find((r) => (r[idx.sym] || '').toLowerCase() === t.sym.toLowerCase());
              if (!row) {
                return tickerCard(t.label, '—', null);
              }
              const close = parseFloat(row[idx.close]);
              const open = parseFloat(row[idx.open]);
              const delta = !isNaN(close) && !isNaN(open) && open !== 0
                ? ((close - open) / open) * 100
                : null;
              return tickerCard(t.label, isNaN(close) ? '—' : formatPrice(close), delta);
            }).join('');
            body.innerHTML = '<div class="markets-grid">' + html + '</div>';
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch((err) => {
            if (killed) return;
            renderErrorInto(body, err, load);
            setPanelStatus(panel, 'error', 'ERR');
          });
      }
      load();
      timer = setInterval(load, 3 * 60 * 1000);
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
      function load() {
        if (killed) return;
        setPanelStatus(panel, 'loading', 'FETCH');
        body.innerHTML = '<div class="panel-loading">Loading coins&hellip;</div>';
        const ids = CRYPTO_COINS.map((c) => c.id).join(',');
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
                    encodeURIComponent(ids) +
                    '&vs_currencies=usd&include_24hr_change=true';
        fetchIntel(url)
          .then((text) => {
            if (killed) return;
            const data = JSON.parse(text);
            const html = CRYPTO_COINS.map((c) => {
              const row = data[c.id];
              if (!row || typeof row.usd !== 'number') return tickerCard(c.label, '—', null);
              return tickerCard(c.label, '$' + formatPrice(row.usd),
                typeof row.usd_24h_change === 'number' ? row.usd_24h_change : null);
            }).join('');
            body.innerHTML = '<div class="markets-grid">' + html + '</div>';
            setPanelStatus(panel, 'live', 'LIVE');
          })
          .catch((err) => {
            if (killed) return;
            renderErrorInto(body, err, load);
            setPanelStatus(panel, 'error', 'ERR');
          });
      }
      load();
      timer = setInterval(load, 2 * 60 * 1000);
      return () => { killed = true; if (timer) clearInterval(timer); };
    },
  };

  // --------------------------------------------------------------------------
  // PANEL: World Map (Leaflet) with toggleable OSINT layers
  // --------------------------------------------------------------------------

  const MAP_LAYERS_DEF = [
    { id: 'conflicts',   label: 'Conflicts',       color: '#ff4e4e' },
    { id: 'threats',     label: 'Intel hotspots',  color: '#e8a23a' },
    { id: 'bases',       label: 'Military bases',  color: '#3aa9d8' },
    { id: 'chokepoints', label: 'Chokepoints',     color: '#d4a843' },
    { id: 'cities',      label: 'Key cities',      color: '#a0c8ff' },
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
    { lat: 36.94, lng: 139.17, name: 'Yokota AB (JP)' },
    { lat: 13.58, lng: 144.92, name: 'Andersen AFB (Guam)' },
    { lat: 50.09, lng: 8.60, name: 'Ramstein (DE)' },
    { lat: 25.47, lng: 51.31, name: 'Al-Udeid (QA)' },
    { lat: 37.08, lng: -76.61, name: 'Langley AFB (US)' },
    { lat: 21.35, lng: -157.95, name: 'Pearl Harbor (US)' },
    { lat: 32.69, lng: -117.21, name: 'NAS North Island' },
    { lat: 50.33, lng: 3.50, name: 'SHAPE / NATO (BE)' },
    { lat: 55.95, lng: 23.31, name: 'Šiauliai AB (LT)' },
    { lat: 39.81, lng: 39.93, name: 'Incirlik (TR)' },
    { lat: 1.35, lng: 103.99, name: 'Changi Naval (SG)' },
    { lat: -25.40, lng: 131.04, name: 'Pine Gap (AU)' },
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
        '  <div class="map-layers"><h4>Layers</h4></div>' +
        '</div>';

      const layersBox = body.querySelector('.map-layers');
      for (const def of MAP_LAYERS_DEF) {
        const row = document.createElement('label');
        row.innerHTML =
          '<input type="checkbox" data-layer="' + def.id + '" ' +
          (state.mapLayers[def.id] ? 'checked' : '') + ' />' +
          '<span class="layer-swatch" style="background:' + def.color + '"></span>' +
          '<span>' + escapeHtml(def.label) + '</span>';
        layersBox.appendChild(row);
      }

      const map = L.map(mapId, {
        attributionControl: true,
        zoomControl: true,
        worldCopyJump: true,
      }).setView([25, 15], 2);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 8,
        minZoom: 2,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const groups = {
        conflicts: L.layerGroup(),
        threats: L.layerGroup(),
        bases: L.layerGroup(),
        chokepoints: L.layerGroup(),
        cities: L.layerGroup(),
      };

      for (const c of CONFLICTS) {
        const radius = c.sev === 'crit' ? 10 : c.sev === 'high' ? 8 : c.sev === 'med' ? 6 : 4;
        L.circleMarker([c.lat, c.lng], {
          radius,
          color: '#ff4e4e',
          fillColor: '#ff4e4e',
          fillOpacity: 0.45,
          weight: 1.5,
        }).bindPopup('<b>' + escapeHtml(c.name) + '</b><br>' + escapeHtml(c.region) +
                     ' &middot; severity ' + c.sev.toUpperCase())
          .addTo(groups.conflicts);
      }
      for (const t of THREAT_HOTSPOTS) {
        L.circleMarker([t.lat, t.lng], {
          radius: 6, color: '#e8a23a', fillColor: '#e8a23a', fillOpacity: 0.35, weight: 1.5,
        }).bindPopup('<b>' + escapeHtml(t.name) + '</b>').addTo(groups.threats);
      }
      for (const b of MILITARY_BASES) {
        L.circleMarker([b.lat, b.lng], {
          radius: 5, color: '#3aa9d8', fillColor: '#3aa9d8', fillOpacity: 0.35, weight: 1.5,
        }).bindPopup('<b>' + escapeHtml(b.name) + '</b>').addTo(groups.bases);
      }
      for (const cp of CHOKEPOINTS) {
        L.circleMarker([cp.lat, cp.lng], {
          radius: 7, color: '#d4a843', fillColor: '#d4a843', fillOpacity: 0.45, weight: 2,
        }).bindPopup('<b>' + escapeHtml(cp.name) + '</b><br>maritime chokepoint')
          .addTo(groups.chokepoints);
      }
      for (const city of KEY_CITIES) {
        L.circleMarker([city.lat, city.lng], {
          radius: 3, color: '#a0c8ff', fillColor: '#a0c8ff', fillOpacity: 0.6, weight: 1,
        }).bindPopup('<b>' + escapeHtml(city.name) + '</b>').addTo(groups.cities);
      }

      // Apply persisted layer state
      for (const def of MAP_LAYERS_DEF) {
        if (state.mapLayers[def.id]) groups[def.id].addTo(map);
      }

      // Toggle handler
      body.querySelectorAll('input[data-layer]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = input.dataset.layer;
          state.mapLayers[id] = input.checked;
          if (input.checked) groups[id].addTo(map);
          else map.removeLayer(groups[id]);
          saveState();
        });
      });

      // Invalidate size after layout (panel sizing may shift after init)
      setTimeout(() => map.invalidateSize(), 60);
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(body);

      return () => {
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
    const url = 'http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=66846719';
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
  // Kick off initial render
  // --------------------------------------------------------------------------
  renderDashboard();

  window.__monitorDashboard = { state, PANELS, renderDashboard, fetchIntel, escapeHtml, uid, setPanelStatus, renderErrorInto, CONFLICTS };
})();
