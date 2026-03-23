import { Panel } from './Panel';

import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

// Godmode-exclusive Intelligence Timeline panel.
// Pulls from time machine snapshots and shows how the intelligence
// picture has evolved — which countries escalated, where new threats
// emerged, and what changed day over day.

interface SnapshotSummary {
  date: string;
  missileCount: number;
  forecastHighRisk: number;
  diseaseCount: number;
  anomalyCount: number;
  threatLevel: string;
  topEvents: string[];
}

export class IntelTimelinePanel extends Panel {
  private snapshots: SnapshotSummary[] = [];
  private availableDates: string[] = [];

  constructor() {
    super({
      id: 'intel-timeline',
      title: '📅 Intelligence Timeline',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Track how the global intelligence picture has evolved over time using daily snapshots',
    });
    this.loadTimeline();
  }

  private async loadTimeline(): Promise<void> {
    this.showLoading();

    try {
      // Fetch available snapshot dates
      const indexResp = await fetch(toApiUrl('/api/snapshot?format=json'));
      if (!indexResp.ok) throw new Error('Snapshot API unavailable');
      const indexData = await indexResp.json();
      this.availableDates = indexData.dates || [];

      if (this.availableDates.length === 0) {
        replaceChildren(this.content, h('div', { style: 'padding:16px;text-align:center;opacity:.5;font-size:13px' },
          'No snapshots available yet. Snapshots are created during each seed run. Check back after the next cycle.',
        ));
        return;
      }

      // Fetch the last 7 snapshots (or however many are available)
      const datesToFetch = this.availableDates.slice(0, 7);
      const snapshotPromises = datesToFetch.map(async (date) => {
        try {
          const resp = await fetch(toApiUrl(`/api/snapshot?date=${date}&format=json`));
          if (!resp.ok) return null;
          return resp.json();
        } catch { return null; }
      });

      const results = await Promise.all(snapshotPromises);

      this.snapshots = results
        .filter(Boolean)
        .map((snap) => {
          const s = snap.sources || {};
          return {
            date: snap.date || '?',
            missileCount: s.missiles?.eventCount || 0,
            forecastHighRisk: (s.conflictForecast?.forecasts || []).filter((f: { predictedLogFatalities?: number }) => (f.predictedLogFatalities || 0) > 3).length,
            diseaseCount: s.diseaseOutbreaks?.eventCount || 0,
            anomalyCount: s.radiation?.anomalyCount || 0,
            threatLevel: s.agentSitrep?.overall_threat_level || 'unknown',
            topEvents: this.extractTopEvents(s),
          };
        });

      this.renderTimeline();
    } catch (err) {
      replaceChildren(this.content, h('div', { style: 'padding:12px;color:#ef4444;font-size:13px' },
        'Failed to load timeline: ' + String(err),
      ));
    }
  }

  private extractTopEvents(sources: Record<string, unknown>): string[] {
    const events: string[] = [];
    const missiles = sources.missiles as { events?: Array<{ title?: string }> } | undefined;
    const diseases = sources.diseaseOutbreaks as { events?: Array<{ title?: string }> } | undefined;
    const sitrep = sources.agentSitrep as { sectionTitles?: string[] } | undefined;

    if (missiles?.events?.[0]?.title) events.push('🚀 ' + (missiles.events[0].title || '').slice(0, 60));
    if (diseases?.events?.[0]?.title) events.push('🦠 ' + (diseases.events[0].title || '').slice(0, 60));
    if (sitrep?.sectionTitles?.[0]) events.push('📋 ' + sitrep.sectionTitles[0]);

    return events.slice(0, 3);
  }

  private renderTimeline(): void {
    const threatColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', low: '#6b7280', unknown: '#555' };

    let html = `<div style="padding:8px">`;
    html += `<div style="font-size:11px;opacity:.5;margin-bottom:10px">${this.availableDates.length} snapshots available · Showing last ${this.snapshots.length} days</div>`;

    if (this.snapshots.length === 0) {
      html += `<div style="opacity:.5;text-align:center;padding:20px;font-size:13px">No snapshot data to display</div>`;
    }

    for (let i = 0; i < this.snapshots.length; i++) {
      const snap = this.snapshots[i]!;
      const prev: SnapshotSummary | undefined = this.snapshots[i + 1];
      const tc = threatColors[snap.threatLevel] || '#555';

      // Calculate deltas from previous day
      const missileDelta = prev ? snap.missileCount - prev.missileCount : 0;
      const forecastDelta = prev ? snap.forecastHighRisk - prev.forecastHighRisk : 0;
      const diseaseDelta = prev ? snap.diseaseCount - prev.diseaseCount : 0;

      const deltaStr = (val: number) => {
        if (val === 0) return '';
        return val > 0 ? `<span style="color:#ef4444;font-size:10px"> ▲${val}</span>` : `<span style="color:#22c55e;font-size:10px"> ▼${Math.abs(val)}</span>`;
      };

      const isToday = i === 0;

      html += `<div style="background:var(--bg-tertiary,#141414);border:1px solid ${isToday ? tc + '60' : 'var(--border-color,#252525)'};border-radius:6px;padding:10px;margin-bottom:8px;${isToday ? 'border-left:3px solid ' + tc : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:700;font-size:13px;color:var(--text-primary,#fff)">${escapeHtml(snap.date)}${isToday ? ' <span style="font-size:10px;opacity:.6">(latest)</span>' : ''}</span>
          <span style="background:${tc};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase">${escapeHtml(snap.threatLevel)}</span>
        </div>
        <div style="display:flex;gap:12px;font-size:12px;opacity:.7;margin-bottom:4px">
          <span>🚀 ${snap.missileCount} strikes${deltaStr(missileDelta)}</span>
          <span>📊 ${snap.forecastHighRisk} high-risk${deltaStr(forecastDelta)}</span>
          <span>🦠 ${snap.diseaseCount} outbreaks${deltaStr(diseaseDelta)}</span>
          ${snap.anomalyCount > 0 ? `<span>☢️ ${snap.anomalyCount} radiation</span>` : ''}
        </div>
        ${snap.topEvents.length > 0 ? `<div style="font-size:11px;opacity:.5;overflow:hidden">${snap.topEvents.map(e => escapeHtml(e)).join(' · ')}</div>` : ''}
      </div>`;
    }

    html += `<a href="/api/snapshot" target="_blank" rel="noopener" style="display:block;text-align:center;font-size:11px;color:var(--accent,#4a90d9);padding:8px;text-decoration:none">View all snapshots →</a>`;
    html += `</div>`;
    this.content.innerHTML = html;
  }

  public async refresh(): Promise<void> {
    await this.loadTimeline();
  }
}
