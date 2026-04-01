/**
 * Analyst Tab — Primary navigation tab for investigation mode
 *
 * When active, hides the main dashboard (map + panels) and shows
 * a full-screen investigation workspace with 5 functional sub-tabs:
 *   1. Entity Intel — POI search with profile cards
 *   2. Link Graph — Force-directed entity relationship graph
 *   3. Timeline — Cross-source event correlation
 *   4. Notepad — Auto-saving markdown scratchpad
 *   5. OSINT Toolkit — Embedded tools (iframes + built-in utilities)
 */

const ANALYST_CONTAINER_ID = 'analystWorkspace';
const ACTIVE_SUBTAB_KEY = 'worldmonitor-analyst-subtab';

export type AnalystSubtab = 'entities' | 'graph' | 'timeline' | 'notepad' | 'toolkit';

interface SubtabDef {
  id: AnalystSubtab;
  label: string;
  icon: string;
}

const SUBTABS: SubtabDef[] = [
  { id: 'entities', label: 'Entity Intel', icon: '👤' },
  { id: 'graph', label: 'Link Graph', icon: '🕸' },
  { id: 'timeline', label: 'Timeline', icon: '📊' },
  { id: 'notepad', label: 'Notepad', icon: '📝' },
  { id: 'toolkit', label: 'OSINT Toolkit', icon: '🔧' },
];

function getActiveSubtab(): AnalystSubtab {
  return (localStorage.getItem(ACTIVE_SUBTAB_KEY) as AnalystSubtab) || 'entities';
}

function setActiveSubtab(id: AnalystSubtab): void {
  localStorage.setItem(ACTIVE_SUBTAB_KEY, id);
}

export function renderAnalystWorkspace(): string {
  const active = getActiveSubtab();
  const tabs = SUBTABS.map(st =>
    `<button class="analyst-subtab${st.id === active ? ' active' : ''}" data-subtab="${st.id}">
      <span class="analyst-subtab-icon">${st.icon}</span>
      <span class="analyst-subtab-label">${st.label}</span>
    </button>`
  ).join('');

  return `<div class="analyst-workspace" id="${ANALYST_CONTAINER_ID}" style="display:none">
    <div class="analyst-subtab-bar">${tabs}</div>
    <div class="analyst-content" id="analystContent"></div>
  </div>`;
}

// ── Sub-tab content renderers ───────────────────────────────

function renderSubtab(id: AnalystSubtab): string {
  switch (id) {
    case 'entities': return renderEntities();
    case 'graph': return renderGraph();
    case 'timeline': return renderTimeline();
    case 'notepad': return renderNotepad();
    case 'toolkit': return renderToolkit();
    default: return '';
  }
}

