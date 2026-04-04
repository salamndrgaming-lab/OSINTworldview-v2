/**
 * Signal Confidence Heatmap Panel
 *
 * Shows data freshness / confidence across all intelligence domains
 * by reading staleness metadata from /api/health. Each domain cell
 * displays a color from green (fresh) → amber → red (stale/missing).
 *
 * This is the "data density = intelligence confidence" layer described
 * in the Tier 2 roadmap. It answers the question:
 * "Which parts of the intelligence picture can I trust right now?"
 *
 * Data: /api/health (reads freshness metadata already written by seeds)
 */

import { Panel } from './Panel';

interface HealthCheck {
  status: string;
  records?: number;
  seedAgeMin?: number;
  maxStaleMin?: number;
}

interface HealthData {
  status?: string;
  checks?: Record<string, HealthCheck>;
  summary?: { total: number; ok: number; warn: number; crit: number };
}

interface DomainCell {
  id: string;
  label: string;
  icon: string;
  category: string;
  healthKey: string;   // key name in health.checks (e.g. 'gdeltIntel', 'earthquakes')
}

const DOMAINS: DomainCell[] = [
  // Conflict & Security
  { id: 'missiles',    label: 'Missiles',      icon: '🚀', category: 'conflict',   healthKey: 'missileEvents' },
  { id: 'conflict',    label: 'UCDP Conflict', icon: '⚔️', category: 'conflict',   healthKey: 'ucdpEvents' },
  { id: 'iran',        label: 'Iran Events',   icon: '🇮🇷', category: 'conflict',   healthKey: 'iranEvents' },
  { id: 'unrest',      label: 'Unrest',        icon: '✊', category: 'conflict',   healthKey: 'unrestEvents' },
  { id: 'forecast',    label: 'Forecasts',     icon: '📊', category: 'conflict',   healthKey: 'correlationCards' },
  // Intelligence
  { id: 'gdelt',       label: 'GDELT Intel',   icon: '🌐', category: 'intel',      healthKey: 'gdeltIntel' },
  { id: 'poi',         label: 'POI',           icon: '👤', category: 'intel',      healthKey: 'poi' },
  { id: 'insights',    label: 'AI Insights',   icon: '💡', category: 'intel',      healthKey: 'insights' },
  { id: 'hypotheses',  label: 'Hypotheses',    icon: '🔮', category: 'intel',      healthKey: 'hypotheses' },
  { id: 'narrative',   label: 'Narratives',    icon: '📡', category: 'intel',      healthKey: 'narrativeDrift' },
  { id: 'telegram',    label: 'Telegram',      icon: '💬', category: 'intel',      healthKey: 'telegramNarratives' },
  { id: 'xsource',    label: 'X-Source',      icon: '⚡', category: 'intel',      healthKey: 'crossSourceSignals' },
  // Markets & Economy
  { id: 'commodities', label: 'Commodities',   icon: '🛢', category: 'market',     healthKey: 'commodityQuotes' },
  { id: 'markets',     label: 'Markets',       icon: '📈', category: 'market',     healthKey: 'marketQuotes' },
  { id: 'crypto',      label: 'Crypto',        icon: '₿',  category: 'market',     healthKey: 'cryptoQuotes' },
  { id: 'chokepoints', label: 'Chokepoints',   icon: '⚓', category: 'market',     healthKey: 'chokepoints' },
  { id: 'predictions', label: 'Predictions',   icon: '🎯', category: 'market',     healthKey: 'predictions' },
  // Environment & Infrastructure
  { id: 'earthquakes', label: 'Earthquakes',   icon: '🌍', category: 'env',        healthKey: 'earthquakes' },
  { id: 'weather',     label: 'Weather',       icon: '⛈', category: 'env',        healthKey: 'weatherAlerts' },
  { id: 'radiation',   label: 'Radiation',     icon: '☢️', category: 'env',        healthKey: 'displacement' },
  { id: 'disease',     label: 'Disease',       icon: '🏥', category: 'env',        healthKey: 'naturalEvents' },
  { id: 'fires',       label: 'Wildfires',     icon: '🔥', category: 'env',        healthKey: 'wildfires' },
  // Cyber & Tech
  { id: 'cyber',       label: 'Cyber',         icon: '💻', category: 'cyber',      healthKey: 'cyberThreats' },
  { id: 'outages',     label: 'Outages',       icon: '🔴', category: 'cyber',      healthKey: 'outages' },
  { id: 'flights',     label: 'Mil Flights',   icon: '✈️', category: 'cyber',      healthKey: 'militaryFlights' },
];

const CATEGORY_LABELS: Record<string, string> = {
  conflict: 'Conflict',
  intel:    'Intelligence',
  market:   'Markets',
  env:      'Environment',
  cyber:    'Cyber',
};

// Staleness thresholds — how old (minutes) before a domain turns amber/red
const AMBER_MIN = 120;  // >2h = amber (fallback when maxStaleMin not available)

