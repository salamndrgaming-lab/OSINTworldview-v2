/**
 * Analyst Tab — Primary navigation tab for investigation mode
 *
 * When the Analyst tab is active, the main-content area (map + panels grid)
 * is hidden and replaced with the Analyst workspace containing:
 *   - Entity Investigation (POI profiles, search, timeline)
 *   - Intelligence Link Graph (full-screen force-directed graph)
 *   - Correlation Timeline (cross-source event overlay)
 *   - Analyst Notepad (scratchpad for notes)
 *   - OSINT Toolkit (migrated from panel)
 *
 * Architecture:
 *   - The analyst view is injected once and toggled via display:none
 *   - Sub-tabs within the analyst view switch between tools
 *   - State is preserved when switching back to Monitor view
 */

const ANALYST_CONTAINER_ID = 'analystWorkspace';
const ACTIVE_SUBTAB_KEY = 'worldmonitor-analyst-subtab';

export type AnalystSubtab = 'entities' | 'graph' | 'timeline' | 'notepad' | 'toolkit';

interface SubtabDef {
  id: AnalystSubtab;
  label: string;
  icon: string;
  description: string;
}

const SUBTABS: SubtabDef[] = [
  { id: 'entities', label: 'Entity Intel', icon: '👤', description: 'Search and investigate persons of interest, organizations, and countries' },
  { id: 'graph', label: 'Link Graph', icon: '🕸', description: 'Force-directed intelligence link analysis between entities' },
  { id: 'timeline', label: 'Timeline', icon: '📊', description: 'Cross-source correlation timeline of events' },
  { id: 'notepad', label: 'Notepad', icon: '📝', description: 'Analyst scratchpad for investigation notes' },
  { id: 'toolkit', label: 'OSINT Toolkit', icon: '🔧', description: 'Curated directory of open-source intelligence tools' },
];

function getActiveSubtab(): AnalystSubtab {
  return (localStorage.getItem(ACTIVE_SUBTAB_KEY) as AnalystSubtab) || 'entities';
}

function setActiveSubtab(id: AnalystSubtab): void {
  localStorage.setItem(ACTIVE_SUBTAB_KEY, id);
}

/**
 * Render the analyst workspace HTML.
 * Injected once into the DOM by panel-layout, then toggled.
 */
export function renderAnalystWorkspace(): string {
  const activeSubtab = getActiveSubtab();

  const subtabButtons = SUBTABS.map(st =>
    `<button class="analyst-subtab${st.id === activeSubtab ? ' active' : ''}" data-subtab="${st.id}" title="${st.description}">
      <span class="analyst-subtab-icon">${st.icon}</span>
      <span class="analyst-subtab-label">${st.label}</span>
    </button>`
  ).join('');

  return `<div class="analyst-workspace" id="${ANALYST_CONTAINER_ID}" style="display:none">
    <div class="analyst-subtab-bar">
      ${subtabButtons}
    </div>
    <div class="analyst-content" id="analystContent">
      ${renderSubtabContent(activeSubtab)}
    </div>
  </div>`;
}

function renderSubtabContent(subtab: AnalystSubtab): string {
  switch (subtab) {
    case 'entities':
      return renderEntityIntel();
    case 'graph':
      return renderGraphPlaceholder();
    case 'timeline':
      return renderTimeline();
    case 'notepad':
      return renderNotepad();
    case 'toolkit':
      return renderToolkit();
    default:
      return renderEntityIntel();
  }
}

