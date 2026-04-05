/**
 * Analyst Tab — Primary navigation tab for investigation mode
 *
 * When active, hides the main dashboard (map + panels) and shows
 * a full-screen investigation workspace with 5 functional sub-tabs:
 *   1. Entity Intel — POI search with profile cards
 *   2. Link Graph — Force-directed entity relationship graph (FIXED)
 *   3. Timeline — Cross-source event correlation
 *   4. Notepad — Auto-saving markdown scratchpad
 *   5. OSINT Toolkit — Embedded tools (iframes + built-in utilities)
 */

import {
  D3LinkGraph,
  addNodeToGraph,
  addLinkToGraph,
  clearStoredGraph,
  getStoredGraph,
  startAutoDiscovery,
  stopAutoDiscovery,
  type GraphNode,
  type GraphData,
} from '../utils/D3LinkGraph';

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
  return `<div class="analyst-pane" data-pane="graph" style="display:flex;flex-direction:column;height:100%">
    <div class="analyst-pane-header" style="flex-shrink:0">
      <h2 class="analyst-pane-title">Intelligence Link Graph</h2>
      <div class="analyst-graph-toolbar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <select class="analyst-graph-category" id="analystGraphCategory" style="font-size:11px;padding:4px 6px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:4px;color:var(--text,#e5e7eb)">
          <option value="Person">👤 Person</option>
          <option value="Organization">🏢 Organization</option>
          <option value="Country">🌍 Country</option>
          <option value="Event">⚡ Event</option>
          <option value="Location">📍 Location</option>
        </select>
        <input type="text" class="analyst-graph-input" id="analystGraphInput" placeholder="Entity name..." spellcheck="false"
          style="flex:1;min-width:120px;max-width:220px;font-size:11px;padding:4px 8px;background:var(--vi-bg,#0c0c10);border:1px solid var(--vi-border,#252535);border-radius:4px;color:var(--text,#e5e7eb);outline:none" />
        <button class="analyst-btn" id="analystGraphAddBtn" style="white-space:nowrap">+ Add</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystGraphLoadApiBtn" style="font-size:10px;white-space:nowrap" title="Load full entity graph from Neo4j/Redis">⬇ Load Neo4j</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystGraphClearBtn" style="font-size:10px">Clear</button>
        <span id="analystGraphStatus" style="font-size:9px;color:var(--text-muted,#666);font-family:'JetBrains Mono',monospace;margin-left:4px"></span>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
        <span style="font-size:9px;color:#f59e0b">● Person</span>
        <span style="font-size:9px;color:#3b82f6">● Org</span>
        <span style="font-size:9px;color:#8b5cf6">● Country</span>
        <span style="font-size:9px;color:#ef4444">● Event</span>
        <span style="font-size:9px;color:#10b981">● Location</span>
        <span style="font-size:9px;color:var(--text-muted,#666);margin-left:8px">— manual &nbsp; - - inferred &nbsp; auto-links in green</span>
      </div>
    </div>
    <div id="analystGraphCanvasWrap" style="flex:1;position:relative;overflow:hidden;background:#060608;border-radius:0 0 6px 6px">
      <div id="analystGraphCanvas" style="width:100%;height:100%"></div>
      <div id="analystGraphEmptyState" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <div class="analyst-empty-state" style="text-align:center">
          <span class="analyst-empty-icon">🕸</span>
          <div class="analyst-empty-text">
            <div class="analyst-empty-title">Intelligence link graph is empty</div>
            <div class="analyst-empty-hint">Add entities manually above, click map pins, or load from Neo4j.<br>Once you add 2+ nodes, the engine auto-discovers related entities in the background.</div>
          </div>
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
  embed: boolean;
  builtin?: string;
}

const TOOLS: ToolDef[] = [
  // ── Lookup ──────────────────────────────────────
  { name: 'WHOIS Lookup', url: '', desc: 'Domain registration & ownership data', cat: 'lookup', icon: '🔍', embed: false, builtin: 'whois' },
  { name: 'DNS Lookup', url: '', desc: 'DNS record query (A, MX, NS, TXT)', cat: 'lookup', icon: '🌐', embed: false, builtin: 'dns' },
  { name: 'IP Geolocation', url: '', desc: 'Geolocate any IP address with ISP/ASN', cat: 'lookup', icon: '📍', embed: false, builtin: 'ipgeo' },
  { name: 'Subnet Calculator', url: '', desc: 'CIDR range calculator & IP breakdown', cat: 'lookup', icon: '🧮', embed: false, builtin: 'subnet' },
  { name: 'HTTP Headers', url: '', desc: 'Inspect HTTP response headers for any URL', cat: 'lookup', icon: '📋', embed: false, builtin: 'httpheaders' },
  // ── Maritime (map layer + in-tab search) ────────
  { name: 'Vessel Tracker', url: '', desc: 'Live AIS vessel positions — search by name or MMSI', cat: 'maritime', icon: '🚢', embed: false, builtin: 'vessels' },
  { name: 'Chokepoint Monitor', url: '', desc: 'Strait & canal transit flow data', cat: 'maritime', icon: '⚓', embed: false, builtin: 'chokepoints' },
  { name: 'Submarine Cables', url: '', desc: 'Global undersea cable infrastructure', cat: 'maritime', icon: '🔌', embed: false, builtin: 'cables' },
  // ── Aviation (map layer + in-tab search) ────────
  { name: 'Flight Tracker', url: '', desc: 'Live ADS-B aircraft — search by callsign or hex', cat: 'aviation', icon: '✈️', embed: false, builtin: 'flights' },
  { name: 'Military Flights', url: '', desc: 'Military & government aircraft tracker', cat: 'aviation', icon: '🛩️', embed: false, builtin: 'milflights' },
  // ── Geospatial (map layer + summary) ────────────
  { name: 'Conflict Zones', url: '', desc: 'Active conflict hotspots on the map', cat: 'geo', icon: '⚔️', embed: false, builtin: 'conflicts' },
  { name: 'GPS Jamming', url: '', desc: 'GPS interference detection heatmap', cat: 'geo', icon: '📡', embed: false, builtin: 'gpsjam' },
  { name: 'Nuclear Facilities', url: '', desc: 'Nuclear installations worldwide', cat: 'geo', icon: '☢️', embed: false, builtin: 'nuclear' },
  { name: 'Military Bases', url: '', desc: 'Known military installations', cat: 'geo', icon: '🏛', embed: false, builtin: 'bases' },
  { name: 'Fire Detections', url: '', desc: 'NASA FIRMS satellite fire data', cat: 'geo', icon: '🔥', embed: false, builtin: 'fires' },
  { name: 'Earthquake Monitor', url: '', desc: 'Recent seismic events worldwide', cat: 'geo', icon: '🌍', embed: false, builtin: 'earthquakes' },
  { name: 'Satellite Tracker', url: '', desc: 'Active satellite positions (TLE data)', cat: 'geo', icon: '🛰', embed: false, builtin: 'satellites' },
  // ── Intelligence (in-tab search/browse) ─────────
  { name: 'Intel Search', url: '', desc: 'Semantic search across all intelligence data', cat: 'intel', icon: '🔎', embed: false, builtin: 'intelsearch' },
  { name: 'POI Lookup', url: '', desc: 'Search persons of interest profiles', cat: 'intel', icon: '👤', embed: false, builtin: 'poilookup' },
  { name: 'Cross-Source Signals', url: '', desc: 'Multi-domain signal correlation feed', cat: 'intel', icon: '🔺', embed: false, builtin: 'signals' },
  // ── Cyber (in-tab) ──────────────────────────────
  { name: 'Threat Feed', url: '', desc: 'Active cyber threat intelligence feed', cat: 'cyber', icon: '🛡', embed: false, builtin: 'threatfeed' },
  { name: 'Breach Checker', url: '', desc: 'Check if an email appeared in known breaches', cat: 'cyber', icon: '🔓', embed: false, builtin: 'breach' },
];

function renderToolkitCards(): string {
  return TOOLS.map((t, i) =>
    `<div class="analyst-tool-card" data-cat="${t.cat}" data-idx="${i}" style="cursor:pointer">
      <div class="analyst-tool-icon">${t.icon}</div>
      <div class="analyst-tool-info">
        <div class="analyst-tool-name">${t.name}</div>
        <div class="analyst-tool-desc">${t.desc}</div>
      </div>
      <span class="analyst-tool-cat">${t.cat}</span>
      <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:var(--intel-accent-subtle);color:var(--intel-accent)">⚡ Run</span>
    </div>`
  ).join('');
}

// ── Initialization ──────────────────────────────────────────

export function initAnalystWorkspace(): void {
  const ws = document.getElementById(ANALYST_CONTAINER_ID);
  if (!ws) return;

  const content = document.getElementById('analystContent');
  if (content) {
    content.innerHTML = renderSubtab(getActiveSubtab());
    initSubtab(getActiveSubtab());
  }

  const bar = ws.querySelector('.analyst-subtab-bar');
  bar?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.analyst-subtab') as HTMLElement;
    if (!btn) return;
    const id = btn.dataset.subtab as AnalystSubtab;
    if (!id) return;

    // Stop auto-discovery when leaving graph tab
    if (getActiveSubtab() === 'graph' && id !== 'graph') {
      stopAutoDiscovery();
    }

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
    case 'graph': initLinkGraph(); break;  // ← THE MISSING CASE — now fixed
    case 'timeline': void loadTimeline('24h'); initTimelineControls(); break;
    case 'notepad': initNotepad(); break;
    case 'toolkit': initToolkit(); break;
  }
}

// ── Link Graph ──────────────────────────────────────────────

let graphInstance: D3LinkGraph | null = null;

function setGraphStatus(msg: string, color = '#666'): void {
  const el = document.getElementById('analystGraphStatus');
  if (el) {
    el.textContent = msg;
    el.style.color = color;
  }
}

function updateEmptyState(nodeCount: number): void {
  const empty = document.getElementById('analystGraphEmptyState');
  if (empty) empty.style.display = nodeCount === 0 ? 'flex' : 'none';
}

function addManualNode(label: string, type: string): void {
  if (!label.trim()) return;
  const id = `${type.toLowerCase()}-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  const node: GraphNode = {
    id,
    label: label.trim(),
    type: type as GraphNode['type'],
    source: 'manual',
    confidence: 1,
    lastSeen: Date.now(),
  };

  addNodeToGraph(node);

  const stored = getStoredGraph();
  updateEmptyState(stored.nodes.length);

  if (graphInstance) {
    graphInstance.addToGraph([node], []);
  } else {
    mountGraph(stored);
  }

  setGraphStatus(`Added: ${label}`, '#22c55e');
  setTimeout(() => setGraphStatus(`${stored.nodes.length} nodes · auto-discovering...`), 2000);
}

