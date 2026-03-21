/**
 * POIPanel.ts — Persons of Interest Dashboard Panel
 * World Monitor OSINT Platform
 *
 * Drop into: src/components/POIPanel.ts
 *
 * In src/config/panels.ts → FULL_PANELS add:
 *   poi: { name: 'Persons of Interest', enabled: true, priority: 1 },
 *
 * In src/app/panel-layout.ts → createPanels() add after insights:
 *   this.createPanel('poi', () => new POIPanel());
 *
 * In src/app/panel-layout.ts → imports add:
 *   import { POIPanel } from '@/components/POIPanel';
 */

import { Panel } from './Panel';

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
  'North America': '🌎', 'South America': '🌎', 'Europe': '🌍',
  'Africa': '🌍', 'Middle East': '🌍', 'Asia': '🌏',
  'Oceania': '🌏', 'Global': '🌐',
};

function esc(str: string): string {
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
  const c = pct > 70 ? '#22c55e' : pct > 40 ? '#eab308' : '#ef4444';
  return `<div class="poi-conf-bar" title="Location confidence: ${pct}%"><div class="poi-conf-fill" style="width:${pct}%;background:${c}"></div><span class="poi-conf-lbl">${pct}%</span></div>`;
}

function gauge(score: number): string {
  const rad = ((score / 100) * 180 * Math.PI) / 180;
  const x = 50 + 35 * Math.cos(Math.PI - rad);
  const y = 50 - 35 * Math.sin(Math.PI - rad);
  const c = score > 70 ? '#ef4444' : score > 40 ? '#eab308' : '#22c55e';
  return `<svg viewBox="0 0 100 55" width="80" height="44"><path d="M15 50A35 35 0 0185 50" fill="none" stroke="var(--border-color,#1e293b)" stroke-width="6" stroke-linecap="round"/><path d="M15 50A35 35 0 0185 50" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(score / 100) * 110} 110"/><circle cx="${x}" cy="${y}" r="3" fill="${c}"/><text x="50" y="48" text-anchor="middle" fill="currentColor" font-size="11" font-weight="700">${score}</text></svg>`;
}

