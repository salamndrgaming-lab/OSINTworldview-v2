import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

interface CorrelatedItem {
  source: string;
  type: string;
  title: string;
  relevance: number;
  timestamp?: number;
}

export class CorrelationEnginePanel extends Panel {
  private currentRegion = '';
  private correlations: CorrelatedItem[] = [];
  private isSearching = false;

  constructor() {
    super({
      id: 'correlation-engine',
      title: '🔗 Correlation Engine',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Click any map event to find correlated intelligence across all data sources',
    });
    this.renderIdle();
    window.addEventListener('godmode-correlate', ((e: CustomEvent) => {
      const { region, lat, lon, eventType, title } = e.detail || {};
      if (region || lat) this.runCorrelation(region || `${lat?.toFixed(1)},${lon?.toFixed(1)}`, eventType, title);
    }) as EventListener);
  }

  private renderIdle(): void {
    replaceChildren(this.content,
      h('div', { style: 'padding:16px;text-align:center;opacity:.5;font-size:13px' },
        h('div', { style: 'font-size:24px;margin-bottom:8px' }, '🔗'),
        h('div', {}, 'Click any event on the map to find correlated intelligence across all data sources.'),
        h('div', { style: 'margin-top:12px' },
          h('input', {
            type: 'text',
            id: 'correlation-search',
            placeholder: 'Or type a region/country...',
            style: 'background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px 12px;color:var(--text-primary,#fff);font-size:13px;outline:none;width:80%',
            onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') { const inp = e.target as HTMLInputElement; this.runCorrelation(inp.value.trim()); } },
          }),
        ),
      ),
    );
  }

  public async runCorrelation(region: string, eventType?: string, eventTitle?: string): Promise<void> {
    if (!region || this.isSearching) return;
    this.currentRegion = region;
    this.isSearching = true;

    this.content.innerHTML = `<div style="padding:12px;opacity:.7;font-size:13px">⏳ Searching for correlated intelligence in <strong>${escapeHtml(region)}</strong>...</div>`;

    try {
      const searchResp = await fetch(toApiUrl(`/api/search?q=${encodeURIComponent(region + (eventType ? ' ' + eventType : ''))}&k=15&format=json`));
      let searchResults: Array<{ data?: string; metadata?: Record<string, string>; score?: number }> = [];
      if (searchResp.ok) {
        const data = await searchResp.json();
        searchResults = data.results || [];
      }

      const alertResp = await fetch(toApiUrl('/api/alerts'));
      let relatedAlerts: Array<{ title?: string; type?: string; severity?: string; source?: string; timestamp?: number }> = [];
      if (alertResp.ok) {
        const alertData = await alertResp.json();
        const regionLower = region.toLowerCase();
        relatedAlerts = (alertData.alerts || []).filter((a: { title?: string }) =>
          (a.title || '').toLowerCase().includes(regionLower)
        );
      }

      this.correlations = [];

      for (const r of searchResults) {
        this.correlations.push({
          source: r.metadata?.type || 'unknown',
          type: r.metadata?.severity || r.metadata?.risk_level || '',
          title: (r.data || '').slice(0, 150),
          relevance: Math.round((r.score || 0) * 100),
          timestamp: r.metadata?.timestamp ? Number(r.metadata.timestamp) : undefined,
        });
      }

      for (const a of relatedAlerts) {
        this.correlations.push({
          source: 'alert',
          type: a.severity || '',
          title: a.title || '',
          relevance: 95,
          timestamp: a.timestamp,
        });
      }

      this.correlations.sort((a, b) => b.relevance - a.relevance);
      this.renderResults(region, eventTitle);
    } catch (err) {
      this.content.innerHTML = `<div style="padding:12px;color:#ef4444;font-size:13px">Correlation search failed: ${escapeHtml(String(err))}</div>`;
    } finally {
      this.isSearching = false;
    }
  }

  private renderResults(region: string, eventTitle?: string): void {
    const sourceColors: Record<string, string> = {
      'gdelt-intel': '#3b82f6', 'missile-strike': '#ef4444', 'disease-outbreak': '#f59e0b',
      'conflict-forecast': '#dc2626', 'poi': '#8b5cf6', 'agent-sitrep': '#06b6d4',
      'alert': '#f97316', 'unrest': '#eab308', unknown: '#6b7280',
    };

    let html = `<div style="padding:8px">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text-primary,#fff)">📍 ${escapeHtml(region)}</div>
        ${eventTitle ? `<div style="font-size:11px;opacity:.5">${escapeHtml(eventTitle.slice(0, 80))}</div>` : ''}
      </div>
      <span style="font-size:11px;opacity:.5">${this.correlations.length} correlations</span>
    </div>`;

    if (this.correlations.length === 0) {
      html += `<div style="opacity:.5;text-align:center;padding:20px;font-size:13px">No correlated intelligence found for this region</div>`;
    }

    const grouped = new Map<string, CorrelatedItem[]>();
    for (const c of this.correlations) {
      const group = grouped.get(c.source) || [];
      group.push(c);
      grouped.set(c.source, group);
    }

    for (const [source, items] of grouped) {
      const color = sourceColors[source] || '#6b7280';
      const label = source.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      html += `<div style="margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="background:${color};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase">${escapeHtml(label)}</span>
          <span style="font-size:10px;opacity:.4">${items.length} items</span>
        </div>`;

      for (const item of items.slice(0, 4)) {
        const sevBadge = item.type ? `<span style="opacity:.6;font-size:10px;text-transform:uppercase"> [${escapeHtml(item.type)}]</span>` : '';
        html += `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border-color,#1a1a1a);color:var(--text-secondary,#ccc)">
          <span style="color:var(--accent,#4a90d9);font-size:10px;font-weight:700">${item.relevance}%</span> ${escapeHtml(item.title)}${sevBadge}
        </div>`;
      }

      html += `</div>`;
    }

    html += `</div>`;
    this.content.innerHTML = html;
  }

  public async refresh(): Promise<void> {
    if (this.currentRegion) this.runCorrelation(this.currentRegion);
  }
}