function mountGraph(data: GraphData): void {
  const canvas = document.getElementById('analystGraphCanvas');
  if (!canvas) return;

  if (graphInstance) {
    graphInstance.destroy();
    graphInstance = null;
  }

  if (data.nodes.length === 0) {
    updateEmptyState(0);
    return;
  }

  try {
    graphInstance = new D3LinkGraph('analystGraphCanvas');
    graphInstance.render(data.nodes, data.links);
    updateEmptyState(data.nodes.length);
    setGraphStatus(`${data.nodes.length} nodes · ${data.links.length} links`);
  } catch (err) {
    console.error('[LinkGraph] Mount error:', err);
    setGraphStatus('Render error — see console', '#ef4444');
  }
}

function initLinkGraph(): void {
  // Load persisted graph from localStorage and render it
  const stored = getStoredGraph();
  mountGraph(stored);

  // ── Add button ────────────────────────────────────────────
  const addBtn = document.getElementById('analystGraphAddBtn');
  const input = document.getElementById('analystGraphInput') as HTMLInputElement;
  const categorySelect = document.getElementById('analystGraphCategory') as HTMLSelectElement;

  function handleAdd(): void {
    const label = input?.value.trim();
    const type = categorySelect?.value || 'Person';
    if (!label) {
      input?.focus();
      return;
    }
    addManualNode(label, type);
    if (input) input.value = '';
    input?.focus();
  }

  addBtn?.addEventListener('click', handleAdd);

  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleAdd();
  });

  // ── Clear button ──────────────────────────────────────────
  document.getElementById('analystGraphClearBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all nodes and links from the graph?')) return;
    clearStoredGraph();
    stopAutoDiscovery();
    if (graphInstance) {
      graphInstance.destroy();
      graphInstance = null;
    }
    updateEmptyState(0);
    setGraphStatus('');
  });

  // ── Load from Neo4j/Redis ─────────────────────────────────
  document.getElementById('analystGraphLoadApiBtn')?.addEventListener('click', async () => {
    setGraphStatus('Loading from Neo4j...', '#f59e0b');
    try {
      const res = await fetch('/api/intelligence/entity-graph', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as GraphData;

      if (!data.nodes || data.nodes.length === 0) {
        setGraphStatus('Neo4j graph is empty — run the entity seed first', '#ef4444');
        return;
      }

      // Tag all API nodes with source
      const taggedNodes: GraphNode[] = (data.nodes || []).map(n => ({ ...n, source: 'api' as const, confidence: n.confidence ?? 0.9 }));
      const taggedLinks = (data.links || []).map(l => ({ ...l, source_type: 'api' as const }));

      // Merge into local store (don't overwrite manual nodes)
      const current = getStoredGraph();
      const existingIds = new Set(current.nodes.map(n => n.id));

      for (const n of taggedNodes) {
        if (!existingIds.has(n.id)) {
          addNodeToGraph(n);
          existingIds.add(n.id);
        }
      }
      for (const l of taggedLinks) {
        addLinkToGraph(l);
      }

      const fresh = getStoredGraph();
      mountGraph(fresh);
      setGraphStatus(`Loaded ${taggedNodes.length} nodes from Neo4j`, '#22c55e');
      setTimeout(() => setGraphStatus(`${fresh.nodes.length} nodes · auto-discovering...`), 3000);

      // Start auto-discovery now that we have nodes
      startAutoDiscovery((updated) => {
        if (graphInstance) graphInstance.addToGraph(updated.nodes, updated.links);
        setGraphStatus(`${updated.nodes.length} nodes · ${updated.links.length} links (live)`);
      });
    } catch (err) {
      console.error('[LinkGraph] API load error:', err);
      setGraphStatus('Failed to load from Neo4j — is the entity seed running?', '#ef4444');
    }
  });

  // ── Map-click → add node ──────────────────────────────────
  // Listen for the custom event dispatched by POIMapLayer and other map layers
  // when a user clicks a feature. Format: { name, type, country }
  function handleMapFeatureClick(e: Event): void {
    const detail = (e as CustomEvent).detail as { name?: string; type?: string; country?: string; role?: string } | undefined;
    if (!detail?.name) return;

    const label = detail.name;
    const type = (detail.type as GraphNode['type']) || 'Person';
    const id = `${type.toLowerCase()}-${label.toLowerCase().replace(/\s+/g, '-')}`;

    const stored = getStoredGraph();
    if (stored.nodes.find(n => n.id === id)) {
      setGraphStatus(`Already in graph: ${label}`, '#f59e0b');
      return;
    }

    const node: GraphNode = {
      id,
      label,
      type,
      source: 'map-click',
      confidence: 0.9,
      country: detail.country,
      lastSeen: Date.now(),
    };

    addNodeToGraph(node);
    const updated = getStoredGraph();
    updateEmptyState(updated.nodes.length);

    if (graphInstance) {
      graphInstance.addToGraph([node], []);
    } else {
      mountGraph(updated);
    }

    setGraphStatus(`Added from map: ${label}`, '#22c55e');
    setTimeout(() => setGraphStatus(`${updated.nodes.length} nodes · auto-discovering...`), 2000);
  }

  window.addEventListener('wm:map-feature-click', handleMapFeatureClick);

  // Clean up listener when subtab changes (via MutationObserver on parent)
  const pane = document.querySelector('[data-pane="graph"]');
  if (pane) {
    const obs = new MutationObserver(() => {
      if (!document.body.contains(pane)) {
        window.removeEventListener('wm:map-feature-click', handleMapFeatureClick);
        stopAutoDiscovery();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── Start auto-discovery if we already have nodes ─────────
  if (stored.nodes.length >= 1) {
    startAutoDiscovery((updated) => {
      if (graphInstance) graphInstance.addToGraph(updated.nodes, updated.links);
      const n = getStoredGraph();
      setGraphStatus(`${n.nodes.length} nodes · ${n.links.length} links (live)`);
    });
    setGraphStatus(`${stored.nodes.length} nodes · auto-discovering...`);
  } else {
    setGraphStatus('Empty — add an entity to begin');
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
      const c = colors[threat] ?? colors['low'] ?? '#22c55e';

      return `<div class="analyst-entity-card" data-name="${esc(name)}" data-country="${esc(country)}" style="cursor:pointer" title="Click to add to Link Graph">
        <div class="analyst-entity-avatar" style="background:${c}20;color:${c};border-color:${c}40">${initials}</div>
        <div class="analyst-entity-info">
          <div class="analyst-entity-name">${esc(name)}</div>
          <div class="analyst-entity-role">${esc(role)}${country ? ' · ' + esc(country) : ''}</div>
        </div>
        <div class="analyst-entity-stats">
          <span class="analyst-entity-threat" style="color:${c}">${threat.toUpperCase()}</span>
          <span class="analyst-entity-mentions">${mentions} mentions</span>
          <span style="font-size:9px;color:var(--text-muted,#666)">+Graph</span>
        </div>
      </div>`;
    }).join('');

    // Click entity card → add to link graph
    results.querySelectorAll('.analyst-entity-card').forEach(card => {
      card.addEventListener('click', () => {
        const el = card as HTMLElement;
        const name = el.dataset.name || '';
        const country = el.dataset.country;
        if (!name) return;
        const id = `person-${name.toLowerCase().replace(/\s+/g, '-')}`;
        const node: GraphNode = {
          id,
          label: name,
          type: 'Person',
          source: 'manual',
          confidence: 1,
          country,
          lastSeen: Date.now(),
          mentions: 0,
        };
        addNodeToGraph(node);
        // Fire the map-click event so graph tab picks it up even if open
        window.dispatchEvent(new CustomEvent('wm:map-feature-click', { detail: { name, type: 'Person', country } }));
        el.style.outline = '1px solid #22c55e';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      });
    });
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
      const c = sevColors[ev.severity] ?? sevColors['low'] ?? '#22c55e';
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

  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.analyst-tool-card') as HTMLElement;
    if (!card) return;
    const idx = parseInt(card.dataset.idx || '0', 10);
    const tool = TOOLS[idx];
    if (!tool) return;
    if (tool.builtin) {
      openBuiltinTool(tool);
    }
  });

  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll('.analyst-tool-card').forEach(card => {
      const el = card as HTMLElement;
      const text = el.textContent?.toLowerCase() || '';
      el.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  });

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

  document.getElementById('builtinToolClose')?.addEventListener('click', closeBuiltinTool);
}

function openBuiltinTool(tool: ToolDef): void {
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
  const searchInput = (inputId: string, placeholder: string, btnId: string, btnText: string) =>
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
    '<input type="text" id="' + inputId + '" placeholder="' + placeholder + '" style="' + inputStyle + '" />' +
    '<button class="analyst-btn" id="' + btnId + '">' + btnText + '</button>' +
    '</div><div id="' + inputId + 'Result" style="' + resultStyle + ';display:none"></div>';
  const layerToggle = (layerName: string, label: string) =>
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
    '<button class="analyst-btn" id="layerToggle_' + layerName + '">Toggle ' + label + ' Layer on Map</button>' +
    '<span id="layerStatus_' + layerName + '" style="font-size:10px;color:var(--text-muted)"></span>' +
    '</div>';
  const autoFeed = (feedId: string) =>
    '<div id="' + feedId + '" style="' + resultStyle + '">Loading...</div>';

  switch (id) {
    case 'whois': return searchInput('whoisInput', 'Enter domain (e.g. example.com)', 'whoisBtn', 'Lookup');
    case 'dns': return searchInput('dnsInput', 'Enter domain', 'dnsBtn', 'Query');
    case 'ipgeo': return searchInput('ipgeoInput', 'Enter IP address (or leave blank for yours)', 'ipgeoBtn', 'Geolocate');
    case 'subnet': return searchInput('subnetInput', 'Enter CIDR (e.g. 192.168.1.0/24)', 'subnetBtn', 'Calculate');
    case 'httpheaders': return searchInput('httpInput', 'Enter URL (e.g. https://example.com)', 'httpBtn', 'Inspect');
    // Maritime
    case 'vessels': return layerToggle('ais', 'AIS Vessel') + searchInput('vesselInput', 'Search vessel name, MMSI, or flag...', 'vesselBtn', 'Search');
    case 'chokepoints': return autoFeed('chokepointFeed');
    case 'cables': return layerToggle('cables', 'Submarine Cable') + autoFeed('cableFeed');
    // Aviation
    case 'flights': return layerToggle('flights', 'Aircraft') + searchInput('flightInput', 'Search callsign, hex ID, or type...', 'flightBtn', 'Search');
    case 'milflights': return layerToggle('flights', 'Military Flights') + autoFeed('milflightFeed');
    // Geo
    case 'conflicts': return layerToggle('conflicts', 'Conflict') + autoFeed('conflictFeed');
    case 'gpsjam': return layerToggle('gpsJamming', 'GPS Jamming') + autoFeed('gpsjamFeed');
    case 'nuclear': return layerToggle('nuclear', 'Nuclear') + autoFeed('nuclearFeed');
    case 'bases': return layerToggle('bases', 'Military Base') + autoFeed('basesFeed');
    case 'fires': return layerToggle('fires', 'Fire Detection') + autoFeed('firesFeed');
    case 'earthquakes': return autoFeed('earthquakeFeed');
    case 'satellites': return layerToggle('satellites', 'Satellite') + autoFeed('satelliteFeed');
    // Intel
    case 'intelsearch': return searchInput('intelInput', 'Natural language search (e.g. "missile strikes Ukraine")', 'intelBtn', 'Search');
    case 'poilookup': return searchInput('poiInput', 'Search person name, role, or country...', 'poiBtn', 'Search');
    case 'signals': return autoFeed('signalsFeed');
    // Cyber
    case 'threatfeed': return autoFeed('threatFeed');
    case 'breach': return searchInput('breachInput', 'Enter email address', 'breachBtn', 'Check');
    default: return '<div style="padding:12px;color:var(--text-dim)">Tool not implemented</div>';
  }
}

// Helper: toggle a map layer via custom event and update status label
function toggleMapLayer(layerName: string): void {
  window.dispatchEvent(new CustomEvent('wm:toggle-layer', { detail: { layer: layerName, enabled: true } }));
  const status = document.getElementById('layerStatus_' + layerName);
  if (status) { status.textContent = '✅ Layer activated'; setTimeout(() => { if (status) status.textContent = ''; }, 3000); }
}

// Helper: fetch JSON and render into a feed div
async function loadFeed(feedId: string, url: string, renderFn: (data: Record<string, unknown>) => string): Promise<void> {
  const el = document.getElementById(feedId);
  if (!el) return;
  el.textContent = 'Loading...';
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    el.innerHTML = renderFn(data as Record<string, unknown>);
  } catch (err) {
    el.textContent = 'Failed to load: ' + ((err as Error).message || 'unknown');
  }
}