function renderEntities(): string {
  return `<div class="analyst-pane" data-pane="entities">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Entity Investigation</h2>
      <div class="analyst-search-bar">
        <input type="text" class="analyst-entity-search" id="analystEntitySearch" placeholder="Search persons, organizations, countries..." spellcheck="false" autocomplete="off" />
        <div class="analyst-search-filters">
          <button class="analyst-filter-btn active" data-filter="all">All</button>
          <button class="analyst-filter-btn" data-filter="person">👤 People</button>
          <button class="analyst-filter-btn" data-filter="org">🏢 Orgs</button>
          <button class="analyst-filter-btn" data-filter="country">🌍 Countries</button>
        </div>
      </div>
    </div>
    <div class="analyst-entity-results" id="analystEntityResults">
      <div class="analyst-empty-state">
        <span class="analyst-empty-icon">🔍</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">Search for an entity to begin investigation</div>
          <div class="analyst-empty-hint">Results pull from POI data, GDELT, and the entity graph. Try a world leader, country, or organization name.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderGraph(): string {
  return `<div class="analyst-pane" data-pane="graph">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Intelligence Link Graph</h2>
      <div class="analyst-graph-toolbar">
        <select class="analyst-graph-category" id="analystGraphCategory">
          <option value="country">🌍 Country</option>
          <option value="person">👤 Person</option>
          <option value="organization">🏢 Organization</option>
          <option value="event">⚡ Event</option>
        </select>
        <input type="text" class="analyst-graph-input" id="analystGraphInput" placeholder="Add entity..." spellcheck="false" />
        <button class="analyst-btn" id="analystGraphAddBtn">+ Add</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystGraphClearBtn">Clear</button>
      </div>
    </div>
    <div class="analyst-graph-canvas-wrap" id="analystGraphCanvasWrap">
      <div class="analyst-empty-state">
        <span class="analyst-empty-icon">🕸</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">Build an intelligence link graph</div>
          <div class="analyst-empty-hint">Add entities above. The full-screen graph is also available as the "Intelligence Link Graph" panel on the Monitor tab.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderTimeline(): string {
  return `<div class="analyst-pane" data-pane="timeline">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Correlation Timeline</h2>
      <div class="analyst-timeline-controls">
        <button class="analyst-filter-btn active" data-range="24h">24h</button>
        <button class="analyst-filter-btn" data-range="48h">48h</button>
        <button class="analyst-filter-btn" data-range="7d">7d</button>
        <span class="analyst-timeline-sep">|</span>
        <button class="analyst-btn analyst-btn-ghost" id="timelineRefreshBtn" style="font-size:10px">Refresh</button>
      </div>
    </div>
    <div id="analystTimelineView" style="flex:1;overflow-y:auto">
      <div class="analyst-searching">Loading events...</div>
    </div>
  </div>`;
}

function renderNotepad(): string {
  const saved = localStorage.getItem('worldmonitor-analyst-notes') || '';
  return `<div class="analyst-pane" data-pane="notepad">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Analyst Notepad</h2>
      <div class="analyst-notepad-actions">
        <button class="analyst-btn analyst-btn-ghost" id="analystNotepadClear" style="font-size:10px">Clear</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystNotepadExport" style="font-size:10px">Export .md</button>
        <span class="analyst-notepad-saved" id="analystNotepadStatus"></span>
      </div>
    </div>
    <textarea class="analyst-notepad-editor" id="analystNotepadEditor" placeholder="Type investigation notes here...&#10;&#10;Notes auto-save every 3 seconds.&#10;Export as .md for reports." spellcheck="true">${esc(saved)}</textarea>
  </div>`;
}

function renderToolkit(): string {
  return `<div class="analyst-pane" data-pane="toolkit">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">OSINT Toolkit</h2>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" class="analyst-toolkit-search" id="analystToolkitSearch" placeholder="Search tools..." spellcheck="false" autocomplete="off" style="max-width:300px" />
        <div class="analyst-search-filters" id="toolkitCatFilters">
          <button class="analyst-filter-btn active" data-cat="all">All</button>
          <button class="analyst-filter-btn" data-cat="lookup">🔍 Lookup</button>
          <button class="analyst-filter-btn" data-cat="threat">🛡 Threat</button>
          <button class="analyst-filter-btn" data-cat="geo">🗺 Geo</button>
          <button class="analyst-filter-btn" data-cat="social">📱 Social</button>
          <button class="analyst-filter-btn" data-cat="maritime">🚢 Maritime</button>
          <button class="analyst-filter-btn" data-cat="aviation">✈ Aviation</button>
        </div>
      </div>
    </div>
    <div class="analyst-toolkit-grid" id="analystToolkitGrid">${renderToolkitCards()}</div>
    <div id="toolFrameWrap" style="display:none;flex:1;min-height:0;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-bottom:none;border-radius:8px 8px 0 0">
        <span id="toolFrameTitle" style="font-size:11px;font-weight:600;color:var(--text)"></span>
        <button class="analyst-btn analyst-btn-ghost" id="toolFrameClose" style="font-size:10px;padding:2px 8px">✕ Close</button>
      </div>
      <iframe id="toolFrame" style="width:100%;height:500px;border:1px solid var(--vi-border,#252535);border-radius:0 0 8px 8px;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
    </div>
    <div id="builtinToolWrap" style="display:none;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:8px 8px 0 0">
        <span id="builtinToolTitle" style="font-size:11px;font-weight:600;color:var(--text)"></span>
        <button class="analyst-btn analyst-btn-ghost" id="builtinToolClose" style="font-size:10px;padding:2px 8px">✕ Close</button>
      </div>
      <div id="builtinToolBody" style="padding:12px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-top:none;border-radius:0 0 8px 8px"></div>
    </div>
  </div>`;
}

// ── Toolkit card data ───────────────────────────────────────

interface ToolDef {
  name: string;
  url: string;
  desc: string;
  cat: string;
  icon: string;
  embed: boolean;     // can iframe
  builtin?: string;   // built-in tool ID (no iframe needed)
}

const TOOLS: ToolDef[] = [
  // Lookup tools (built-in)
  { name: 'WHOIS Lookup', url: '', desc: 'Domain registration lookup', cat: 'lookup', icon: '🔍', embed: false, builtin: 'whois' },
  { name: 'DNS Lookup', url: '', desc: 'DNS record query (A, MX, NS, TXT)', cat: 'lookup', icon: '🌐', embed: false, builtin: 'dns' },
  { name: 'IP Geolocation', url: '', desc: 'Geolocate any IP address', cat: 'lookup', icon: '📍', embed: false, builtin: 'ipgeo' },
  { name: 'HTTP Headers', url: '', desc: 'Inspect HTTP response headers', cat: 'lookup', icon: '📋', embed: false, builtin: 'headers' },

  // Embeddable external tools
  { name: 'Shodan', url: 'https://www.shodan.io', desc: 'Internet-connected device search', cat: 'threat', icon: '🛡', embed: true },
  { name: 'Censys Search', url: 'https://search.censys.io', desc: 'Internet asset discovery', cat: 'threat', icon: '🔎', embed: true },
  { name: 'VirusTotal', url: 'https://www.virustotal.com', desc: 'File & URL threat analysis', cat: 'threat', icon: '🦠', embed: true },
  { name: 'GreyNoise', url: 'https://viz.greynoise.io', desc: 'Internet scanner identification', cat: 'threat', icon: '📡', embed: true },
  { name: 'Have I Been Pwned', url: 'https://haveibeenpwned.com', desc: 'Breach exposure checker', cat: 'threat', icon: '🔓', embed: true },
  { name: 'URLhaus', url: 'https://urlhaus.abuse.ch/browse/', desc: 'Malware URL database', cat: 'threat', icon: '🕷', embed: true },

  // Geospatial
  { name: 'Google Earth', url: 'https://earth.google.com/web/', desc: '3D satellite imagery', cat: 'geo', icon: '🌍', embed: true },
  { name: 'Sentinel Hub', url: 'https://apps.sentinel-hub.com/eo-browser/', desc: 'Satellite imagery browser', cat: 'geo', icon: '🛰', embed: true },
  { name: 'Overpass Turbo', url: 'https://overpass-turbo.eu', desc: 'OpenStreetMap query engine', cat: 'geo', icon: '🗺', embed: true },

  // Social
  { name: 'TGStat', url: 'https://tgstat.com', desc: 'Telegram channel analytics', cat: 'social', icon: '📱', embed: true },
  { name: 'Social Searcher', url: 'https://www.social-searcher.com', desc: 'Cross-platform social search', cat: 'social', icon: '🔎', embed: true },

  // Maritime
  { name: 'MarineTraffic', url: 'https://www.marinetraffic.com', desc: 'Real-time vessel tracking', cat: 'maritime', icon: '🚢', embed: true },
  { name: 'VesselFinder', url: 'https://www.vesselfinder.com', desc: 'Free AIS vessel tracking', cat: 'maritime', icon: '⚓', embed: true },

  // Aviation
  { name: 'FlightRadar24', url: 'https://www.flightradar24.com', desc: 'Live global flight tracking', cat: 'aviation', icon: '✈', embed: true },
  { name: 'ADS-B Exchange', url: 'https://globe.adsbexchange.com', desc: 'Unfiltered ADS-B data', cat: 'aviation', icon: '📡', embed: true },
];

function renderToolkitCards(): string {
  return TOOLS.map((t, i) =>
    `<div class="analyst-tool-card" data-cat="${t.cat}" data-idx="${i}">
      <div class="analyst-tool-icon">${t.icon}</div>
      <div class="analyst-tool-info">
        <div class="analyst-tool-name">${t.name}</div>
        <div class="analyst-tool-desc">${t.desc}</div>
      </div>
      <span class="analyst-tool-cat">${t.cat}</span>
      <span style="font-size:9px;color:var(--text-ghost)">${t.builtin ? '⚡ Built-in' : t.embed ? '🔗 Embed' : '↗ External'}</span>
    </div>`
  ).join('');
}

// ── Initialization ──────────────────────────────────────────

export function initAnalystWorkspace(): void {
  const ws = document.getElementById(ANALYST_CONTAINER_ID);
  if (!ws) return;

  // Render initial subtab
  const content = document.getElementById('analystContent');
  if (content) {
    content.innerHTML = renderSubtab(getActiveSubtab());
    initSubtab(getActiveSubtab());
  }

  // Sub-tab switching
  const bar = ws.querySelector('.analyst-subtab-bar');
  bar?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.analyst-subtab') as HTMLElement;
    if (!btn) return;
    const id = btn.dataset.subtab as AnalystSubtab;
    if (!id) return;

    setActiveSubtab(id);
    bar.querySelectorAll('.analyst-subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (content) {
      content.innerHTML = renderSubtab(id);
      initSubtab(id);
    }
  });
}

