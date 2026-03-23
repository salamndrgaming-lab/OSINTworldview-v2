import { Panel } from './Panel';

import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

// Godmode-exclusive Geopolitical Risk Radar panel.
// Pulls data from multiple intelligence endpoints and renders a live
// risk matrix showing regional threat levels, active events, and trends.

interface RegionRisk {
  name: string;
  threatLevel: string;
  activeEvents: number;
  topEvent: string;
  sources: string[];
}

export class GeoRiskRadarPanel extends Panel {
  private regions: RegionRisk[] = [];
  private overallThreat = 'unknown';
  private lastUpdate: Date | null = null;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'geo-risk-radar',
      title: '🎯 Geopolitical Risk Radar',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Real-time geopolitical risk matrix synthesized from all intelligence sources',
    });
    this.loadData();
    // Auto-refresh every 2 minutes for a live operations feel
    this.autoRefreshTimer = setInterval(() => this.loadData(), 120_000);
  }

  private async loadData(): Promise<void> {
    try {
      // Fetch from multiple endpoints in parallel
      const [sitrepResp, forecastResp, missileResp, alertResp] = await Promise.all([
        fetch(toApiUrl('/api/agent-sitrep?format=json')).catch(() => null),
        fetch(toApiUrl('/api/conflict-forecast')).catch(() => null),
        fetch(toApiUrl('/api/missile-events')).catch(() => null),
        fetch(toApiUrl('/api/alerts')).catch(() => null),
      ]);

      // Parse all data sources
      const sitrep = sitrepResp?.ok ? await sitrepResp.json() : null;
      const forecasts = forecastResp?.ok ? await forecastResp.json() : null;
      const missiles = missileResp?.ok ? await missileResp.json() : null;
      const alerts = alertResp?.ok ? await alertResp.json() : null;

      this.overallThreat = sitrep?.overall_threat_level || 'unknown';

      // Build regional risk assessment from all sources
      const regionMap = new Map<string, { events: number; severity: number; topEvent: string; sources: Set<string> }>();

      // Add conflict forecast data (by region)
      const regionMapping: Record<string, string> = {
        UA: 'Eastern Europe', RU: 'Eastern Europe', BY: 'Eastern Europe',
        SY: 'Middle East', IQ: 'Middle East', IR: 'Middle East', YE: 'Middle East',
        IL: 'Middle East', LB: 'Middle East', JO: 'Middle East', SA: 'Middle East',
        SD: 'Sub-Saharan Africa', SS: 'Sub-Saharan Africa', ET: 'Sub-Saharan Africa',
        SO: 'Sub-Saharan Africa', CD: 'Sub-Saharan Africa', NG: 'Sub-Saharan Africa',
        ML: 'Sub-Saharan Africa', NE: 'Sub-Saharan Africa', BF: 'Sub-Saharan Africa',
        CM: 'Sub-Saharan Africa', MZ: 'Sub-Saharan Africa',
        AF: 'Central/South Asia', PK: 'Central/South Asia', IN: 'Central/South Asia',
        MM: 'Southeast Asia', PH: 'Southeast Asia', TH: 'Southeast Asia',
        CN: 'East Asia', KP: 'East Asia', KR: 'East Asia', TW: 'East Asia',
        LY: 'North Africa', DZ: 'North Africa', EG: 'North Africa', TN: 'North Africa',
        CO: 'Latin America', VE: 'Latin America', MX: 'Latin America', HT: 'Latin America',
      };

      if (forecasts?.forecasts) {
        for (const f of forecasts.forecasts.filter((x: { predictedLogFatalities: number }) => x.predictedLogFatalities > 1)) {
          const region = regionMapping[f.countryCode] || 'Other';
          const entry = regionMap.get(region) || { events: 0, severity: 0, topEvent: '', sources: new Set() };
          entry.events++;
          entry.severity = Math.max(entry.severity, f.predictedLogFatalities);
          if (f.predictedLogFatalities > entry.severity - 0.5) {
            entry.topEvent = `${f.countryName || f.countryCode}: ~${f.estimatedFatalities} predicted fatalities/mo`;
          }
          entry.sources.add('VIEWS');
          regionMap.set(region, entry);
        }
      }

      // Add missile events by region
      if (missiles?.events) {
        const sixH = Date.now() - 6 * 3600_000;
        const recent = missiles.events.filter((e: { timestamp: number }) => e.timestamp >= sixH);
        for (const e of recent) {
          // Rough region mapping from location names
          const loc = (e.locationName || '').toLowerCase();
          let region = 'Other';
          if (/ukraine|kyiv|kharkiv|odesa|dnipro|kherson|crimea|donbas/.test(loc)) region = 'Eastern Europe';
          else if (/gaza|israel|syria|iraq|iran|yemen|lebanon|beirut/.test(loc)) region = 'Middle East';
          else if (/sudan|ethiopia|somalia|nigeria|mali|niger/.test(loc)) region = 'Sub-Saharan Africa';
          else if (/afghan|pakistan|india|kashmir/.test(loc)) region = 'Central/South Asia';
          else if (/myanmar|philippines/.test(loc)) region = 'Southeast Asia';

          const entry = regionMap.get(region) || { events: 0, severity: 0, topEvent: '', sources: new Set() };
          entry.events++;
          const sevScore = e.severity === 'critical' ? 6 : e.severity === 'high' ? 4 : 2;
          entry.severity = Math.max(entry.severity, sevScore);
          entry.sources.add('GDELT');
          if (!entry.topEvent) entry.topEvent = (e.title || '').slice(0, 80);
          regionMap.set(region, entry);
        }
      }

      // Add alerts
      if (alerts?.alerts) {
        for (const a of alerts.alerts.slice(0, 10)) {
          const sevScore = a.severity === 'critical' ? 6 : a.severity === 'high' ? 4 : 2;
          // Alerts don't have regions, attribute to 'Global'
          const entry = regionMap.get('Global Alerts') || { events: 0, severity: 0, topEvent: '', sources: new Set() };
          entry.events++;
          entry.severity = Math.max(entry.severity, sevScore);
          if (!entry.topEvent) entry.topEvent = a.title || '';
          entry.sources.add(a.source || 'Intel');
          regionMap.set('Global Alerts', entry);
        }
      }

      // Convert to sorted array
      this.regions = Array.from(regionMap.entries())
        .map(([name, data]) => ({
          name,
          threatLevel: data.severity > 5 ? 'critical' : data.severity > 3 ? 'high' : data.severity > 1 ? 'elevated' : 'moderate',
          activeEvents: data.events,
          topEvent: data.topEvent,
          sources: Array.from(data.sources),
        }))
        .sort((a, b) => {
          const order: Record<string, number> = { critical: 0, high: 1, elevated: 2, moderate: 3 };
          return (order[a.threatLevel] ?? 3) - (order[b.threatLevel] ?? 3);
        });

      this.lastUpdate = new Date();
      this.renderRadar();
    } catch (err) {
      replaceChildren(this.content, h('div', { style: 'padding:12px;color:#ef4444;font-size:13px' }, 'Failed to load risk data: ' + String(err)));
    }
  }

  private renderRadar(): void {
    const threatColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', unknown: '#6b7280' };
    const overallColor = threatColors[this.overallThreat] || '#6b7280';

    let html = `<div style="padding:8px">`;

    // Overall threat header
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.6">Global Threat Level</span>
        <div style="margin-top:2px"><span style="background:${overallColor};color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${escapeHtml(this.overallThreat.toUpperCase())}</span></div>
      </div>
      <div style="font-size:10px;opacity:.4">${this.lastUpdate ? 'Updated ' + this.lastUpdate.toLocaleTimeString() : ''}</div>
    </div>`;

    // Region cards
    if (this.regions.length === 0) {
      html += `<div style="opacity:.5;font-size:13px;text-align:center;padding:20px">No active regional threats detected</div>`;
    }

    for (const region of this.regions) {
      const rc = threatColors[region.threatLevel] || '#6b7280';
      html += `<div style="background:var(--bg-tertiary,#141414);border:1px solid ${rc}40;border-left:3px solid ${rc};border-radius:6px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:700;font-size:13px;color:var(--text-primary,#fff)">${escapeHtml(region.name)}</span>
          <span style="background:${rc};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase">${escapeHtml(region.threatLevel)}</span>
        </div>
        <div style="font-size:12px;opacity:.7;margin-bottom:2px">${region.activeEvents} active events · Sources: ${escapeHtml(region.sources.join(', '))}</div>
        ${region.topEvent ? `<div style="font-size:11px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(region.topEvent)}</div>` : ''}
      </div>`;
    }

    html += `</div>`;
    this.content.innerHTML = html;
  }

  public async refresh(): Promise<void> {
    await this.loadData();
  }

  public destroy(): void {
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
    super.destroy?.();
  }
}