function injectPOIStyles(): void {
  if (document.getElementById('poi-panel-css')) return;
  const s = document.createElement('style');
  s.id = 'poi-panel-css';
  s.textContent = `
.poi-toolbar{display:flex;align-items:center;gap:6px;padding:8px 0;flex-wrap:wrap;border-bottom:1px solid var(--border-color,#1e293b);margin-bottom:8px}
.poi-search{flex:1;min-width:140px;padding:6px 10px;background:var(--bg-secondary,#0a0e17);border:1px solid var(--border-color,#1e293b);border-radius:6px;color:var(--text-primary,#e2e8f0);font-size:12px;font-family:inherit;outline:none}
.poi-search:focus{border-color:var(--accent-color,#3b82f6)}
.poi-fbtn{padding:4px 8px;background:transparent;border:1px solid var(--border-color,#1e293b);border-radius:5px;color:var(--text-secondary,#94a3b8);font-size:10px;font-family:inherit;cursor:pointer;text-transform:uppercase;letter-spacing:.4px}
.poi-fbtn:hover{color:var(--text-primary,#e2e8f0)}
.poi-fbtn.active{background:color-mix(in srgb,var(--accent-color,#3b82f6) 15%,transparent);border-color:var(--accent-color,#3b82f6);color:var(--accent-color,#3b82f6)}
.poi-sort{padding:4px 6px;background:transparent;border:1px solid var(--border-color,#1e293b);border-radius:5px;color:var(--text-secondary,#94a3b8);font-size:10px;font-family:inherit;cursor:pointer}
.poi-count{color:var(--text-muted,#64748b);font-size:10px;margin-left:auto}
.poi-cards{display:flex;flex-direction:column;gap:8px}
.poi-card{background:var(--bg-secondary,#111827);border:1px solid var(--border-color,#1e293b);border-radius:10px;padding:12px;cursor:pointer;position:relative;overflow:hidden;transition:background .15s,border-color .15s}
.poi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--card-risk,var(--accent-color,#3b82f6));opacity:.7}
.poi-card:hover{background:var(--bg-hover,#1a2332);border-color:var(--border-hover,#334155)}
.poi-card-hdr{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
.poi-av{width:38px;height:38px;border-radius:50%;background:var(--bg-tertiary,#1e293b);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:var(--accent-color,#3b82f6);flex-shrink:0;border:2px solid var(--card-risk,var(--border-color))}
.poi-info{flex:1;min-width:0}
.poi-nm{font-size:13px;font-weight:700;color:var(--text-primary,#e2e8f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.poi-rl{font-size:10px;color:var(--text-secondary,#94a3b8);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.poi-rg{font-size:9px;color:var(--text-muted,#64748b);margin-top:1px}
.poi-badges{display:flex;gap:5px;align-items:center;flex-shrink:0}
.poi-risk{padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.poi-sent{font-size:11px;line-height:1}
.poi-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;text-align:center}
.poi-ml{font-size:8px;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px}
.poi-mv{font-size:14px;font-weight:700;color:var(--text-primary,#e2e8f0)}
.poi-loc{display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid var(--border-color,#1e293b);font-size:10px;color:var(--text-secondary,#94a3b8)}
.poi-loc-nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.poi-conf-bar{width:50px;height:5px;background:var(--bg-tertiary,#1e293b);border-radius:3px;overflow:hidden;position:relative;flex-shrink:0}
.poi-conf-fill{height:100%;border-radius:3px}
.poi-conf-lbl{position:absolute;right:-24px;top:-2px;font-size:8px;color:var(--text-muted,#64748b)}
.poi-tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}
.poi-tg{padding:1px 5px;background:var(--bg-tertiary,#1e293b);border-radius:3px;font-size:8px;color:var(--text-muted,#64748b);text-transform:uppercase}
.poi-sum{font-size:10px;color:var(--text-secondary,#94a3b8);line-height:1.4;margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.poi-empty{text-align:center;padding:30px 10px;color:var(--text-muted,#64748b);font-size:12px}
.poi-drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:9998;opacity:0;transition:opacity .3s;pointer-events:none}
.poi-drawer-overlay.open{opacity:1;pointer-events:auto}
.poi-drawer{position:fixed;top:0;right:0;bottom:0;width:min(480px,90vw);background:var(--bg-primary,#0a0e17);border-left:1px solid var(--border-color,#1e293b);z-index:9999;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
.poi-drawer.open{transform:translateX(0)}
.poi-drawer-hdr{display:flex;align-items:center;gap:14px;padding:16px 20px;background:var(--bg-secondary,#111827);border-bottom:1px solid var(--border-color,#1e293b);flex-shrink:0}
.poi-drawer-av{width:48px;height:48px;border-radius:50%;background:var(--bg-tertiary,#1e293b);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:var(--accent-color,#3b82f6);flex-shrink:0}
.poi-drawer-ti{flex:1;min-width:0}
.poi-drawer-nm{font-size:16px;font-weight:700;color:var(--text-primary,#e2e8f0)}
.poi-drawer-rl{font-size:11px;color:var(--text-secondary,#94a3b8);margin-top:2px}
.poi-drawer-x{width:32px;height:32px;border-radius:6px;background:var(--bg-tertiary,#1e293b);border:1px solid var(--border-color,#1e293b);color:var(--text-secondary,#94a3b8);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.poi-drawer-x:hover{color:var(--text-primary,#e2e8f0)}
.poi-drawer-body{flex:1;overflow-y:auto;padding:20px}
.poi-dsec{margin-bottom:20px}
.poi-dsec-t{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted,#64748b);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.poi-dsec-t::after{content:'';flex:1;height:1px;background:var(--border-color,#1e293b)}
.poi-dmg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.poi-dm{background:var(--bg-secondary,#111827);border:1px solid var(--border-color,#1e293b);border-radius:6px;padding:10px;text-align:center}
.poi-dm-l{font-size:8px;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
.poi-dm-v{font-size:18px;font-weight:700;color:var(--text-primary,#e2e8f0)}
.poi-dsum{font-size:12px;color:var(--text-secondary,#94a3b8);line-height:1.6;background:var(--bg-secondary,#111827);border:1px solid var(--border-color,#1e293b);border-radius:6px;padding:12px}
.poi-dai{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color,#1e293b);font-size:11px;color:var(--text-secondary,#94a3b8);line-height:1.4}
.poi-dai:last-child{border-bottom:none}
.poi-dai-dot{width:5px;height:5px;border-radius:50%;background:var(--accent-color,#3b82f6);margin-top:5px;flex-shrink:0}
.poi-dart{display:block;padding:8px 10px;background:var(--bg-secondary,#111827);border:1px solid var(--border-color,#1e293b);border-radius:6px;margin-bottom:6px;text-decoration:none}
.poi-dart:hover{border-color:var(--accent-color,#3b82f6)}
.poi-dart-t{font-size:11px;color:var(--text-primary,#e2e8f0);line-height:1.3}
.poi-dart-d{font-size:9px;color:var(--text-muted,#64748b);margin-top:3px}
.poi-dents{display:flex;flex-wrap:wrap;gap:5px}
.poi-dent{padding:3px 8px;background:color-mix(in srgb,var(--accent-color,#3b82f6) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent-color,#3b82f6) 25%,transparent);border-radius:12px;font-size:10px;color:var(--accent-color,#3b82f6)}
  `;
  document.head.appendChild(s);
}