function renderEntityIntel(): string {
  return `<div class="analyst-pane analyst-entity-intel" data-pane="entities">
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
          <div class="analyst-empty-hint">Try searching for a world leader, country, or organization. Results pull from POI data, GDELT, and the entity graph.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderGraphPlaceholder(): string {
  return `<div class="analyst-pane analyst-graph-pane" data-pane="graph">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Intelligence Link Graph</h2>
      <div class="analyst-graph-toolbar">
        <select class="analyst-graph-category" id="analystGraphCategory">
          <option value="country">🌍 Country</option>
          <option value="person">👤 Person</option>
          <option value="organization">🏢 Organization</option>
          <option value="event">⚡ Event</option>
          <option value="topic">🔍 Topic</option>
        </select>
        <input type="text" class="analyst-graph-input" id="analystGraphInput" placeholder="Add entity to graph..." spellcheck="false" />
        <button class="analyst-btn" id="analystGraphAddBtn">+ Add</button>
        <button class="analyst-btn analyst-btn-secondary" id="analystGraphAnalyzeBtn">🧠 Analyze</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystGraphClearBtn">Clear</button>
      </div>
    </div>
    <div class="analyst-graph-canvas-wrap" id="analystGraphCanvasWrap">
      <div class="analyst-empty-state">
        <span class="analyst-empty-icon">🕸</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">Build an intelligence link graph</div>
          <div class="analyst-empty-hint">Add entities above to discover connections between countries, people, organizations, and events. The graph uses force-directed layout with AI-powered analysis.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderTimeline(): string {
  return `<div class="analyst-pane analyst-timeline-pane" data-pane="timeline">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Correlation Timeline</h2>
      <div class="analyst-timeline-controls">
        <button class="analyst-filter-btn active" data-range="24h">24h</button>
        <button class="analyst-filter-btn" data-range="48h">48h</button>
        <button class="analyst-filter-btn" data-range="7d">7d</button>
        <button class="analyst-filter-btn" data-range="30d">30d</button>
        <span class="analyst-timeline-sep">|</span>
        <label class="analyst-timeline-toggle"><input type="checkbox" checked data-source="gdelt"> GDELT</label>
        <label class="analyst-timeline-toggle"><input type="checkbox" checked data-source="acled"> ACLED</label>
        <label class="analyst-timeline-toggle"><input type="checkbox" checked data-source="news"> News</label>
        <label class="analyst-timeline-toggle"><input type="checkbox" data-source="poi"> POI</label>
      </div>
    </div>
    <div class="analyst-timeline-view" id="analystTimelineView">
      <div class="analyst-empty-state">
        <span class="analyst-empty-icon">📊</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">Cross-source event correlation</div>
          <div class="analyst-empty-hint">Overlay events from GDELT, ACLED, news feeds, and POI movements on a single timeline to spot patterns and correlations across intelligence sources.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderNotepad(): string {
  const savedNotes = localStorage.getItem('worldmonitor-analyst-notes') || '';
  return `<div class="analyst-pane analyst-notepad-pane" data-pane="notepad">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">Analyst Notepad</h2>
      <div class="analyst-notepad-actions">
        <button class="analyst-btn analyst-btn-ghost" id="analystNotepadClear">Clear</button>
        <button class="analyst-btn analyst-btn-ghost" id="analystNotepadExport">Export</button>
        <span class="analyst-notepad-saved" id="analystNotepadStatus"></span>
      </div>
    </div>
    <textarea class="analyst-notepad-editor" id="analystNotepadEditor" placeholder="Type investigation notes here...&#10;&#10;Tips:&#10;• Use ## for section headers&#10;• Paste URLs and they'll be preserved on export&#10;• Notes auto-save every 3 seconds&#10;• Export as .md file for reports" spellcheck="true">${savedNotes}</textarea>
  </div>`;
}

function renderToolkit(): string {
  // This will be populated by migrating OsintToolkitPanel content
  return `<div class="analyst-pane analyst-toolkit-pane" data-pane="toolkit">
    <div class="analyst-pane-header">
      <h2 class="analyst-pane-title">OSINT Toolkit</h2>
      <div class="analyst-search-bar">
        <input type="text" class="analyst-toolkit-search" id="analystToolkitSearch" placeholder="Search tools..." spellcheck="false" autocomplete="off" />
      </div>
    </div>
    <div class="analyst-toolkit-grid" id="analystToolkitGrid">
      <div class="analyst-toolkit-loading">Loading toolkit...</div>
    </div>
  </div>`;
}

/**
 * Initialize analyst workspace event listeners.
 */
export function initAnalystWorkspace(): void {
  const workspace = document.getElementById(ANALYST_CONTAINER_ID);
  if (!workspace) return;

  // Sub-tab switching
  const subtabBar = workspace.querySelector('.analyst-subtab-bar');
  subtabBar?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.analyst-subtab') as HTMLElement;
    if (!btn) return;
    const subtab = btn.dataset.subtab as AnalystSubtab;
    if (!subtab) return;

    setActiveSubtab(subtab);

    // Update active states
    subtabBar.querySelectorAll('.analyst-subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Swap content
    const content = document.getElementById('analystContent');
    if (content) content.innerHTML = renderSubtabContent(subtab);

    // Re-init subtab-specific behaviors
    initSubtabBehaviors(subtab);
  });

  // Init behaviors for the initially active subtab
  initSubtabBehaviors(getActiveSubtab());
}

function initSubtabBehaviors(subtab: AnalystSubtab): void {
  switch (subtab) {
    case 'entities':
      initEntitySearch();
      break;
    case 'notepad':
      initNotepad();
      break;
    case 'toolkit':
      initToolkit();
      break;
  }
}

function initEntitySearch(): void {
  const search = document.getElementById('analystEntitySearch') as HTMLInputElement;
  if (!search) return;

  let debounce: ReturnType<typeof setTimeout>;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = search.value.trim();
      if (q.length < 2) return;
      void searchEntities(q);
    }, 300);
  });

  // Filter buttons
  const filters = document.querySelectorAll('.analyst-search-filters .analyst-filter-btn');
  filters.forEach(btn => {
    btn.addEventListener('click', () => {
      filters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const q = search.value.trim();
      if (q.length >= 2) void searchEntities(q);
    });
  });
}

async function searchEntities(query: string): Promise<void> {
  const results = document.getElementById('analystEntityResults');
  if (!results) return;

  results.innerHTML = '<div class="analyst-searching">Searching...</div>';

  try {
    // Try POI endpoint first
    const resp = await fetch('/api/poi', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('POI unavailable');
    const data = await resp.json();
    const persons = data?.persons || [];

    const q = query.toLowerCase();
    const matches = persons.filter((p: Record<string, unknown>) => {
      const name = String(p.name || '').toLowerCase();
      const role = String(p.role || '').toLowerCase();
      const country = String(p.country || '').toLowerCase();
      return name.includes(q) || role.includes(q) || country.includes(q);
    });

    if (matches.length === 0) {
      results.innerHTML = `<div class="analyst-empty-state">
        <span class="analyst-empty-icon">🔍</span>
        <div class="analyst-empty-text">
          <div class="analyst-empty-title">No results for "${escHtml(query)}"</div>
          <div class="analyst-empty-hint">Try a different search term or check the POI seed status.</div>
        </div>
      </div>`;
      return;
    }

    results.innerHTML = matches.slice(0, 20).map((p: Record<string, unknown>) => {
      const name = String(p.name || 'Unknown');
      const role = String(p.role || '');
      const country = String(p.country || '');
      const threat = String(p.threatLevel || 'low');
      const mentions = Number(p.mentions || 0);
      const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
      const threatColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#d4a843', low: '#22c55e' };
      const color = threatColors[threat] || threatColors.low;

      return `<div class="analyst-entity-card" data-entity-name="${escHtml(name)}">
        <div class="analyst-entity-avatar" style="background:${color}20;color:${color};border-color:${color}40">${initials}</div>
        <div class="analyst-entity-info">
          <div class="analyst-entity-name">${escHtml(name)}</div>
          <div class="analyst-entity-role">${escHtml(role)}${country ? ' · ' + escHtml(country) : ''}</div>
        </div>
        <div class="analyst-entity-stats">
          <span class="analyst-entity-threat" style="color:${color}">${threat.toUpperCase()}</span>
          <span class="analyst-entity-mentions">${mentions} mentions</span>
        </div>
      </div>`;
    }).join('');
  } catch {
    results.innerHTML = `<div class="analyst-empty-state">
      <span class="analyst-empty-icon">⚠</span>
      <div class="analyst-empty-text">
        <div class="analyst-empty-title">Entity data unavailable</div>
        <div class="analyst-empty-hint">The POI endpoint returned an error. Check that the seed has run.</div>
      </div>
    </div>`;
  }
}

function initNotepad(): void {
  const editor = document.getElementById('analystNotepadEditor') as HTMLTextAreaElement;
  const status = document.getElementById('analystNotepadStatus');
  const clearBtn = document.getElementById('analystNotepadClear');
  const exportBtn = document.getElementById('analystNotepadExport');
  if (!editor) return;

  // Auto-save
  let saveTimer: ReturnType<typeof setTimeout>;
  editor.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem('worldmonitor-analyst-notes', editor.value);
      if (status) {
        status.textContent = 'Saved';
        setTimeout(() => { if (status) status.textContent = ''; }, 2000);
      }
    }, 3000);
  });

  // Clear
  clearBtn?.addEventListener('click', () => {
    if (confirm('Clear all notes?')) {
      editor.value = '';
      localStorage.removeItem('worldmonitor-analyst-notes');
    }
  });

  // Export as .md
  exportBtn?.addEventListener('click', () => {
    const text = editor.value;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analyst-notes-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function initToolkit(): void {
  const grid = document.getElementById('analystToolkitGrid');
  const search = document.getElementById('analystToolkitSearch') as HTMLInputElement;
  if (!grid) return;

  // Dynamically import OSINT tools data from the panel
  void import('@/components/OsintToolkitPanel').then(_mod => {
    // The panel exports a class — we need to extract the tools data
    // For now, render a curated set inline
    grid.innerHTML = renderToolkitCards();
    if (search) initToolkitSearch(search, grid);
  }).catch(() => {
    grid.innerHTML = renderToolkitCards();
    if (search) initToolkitSearch(search, grid);
  });
}

function renderToolkitCards(): string {
  const tools = [
    { name: 'Shodan', url: 'https://www.shodan.io', desc: 'Internet-connected device search', cat: 'Threat Intel', icon: '🛡' },
    { name: 'OSINT Framework', url: 'https://osintframework.com', desc: 'Interactive OSINT tool directory', cat: 'Search', icon: '🌐' },
    { name: 'Wayback Machine', url: 'https://web.archive.org', desc: 'Historical website archive', cat: 'Search', icon: '🕰' },
    { name: 'Intelligence X', url: 'https://intelx.io', desc: 'Darknet & leak search engine', cat: 'Search', icon: '🔍' },
    { name: 'GreyNoise', url: 'https://www.greynoise.io', desc: 'Internet scanner identification', cat: 'Threat Intel', icon: '📡' },
    { name: 'Censys', url: 'https://search.censys.io', desc: 'Internet asset discovery', cat: 'Threat Intel', icon: '🔎' },
    { name: 'FlightRadar24', url: 'https://www.flightradar24.com', desc: 'Live global flight tracking', cat: 'Aviation', icon: '✈' },
    { name: 'MarineTraffic', url: 'https://www.marinetraffic.com', desc: 'Real-time vessel tracking', cat: 'Maritime', icon: '🚢' },
    { name: 'Sentinel Hub', url: 'https://www.sentinel-hub.com', desc: 'Satellite imagery browser', cat: 'Geospatial', icon: '🛰' },
    { name: 'Google Earth', url: 'https://earth.google.com', desc: '3D satellite & aerial imagery', cat: 'Geospatial', icon: '🌍' },
    { name: 'TGStat', url: 'https://tgstat.com', desc: 'Telegram analytics & monitoring', cat: 'Social', icon: '📱' },
    { name: 'Social Searcher', url: 'https://www.social-searcher.com', desc: 'Cross-platform social search', cat: 'Social', icon: '🔎' },
    { name: 'VirusTotal', url: 'https://www.virustotal.com', desc: 'File & URL threat analysis', cat: 'Threat Intel', icon: '🦠' },
    { name: 'Have I Been Pwned', url: 'https://haveibeenpwned.com', desc: 'Breach exposure checker', cat: 'Threat Intel', icon: '🔓' },
    { name: 'Overpass Turbo', url: 'https://overpass-turbo.eu', desc: 'OpenStreetMap query engine', cat: 'Geospatial', icon: '🗺' },
    { name: 'GDELT', url: 'https://www.gdeltproject.org', desc: 'Global event monitoring', cat: 'Intel', icon: '📰' },
  ];

  return tools.map(t =>
    `<a href="${t.url}" target="_blank" rel="noopener" class="analyst-tool-card" data-cat="${t.cat}">
      <div class="analyst-tool-icon">${t.icon}</div>
      <div class="analyst-tool-info">
        <div class="analyst-tool-name">${t.name}</div>
        <div class="analyst-tool-desc">${t.desc}</div>
      </div>
      <span class="analyst-tool-cat">${t.cat}</span>
    </a>`
  ).join('');
}

function initToolkitSearch(search: HTMLInputElement, grid: HTMLElement): void {
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll('.analyst-tool-card').forEach(card => {
      const el = card as HTMLElement;
      const text = el.textContent?.toLowerCase() || '';
      el.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Show the analyst workspace, hiding the monitor view.
 */
export function showAnalystView(): void {
  const monitor = document.querySelector('.main-content') as HTMLElement;
  const analyst = document.getElementById(ANALYST_CONTAINER_ID);
  const presetBar = document.getElementById('presetBar');
  if (monitor) monitor.style.display = 'none';
  if (analyst) analyst.style.display = 'flex';
  if (presetBar) presetBar.style.display = 'none';
}

/**
 * Show the monitor view, hiding the analyst workspace.
 */
export function showMonitorView(): void {
  const monitor = document.querySelector('.main-content') as HTMLElement;
  const analyst = document.getElementById(ANALYST_CONTAINER_ID);
  const presetBar = document.getElementById('presetBar');
  if (monitor) monitor.style.display = '';
  if (analyst) analyst.style.display = 'none';
  if (presetBar) presetBar.style.display = '';
}
