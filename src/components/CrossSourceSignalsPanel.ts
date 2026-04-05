/**
 * Cross-Source Signals Panel
 *
 * Displays real-time multi-domain intelligence correlation signals
 * from /api/bootstrap (crossSourceSignals key). Shows composite
 * escalation zones and individual signal detections ranked by severity.
 *
 * Data: /api/bootstrap → crossSourceSignals
 */

import { Panel } from './Panel';

interface Signal {
  id: string;
  type: string;
  theater: string;
  summary: string;
  severity: string;
  severityScore: number;
  detectedAt: number;
  contributingTypes: string[];
  signalCount: number;
}

const SEVERITY_META: Record<string, { color: string; bg: string; label: string; priority: number }> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: 'CRITICAL', priority: 4 },
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.08)', label: 'HIGH',     priority: 3 },
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM:   { color: '#d4a843', bg: 'rgba(212,168,67,0.08)', label: 'MEDIUM',   priority: 2 },
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.06)',  label: 'LOW',      priority: 1 },
};
const SEV_FALLBACK = { color: '#666', bg: 'rgba(100,100,100,0.06)', label: '?', priority: 0 };

const TYPE_ICONS: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION: '🔺',
  CROSS_SOURCE_SIGNAL_TYPE_THERMAL_SPIKE: '🔥',
  CROSS_SOURCE_SIGNAL_TYPE_GPS_JAMMING: '📡',
  CROSS_SOURCE_SIGNAL_TYPE_MILITARY_FLIGHT_SURGE: '✈️',
  CROSS_SOURCE_SIGNAL_TYPE_UNREST_SURGE: '✊',
  CROSS_SOURCE_SIGNAL_TYPE_OREF_ALERT_CLUSTER: '🚨',
  CROSS_SOURCE_SIGNAL_TYPE_VIX_SPIKE: '📉',
  CROSS_SOURCE_SIGNAL_TYPE_COMMODITY_SHOCK: '🛢',
  CROSS_SOURCE_SIGNAL_TYPE_CYBER_ESCALATION: '💻',
  CROSS_SOURCE_SIGNAL_TYPE_SHIPPING_DISRUPTION: '🚢',
  CROSS_SOURCE_SIGNAL_TYPE_SANCTIONS_SURGE: '🏛',
  CROSS_SOURCE_SIGNAL_TYPE_EARTHQUAKE_SIGNIFICANT: '🌍',
  CROSS_SOURCE_SIGNAL_TYPE_RADIATION_ANOMALY: '☢️',
  CROSS_SOURCE_SIGNAL_TYPE_INFRASTRUCTURE_OUTAGE: '🔴',
  CROSS_SOURCE_SIGNAL_TYPE_WILDFIRE_ESCALATION: '🔥',
  CROSS_SOURCE_SIGNAL_TYPE_DISPLACEMENT_SURGE: '🏚',
  CROSS_SOURCE_SIGNAL_TYPE_FORECAST_DETERIORATION: '📊',
  CROSS_SOURCE_SIGNAL_TYPE_MARKET_STRESS: '📈',
  CROSS_SOURCE_SIGNAL_TYPE_WEATHER_EXTREME: '⛈',
  CROSS_SOURCE_SIGNAL_TYPE_MEDIA_TONE_DETERIORATION: '📰',
  CROSS_SOURCE_SIGNAL_TYPE_RISK_SCORE_SPIKE: '⚠️',
};

