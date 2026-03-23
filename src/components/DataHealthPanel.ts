import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

interface FeedStatus {
  name: string;
  icon: string;
  endpoint: string;
  status: 'ok' | 'warning' | 'error' | 'checking';
  lastChecked: number;
  recordCount: number;
  responseMs: number;
  error?: string;
}

const FEEDS_TO_CHECK: Array<{ name: string; icon: string; endpoint: string; countField: string }> = [
  { name: 'GDELT Intel', icon: '🔍', endpoint: '/api/sitrep?format=json', countField: 'sections' },
  { name: 'Missile Events', icon: '🚀', endpoint: '/api/missile-events', countField: 'events' },
  { name: 'Conflict Forecast', icon: '📊', endpoint: '/api/conflict-forecast', countField: 'forecasts' },
  { name: 'Disease Outbreaks', icon: '🦠', endpoint: '/api/disease-outbreaks', countField: 'events' },
  { name: 'Radiation', icon: '☢️', endpoint: '/api/radiation', countField: 'readings' },
  { name: 'Alerts Stream', icon: '🚨', endpoint: '/api/alerts', countField: 'alerts' },
  { name: 'Agent SITREP', icon: '🤖', endpoint: '/api/agent-sitrep?format=json', countField: 'sections' },
  { name: 'Semantic Search', icon: '🔎', endpoint: '/api/search?q=test&k=1&format=json', countField: 'results' },
  { name: 'Snapshots', icon: '⏱️', endpoint: '/api/snapshot?format=json', countField: 'dates' },
  { name: 'POI Data', icon: '👤', endpoint: '/api/poi', countField: 'persons' },
];

export class DataHealthPanel extends Panel {
  private feedStatuses: FeedStatus[] = [];
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'data-health',
      title: '📡 Data Source Health',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Real-time status of all intelligence data feeds',
    });

    this.feedStatuses = FEEDS_TO_CHECK.map(f => ({
      name: f.name,
      icon: f.icon,
      endpoint: f.endpoint,
      status: 'checking' as const,
      lastChecked: 0,
      recordCount: 0,
      responseMs: 0,
    }));

    this.renderStatus();
    this.checkAllFeeds();
    this.autoRefreshTimer = setInterval(() => this.checkAllFeeds(), 60_000);
  }

  private async checkAllFeeds(): Promise<void> {
    const promises = FEEDS_TO_CHECK.map(async (feed, idx) => {
      const startMs = Date.now();
      try {
        const resp = await fetch(toApiUrl(feed.endpoint), {
          signal: AbortSignal.timeout(8_000),
        });
        const responseMs = Date.now() - startMs;

        if (!resp.ok) {
          this.feedStatuses[idx] = {
            ...this.feedStatuses[idx]!,
            status: resp.status === 503 ? 'warning' : 'error',
            lastChecked: Date.now(),
            responseMs,
            recordCount: 0,
            error: `HTTP ${resp.status}`,
          };
          return;
        }

        const data = await resp.json();
        const count = Array.isArray(data[feed.countField])
          ? data[feed.countField].length
          : (typeof data[feed.countField] === 'number' ? data[feed.countField] : 0);

        this.feedStatuses[idx] = {
          ...this.feedStatuses[idx]!,
          status: count > 0 ? 'ok' : 'warning',
          lastChecked: Date.now(),
          responseMs,
          recordCount: count,
          error: undefined,
        };
      } catch (err) {
        this.feedStatuses[idx] = {
          ...this.feedStatuses[idx]!,
          status: 'error',
          lastChecked: Date.now(),
          responseMs: Date.now() - startMs,
          recordCount: 0,
          error: String(err).slice(0, 50),
        };
      }
    });

    await Promise.allSettled(promises);
    this.renderStatus();
  }

  private renderStatus(): void {
    const okCount = this.feedStatuses.filter(f => f.status === 'ok').length;
    const warnCount = this.feedStatuses.filter(f => f.status === 'warning').length;
    const errCount = this.feedStatuses.filter(f => f.status === 'error').length;
    const checkingCount = this.feedStatuses.filter(f => f.status === 'checking').length;

    const overallStatus = errCount > 2 ? 'error' : errCount > 0 || warnCount > 3 ? 'warning' : 'ok';
    const overallColor = overallStatus === 'ok' ? '#22c55e' : overallStatus === 'warning' ? '#eab308' : '#ef4444';

    let html = `<div style="padding:8px">`;

    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px;background:var(--bg-tertiary,#141414);border-radius:6px;border-left:3px solid ${overallColor}">
      <div>
        <span style="font-size:13px;font-weight:700;color:var(--text-primary,#fff)">System Health</span>
        <span style="background:${overallColor};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;margin-left:8px">${overallStatus.toUpperCase()}</span>
      </div>
      <div style="font-size:11px;opacity:.5">${okCount}✅ ${warnCount}⚠️ ${errCount}❌ ${checkingCount > 0 ? checkingCount + '⏳' : ''}</div>
    </div>`;

    for (const feed of this.feedStatuses) {
      const statusColors: Record<string, string> = { ok: '#22c55e', warning: '#eab308', error: '#ef4444', checking: '#6b7280' };
      const sc = statusColors[feed.status] || '#6b7280';
      const statusDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sc};margin-right:6px"></span>`;
      const ageStr = feed.lastChecked > 0 ? this.timeAgo(feed.lastChecked) : 'checking...';

      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px;border-bottom:1px solid var(--border-color,#1a1a1a)">
        <div style="display:flex;align-items:center;font-size:12px">
          ${statusDot}
          <span style="margin-right:4px">${feed.icon}</span>
          <span style="color:var(--text-primary,#fff)">${escapeHtml(feed.name)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:10px;opacity:.6">
          ${feed.recordCount > 0 ? `<span>${feed.recordCount} items</span>` : ''}
          ${feed.responseMs > 0 ? `<span>${feed.responseMs}ms</span>` : ''}
          <span>${ageStr}</span>
          ${feed.error ? `<span style="color:#ef4444" title="${escapeHtml(feed.error)}">⚠️</span>` : ''}
        </div>
      </div>`;
    }

    html += `</div>`;
    this.content.innerHTML = html;
  }

  private timeAgo(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    return Math.floor(sec / 60) + 'm ago';
  }

  public async refresh(): Promise<void> {
    await this.checkAllFeeds();
  }

  public destroy(): void {
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
    super.destroy?.();
  }
}
