import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

// Godmode-exclusive Warcam panel — Conflict Zone Media Feed.
// Shows geolocated conflict reports with large images, severity badges,
// timestamps, and links to source articles with embedded video content.

export class WarcamPanel extends Panel {
  private entries: Array<{
    id: string; title: string; url: string; image: string; source: string;
    lat: number; lng: number; timestamp: number; category: string; severity: string;
  }> = [];
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'warcam',
      title: '🎥 Conflict Zone Media',
      defaultRowSpan: 3,
      infoTooltip: 'Godmode exclusive: Live geolocated conflict media feed with severity classification',
    });
    this.loadData();
    this.autoRefreshTimer = setInterval(() => this.loadData(), 120_000);
  }

  private async loadData(): Promise<void> {
    try {
      const resp = await fetch(toApiUrl('/api/warcam'));
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      this.entries = data?.entries || [];
      this.renderFeed();
    } catch (err) {
      this.content.innerHTML = `<div style="padding:16px;color:#ef4444;font-size:13px">Failed to load conflict media: ${escapeHtml(String(err))}</div>`;
    }
  }

  private renderFeed(): void {
    const sevColors: Record<string, string> = {
      critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#6b7280',
    };
    const catIcons: Record<string, string> = {
      airstrikes: '✈️', 'ground-combat': '⚔️', 'drone-missile': '🚀',
      casualties: '💀', 'military-ops': '🎯',
    };

    let html = `<div style="padding:8px">`;

    // Header with stats
    const critCount = this.entries.filter(e => e.severity === 'critical').length;
    const highCount = this.entries.filter(e => e.severity === 'high').length;
    const totalSources = new Set(this.entries.map(e => e.source)).size;

    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;opacity:.7">${this.entries.length} reports from ${totalSources} sources</div>
      <div style="display:flex;gap:6px;font-size:10px">
        ${critCount > 0 ? `<span style="background:#dc2626;color:#fff;padding:1px 6px;border-radius:3px;font-weight:700">${critCount} CRITICAL</span>` : ''}
        ${highCount > 0 ? `<span style="background:#f97316;color:#fff;padding:1px 6px;border-radius:3px;font-weight:700">${highCount} HIGH</span>` : ''}
      </div>
    </div>`;

    if (this.entries.length === 0) {
      html += `<div style="opacity:.5;text-align:center;padding:30px;font-size:13px">
        <div style="font-size:32px;margin-bottom:8px">🎥</div>
        No conflict media available yet.<br>Data populates after seed runs.
      </div>`;
    }

    for (const entry of this.entries.slice(0, 15)) {
      const sc = sevColors[entry.severity] || '#6b7280';
      const icon = catIcons[entry.category] || '📰';
      const timeStr = entry.timestamp ? this.timeAgo(entry.timestamp) : '';
      const hasImage = entry.image && entry.image.startsWith('http');

      html += `<div style="background:var(--bg-tertiary,#141414);border:1px solid ${sc}40;border-radius:8px;margin-bottom:10px;overflow:hidden">`;

      // Large image with title overlay
      if (hasImage) {
        html += `<div style="position:relative;width:100%;height:140px;overflow:hidden;cursor:pointer" onclick="window.open('${escapeHtml(entry.url)}','_blank')">
          <img src="${escapeHtml(entry.image)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.display='none'" loading="lazy">
          <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:8px 10px">
            <div style="font-size:12px;font-weight:700;color:#fff;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${icon} ${escapeHtml(entry.title.slice(0, 120))}</div>
          </div>
          <div style="position:absolute;top:8px;left:8px">
            <span style="background:${sc};color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${escapeHtml(entry.severity)}</span>
          </div>
          <div style="position:absolute;top:8px;right:8px">
            <span style="background:rgba(0,0,0,.7);color:#fff;padding:2px 6px;border-radius:3px;font-size:9px">${timeStr}</span>
          </div>
        </div>`;
      } else {
        // No image — text-only card with colored left border
        html += `<div style="border-left:4px solid ${sc};padding:10px;cursor:pointer" onclick="window.open('${escapeHtml(entry.url)}','_blank')">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
            <span style="background:${sc};color:#fff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase">${escapeHtml(entry.severity)}</span>
            <span style="font-size:10px;opacity:.4">${timeStr}</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);line-height:1.3">${icon} ${escapeHtml(entry.title.slice(0, 120))}</div>
        </div>`;
      }

      // Footer: source, location, view button
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-top:1px solid var(--border-color,#252525)">
        <div style="font-size:10px;opacity:.5">${escapeHtml(entry.source)} · ${entry.lat.toFixed(1)}°, ${entry.lng.toFixed(1)}°</div>
        <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener" style="font-size:10px;color:var(--accent,#4a90d9);text-decoration:none;font-weight:700" onclick="event.stopPropagation()">View Report →</a>
      </div>`;

      html += `</div>`;
    }

    if (this.entries.length > 15) {
      html += `<div style="text-align:center;font-size:11px;opacity:.4;padding:8px">Showing 15 of ${this.entries.length} reports</div>`;
    }

    html += `</div>`;
    this.content.innerHTML = html;
  }

  private timeAgo(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }

  public async refresh(): Promise<void> {
    await this.loadData();
  }

  public destroy(): void {
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
    super.destroy?.();
  }
}
