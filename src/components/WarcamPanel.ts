import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

// Godmode-exclusive Warcam panel.
// Shows a live feed of geolocated conflict zone media with images,
// timestamps, severity badges, and source links.

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
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Live geolocated conflict media from GDELT with severity classification',
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
      this.content.innerHTML = `<div style="padding:12px;color:#ef4444;font-size:13px">Failed to load warcam data: ${escapeHtml(String(err))}</div>`;
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

    // Summary bar
    const critCount = this.entries.filter(e => e.severity === 'critical').length;
    const highCount = this.entries.filter(e => e.severity === 'high').length;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:11px;opacity:.6">
      <span>${this.entries.length} conflict media reports</span>
      <span>${critCount > 0 ? `🔴 ${critCount} critical` : ''} ${highCount > 0 ? `🟠 ${highCount} high` : ''}</span>
    </div>`;

    if (this.entries.length === 0) {
      html += `<div style="opacity:.5;text-align:center;padding:20px;font-size:13px">No conflict media available. Data populates after seed runs.</div>`;
    }

    for (const entry of this.entries.slice(0, 20)) {
      const sc = sevColors[entry.severity] || '#6b7280';
      const icon = catIcons[entry.category] || '📰';
      const timeStr = entry.timestamp ? this.timeAgo(entry.timestamp) : '';
      const hasImage = entry.image && !entry.image.includes('logo');

      html += `<div style="background:var(--bg-tertiary,#141414);border:1px solid ${sc}30;border-left:3px solid ${sc};border-radius:6px;padding:10px;margin-bottom:8px;cursor:pointer" onclick="window.open('${escapeHtml(entry.url)}','_blank')">`;

      // Image + text layout
      if (hasImage) {
        html += `<div style="display:flex;gap:10px">
          <img src="${escapeHtml(entry.image)}" alt="" style="width:80px;height:56px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'" loading="lazy">
          <div style="flex:1;min-width:0">`;
      } else {
        html += `<div>`;
      }

      // Title
      html += `<div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${icon} ${escapeHtml(entry.title.slice(0, 120))}</div>`;

      // Metadata line
      html += `<div style="display:flex;gap:8px;align-items:center;margin-top:4px;font-size:10px">
        <span style="background:${sc};color:#fff;padding:1px 5px;border-radius:3px;font-weight:700;text-transform:uppercase">${escapeHtml(entry.severity)}</span>
        <span style="opacity:.5">${escapeHtml(entry.category.replace(/-/g, ' '))}</span>
        <span style="opacity:.4">${timeStr}</span>
      </div>`;

      // Source + location
      html += `<div style="font-size:10px;opacity:.4;margin-top:2px">${escapeHtml(entry.source)} · ${entry.lat.toFixed(1)}°, ${entry.lng.toFixed(1)}°</div>`;

      if (hasImage) {
        html += `</div></div>`; // close flex text + flex container
      } else {
        html += `</div>`; // close non-image container
      }

      html += `</div>`; // close card
    }

    if (this.entries.length > 20) {
      html += `<div style="text-align:center;font-size:11px;opacity:.4;padding:8px">Showing 20 of ${this.entries.length} reports</div>`;
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