function typeLabel(type: string): string {
  return type
    .replace('CROSS_SOURCE_SIGNAL_TYPE_', '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

export class CrossSourceSignalsPanel extends Panel {
  private signals: Signal[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'cross-source-signals',
      title: 'Cross-Source Signals',
      showCount: true,
      closable: true,
      defaultRowSpan: 3,
      className: 'cross-source-signals-panel',
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
        🔺 Multi-Domain Signal Fusion
      </div>
      <div id="css-status" style="font-size:9px;color:var(--text-muted)"></div>
    `;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'css-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim)"><div style="width:22px;height:22px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:css-spin 0.8s linear infinite;margin:0 auto 10px"></div><div style="font-size:11px">Scanning signals\u2026</div><style>@keyframes css-spin{to{transform:rotate(360deg)}}</style></div>';
    this.content.appendChild(body);
  }

  private async fetchData(): Promise<void> {
    const statusEl = this.content.querySelector('#css-status');
    if (statusEl) statusEl.textContent = 'Scanning\u2026';

    try {
      const resp = await fetch('/api/bootstrap', { signal: AbortSignal.timeout(12_000) });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      const payload = data?.crossSourceSignals;
      if (!payload || !Array.isArray(payload.signals)) {
        this.renderEmpty('No cross-source signal data yet');
        return;
      }

      this.signals = payload.signals;
      this.setCount(this.signals.length);

      if (statusEl) {
        const critCount = this.signals.filter(s => s.severity === 'CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL').length;
        const highCount = this.signals.filter(s => s.severity === 'CROSS_SOURCE_SIGNAL_SEVERITY_HIGH').length;
        statusEl.innerHTML = critCount > 0
          ? '<span style="color:#ef4444;font-weight:700">' + critCount + ' CRIT</span> ' + highCount + ' HIGH'
          : highCount > 0
          ? '<span style="color:#f97316;font-weight:600">' + highCount + ' HIGH</span>'
          : this.signals.length + ' signals';
      }

      this.render();
    } catch {
      this.renderEmpty('Signal data unavailable');
    }
  }

  private render(): void {
    const body = this.content.querySelector('#css-body');
    if (!body) return;

    if (this.signals.length === 0) {
      this.renderEmpty('No active signals detected');
      return;
    }

    // Composites first, then by severity score
    const composites = this.signals.filter(s => s.type === 'CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION');
    const singles = this.signals.filter(s => s.type !== 'CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION');

    let html = '';

    // Composite escalation banner
    if (composites.length > 0) {
      html += '<div style="margin-bottom:8px">';
      html += '<div style="font-size:9px;font-weight:600;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Composite Escalation Zones</div>';
      for (const sig of composites) {
        html += this.renderCompositeCard(sig);
      }
      html += '</div>';
    }

    // Individual signals
    if (singles.length > 0) {
      html += '<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Active Signals (' + singles.length + ')</div>';
      for (const sig of singles) {
        html += this.renderSignalCard(sig);
      }
    }

    body.innerHTML = html;
  }

  private renderCompositeCard(sig: Signal): string {
    const sev = SEVERITY_META[sig.severity] ?? SEV_FALLBACK;
    const categories = sig.contributingTypes.slice(0, 5).map(t =>
      '<span style="display:inline-block;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:3px;padding:1px 5px;font-size:8px;color:#ef4444;margin:1px 2px 1px 0">' + this.esc(t) + '</span>'
    ).join('');

    return '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-left:3px solid #ef4444;border-radius:7px;padding:10px;margin-bottom:6px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
        '<div>' +
          '<div style="font-size:12px;font-weight:700;color:#ef4444;line-height:1.3">🔺 ' + this.esc(sig.theater) + '</div>' +
          '<div style="font-size:10px;color:var(--text-dim);margin-top:3px;line-height:1.4">' + this.esc(sig.summary) + '</div>' +
        '</div>' +
        '<div style="flex-shrink:0;text-align:center">' +
          '<div style="font-size:18px;font-weight:800;color:' + sev.color + ';line-height:1">' + sig.severityScore.toFixed(1) + '</div>' +
          '<div style="font-size:7px;color:var(--text-muted)">score</div>' +
        '</div>' +
      '</div>' +
      (categories ? '<div style="margin-top:6px">' + categories + '</div>' : '') +
      '<div style="font-size:8px;color:var(--text-ghost);margin-top:4px">' + sig.signalCount + ' contributing signals \u00B7 ' + this.formatAge(sig.detectedAt) + '</div>' +
    '</div>';
  }

  private renderSignalCard(sig: Signal): string {
    const sev = SEVERITY_META[sig.severity] ?? SEV_FALLBACK;
    const icon = TYPE_ICONS[sig.type] ?? '\u26A1';
    const label = typeLabel(sig.type);

    return '<div style="background:' + sev.bg + ';border:1px solid var(--vi-border,#252535);border-left:3px solid ' + sev.color + ';border-radius:6px;padding:8px 10px;margin-bottom:4px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:10px;font-weight:600;color:var(--text);line-height:1.3">' + icon + ' ' + this.esc(sig.summary) + '</div>' +
          '<div style="font-size:9px;color:var(--text-muted);margin-top:3px">' +
            '<span style="color:' + sev.color + ';font-weight:600">' + sev.label + '</span>' +
            ' \u00B7 ' + this.esc(sig.theater) +
            ' \u00B7 ' + this.esc(label) +
            ' \u00B7 ' + this.formatAge(sig.detectedAt) +
          '</div>' +
        '</div>' +
        '<div style="font-size:14px;font-weight:700;color:' + sev.color + ';flex-shrink:0">' + sig.severityScore.toFixed(1) + '</div>' +
      '</div>' +
    '</div>';
  }

  private renderEmpty(msg: string): void {
    const body = this.content.querySelector('#css-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">' +
      '<div style="font-size:32px;opacity:0.3;margin-bottom:8px">🔺</div>' +
      '<div style="font-size:11px;font-weight:500">' + this.esc(msg) + '</div>' +
      '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">Signals refresh every 5 minutes</div>' +
    '</div>';
    const statusEl = this.content.querySelector('#css-status');
    if (statusEl) statusEl.textContent = 'Idle';
  }

  private formatAge(ts: number): string {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  private esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
