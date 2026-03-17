/**
 * POIPanel.ts — Persons of Interest Dashboard Panel
 * World Monitor OSINT Platform
 *
 * Drop into: src/components/POIPanel.ts
 * Register in src/config/panels.ts → FULL_PANELS:
 *   poi: { name: 'Persons of Interest', enabled: true, priority: 1 },
 */

interface POIPerson {
  name: string;
  role: string;
  region: string;
  tags: string[];
  lastKnownLocation: string;
  locationConfidence: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  recentActivity: string[];
  recentArticles: { title: string; url: string; date: string }[];
  mentionCount: number;
  activityScore: number;
  averageTone: number;
  associatedEntities: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface POIData {
  persons: POIPerson[];
}

const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

const RISK_ICONS: Record<string, string> = {
  low: '◉',
  medium: '◈',
  high: '⬥',
  critical: '⛊',
};

const SENTIMENT_ICONS: Record<string, string> = {
  positive: '▲',
  neutral: '●',
  negative: '▼',
};

const REGION_FLAGS: Record<string, string> = {
  'North America': '🌎',
  'South America': '🌎',
  'Europe': '🌍',
  'Africa': '🌍',
  'Middle East': '🌍',
  'Asia': '🌏',
  'Oceania': '🌏',
  'Global': '🌐',
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function toneToLabel(tone: number): string {
  if (tone >= 0.3) return 'Very Positive';
  if (tone >= 0.1) return 'Positive';
  if (tone >= -0.1) return 'Neutral';
  if (tone >= -0.3) return 'Negative';
  return 'Very Negative';
}

function toneToColor(tone: number): string {
  if (tone >= 0.3) return '#22c55e';
  if (tone >= 0.1) return '#86efac';
  if (tone >= -0.1) return '#94a3b8';
  if (tone >= -0.3) return '#fbbf24';
  return '#ef4444';
}

function confidenceBar(value: number): string {
  const pct = Math.round(value * 100);
  return `<div class="poi-confidence-bar" title="Location confidence: ${pct}%"><div class="poi-confidence-fill" style="width:${pct}%;background:${pct > 70 ? '#22c55e' : pct > 40 ? '#eab308' : '#ef4444'}"></div><span class="poi-confidence-label">${pct}%</span></div>`;
}

function activityGauge(score: number): string {
  const angle = (score / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const x = 50 + 35 * Math.cos(Math.PI - rad);
  const y = 50 - 35 * Math.sin(Math.PI - rad);
  const color = score > 70 ? '#ef4444' : score > 40 ? '#eab308' : '#22c55e';
  return `<svg class="poi-gauge" viewBox="0 0 100 55" width="80" height="44"><path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="var(--poi-muted)" stroke-width="6" stroke-linecap="round"/><path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(score / 100) * 110} 110"/><circle cx="${x}" cy="${y}" r="3" fill="${color}"/><text x="50" y="48" text-anchor="middle" fill="var(--poi-text)" font-size="11" font-weight="700">${score}</text></svg>`;
}

function injectStyles(): void {
  if (document.getElementById('poi-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'poi-panel-styles';
  style.textContent = `
    :root{--poi-bg:#0a0e17;--poi-surface:#111827;--poi-surface-hover:#1a2332;--poi-border:#1e293b;--poi-border-accent:#334155;--poi-text:#e2e8f0;--poi-text-dim:#94a3b8;--poi-text-muted:#64748b;--poi-muted:#1e293b;--poi-accent:var(--accent-color,#3b82f6);--poi-accent-dim:color-mix(in srgb,var(--poi-accent) 20%,transparent);--poi-radius:8px;--poi-card-radius:12px;--poi-transition:200ms cubic-bezier(.4,0,.2,1)}
    .poi-panel{display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--poi-bg);font-family:'JetBrains Mono','Fira Code','SF Mono',monospace}
    .poi-toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--poi-surface);border-bottom:1px solid var(--poi-border);flex-shrink:0;flex-wrap:wrap}
    .poi-search{flex:1;min-width:180px;padding:8px 12px 8px 32px;background:var(--poi-bg);border:1px solid var(--poi-border);border-radius:var(--poi-radius);color:var(--poi-text);font-size:13px;font-family:inherit;outline:none;transition:border-color var(--poi-transition)}
    .poi-search:focus{border-color:var(--poi-accent)}
    .poi-search-wrap{position:relative;flex:1;min-width:180px}
    .poi-search-wrap::before{content:'⌕';position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--poi-text-muted);font-size:14px;pointer-events:none}
    .poi-filter-btn{padding:6px 12px;background:var(--poi-bg);border:1px solid var(--poi-border);border-radius:var(--poi-radius);color:var(--poi-text-dim);font-size:11px;font-family:inherit;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;transition:all var(--poi-transition)}
    .poi-filter-btn:hover{border-color:var(--poi-border-accent);color:var(--poi-text)}
    .poi-filter-btn.active{background:var(--poi-accent-dim);border-color:var(--poi-accent);color:var(--poi-accent)}
    .poi-sort-select{padding:6px 8px;background:var(--poi-bg);border:1px solid var(--poi-border);border-radius:var(--poi-radius);color:var(--poi-text-dim);font-size:11px;font-family:inherit;cursor:pointer;outline:none}
    .poi-count{color:var(--poi-text-muted);font-size:11px;margin-left:auto;white-space:nowrap}
    .poi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;padding:16px;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:var(--poi-border) transparent}
    @media(max-width:768px){.poi-grid{grid-template-columns:1fr;padding:12px;gap:10px}}
    .poi-card{background:var(--poi-surface);border:1px solid var(--poi-border);border-radius:var(--poi-card-radius);padding:16px;cursor:pointer;transition:all var(--poi-transition);position:relative;overflow:hidden;animation:poi-card-in .3s ease both}
    .poi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--card-risk-color,var(--poi-accent));opacity:.7;transition:opacity var(--poi-transition)}
    .poi-card:hover{border-color:var(--poi-border-accent);background:var(--poi-surface-hover);transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,.3)}
    .poi-card:hover::before{opacity:1}
    .poi-card-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
    .poi-avatar{width:44px;height:44px;border-radius:50%;background:var(--poi-muted);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:var(--poi-accent);flex-shrink:0;border:2px solid var(--card-risk-color,var(--poi-border))}
    .poi-card-info{flex:1;min-width:0}
    .poi-card-name{font-size:14px;font-weight:700;color:var(--poi-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
    .poi-card-role{font-size:11px;color:var(--poi-text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .poi-card-region{font-size:10px;color:var(--poi-text-muted);margin-top:2px}
    .poi-card-badges{display:flex;gap:6px;align-items:center;flex-shrink:0}
    .poi-risk-badge{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:color-mix(in srgb,var(--badge-color) 15%,transparent);color:var(--badge-color);border:1px solid color-mix(in srgb,var(--badge-color) 30%,transparent)}
    .poi-sentiment-icon{font-size:12px;line-height:1}
    .poi-card-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}
    .poi-metric{text-align:center}
    .poi-metric-label{font-size:9px;color:var(--poi-text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
    .poi-metric-value{font-size:16px;font-weight:700;color:var(--poi-text)}
    .poi-card-location{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--poi-border);font-size:11px;color:var(--poi-text-dim)}
    .poi-card-location-icon{color:var(--poi-accent)}
    .poi-card-location-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .poi-confidence-bar{width:60px;height:6px;background:var(--poi-muted);border-radius:3px;overflow:hidden;position:relative;flex-shrink:0}
    .poi-confidence-fill{height:100%;border-radius:3px;transition:width .6s ease}
    .poi-confidence-label{position:absolute;right:-28px;top:-3px;font-size:9px;color:var(--poi-text-muted)}
    .poi-card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
    .poi-tag{padding:2px 6px;background:var(--poi-muted);border-radius:3px;font-size:9px;color:var(--poi-text-muted);text-transform:uppercase;letter-spacing:.3px}
    .poi-card-summary{font-size:11px;color:var(--poi-text-dim);line-height:1.5;margin-top:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .poi-drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:9998;opacity:0;transition:opacity 300ms ease;pointer-events:none}
    .poi-drawer-overlay.open{opacity:1;pointer-events:auto}
    .poi-drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,90vw);background:var(--poi-bg);border-left:1px solid var(--poi-border);z-index:9999;transform:translateX(100%);transition:transform 300ms cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
    .poi-drawer.open{transform:translateX(0)}
    .poi-drawer-header{display:flex;align-items:center;gap:16px;padding:20px 24px;background:var(--poi-surface);border-bottom:1px solid var(--poi-border);flex-shrink:0}
    .poi-drawer-avatar{width:56px;height:56px;border-radius:50%;background:var(--poi-muted);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:var(--poi-accent);border:2px solid var(--card-risk-color,var(--poi-border));flex-shrink:0}
    .poi-drawer-title{flex:1;min-width:0}
    .poi-drawer-name{font-size:18px;font-weight:700;color:var(--poi-text)}
    .poi-drawer-role{font-size:12px;color:var(--poi-text-dim);margin-top:2px}
    .poi-drawer-close{width:36px;height:36px;border-radius:8px;background:var(--poi-muted);border:1px solid var(--poi-border);color:var(--poi-text-dim);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--poi-transition);flex-shrink:0}
    .poi-drawer-close:hover{background:var(--poi-surface-hover);color:var(--poi-text)}
    .poi-drawer-body{flex:1;overflow-y:auto;padding:24px;scrollbar-width:thin;scrollbar-color:var(--poi-border) transparent}
    .poi-drawer-section{margin-bottom:24px}
    .poi-drawer-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--poi-text-muted);margin-bottom:12px;display:flex;align-items:center;gap:8px}
    .poi-drawer-section-title::after{content:'';flex:1;height:1px;background:var(--poi-border)}
    .poi-drawer-metrics-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
    .poi-drawer-metric{background:var(--poi-surface);border:1px solid var(--poi-border);border-radius:var(--poi-radius);padding:12px;text-align:center}
    .poi-drawer-metric-label{font-size:9px;color:var(--poi-text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
    .poi-drawer-metric-value{font-size:20px;font-weight:700;color:var(--poi-text)}
    .poi-drawer-summary{font-size:13px;color:var(--poi-text-dim);line-height:1.7;background:var(--poi-surface);border:1px solid var(--poi-border);border-radius:var(--poi-radius);padding:14px}
    .poi-drawer-activity-item{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--poi-border);font-size:12px;color:var(--poi-text-dim);line-height:1.5}
    .poi-drawer-activity-item:last-child{border-bottom:none}
    .poi-drawer-activity-dot{width:6px;height:6px;border-radius:50%;background:var(--poi-accent);margin-top:6px;flex-shrink:0}
    .poi-drawer-article{display:block;padding:10px 12px;background:var(--poi-surface);border:1px solid var(--poi-border);border-radius:var(--poi-radius);margin-bottom:8px;text-decoration:none;transition:all var(--poi-transition)}
    .poi-drawer-article:hover{border-color:var(--poi-accent);background:var(--poi-surface-hover)}
    .poi-drawer-article-title{font-size:12px;color:var(--poi-text);line-height:1.4}
    .poi-drawer-article-date{font-size:10px;color:var(--poi-text-muted);margin-top:4px}
    .poi-drawer-entities{display:flex;flex-wrap:wrap;gap:6px}
    .poi-entity-chip{padding:4px 10px;background:var(--poi-accent-dim);border:1px solid color-mix(in srgb,var(--poi-accent) 30%,transparent);border-radius:20px;font-size:11px;color:var(--poi-accent)}
    .poi-loading,.poi-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--poi-text-muted);text-align:center;gap:12px}
    .poi-loading-spinner{width:32px;height:32px;border:3px solid var(--poi-border);border-top-color:var(--poi-accent);border-radius:50%;animation:poi-spin .8s linear infinite}
    @keyframes poi-spin{to{transform:rotate(360deg)}}
    .poi-empty-icon{font-size:32px;opacity:.5}
    @keyframes poi-card-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  `;
  document.head.appendChild(style);
}

export class POIPanel {
  private container: HTMLElement;
  private data: POIPerson[] = [];
  private filtered: POIPerson[] = [];
  private searchQuery = '';
  private riskFilter: string | null = null;
  private sortBy: 'activity' | 'mentions' | 'risk' | 'name' = 'activity';
  private _selectedPerson: POIPerson | null = null;
  private drawerEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    injectStyles();
  }

  async init(): Promise<void> {
    this.container.innerHTML = `<div class="poi-panel"><div class="poi-loading"><div class="poi-loading-spinner"></div><div>Loading persons of interest…</div></div></div>`;
    try {
      const res = await fetch('/api/poi');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: POIData = await res.json();
      this.data = json.persons || [];
    } catch (err) {
      console.error('[POIPanel] Failed to fetch POI data:', err);
      this.data = [];
    }
    this.applyFilters();
    this.render();
  }

  private applyFilters(): void {
    let list = [...this.data];
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q) ||
        p.lastKnownLocation.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.associatedEntities.some((e) => e.toLowerCase().includes(q))
      );
    }
    if (this.riskFilter) {
      list = list.filter((p) => p.riskLevel === this.riskFilter);
    }
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    switch (this.sortBy) {
      case 'activity': list.sort((a, b) => b.activityScore - a.activityScore); break;
      case 'mentions': list.sort((a, b) => b.mentionCount - a.mentionCount); break;
      case 'risk': list.sort((a, b) => (riskOrder[a.riskLevel] ?? 3) - (riskOrder[b.riskLevel] ?? 3)); break;
      case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    this.filtered = list;
  }

  private render(): void {
    const panel = this.container.querySelector('.poi-panel') || this.container;
    panel.innerHTML = `
      <div class="poi-toolbar">
        <div class="poi-search-wrap"><input class="poi-search" type="text" placeholder="Search name, role, location, entity…" value="${escapeHtml(this.searchQuery)}" /></div>
        <button class="poi-filter-btn ${!this.riskFilter ? 'active' : ''}" data-risk="">ALL</button>
        <button class="poi-filter-btn ${this.riskFilter === 'critical' ? 'active' : ''}" data-risk="critical" style="--badge-color:${RISK_COLORS.critical}">CRIT</button>
        <button class="poi-filter-btn ${this.riskFilter === 'high' ? 'active' : ''}" data-risk="high" style="--badge-color:${RISK_COLORS.high}">HIGH</button>
        <button class="poi-filter-btn ${this.riskFilter === 'medium' ? 'active' : ''}" data-risk="medium" style="--badge-color:${RISK_COLORS.medium}">MED</button>
        <button class="poi-filter-btn ${this.riskFilter === 'low' ? 'active' : ''}" data-risk="low" style="--badge-color:${RISK_COLORS.low}">LOW</button>
        <select class="poi-sort-select" title="Sort by">
          <option value="activity" ${this.sortBy === 'activity' ? 'selected' : ''}>⚡ Activity</option>
          <option value="mentions" ${this.sortBy === 'mentions' ? 'selected' : ''}>📊 Mentions</option>
          <option value="risk" ${this.sortBy === 'risk' ? 'selected' : ''}>⚠ Risk</option>
          <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>A→Z Name</option>
        </select>
        <span class="poi-count">${this.filtered.length} / ${this.data.length} tracked</span>
      </div>
      <div class="poi-grid">${this.filtered.length === 0
        ? '<div class="poi-empty" style="grid-column:1/-1"><div class="poi-empty-icon">👤</div><div>No persons match your filters</div></div>'
        : this.filtered.map((p, i) => this.renderCard(p, i)).join('')}</div>`;
    this.bindEvents(panel);
  }

  private renderCard(p: POIPerson, index: number): string {
    const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const riskColor = RISK_COLORS[p.riskLevel] || '#eab308';
    const sentColor = toneToColor(p.averageTone);
    const regionFlag = REGION_FLAGS[p.region] || '🌐';
    return `<div class="poi-card" data-index="${index}" style="--card-risk-color:${riskColor};animation-delay:${index * 40}ms">
      <div class="poi-card-header">
        <div class="poi-avatar">${initials}</div>
        <div class="poi-card-info"><div class="poi-card-name">${escapeHtml(p.name)}</div><div class="poi-card-role">${escapeHtml(p.role)}</div><div class="poi-card-region">${regionFlag} ${escapeHtml(p.region)}</div></div>
        <div class="poi-card-badges"><span class="poi-risk-badge" style="--badge-color:${riskColor}">${RISK_ICONS[p.riskLevel] || '●'} ${p.riskLevel}</span><span class="poi-sentiment-icon" style="color:${sentColor}" title="Sentiment: ${p.sentiment}">${SENTIMENT_ICONS[p.sentiment] || '●'}</span></div>
      </div>
      <div class="poi-card-metrics">
        <div class="poi-metric"><div class="poi-metric-label">Mentions</div><div class="poi-metric-value">${p.mentionCount.toLocaleString()}</div></div>
        <div class="poi-metric"><div class="poi-metric-label">Activity</div>${activityGauge(p.activityScore)}</div>
        <div class="poi-metric"><div class="poi-metric-label">Tone</div><div class="poi-metric-value" style="color:${sentColor};font-size:13px">${toneToLabel(p.averageTone)}</div></div>
      </div>
      <div class="poi-card-location"><span class="poi-card-location-icon">📍</span><span class="poi-card-location-name">${escapeHtml(p.lastKnownLocation)}</span>${confidenceBar(p.locationConfidence)}</div>
      ${p.tags.length > 0 ? `<div class="poi-card-tags">${p.tags.slice(0, 5).map((t) => `<span class="poi-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="poi-card-summary">${escapeHtml(p.summary)}</div>
    </div>`;
  }

  private bindEvents(panel: Element): void {
    const searchInput = panel.querySelector('.poi-search') as HTMLInputElement | null;
    if (searchInput) {
      let debounce: ReturnType<typeof setTimeout>;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { this.searchQuery = searchInput.value.trim(); this.applyFilters(); this.render(); }, 200);
      });
    }
    panel.querySelectorAll('.poi-filter-btn[data-risk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const risk: string = (btn as HTMLElement).dataset.risk || '';
        this.riskFilter = risk.length > 0 ? risk : null;
        this.applyFilters();
        this.render();
      });
    });
    const sortSelect = panel.querySelector('.poi-sort-select') as HTMLSelectElement | null;
    if (sortSelect) {
      sortSelect.addEventListener('change', () => { this.sortBy = sortSelect.value as 'activity' | 'mentions' | 'risk' | 'name'; this.applyFilters(); this.render(); });
    }
    panel.querySelectorAll('.poi-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt((card as HTMLElement).dataset.index || '0', 10);
        const person = this.filtered[idx];
        if (person) this.openDrawer(person);
      });
    });
  }

  private openDrawer(person: POIPerson): void {
    this._selectedPerson = person;
    this.closeDrawer();
    const riskColor = RISK_COLORS[person.riskLevel] || '#eab308';
    const sentColor = toneToColor(person.averageTone);
    const initials = person.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'poi-drawer-overlay';
    this.overlayEl.addEventListener('click', () => this.closeDrawer());
    document.body.appendChild(this.overlayEl);
    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'poi-drawer';
    this.drawerEl.style.setProperty('--card-risk-color', riskColor);
    this.drawerEl.innerHTML = `
      <div class="poi-drawer-header">
        <div class="poi-drawer-avatar">${initials}</div>
        <div class="poi-drawer-title"><div class="poi-drawer-name">${escapeHtml(person.name)}</div><div class="poi-drawer-role">${escapeHtml(person.role)} · ${escapeHtml(person.region)}</div></div>
        <button class="poi-drawer-close" title="Close">✕</button>
      </div>
      <div class="poi-drawer-body">
        <div class="poi-drawer-section"><div class="poi-drawer-section-title">Key Metrics</div>
          <div class="poi-drawer-metrics-grid">
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Risk Level</div><div class="poi-drawer-metric-value" style="color:${riskColor}">${person.riskLevel.toUpperCase()}</div></div>
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Mentions</div><div class="poi-drawer-metric-value">${person.mentionCount.toLocaleString()}</div></div>
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Activity Score</div><div class="poi-drawer-metric-value">${person.activityScore}</div></div>
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Avg Tone</div><div class="poi-drawer-metric-value" style="color:${sentColor}">${person.averageTone.toFixed(2)}</div></div>
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Location</div><div class="poi-drawer-metric-value" style="font-size:12px">${escapeHtml(person.lastKnownLocation)}</div></div>
            <div class="poi-drawer-metric"><div class="poi-drawer-metric-label">Loc Confidence</div><div class="poi-drawer-metric-value">${Math.round(person.locationConfidence * 100)}%</div></div>
          </div>
        </div>
        <div class="poi-drawer-section"><div class="poi-drawer-section-title">AI Intelligence Summary</div><div class="poi-drawer-summary">${escapeHtml(person.summary)}</div></div>
        ${person.recentActivity.length > 0 ? `<div class="poi-drawer-section"><div class="poi-drawer-section-title">Recent Activity</div>${person.recentActivity.map((a) => `<div class="poi-drawer-activity-item"><div class="poi-drawer-activity-dot"></div><div>${escapeHtml(a)}</div></div>`).join('')}</div>` : ''}
        ${person.recentArticles.length > 0 ? `<div class="poi-drawer-section"><div class="poi-drawer-section-title">Source Articles</div>${person.recentArticles.map((a) => `<a class="poi-drawer-article" href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><div class="poi-drawer-article-title">${escapeHtml(a.title)}</div><div class="poi-drawer-article-date">${escapeHtml(a.date)}</div></a>`).join('')}</div>` : ''}
        ${person.associatedEntities.length > 0 ? `<div class="poi-drawer-section"><div class="poi-drawer-section-title">Associated Entities</div><div class="poi-drawer-entities">${person.associatedEntities.map((e) => `<span class="poi-entity-chip">${escapeHtml(e)}</span>`).join('')}</div></div>` : ''}
        ${person.tags.length > 0 ? `<div class="poi-drawer-section"><div class="poi-drawer-section-title">Tags</div><div class="poi-card-tags" style="margin-top:0">${person.tags.map((t) => `<span class="poi-tag">${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
      </div>`;
    document.body.appendChild(this.drawerEl);
    this.drawerEl.querySelector('.poi-drawer-close')?.addEventListener('click', () => this.closeDrawer());
    const escHandler = (e: KeyboardEvent): void => { if (e.key === 'Escape') { this.closeDrawer(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    requestAnimationFrame(() => { this.overlayEl?.classList.add('open'); this.drawerEl?.classList.add('open'); });
  }

  private closeDrawer(): void {
    if (this.drawerEl) {
      this.drawerEl.classList.remove('open');
      this.overlayEl?.classList.remove('open');
      setTimeout(() => { this.drawerEl?.remove(); this.overlayEl?.remove(); this.drawerEl = null; this.overlayEl = null; }, 300);
    }
    this._selectedPerson = null;
  }

  getMapPins(): Array<{ name: string; role: string; location: string; riskLevel: string; riskColor: string; confidence: number; activityScore: number }> {
    return this.data.map((p) => ({ name: p.name, role: p.role, location: p.lastKnownLocation, riskLevel: p.riskLevel, riskColor: RISK_COLORS[p.riskLevel] || '#3b82f6', confidence: p.locationConfidence, activityScore: p.activityScore }));
  }

  getData(): POIPerson[] { return this.data; }

  destroy(): void { this.closeDrawer(); this.container.innerHTML = ''; }
}

export default POIPanel;