function initBuiltinTool(id: string): void {
  // Wire map layer toggle buttons
  const layerBtn = document.querySelector('[id^="layerToggle_"]') as HTMLButtonElement;
  if (layerBtn) {
    const ln = layerBtn.id.replace('layerToggle_', '');
    layerBtn.addEventListener('click', () => toggleMapLayer(ln));
  }

  switch (id) {
    case 'whois':
      document.getElementById('whoisBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('whoisInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('whoisInputResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Looking up...';
        try {
          const resp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(input) + '&type=SOA');
          const data = await resp.json();
          const lines = ['Domain: ' + input + '\n'];
          if (data.Answer) { for (const a of data.Answer as Array<{ data: string; TTL: number }>) { lines.push('SOA: ' + a.data); lines.push('TTL: ' + a.TTL + 's'); } }
          const nsResp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(input) + '&type=NS');
          const nsData = await nsResp.json();
          if (nsData.Answer) { lines.push('\nNameservers:'); for (const a of nsData.Answer as Array<{ data: string }>) lines.push('  NS: ' + a.data); }
          lines.push('\nFull WHOIS: https://who.is/whois/' + input);
          result.textContent = lines.join('\n');
        } catch { result.textContent = 'Lookup failed for: ' + input; }
      });
      break;
    case 'dns':
      document.getElementById('dnsBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('dnsInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('dnsInputResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Querying DNS...';
        try {
          const typeMap: Record<number, string> = { 1: 'A', 5: 'CNAME', 15: 'MX', 28: 'AAAA', 16: 'TXT', 2: 'NS' };
          const lines = ['DNS Records for: ' + input + '\n'];
          for (const qtype of ['A', 'AAAA', 'MX', 'NS', 'TXT']) {
            const resp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(input) + '&type=' + qtype);
            const data = await resp.json();
            if (data.Answer && (data.Answer as Array<{ type: number; data: string; TTL: number }>).length > 0) {
              lines.push(qtype + ' Records:');
              for (const a of data.Answer as Array<{ type: number; data: string; TTL: number }>) { lines.push('  ' + (typeMap[a.type] || 'TYPE' + a.type) + ': ' + a.data + ' (TTL: ' + a.TTL + ')'); }
              lines.push('');
            }
          }
          if (lines.length <= 1) lines.push('No records found');
          result.textContent = lines.join('\n');
        } catch { result.textContent = 'DNS query failed for: ' + input; }
      });
      break;
    case 'ipgeo':
      document.getElementById('ipgeoBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('ipgeoInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('ipgeoInputResult');
        if (!result) return;
        result.style.display = 'block';
        result.textContent = 'Geolocating...';
        try {
          const resp = await fetch('http://ip-api.com/json/' + encodeURIComponent(input || '') + '?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query');
          const data = await resp.json() as Record<string, unknown>;
          if (data.status === 'fail') { result.textContent = 'Geolocation failed: ' + String(data.message || 'Unknown'); return; }
          result.textContent = ['IP: ' + data.query, 'City: ' + data.city, 'Region: ' + data.regionName + ' (' + data.region + ')', 'Country: ' + data.country + ' (' + data.countryCode + ')', 'Coordinates: ' + data.lat + ', ' + data.lon, 'Timezone: ' + data.timezone, 'ISP: ' + data.isp, 'Org: ' + data.org, 'ASN: ' + data.as].join('\n');
        } catch { result.textContent = 'Geolocation failed for: ' + (input || 'your IP'); }
      });
      break;
    case 'subnet':
      document.getElementById('subnetBtn')?.addEventListener('click', () => {
        const input = (document.getElementById('subnetInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('subnetInputResult');
        if (!input || !result) return;
        result.style.display = 'block';
        try {
          const [ipStr, prefixStr] = input.split('/');
          if (!ipStr || !prefixStr) throw new Error('bad');
          const prefix = parseInt(prefixStr, 10);
          if (isNaN(prefix) || prefix < 0 || prefix > 32) throw new Error('bad');
          const octets = ipStr.split('.').map(Number);
          if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) throw new Error('bad');
          const ipNum = ((octets[0] ?? 0) << 24) | ((octets[1] ?? 0) << 16) | ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
          const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
          const network = (ipNum & mask) >>> 0;
          const broadcast = (network | ~mask) >>> 0;
          const toIP = (n: number) => ((n >>> 24) & 255) + '.' + ((n >>> 16) & 255) + '.' + ((n >>> 8) & 255) + '.' + (n & 255);
          result.textContent = ['CIDR: ' + input, 'Network: ' + toIP(network), 'Broadcast: ' + toIP(broadcast), 'Mask: ' + toIP(mask), 'Range: ' + toIP(network + 1) + ' — ' + toIP(broadcast - 1), 'Hosts: ' + Math.max(0, Math.pow(2, 32 - prefix) - 2).toLocaleString()].join('\n');
        } catch { result.textContent = 'Invalid CIDR notation. Use: 192.168.1.0/24'; }
      });
      break;
    case 'httpheaders':
      document.getElementById('httpBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('httpInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('httpInputResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.textContent = 'Fetching headers...';
        try {
          let url = input;
          if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
          const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(8000) });
          const lines = ['URL: ' + url, 'Status: ' + resp.status + ' ' + resp.statusText, '', 'Headers:'];
          resp.headers.forEach((v, k) => lines.push('  ' + k + ': ' + v));
          if (lines.length <= 4) lines.push('  (CORS blocking — use DevTools Network tab)');
          result.textContent = lines.join('\n');
        } catch (err) { result.textContent = 'Failed: ' + ((err as Error).message || 'unknown') + '\n\nCORS may block this.'; }
      });
      break;

    // ── Maritime ────────────────────────────────────────────────
    case 'vessels':
      document.getElementById('vesselBtn')?.addEventListener('click', async () => {
        const q = (document.getElementById('vesselInput') as HTMLInputElement)?.value.trim().toLowerCase();
        const result = document.getElementById('vesselInputResult');
        if (!q || !result) return;
        result.style.display = 'block';
        result.innerHTML = 'Searching AIS data...';
        try {
          const resp = await fetch('/api/ais-snapshot', { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          const vessels = (data.vessels || []) as Array<Record<string, unknown>>;
          const matches = vessels.filter((v: Record<string, unknown>) => {
            const name = String(v.name || v.shipName || '').toLowerCase();
            const mmsi = String(v.mmsi || '');
            const flag = String(v.flag || v.country || '').toLowerCase();
            return name.includes(q) || mmsi.includes(q) || flag.includes(q);
          }).slice(0, 15);
          if (matches.length === 0) { result.innerHTML = 'No vessels matching "' + esc(q) + '" in current AIS snapshot (' + vessels.length + ' total tracked)'; return; }
          result.innerHTML = matches.map((v: Record<string, unknown>) => '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 0"><b>' + esc(String(v.name || v.shipName || 'Unknown')) + '</b> · MMSI: ' + esc(String(v.mmsi || '—')) + ' · Flag: ' + esc(String(v.flag || v.country || '—')) + '<br><span style="color:var(--text-muted)">Lat: ' + Number(v.lat || 0).toFixed(3) + ' Lon: ' + Number(v.lon || 0).toFixed(3) + ' · Speed: ' + String(v.speed || v.sog || '—') + 'kn · Course: ' + String(v.course || v.cog || '—') + '</span></div>').join('');
        } catch (err) { result.innerHTML = 'AIS search failed: ' + ((err as Error).message || 'unknown'); }
      });
      break;
    case 'chokepoints':
      void loadFeed('chokepointFeed', '/api/supply-chain/chokepoints', (d) => {
        const cps = (d.chokepoints || []) as Array<Record<string, unknown>>;
        if (cps.length === 0) return 'No chokepoint data available';
        return cps.map((c: Record<string, unknown>) => '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 0"><b>' + esc(String(c.name || c.id || '')) + '</b> · Vessels/24h: ' + (c.vessels24h ?? '—') + ' · Tanker %: ' + (typeof c.tankerRatio === 'number' ? (c.tankerRatio * 100).toFixed(0) + '%' : '—') + '</div>').join('');
      });
      break;
    case 'cables':
      void loadFeed('cableFeed', '/api/health', (d) => {
        const check = (d.checks as Record<string, Record<string, unknown>> | undefined)?.cableHealth;
        if (!check) return 'Cable health data: check /api/health for status';
        return 'Cable infrastructure status: ' + (check.status || 'unknown') + '\nRecords: ' + (check.records || 0);
      });
      break;

    // ── Aviation ────────────────────────────────────────────────
    case 'flights':
      document.getElementById('flightBtn')?.addEventListener('click', async () => {
        const q = (document.getElementById('flightInput') as HTMLInputElement)?.value.trim().toLowerCase();
        const result = document.getElementById('flightInputResult');
        if (!q || !result) return;
        result.style.display = 'block';
        result.innerHTML = 'Searching ADS-B data...';
        try {
          const resp = await fetch('/api/adsb', { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          const aircraft = (data.aircraft || data.ac || []) as Array<Record<string, unknown>>;
          const matches = aircraft.filter((a: Record<string, unknown>) => {
            const call = String(a.flight || a.callsign || '').trim().toLowerCase();
            const hex = String(a.hex || '').toLowerCase();
            const type = String(a.t || a.type || '').toLowerCase();
            return call.includes(q) || hex.includes(q) || type.includes(q);
          }).slice(0, 20);
          if (matches.length === 0) { result.innerHTML = 'No aircraft matching "' + esc(q) + '" in current ADS-B snapshot (' + aircraft.length + ' tracked)'; return; }
          result.innerHTML = matches.map((a: Record<string, unknown>) => '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 0"><b>' + esc(String(a.flight || a.callsign || 'Unknown').trim()) + '</b> · Hex: ' + esc(String(a.hex || '—')) + ' · Type: ' + esc(String(a.t || a.type || '—')) + '<br><span style="color:var(--text-muted)">Alt: ' + (a.alt_baro || a.altitude || '—') + 'ft · Speed: ' + (a.gs || a.speed || '—') + 'kn · Lat: ' + Number(a.lat || 0).toFixed(2) + ' Lon: ' + Number(a.lon || 0).toFixed(2) + '</span></div>').join('');
        } catch (err) { result.innerHTML = 'ADS-B search failed: ' + ((err as Error).message || 'unknown'); }
      });
      break;
    case 'milflights':
      void loadFeed('milflightFeed', '/api/military-flights', (d) => {
        const flights = (d.flights || []) as Array<Record<string, unknown>>;
        if (flights.length === 0) return 'No military flights currently tracked';
        return '<div style="margin-bottom:6px;font-weight:600">' + flights.length + ' military aircraft tracked</div>' +
          flights.slice(0, 15).map((f: Record<string, unknown>) => '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:4px 0">' + esc(String(f.callsign || f.flight || 'Unknown').trim()) + ' · ' + esc(String(f.type || f.t || '—')) + ' · Alt: ' + (f.altitude || f.alt_baro || '—') + 'ft</div>').join('');
      });
      break;

    // ── Geospatial ─────────────────────────────────────────────
    case 'conflicts':
      void loadFeed('conflictFeed', '/api/data/gdelt-intel', (d) => {
        const topics = (d.topics || []) as Array<Record<string, unknown>>;
        const mil = topics.find((t: Record<string, unknown>) => t.id === 'military');
        const articles = (mil?.articles || []) as Array<Record<string, unknown>>;
        if (articles.length === 0) return 'No active conflict data';
        return '<div style="margin-bottom:6px;font-weight:600">' + articles.length + ' conflict-related articles</div>' +
          articles.slice(0, 10).map((a: Record<string, unknown>) => '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:4px 0">' + esc(String(a.title || '').slice(0, 100)) + '<br><span style="color:var(--text-muted);font-size:10px">' + esc(String(a.source || a.domain || '')) + '</span></div>').join('');
      });
      break;
    case 'gpsjam':
      void loadFeed('gpsjamFeed', '/api/gpsjam', (d) => {
        const hexes = (d.hexes || []) as Array<Record<string, unknown>>;
        const high = hexes.filter((h: Record<string, unknown>) => h.level === 'high');
        return hexes.length + ' GPS monitoring cells · ' + high.length + ' high-interference zones';
      });
      break;
    case 'nuclear': case 'bases':
      void loadFeed(id === 'nuclear' ? 'nuclearFeed' : 'basesFeed', '/api/health', (d) => {
        const checks = d.checks as Record<string, Record<string, unknown>> | undefined;
        const key = id === 'nuclear' ? 'irradiators' : 'militaryBases';
        const check = checks?.[key];
        return (id === 'nuclear' ? 'Nuclear facility' : 'Military base') + ' data: ' + (check ? check.status + ' (' + (check.records || 0) + ' records)' : 'not available');
      });
      break;
    case 'fires':
      void loadFeed('firesFeed', '/api/health', (d) => {
        const check = (d.checks as Record<string, Record<string, unknown>> | undefined)?.wildfires;
        return 'Fire detection data: ' + (check ? check.status + ' · ' + (check.records || 0) + ' detections' + (check.seedAgeMin != null ? ' · Updated ' + check.seedAgeMin + 'm ago' : '') : 'not available');
      });
      break;
    case 'earthquakes':
      void loadFeed('earthquakeFeed', '/api/bootstrap', (d) => {
        const quakes = ((d.earthquakes as Record<string, unknown>)?.earthquakes || []) as Array<Record<string, unknown>>;
        if (quakes.length === 0) return 'No recent earthquake data';
        return '<div style="margin-bottom:6px;font-weight:600">' + quakes.length + ' recent earthquakes</div>' +
          quakes.slice(0, 10).map((q: Record<string, unknown>) => {
            const mag = Number(q.magnitude || q.mag || 0).toFixed(1);
            const c = Number(mag) >= 6 ? '#ef4444' : Number(mag) >= 4.5 ? '#f97316' : '#22c55e';
            return '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:4px 0"><span style="color:' + c + ';font-weight:700">M' + mag + '</span> ' + esc(String(q.place || q.title || '').slice(0, 80)) + '</div>';
          }).join('');
      });
      break;
    case 'satellites':
      void loadFeed('satelliteFeed', '/api/satellites', (d) => {
        const sats = Array.isArray(d) ? d : (d.satellites || []);
        return (sats as unknown[]).length + ' active satellites in TLE database';
      });
      break;

    // ── Intelligence ───────────────────────────────────────────
    case 'intelsearch':
      document.getElementById('intelBtn')?.addEventListener('click', async () => {
        const q = (document.getElementById('intelInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('intelInputResult');
        if (!q || !result) return;
        result.style.display = 'block';
        result.innerHTML = 'Searching intelligence index...';
        try {
          const resp = await fetch('/api/search?q=' + encodeURIComponent(q) + '&k=15', { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          const results = (data.results || []) as Array<Record<string, unknown>>;
          if (results.length === 0) { result.innerHTML = 'No results for "' + esc(q) + '"'; return; }
          result.innerHTML = results.map((r: Record<string, unknown>) => {
            const score = Number(r.score || 0).toFixed(2);
            const meta = r.metadata as Record<string, unknown> | undefined;
            const title = String(meta?.title || meta?.name || r.id || '');
            const type = String(meta?.type || '');
            return '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 0"><b>' + esc(title.slice(0, 100)) + '</b><br><span style="color:var(--text-muted);font-size:10px">Score: ' + score + ' · Type: ' + esc(type) + '</span></div>';
          }).join('');
        } catch (err) { result.innerHTML = 'Search failed: ' + ((err as Error).message || 'unknown'); }
      });
      break;
    case 'poilookup':
      document.getElementById('poiBtn')?.addEventListener('click', async () => {
        const q = (document.getElementById('poiInput') as HTMLInputElement)?.value.trim().toLowerCase();
        const result = document.getElementById('poiInputResult');
        if (!q || !result) return;
        result.style.display = 'block';
        result.innerHTML = 'Searching POI database...';
        try {
          const resp = await fetch('/api/poi', { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          const persons = (data.persons || []) as Array<Record<string, unknown>>;
          const matches = persons.filter((p: Record<string, unknown>) => {
            return String(p.name || '').toLowerCase().includes(q) || String(p.role || '').toLowerCase().includes(q) || String(p.country || p.region || '').toLowerCase().includes(q);
          }).slice(0, 10);
          if (matches.length === 0) { result.innerHTML = 'No POI matching "' + esc(q) + '" (' + persons.length + ' total tracked)'; return; }
          result.innerHTML = matches.map((p: Record<string, unknown>) => {
            const risk = String(p.riskLevel || p.threatLevel || 'low');
            const c: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#d4a843', low: '#22c55e' };
            return '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 0"><b>' + esc(String(p.name || '')) + '</b> · <span style="color:' + (c[risk] || '#666') + '">' + risk.toUpperCase() + '</span><br><span style="color:var(--text-muted);font-size:10px">' + esc(String(p.role || '')) + (p.country ? ' · ' + esc(String(p.country)) : '') + ' · ' + (p.mentionCount || p.mentions || 0) + ' mentions</span></div>';
          }).join('');
        } catch (err) { result.innerHTML = 'POI search failed: ' + ((err as Error).message || 'unknown'); }
      });
      break;
    case 'signals':
      void loadFeed('signalsFeed', '/api/bootstrap', (d) => {
        const payload = d.crossSourceSignals as Record<string, unknown> | undefined;
        const signals = ((payload?.signals || []) as Array<Record<string, unknown>>);
        if (signals.length === 0) return 'No active cross-source signals';
        const sevColors: Record<string, string> = { CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: '#ef4444', CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: '#f97316', CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: '#d4a843', CROSS_SOURCE_SIGNAL_SEVERITY_LOW: '#22c55e' };
        return '<div style="margin-bottom:6px;font-weight:600">' + signals.length + ' active signals</div>' +
          signals.slice(0, 15).map((s: Record<string, unknown>) => {
            const c = sevColors[String(s.severity || '')] || '#666';
            return '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:5px 0;border-left:3px solid ' + c + ';padding-left:8px"><span style="font-size:11px">' + esc(String(s.summary || '').slice(0, 120)) + '</span><br><span style="color:var(--text-muted);font-size:9px">' + esc(String(s.theater || '')) + ' · Score: ' + Number(s.severityScore || 0).toFixed(1) + '</span></div>';
          }).join('');
      });
      break;

    // ── Cyber ──────────────────────────────────────────────────
    case 'threatfeed':
      void loadFeed('threatFeed', '/api/bootstrap', (d) => {
        const threats = ((d.cyberThreats as Record<string, unknown>)?.threats || []) as Array<Record<string, unknown>>;
        if (threats.length === 0) return 'No active cyber threats in feed';
        return '<div style="margin-bottom:6px;font-weight:600">' + threats.length + ' cyber threats tracked</div>' +
          threats.slice(0, 12).map((t: Record<string, unknown>) => {
            const sev = String(t.severity || 'medium');
            const c: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#d4a843', low: '#22c55e' };
            return '<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:5px 0"><span style="color:' + (c[sev] || '#666') + ';font-weight:600;font-size:9px">' + sev.toUpperCase() + '</span> ' + esc(String(t.title || t.name || '').slice(0, 100)) + '<br><span style="color:var(--text-muted);font-size:9px">' + esc(String(t.source || t.feed || '')) + '</span></div>';
          }).join('');
      });
      break;
    case 'breach':
      document.getElementById('breachBtn')?.addEventListener('click', async () => {
        const input = (document.getElementById('breachInput') as HTMLInputElement)?.value.trim();
        const result = document.getElementById('breachInputResult');
        if (!input || !result) return;
        result.style.display = 'block';
        result.innerHTML = 'Checking breach databases...';
        try {
          const resp = await fetch('https://haveibeenpwned.com/api/v3/breachedaccount/' + encodeURIComponent(input) + '?truncateResponse=true', {
            headers: { 'hibp-api-key': '', 'User-Agent': 'WorldMonitor-OSINT' },
            signal: AbortSignal.timeout(8000),
          });
          if (resp.status === 404) { result.innerHTML = '<span style="color:#22c55e;font-weight:600">✅ No breaches found</span> for ' + esc(input); return; }
          if (resp.status === 401) { result.innerHTML = 'HIBP API requires an API key for account searches.\n\nThe email "' + esc(input) + '" cannot be checked without a HIBP API key.\nYou can check manually at: haveibeenpwned.com'; return; }
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const breaches = await resp.json() as Array<{ Name: string }>;
          result.innerHTML = '<span style="color:#ef4444;font-weight:600">⚠ ' + breaches.length + ' breach(es) found</span> for ' + esc(input) + '<br><br>' +
            breaches.map((b: { Name: string }) => '• ' + esc(b.Name)).join('<br>');
        } catch { result.innerHTML = 'Breach check requires HIBP API key.\n\nCheck manually: haveibeenpwned.com/account/' + esc(input); }
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
  // Stop background graph processes when leaving Analyst view
  stopAutoDiscovery();
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