function initSubtab(id: AnalystSubtab): void {
  switch (id) {
    case 'entities': initEntitySearch(); break;
    case 'timeline': void loadTimeline('24h'); initTimelineControls(); break;
    case 'notepad': initNotepad(); break;
    case 'toolkit': initToolkit(); break;
  }
}

// ── Entity Intel ────────────────────────────────────────────

function initEntitySearch(): void {
  const search = document.getElementById('analystEntitySearch') as HTMLInputElement;
  if (!search) return;

  let timer: ReturnType<typeof setTimeout>;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = search.value.trim();
      if (q.length >= 2) void searchEntities(q);
    }, 300);
  });

  // Auto-load all POI on open
  void searchEntities('');

  const filters = document.querySelectorAll('.analyst-search-filters .analyst-filter-btn');
  filters.forEach(btn => {
    btn.addEventListener('click', () => {
      filters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      void searchEntities(search.value.trim());
    });
  });
}

async function searchEntities(query: string): Promise<void> {
  const results = document.getElementById('analystEntityResults');
  if (!results) return;

  results.innerHTML = '<div class="analyst-searching">Searching...</div>';

  try {
    const resp = await fetch('/api/poi', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const persons: Record<string, unknown>[] = data?.persons || [];

    const q = query.toLowerCase();
    const matches = q ? persons.filter(p => {
      const name = String(p.name || '').toLowerCase();
      const role = String(p.role || '').toLowerCase();
      const country = String(p.country || '').toLowerCase();
      return name.includes(q) || role.includes(q) || country.includes(q);
    }) : persons;

    if (matches.length === 0) {
      results.innerHTML = `<div class="analyst-empty-state">
        <span class="analyst-empty-icon">🔍</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">No results${q ? ' for "' + esc(q) + '"' : ''}</div>
          <div class="analyst-empty-hint">Try a different search term or check the POI seed.</div>
        </div>
      </div>`;
      return;
    }

    results.innerHTML = matches.slice(0, 30).map(p => {
      const name = String(p.name || 'Unknown');
      const role = String(p.role || '');
      const country = String(p.country || '');
      const threat = String(p.threatLevel || 'low');
      const mentions = Number(p.mentions || 0);
      const initials = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
      const colors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#d4a843', low: '#22c55e' };
      const c = colors[threat] || colors.low;

      return `<div class="analyst-entity-card">
        <div class="analyst-entity-avatar" style="background:${c}20;color:${c};border-color:${c}40">${initials}</div>
        <div class="analyst-entity-info">
          <div class="analyst-entity-name">${esc(name)}</div>
          <div class="analyst-entity-role">${esc(role)}${country ? ' · ' + esc(country) : ''}</div>
        </div>
        <div class="analyst-entity-stats">
          <span class="analyst-entity-threat" style="color:${c}">${threat.toUpperCase()}</span>
          <span class="analyst-entity-mentions">${mentions} mentions</span>
        </div>
      </div>`;
    }).join('');
  } catch {
    results.innerHTML = `<div class="analyst-empty-state">
      <span class="analyst-empty-icon">⚠</span>
      <div class="analyst-empty-text">
        <div class="analyst-empty-title">Entity data unavailable</div>
        <div class="analyst-empty-hint">The POI endpoint returned an error. Ensure the seed has run.</div>
      </div>
    </div>`;
  }
}

// ── Timeline ────────────────────────────────────────────────

function initTimelineControls(): void {
  const controls = document.querySelectorAll('.analyst-timeline-controls .analyst-filter-btn');
  controls.forEach(btn => {
    btn.addEventListener('click', () => {
      controls.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = (btn as HTMLElement).dataset.range || '24h';
      void loadTimeline(range);
    });
  });
  document.getElementById('timelineRefreshBtn')?.addEventListener('click', () => {
    const active = document.querySelector('.analyst-timeline-controls .analyst-filter-btn.active') as HTMLElement;
    void loadTimeline(active?.dataset.range || '24h');
  });
}

async function loadTimeline(_range: string): Promise<void> {
  const view = document.getElementById('analystTimelineView');
  if (!view) return;
  view.innerHTML = '<div class="analyst-searching">Loading events...</div>';

  try {
    // Fetch from multiple existing sources in parallel
    const [newsResp, insightsResp] = await Promise.all([
      fetch('/api/news/headlines?limit=30', { signal: AbortSignal.timeout(6000) }).catch(() => null),
      fetch('/api/insights', { signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);

    const events: { time: number; source: string; title: string; severity: string }[] = [];

    if (newsResp?.ok) {
      const news = await newsResp.json();
      const items = news?.items || news?.headlines || news || [];
      for (const item of (items as Record<string, unknown>[]).slice(0, 20)) {
        events.push({
          time: Number(item.timestamp || item.pubDate || Date.now()),
          source: String(item.source || 'News'),
          title: String(item.title || ''),
          severity: String(item.severity || item.threatLevel || 'low'),
        });
      }
    }

    if (insightsResp?.ok) {
      const insights = await insightsResp.json();
      const brief = insights?.worldBrief || insights?.brief || '';
      if (brief) {
        events.push({ time: Date.now(), source: 'AI Insights', title: String(brief).slice(0, 200), severity: 'info' });
      }
    }

    if (events.length === 0) {
      view.innerHTML = '<div class="analyst-empty-state"><span class="analyst-empty-icon">📊</span><div class="analyst-empty-text"><div class="analyst-empty-title">No events in this timeframe</div></div></div>';
      return;
    }

    events.sort((a, b) => b.time - a.time);
    const sevColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#d4a843', low: '#22c55e', info: '#5b8dd9' };

    view.innerHTML = events.map(ev => {
      const c = sevColors[ev.severity] || sevColors.low;
      const age = formatAge(ev.time);
      return `<div style="display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28)">
        <div style="width:3px;border-radius:2px;background:${c};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:500;color:var(--text);line-height:1.4">${esc(ev.title)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
            <span style="color:${c}">${esc(ev.source)}</span> · ${age}
          </div>
        </div>
      </div>`;
    }).join('');
  } catch {
    view.innerHTML = '<div class="analyst-empty-state"><span class="analyst-empty-icon">⚠</span><div class="analyst-empty-text"><div class="analyst-empty-title">Timeline data unavailable</div></div></div>';
  }
}

// ── Notepad ─────────────────────────────────────────────────

function initNotepad(): void {
  const editor = document.getElementById('analystNotepadEditor') as HTMLTextAreaElement;
  const status = document.getElementById('analystNotepadStatus');
  if (!editor) return;

  let timer: ReturnType<typeof setTimeout>;
  editor.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      localStorage.setItem('worldmonitor-analyst-notes', editor.value);
      if (status) { status.textContent = 'Saved'; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
    }, 3000);
  });

  document.getElementById('analystNotepadClear')?.addEventListener('click', () => {
    if (confirm('Clear all notes?')) { editor.value = ''; localStorage.removeItem('worldmonitor-analyst-notes'); }
  });

  document.getElementById('analystNotepadExport')?.addEventListener('click', () => {
    if (!editor.value.trim()) return;
    const blob = new Blob([editor.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analyst-notes-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── OSINT Toolkit ───────────────────────────────────────────

function initToolkit(): void {
  const grid = document.getElementById('analystToolkitGrid');
  const search = document.getElementById('analystToolkitSearch') as HTMLInputElement;
  if (!grid) return;

  // Card click → open tool
  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.analyst-tool-card') as HTMLElement;
    if (!card) return;
    const idx = parseInt(card.dataset.idx || '0', 10);
    const tool = TOOLS[idx];
    if (!tool) return;

    if (tool.builtin) {
      openBuiltinTool(tool);
    } else if (tool.embed) {
      openIframeTool(tool);
    } else {
      window.open(tool.url, '_blank', 'noopener');
    }
  });

  // Search
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll('.analyst-tool-card').forEach(card => {
      const el = card as HTMLElement;
      const text = el.textContent?.toLowerCase() || '';
      el.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  });

  // Category filter
  document.getElementById('toolkitCatFilters')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.analyst-filter-btn') as HTMLElement;
    if (!btn) return;
    const cat = btn.dataset.cat || 'all';
    document.querySelectorAll('#toolkitCatFilters .analyst-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    grid.querySelectorAll('.analyst-tool-card').forEach(card => {
      const el = card as HTMLElement;
      el.style.display = (cat === 'all' || el.dataset.cat === cat) ? '' : 'none';
    });
  });

  // Close buttons
  document.getElementById('toolFrameClose')?.addEventListener('click', closeToolFrame);
  document.getElementById('builtinToolClose')?.addEventListener('click', closeBuiltinTool);
}

function openIframeTool(tool: ToolDef): void {
  closeBuiltinTool();
  const wrap = document.getElementById('toolFrameWrap');
  const frame = document.getElementById('toolFrame') as HTMLIFrameElement;
  const title = document.getElementById('toolFrameTitle');
  if (!wrap || !frame) return;
  if (title) title.textContent = `${tool.icon} ${tool.name}`;
  frame.src = tool.url;
  wrap.style.display = 'block';
}

function closeToolFrame(): void {
  const wrap = document.getElementById('toolFrameWrap');
  const frame = document.getElementById('toolFrame') as HTMLIFrameElement;
  if (wrap) wrap.style.display = 'none';
  if (frame) frame.src = 'about:blank';
}

function openBuiltinTool(tool: ToolDef): void {
  closeToolFrame();
  const wrap = document.getElementById('builtinToolWrap');
  const body = document.getElementById('builtinToolBody');
  const title = document.getElementById('builtinToolTitle');
  if (!wrap || !body) return;
  if (title) title.textContent = `${tool.icon} ${tool.name}`;
  body.innerHTML = renderBuiltinTool(tool.builtin || '');
  wrap.style.display = 'block';
  initBuiltinTool(tool.builtin || '');
}

function closeBuiltinTool(): void {
  const wrap = document.getElementById('builtinToolWrap');
  if (wrap) wrap.style.display = 'none';
}

function renderBuiltinTool(id: string): string {
  const inputStyle = 'font-family:var(--vi-font-body,sans-serif);font-size:13px;padding:8px 12px;background:var(--vi-bg,#0c0c10);border:1px solid var(--vi-border,#252535);border-radius:6px;color:var(--text);width:100%;max-width:400px;outline:none';
  const resultStyle = 'margin-top:10px;padding:10px;background:var(--vi-bg,#0c0c10);border:1px solid var(--vi-border,#252535);border-radius:6px;font-family:var(--vi-font-data,monospace);font-size:11px;color:var(--text);white-space:pre-wrap;max-height:300px;overflow-y:auto';

  switch (id) {
    case 'whois':
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" id="whoisInput" placeholder="Enter domain (e.g. example.com)" style="${inputStyle}" />
        <button class="analyst-btn" id="whoisBtn">Lookup</button>
      </div><div id="whoisResult" style="${resultStyle};display:none"></div>`;
    case 'dns':
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" id="dnsInput" placeholder="Enter domain" style="${inputStyle}" />
        <button class="analyst-btn" id="dnsBtn">Query</button>
      </div><div id="dnsResult" style="${resultStyle};display:none"></div>`;
    case 'ipgeo':
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" id="ipgeoInput" placeholder="Enter IP address" style="${inputStyle}" />
        <button class="analyst-btn" id="ipgeoBtn">Geolocate</button>
      </div><div id="ipgeoResult" style="${resultStyle};display:none"></div>`;
    case 'headers':
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" id="headersInput" placeholder="Enter URL (https://...)" style="${inputStyle}" />
        <button class="analyst-btn" id="headersBtn">Inspect</button>
      </div><div id="headersResult" style="${resultStyle};display:none"></div>`;
    default:
      return '<div>Tool not implemented</div>';
  }
}

function initBuiltinTool(id: string): void {
  switch (id) {
    case 'whois':
      document.getElementById('whoisBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('whoisInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('whoisResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Looking up...';
        try {
          // Use a public WHOIS API
          const resp = await fetch(`https://api.api-ninjas.com/v1/whois?domain=${encodeURIComponent(input)}`);
          if (!resp.ok) throw new Error('Lookup failed');
          const data = await resp.json();
          result.textContent = JSON.stringify(data, null, 2);
        } catch {
          // Fallback: show basic info
          result.textContent = `WHOIS lookup for: ${input}\n\nNote: Direct WHOIS requires a backend proxy.\nTry: https://who.is/whois/${input}`;
        }
      });
      break;
    case 'dns':
      document.getElementById('dnsBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('dnsInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('dnsResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Querying DNS...';
        try {
          const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(input)}&type=A`);
          const data = await resp.json();
          const lines = [`DNS Records for: ${input}\n`];
          if (data.Answer) {
            for (const a of data.Answer) lines.push(`${a.type === 1 ? 'A' : a.type === 5 ? 'CNAME' : a.type === 28 ? 'AAAA' : 'TYPE' + a.type}: ${a.data} (TTL: ${a.TTL})`);
          } else {
            lines.push('No records found');
          }
          // Also try MX
          const mxResp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(input)}&type=MX`);
          const mxData = await mxResp.json();
          if (mxData.Answer) {
            lines.push('\nMX Records:');
            for (const a of mxData.Answer) lines.push(`  MX: ${a.data}`);
          }
          result.textContent = lines.join('\n');
        } catch {
          result.textContent = `DNS query failed for: ${input}`;
        }
      });
      break;
    case 'ipgeo':
      document.getElementById('ipgeoBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('ipgeoInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('ipgeoResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Geolocating...';
        try {
          const resp = await fetch(`https://ipapi.co/${encodeURIComponent(input)}/json/`);
          const data = await resp.json();
          result.textContent = [
            `IP: ${data.ip}`,
            `City: ${data.city}`,
            `Region: ${data.region}`,
            `Country: ${data.country_name} (${data.country_code})`,
            `Lat/Lon: ${data.latitude}, ${data.longitude}`,
            `ISP: ${data.org}`,
            `ASN: ${data.asn}`,
            `Timezone: ${data.timezone}`,
          ].join('\n');
        } catch {
          result.textContent = `Geolocation failed for: ${input}`;
        }
      });
      break;
    case 'headers':
      document.getElementById('headersBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('headersInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('headersResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Fetching headers...';
        try {
          const resp = await fetch(input, { method: 'HEAD', mode: 'no-cors' });
          const lines = [`Headers for: ${input}\n`];
          resp.headers.forEach((v, k) => lines.push(`${k}: ${v}`));
          if (lines.length <= 1) lines.push('(CORS may block header visibility. Try a same-origin URL.)');
          result.textContent = lines.join('\n');
        } catch {
          result.textContent = `Header fetch failed for: ${input}\n\nCORS restrictions may prevent cross-origin requests.`;
        }
      });
      break;
  }
}

// ── View toggling ───────────────────────────────────────────

export function showAnalystView(): void {
  const monitor = document.querySelector('.main-content') as HTMLElement;
  const analyst = document.getElementById(ANALYST_CONTAINER_ID);
  const presetBar = document.getElementById('presetBar');
  if (monitor) monitor.style.display = 'none';
  if (analyst) analyst.style.display = 'flex';
  if (presetBar) presetBar.style.display = 'none';
}

export function showMonitorView(): void {
  const monitor = document.querySelector('.main-content') as HTMLElement;
  const analyst = document.getElementById(ANALYST_CONTAINER_ID);
  const presetBar = document.getElementById('presetBar');
  if (monitor) monitor.style.display = '';
  if (analyst) analyst.style.display = 'none';
  if (presetBar) presetBar.style.display = '';
}

// ── Utilities ───────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAge(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