export class SignalConfidencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'signal-confidence',
      title: 'Signal Confidence',
      showCount: false,
      closable: true,
      defaultRowSpan: 2,
      className: 'signal-confidence-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchData();
    this.refreshTimer = setInterval(() => { void this.fetchData(); }, 300_000); // 5 min
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase">
        🗺 Intelligence Coverage Map
      </div>
      <div id="sig-summary" style="font-size:9px;color:var(--text-muted)"></div>
    `;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'sig-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
    body.innerHTML = this.loadingHTML();
    this.content.appendChild(body);
  }

  private loadingHTML(): string {
    return `<div style="text-align:center;padding:24px;color:var(--text-dim)">
      <div style="width:22px;height:22px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:sig-spin 0.8s linear infinite;margin:0 auto 10px"></div>
      <div style="font-size:11px">Checking signal freshness…</div>
      <style>@keyframes sig-spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  private async fetchData(): Promise<void> {
    try {
      const resp = await fetch('/api/health', { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: HealthData = await resp.json();
      this.render(data);
    } catch {
      const body = this.content.querySelector('#sig-body');
      if (body) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:26px;opacity:0.3;margin-bottom:8px">🗺</div>
          <div style="font-size:11px">Health data unavailable</div>
        </div>`;
      }
    }
  }

  private render(data: HealthData): void {
    const body = this.content.querySelector('#sig-body');
    const summary = this.content.querySelector('#sig-summary');
    if (!body) return;

    const checks = data.checks ?? {};

    // Score each domain based on health check data
    const scored = DOMAINS.map(domain => {
      const check = checks[domain.healthKey];
      let ageMin: number | null = null;
      let present = false;
      let records = 0;
      let confidence: 'fresh' | 'amber' | 'stale' | 'missing' = 'missing';

      if (check) {
        const status = check.status || '';
        records = check.records ?? 0;

        if (status === 'EMPTY' || status === 'EMPTY_DATA') {
          confidence = 'missing';
        } else if (check.seedAgeMin != null) {
          ageMin = check.seedAgeMin;
          present = true;
          const threshold = check.maxStaleMin ?? AMBER_MIN;
          confidence = ageMin <= threshold ? 'fresh' : ageMin <= threshold * 2 ? 'amber' : 'stale';
        } else if (status === 'STALE_SEED') {
          present = true;
          confidence = 'stale';
        } else if (status === 'OK' || status === 'OK_CASCADE') {
          present = true;
          confidence = 'fresh';
        }
      }

      return { ...domain, ageMin, present, confidence, records };
    });

    // Summary counts
    const fresh = scored.filter(d => d.confidence === 'fresh').length;
    const amber = scored.filter(d => d.confidence === 'amber').length;
    const stale = scored.filter(d => d.confidence === 'stale').length;
    const missing = scored.filter(d => d.confidence === 'missing').length;
    const overallPct = Math.round((fresh / scored.length) * 100);

    if (summary) {
      summary.innerHTML = `
        <span style="color:#22c55e">●</span> ${fresh}
        <span style="color:#d4a843;margin-left:4px">●</span> ${amber}
        <span style="color:#ef4444;margin-left:4px">●</span> ${stale + missing}
        <span style="color:var(--text-muted);margin-left:6px">${overallPct}% live</span>
      `;
    }

    // Group by category
    const grouped: Record<string, typeof scored> = {};
    for (const d of scored) {
      const bucket = grouped[d.category];
      if (bucket === undefined) {
        grouped[d.category] = [d];
      } else {
        bucket.push(d);
      }
    }

    let html = '';

    for (const [cat, items] of Object.entries(grouped)) {
      html += `<div style="margin-bottom:10px">
        <div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">${CATEGORY_LABELS[cat] ?? cat}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:4px">
          ${items.map(d => this.renderCell(d)).join('')}
        </div>
      </div>`;
    }

    // Legend
    html += `<div style="display:flex;gap:10px;justify-content:center;padding:6px 0;border-top:1px solid var(--vi-border-subtle,#1a1a28);margin-top:4px">
      <div style="font-size:8px;color:#22c55e">● Fresh (&lt;2h)</div>
      <div style="font-size:8px;color:#d4a843">● Aging (2–6h)</div>
      <div style="font-size:8px;color:#ef4444">● Stale (&gt;6h)</div>
      <div style="font-size:8px;color:#444">● No data</div>
    </div>`;

    body.innerHTML = html;
  }

  private renderCell(d: {
    icon: string; label: string; confidence: string;
    ageMin: number | null; present: boolean; records?: number;
  }): string {
    type ColorEntry = { bg: string; border: string; text: string; dot: string };
    const colors: Record<string, ColorEntry> = {
      fresh:   { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',   text: '#22c55e', dot: '#22c55e' },
      amber:   { bg: 'rgba(212,168,67,0.08)',   border: 'rgba(212,168,67,0.25)',  text: '#d4a843', dot: '#d4a843' },
      stale:   { bg: 'rgba(239,68,68,0.08)',    border: 'rgba(239,68,68,0.25)',   text: '#ef4444', dot: '#ef4444' },
      missing: { bg: 'rgba(75,75,90,0.08)',     border: 'rgba(75,75,90,0.2)',     text: '#444',    dot: '#333' },
    };
    const missing: ColorEntry = { bg: 'rgba(75,75,90,0.08)', border: 'rgba(75,75,90,0.2)', text: '#444', dot: '#333' };
    const c: ColorEntry = colors[d.confidence] ?? missing;
    const bg: string = c.bg;
    const border: string = c.border;
    const text: string = c.text;

    const ageStr = d.ageMin !== null
      ? (d.ageMin < 60 ? `${d.ageMin}m` : `${Math.round(d.ageMin / 60)}h`) + ' ago'
      : d.present ? 'Active' : 'No data';

    const recStr = d.records ? ` · ${d.records}` : '';

    return `<div style="
      background:${bg};border:1px solid ${border};border-radius:6px;
      padding:6px 7px;text-align:center;cursor:default;
    " title="${this.esc(d.label)}: ${ageStr}${recStr ? ' (' + d.records + ' records)' : ''}">
      <div style="font-size:16px;line-height:1;margin-bottom:3px">${d.icon}</div>
      <div style="font-size:9px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(d.label)}</div>
      <div style="font-size:8px;color:${text};margin-top:1px">${ageStr}</div>
    </div>`;
  }

  private esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
