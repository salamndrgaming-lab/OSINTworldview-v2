/**
 * Narrative Drift Detection Panel
 *
 * Shows which intelligence topics are surging, rising, stable, or fading
 * based on GDELT mention velocity compared to a 24-hour rolling baseline.
 *
 * Displays:
 *   - Overall drift index badge
 *   - Per-theme drift bars with direction indicators
 *   - Surging/Rising highlighted at top
 *   - Age of last analysis
 *
 * Data: /api/intelligence/narrative-drift  (seeded every 3h)
 */

import { Panel } from './Panel';
import { toApiUrl } from '@/services/runtime';

interface ThemeDrift {
  id: string;
  totalVolume: number;
  recentVolume: number;
  baselineVolume: number | null;
  driftRatio: number;
  driftScore: number;           // percent change vs baseline
  direction: 'surging' | 'rising' | 'stable' | 'fading' | 'collapsed';
  hasBaseline: boolean;
}

interface NarrativeDriftData {
  themes: ThemeDrift[];
  overallDriftIndex: number;
  hasBaseline: boolean;
  themeCount: number;
  generatedAt: string | null;
}

const DIRECTION_META_MAP: Record<string, { label: string; icon: string; color: string }> = {
  surging:   { label: 'SURGING',   icon: '🔺', color: '#ef4444' },
  rising:    { label: 'RISING',    icon: '📈', color: '#f97316' },
  stable:    { label: 'STABLE',    icon: '➡',  color: '#6b7280' },
  fading:    { label: 'FADING',    icon: '📉', color: '#3b82f6' },
  collapsed: { label: 'COLLAPSED', icon: '🔻', color: '#8b5cf6' },
};
const DIRECTION_META_FALLBACK = { label: 'STABLE', icon: '➡', color: '#6b7280' };
function getDirectionMeta(direction: string): { label: string; icon: string; color: string } {
  return DIRECTION_META_MAP[direction] ?? DIRECTION_META_FALLBACK;
}

const THEME_LABELS: Record<string, string> = {
  conflict:   'Conflict & War',
  military:   'Military Ops',
  cyber:      'Cyber / Hack',
  ukraine:    'Ukraine / Russia',
  middleeast: 'Middle East',
  nuclear:    'Nuclear / WMD',
  sanctions:  'Sanctions / Trade',
  china:      'China / Taiwan',
  unrest:     'Civil Unrest',
  energy:     'Energy / OPEC',
};