export class POIPanel extends Panel {
  private data: POIPerson[] = [];
  private filtered: POIPerson[] = [];
  private searchQuery = '';
  private riskFilter: string | null = null;
  private sortBy: 'activity' | 'mentions' | 'risk' | 'name' = 'activity';
  private drawerEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;

  constructor() {
    super({ id: 'poi', title: 'Persons of Interest', defaultRowSpan: 2 });
    injectPOIStyles();
    void this.fetchData();
  }

  async fetchData(): Promise<void> {
    this.showLoading('Loading persons of interest…');
    try {
      const res = await fetch('/api/poi');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: POIData = await res.json();
      this.data = json.persons || [];
      this.resetRetryBackoff();
    } catch (err) {
      console.error('[POIPanel] Failed to fetch:', err);
      this.data = [];
      this.showError('Failed to load POI data', () => { void this.fetchData(); });
      return;
    }
    this.applyFilters();
    this.renderContent();
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
    const ro: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    switch (this.sortBy) {
      case 'activity': list.sort((a, b) => b.activityScore - a.activityScore); break;
      case 'mentions': list.sort((a, b) => b.mentionCount - a.mentionCount); break;
      case 'risk': list.sort((a, b) => (ro[a.riskLevel] ?? 3) - (ro[b.riskLevel] ?? 3)); break;
      case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    this.filtered = list;
  }

  private renderContent(): void {
    this.setCount(this.data.length);
    if (this.data.length === 0) {
      this.content.innerHTML = '<div class="poi-empty">No persons of interest data available. Run /seed to populate.</div>';
      return;
    }

    const html = `
      <div class="poi-toolbar">
        <input class="poi-search" type="text" placeholder="Search name, role, location…" value="${esc(this.searchQuery)}" />
        <button class="poi-fbtn ${!this.riskFilter ? 'active' : ''}" data-risk="">ALL</button>
        <button class="poi-fbtn ${this.riskFilter === 'critical' ? 'active' : ''}" data-risk="critical">CRIT</button>
        <button class="poi-fbtn ${this.riskFilter === 'high' ? 'active' : ''}" data-risk="high">HIGH</button>
        <button class="poi-fbtn ${this.riskFilter === 'medium' ? 'active' : ''}" data-risk="medium">MED</button>
        <button class="poi-fbtn ${this.riskFilter === 'low' ? 'active' : ''}" data-risk="low">LOW</button>
        <select class="poi-sort">
          <option value="activity" ${this.sortBy === 'activity' ? 'selected' : ''}>⚡ Activity</option>
          <option value="mentions" ${this.sortBy === 'mentions' ? 'selected' : ''}>📊 Mentions</option>
          <option value="risk" ${this.sortBy === 'risk' ? 'selected' : ''}>⚠ Risk</option>
          <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>A→Z</option>
        </select>
        <span class="poi-count">${this.filtered.length}/${this.data.length}</span>
      </div>
      <div class="poi-cards">
        ${this.filtered.length === 0
          ? '<div class="poi-empty">No persons match filters</div>'
          : this.filtered.map((p, i) => this.cardHtml(p, i)).join('')}
      </div>`;

    this.content.innerHTML = html;
    this.bindContentEvents();
  }

  private cardHtml(p: POIPerson, idx: number): string {
    const ini = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const rc = RISK_COLORS[p.riskLevel] || '#eab308';
    const sc = toneToColor(p.averageTone);
    const rf = REGION_FLAGS[p.region] || '🌐';
    return `<div class="poi-card" data-idx="${idx}" style="--card-risk:${rc}">
      <div class="poi-card-hdr">
        <div class="poi-av" style="border-color:${rc}">${ini}</div>
        <div class="poi-info"><div class="poi-nm">${esc(p.name)}</div><div class="poi-rl">${esc(p.role)}</div><div class="poi-rg">${rf} ${esc(p.region)}</div></div>
        <div class="poi-badges"><span class="poi-risk" style="color:${rc};background:${rc}18;border:1px solid ${rc}40">${RISK_ICONS[p.riskLevel] || '●'} ${p.riskLevel}</span><span class="poi-sent" style="color:${sc}">${SENTIMENT_ICONS[p.sentiment] || '●'}</span></div>
      </div>
      <div class="poi-metrics">
        <div><div class="poi-ml">Mentions</div><div class="poi-mv">${p.mentionCount.toLocaleString()}</div></div>
        <div><div class="poi-ml">Activity</div>${gauge(p.activityScore)}</div>
        <div><div class="poi-ml">Tone</div><div class="poi-mv" style="color:${sc};font-size:11px">${toneToLabel(p.averageTone)}</div></div>
      </div>
      <div class="poi-loc"><span>📍</span><span class="poi-loc-nm">${esc(p.lastKnownLocation)}</span>${confidenceBar(p.locationConfidence)}</div>
      ${p.tags.length > 0 ? `<div class="poi-tags">${p.tags.slice(0, 5).map((t) => `<span class="poi-tg">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="poi-sum">${esc(p.summary)}</div>
    </div>`;
  }

  private bindContentEvents(): void {
    const search = this.content.querySelector('.poi-search') as HTMLInputElement | null;
    if (search) {
      let db: ReturnType<typeof setTimeout>;
      search.addEventListener('input', () => {
        clearTimeout(db);
        db = setTimeout(() => { this.searchQuery = search.value.trim(); this.applyFilters(); this.renderContent(); }, 200);
      });
    }
    this.content.querySelectorAll('.poi-fbtn[data-risk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r: string = (btn as HTMLElement).dataset.risk || '';
        this.riskFilter = r.length > 0 ? r : null;
        this.applyFilters();
        this.renderContent();
      });
    });
    const sort = this.content.querySelector('.poi-sort') as HTMLSelectElement | null;
    if (sort) {
      sort.addEventListener('change', () => { this.sortBy = sort.value as 'activity' | 'mentions' | 'risk' | 'name'; this.applyFilters(); this.renderContent(); });
    }
    this.content.querySelectorAll('.poi-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt((card as HTMLElement).dataset.idx || '0', 10);
        const person = this.filtered[idx];
        if (person) this.openDrawer(person);
      });
    });
  }

  private openDrawer(p: POIPerson): void {
    this.closeDrawer();
    const rc = RISK_COLORS[p.riskLevel] || '#eab308';
    const sc = toneToColor(p.averageTone);
    const ini = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'poi-drawer-overlay';
    this.overlayEl.addEventListener('click', () => this.closeDrawer());
    document.body.appendChild(this.overlayEl);

    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'poi-drawer';
    this.drawerEl.innerHTML = `
      <div class="poi-drawer-hdr">
        <div class="poi-drawer-av" style="border-color:${rc}">${ini}</div>
        <div class="poi-drawer-ti"><div class="poi-drawer-nm">${esc(p.name)}</div><div class="poi-drawer-rl">${esc(p.role)} · ${esc(p.region)}</div></div>
        <button class="poi-drawer-x">✕</button>
      </div>
      <div class="poi-drawer-body">
        <div class="poi-dsec"><div class="poi-dsec-t">Key Metrics</div>
          <div class="poi-dmg">
            <div class="poi-dm"><div class="poi-dm-l">Risk</div><div class="poi-dm-v" style="color:${rc}">${p.riskLevel.toUpperCase()}</div></div>
            <div class="poi-dm"><div class="poi-dm-l">Mentions</div><div class="poi-dm-v">${p.mentionCount.toLocaleString()}</div></div>
            <div class="poi-dm"><div class="poi-dm-l">Activity</div><div class="poi-dm-v">${p.activityScore}</div></div>
            <div class="poi-dm"><div class="poi-dm-l">Avg Tone</div><div class="poi-dm-v" style="color:${sc}">${p.averageTone.toFixed(2)}</div></div>
            <div class="poi-dm"><div class="poi-dm-l">Location</div><div class="poi-dm-v" style="font-size:11px">${esc(p.lastKnownLocation)}</div></div>
            <div class="poi-dm"><div class="poi-dm-l">Confidence</div><div class="poi-dm-v">${Math.round(p.locationConfidence * 100)}%</div></div>
          </div>
        </div>
        <div class="poi-dsec"><div class="poi-dsec-t">AI Summary</div><div class="poi-dsum">${esc(p.summary)}</div></div>
        ${p.recentActivity.length > 0 ? `<div class="poi-dsec"><div class="poi-dsec-t">Recent Activity</div>${p.recentActivity.map((a) => `<div class="poi-dai"><div class="poi-dai-dot"></div><div>${esc(a)}</div></div>`).join('')}</div>` : ''}
        ${p.recentArticles.length > 0 ? `<div class="poi-dsec"><div class="poi-dsec-t">Source Articles</div>${p.recentArticles.map((a) => `<a class="poi-dart" href="${esc(a.url)}" target="_blank" rel="noopener"><div class="poi-dart-t">${esc(a.title)}</div><div class="poi-dart-d">${esc(a.date)}</div></a>`).join('')}</div>` : ''}
        ${p.associatedEntities.length > 0 ? `<div class="poi-dsec"><div class="poi-dsec-t">Entities</div><div class="poi-dents">${p.associatedEntities.map((e) => `<span class="poi-dent">${esc(e)}</span>`).join('')}</div></div>` : ''}
        ${p.tags.length > 0 ? `<div class="poi-dsec"><div class="poi-dsec-t">Tags</div><div class="poi-tags" style="margin-top:0">${p.tags.map((t) => `<span class="poi-tg">${esc(t)}</span>`).join('')}</div></div>` : ''}
      </div>`;
    document.body.appendChild(this.drawerEl);

    this.drawerEl.querySelector('.poi-drawer-x')?.addEventListener('click', () => this.closeDrawer());
    const escH = (e: KeyboardEvent): void => { if (e.key === 'Escape') { this.closeDrawer(); document.removeEventListener('keydown', escH); } };
    document.addEventListener('keydown', escH);

    requestAnimationFrame(() => { this.overlayEl?.classList.add('open'); this.drawerEl?.classList.add('open'); });
  }

  private closeDrawer(): void {
    if (this.drawerEl) {
      this.drawerEl.classList.remove('open');
      this.overlayEl?.classList.remove('open');
      const d = this.drawerEl;
      const o = this.overlayEl;
      setTimeout(() => { d.remove(); o?.remove(); }, 300);
      this.drawerEl = null;
      this.overlayEl = null;
    }
  }

  public override destroy(): void {
    this.closeDrawer();
    super.destroy();
  }
}