export class NarrativeDriftPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'narrative-drift',
      title: 'Narrative Drift',
      showCount: false,
      closable: true,
      defaultRowSpan: 3,
      className: 'narrative-drift-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchData();
    this.refreshTimer = setInterval(() => { void this.fetchData(); }, 1_800_000); // 30 min
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase">
        📡 Topic Velocity vs 24h Baseline
      </div>
      <div id="drift-badge" style="font-size:9px;color:var(--text-muted)"></div>
    `;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'drift-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    body.innerHTML = this.loadingHTML();
    this.content.appendChild(body);
  }

  private loadingHTML(): string {
    return `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="width:24px;height:24px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:drift-spin 0.8s linear infinite;margin:0 auto 12px"></div>
      <div style="font-size:11px">Analysing narrative velocity...</div>
      <style>@keyframes drift-spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  /** Hydrate panel with pre-fetched data (from bootstrap or data-loader). */
  setData(data: NarrativeDriftData): void {
    if (data?.themes?.length > 0 || data?.overallDriftIndex != null) {
      this.render(data);
    }
  }

  private async fetchData(): Promise<void> {
    const body = this.content.querySelector('#drift-body');
    if (!body) return;
    try {
      const resp = await fetch(toApiUrl('/api/intelligence/narrative-drift'), {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: NarrativeDriftData = await resp.json();
      this.render(data);
    } catch {
      if (body) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:28px;opacity:0.3;margin-bottom:8px">📡</div>
          <div style="font-size:11px">Drift data unavailable</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Updates every 3 hours via GDELT</div>
        </div>`;
      }
    }
  }

  private render(data: NarrativeDriftData): void {
    const body = this.content.querySelector('#drift-body');
    const badge = this.content.querySelector('#drift-badge');
    if (!body) return;

    const { themes = [], overallDriftIndex, hasBaseline, generatedAt } = data;

    // Update header badge
    if (badge) {
      if (!hasBaseline) {
        badge.textContent = 'Calibrating baseline…';
      } else if (generatedAt) {
        const age = Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000);
        const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
        const driftLabel = overallDriftIndex >= 60 ? '🔴 HIGH' : overallDriftIndex >= 30 ? '🟠 MOD' : '🟢 LOW';
        badge.innerHTML = `${driftLabel} drift · ${ageStr}`;
      }
    }

    if (themes.length === 0) {
      body.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
        <div style="font-size:28px;opacity:0.3;margin-bottom:8px">📡</div>
        <div style="font-size:11px">No theme data yet</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Seed runs every 3 hours</div>
      </div>`;
      return;
    }

    // Summary bar at top
    const surging = themes.filter(t => t.direction === 'surging').length;
    const rising = themes.filter(t => t.direction === 'rising').length;
    const fading = themes.filter(t => t.direction === 'fading' || t.direction === 'collapsed').length;

    let summaryHtml = '';
    if (hasBaseline) {
      summaryHtml = `<div style="display:flex;gap:6px;margin-bottom:8px;padding:6px 8px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px">
        <div style="flex:1;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#ef4444">${surging + rising}</div>
          <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">Rising</div>
        </div>
        <div style="width:1px;background:var(--vi-border,#252535)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#6b7280">${themes.length - surging - rising - fading}</div>
          <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">Stable</div>
        </div>
        <div style="width:1px;background:var(--vi-border,#252535)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#3b82f6">${fading}</div>
          <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">Fading</div>
        </div>
        <div style="width:1px;background:var(--vi-border,#252535)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--intel-accent,#d4a843)">${overallDriftIndex}</div>
          <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">Index</div>
        </div>
      </div>`;
    } else {
      summaryHtml = `<div style="padding:6px 8px;margin-bottom:8px;background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px;font-size:10px;color:var(--text-dim)">
        ⏳ Establishing 24h baseline — drift scores available after second seed run
      </div>`;
    }

    const themeRows = themes.map(t => this.renderThemeRow(t, hasBaseline)).join('');

    body.innerHTML = summaryHtml + themeRows +
      `<div style="text-align:center;padding:6px 0 4px;font-size:8px;color:var(--text-ghost)">GDELT Doc API · 6h window vs 24h baseline</div>`;
  }

  private renderThemeRow(t: ThemeDrift, hasBaseline: boolean): string {
    const { icon, color, label: dirLabel } = getDirectionMeta(t.direction);
    const label = THEME_LABELS[t.id] ?? t.id;

    // Bar fill: show relative volume as fraction of a reference max
    // Use 200 as a nominal "full" volume for bar display purposes
    const barPct = Math.min(100, Math.round((t.totalVolume / 200) * 100));
    const changeStr = !hasBaseline || !t.hasBaseline
      ? ''
      : t.driftScore > 0
        ? `+${t.driftScore}%`
        : `${t.driftScore}%`;

    return `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px;padding:7px 9px;margin-bottom:5px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:11px;font-weight:600;color:var(--text)">${icon} ${this.esc(label)}</div>
        <div style="display:flex;align-items:center;gap:6px">
          ${changeStr ? `<span style="font-size:10px;font-weight:700;color:${color}">${changeStr}</span>` : ''}
          <span style="font-size:9px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.4px">${dirLabel}</span>
        </div>
      </div>
      <div style="height:3px;background:var(--vi-bg,#0c0c10);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${barPct}%;background:${color};border-radius:2px;opacity:0.65;transition:width 0.4s ease"></div>
      </div>
      <div style="font-size:8px;color:var(--text-ghost);margin-top:3px">Vol: ${t.totalVolume} ${t.baselineVolume !== null ? `· Base: ${t.baselineVolume}` : ''}</div>
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
