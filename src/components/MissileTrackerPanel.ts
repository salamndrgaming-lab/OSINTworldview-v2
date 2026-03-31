/**
 * Missile / Drone Strike Tracker Panel
 *
 * Displays a live timeline feed of missile, drone, and airstrike events
 * sourced from the /api/missile-events endpoint (GDELT + ACLED data).
 * Features severity-colored badges, event type icons, country filters,
 * and auto-refresh every 5 minutes.
 */

import { Panel } from './Panel';

interface MissileEvent {
  id: string;
  title: string;
  eventType: 'missile' | 'drone' | 'airstrike' | string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  latitude: number;
  longitude: number;
  locationName: string;
  timestamp: number;
  sources: string[];
  sourceUrl?: string;
  dataSource: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
};

const EVENT_TYPE_ICONS: Record<string, string> = {
  missile: '🚀',
  drone: '🛩',
  airstrike: '💣',
};

export class MissileTrackerPanel extends Panel {
  private events: MissileEvent[] = [];
  private filteredEvents: MissileEvent[] = [];
  private activeFilter: string = 'all';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'missile-tracker',
      title: 'Missile / Drone Tracker',
      showCount: true,
      closable: true,
      className: 'missile-tracker-panel',
    });
    this.buildUI();
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 300_000); // 5min
  }

  private buildUI(): void {
    const content = this.content;
    // Clear the base-class loading spinner before building our UI
    content.innerHTML = '';
    content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    // Filter tabs
    const tabs = document.createElement('div');
    tabs.className = 'panel-tabs mtp-tabs';
    tabs.innerHTML = `
      <button class="panel-tab active" data-filter="all">All</button>
      <button class="panel-tab" data-filter="missile">🚀 Missile</button>
      <button class="panel-tab" data-filter="drone">🛩 Drone</button>
      <button class="panel-tab" data-filter="airstrike">💣 Airstrike</button>
    `;
    content.appendChild(tabs);

    // Stats bar
    const stats = document.createElement('div');
    stats.className = 'mtp-stats';
    stats.id = 'mtpStats';
    content.appendChild(stats);

    // Event list
    const list = document.createElement('div');
    list.className = 'mtp-list';
    list.id = 'mtpList';
    list.innerHTML = '<div class="mtp-loading" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;color:var(--text-dim)"><div style="width:24px;height:24px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:mtp-spin 0.8s linear infinite"></div><span style="font-size:12px">Scanning for strike events...</span></div><style>@keyframes mtp-spin{to{transform:rotate(360deg)}}</style>';
    content.appendChild(list);

    // Tab click handler
    tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement;
      if (!btn) return;
      tabs.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.activeFilter = btn.dataset.filter || 'all';
      this.applyFilter();
    });
  }

  async fetchData(): Promise<void> {
    try {
      const resp = await fetch('/api/missile-events', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this.events = data.events || [];
      this.setCount(this.events.length);
      this.applyFilter();
      this.renderStats();
    } catch {
      const list = this.content.querySelector('#mtpList');
      if (list) {
        list.innerHTML = `<div class="mtp-empty" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 16px;text-align:center">
          <span style="font-size:28px;opacity:0.5">🚀</span>
          <div style="font-size:12px;color:var(--text-dim);line-height:1.6">
            <div style="font-weight:600;margin-bottom:4px">No Strike Data Available</div>
            <div style="font-size:11px;color:var(--text-muted)">The missile/drone event seed may not have run yet.<br>Data refreshes every 4 hours via GitHub Actions.</div>
          </div>
        </div>`;
      }
    }
  }

  private applyFilter(): void {
    if (this.activeFilter === 'all') {
      this.filteredEvents = this.events;
    } else {
      this.filteredEvents = this.events.filter(e => e.eventType === this.activeFilter);
    }
    this.renderList();
  }

  private renderStats(): void {
    const stats = this.content.querySelector('#mtpStats');
    if (!stats) return;

    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const types = { missile: 0, drone: 0, airstrike: 0 };
    const regions = new Set<string>();

    for (const e of this.events) {
      counts[e.severity as keyof typeof counts] = (counts[e.severity as keyof typeof counts] || 0) + 1;
      types[e.eventType as keyof typeof types] = (types[e.eventType as keyof typeof types] || 0) + 1;
      regions.add(e.locationName);
    }

    stats.innerHTML = `
      <span class="mtp-stat"><span class="mtp-stat-dot" style="background:${SEVERITY_COLORS.critical}"></span>${counts.critical} CRIT</span>
      <span class="mtp-stat"><span class="mtp-stat-dot" style="background:${SEVERITY_COLORS.high}"></span>${counts.high} HIGH</span>
      <span class="mtp-stat"><span class="mtp-stat-dot" style="background:${SEVERITY_COLORS.medium}"></span>${counts.medium} MED</span>
      <span class="mtp-stat-sep">|</span>
      <span class="mtp-stat">${regions.size} regions</span>
      <span class="mtp-stat-sep">|</span>
      <span class="mtp-stat-time">${this.events.length > 0 ? 'Last 12h' : 'No data'}</span>
    `;
  }

  private renderList(): void {
    const list = this.content.querySelector('#mtpList');
    if (!list) return;

    if (this.filteredEvents.length === 0) {
      list.innerHTML = `<div class="mtp-empty">${this.events.length === 0 ? 'No strike events detected in the last 12 hours.' : 'No events match this filter.'}</div>`;
      return;
    }

    list.innerHTML = this.filteredEvents.slice(0, 100).map(e => {
      const age = this.formatAge(e.timestamp);
      const sevColor = SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.low;
      const sevLabel = SEVERITY_LABELS[e.severity] || 'LOW';
      const icon = EVENT_TYPE_ICONS[e.eventType] || '💥';
      const location = e.locationName.charAt(0).toUpperCase() + e.locationName.slice(1);
      const sourceTag = e.dataSource === 'ACLED' ? '<span class="mtp-source-tag mtp-acled">ACLED</span>' : '<span class="mtp-source-tag mtp-gdelt">GDELT</span>';

      return `<div class="mtp-event" data-lat="${e.latitude}" data-lon="${e.longitude}">
        <div class="mtp-event-left">
          <span class="mtp-event-icon">${icon}</span>
          <span class="mtp-sev-badge" style="background:${sevColor}15;color:${sevColor};border-color:${sevColor}40">${sevLabel}</span>
        </div>
        <div class="mtp-event-body">
          <div class="mtp-event-title">${this.escHtml(e.title.slice(0, 120))}</div>
          <div class="mtp-event-meta">
            <span class="mtp-event-location">📍 ${this.escHtml(location)}</span>
            <span class="mtp-event-time">${age}</span>
            ${sourceTag}
          </div>
        </div>
      </div>`;
    }).join('');

    // Click to fly to location on map
    list.addEventListener('click', (ev) => {
      const item = (ev.target as HTMLElement).closest('.mtp-event') as HTMLElement;
      if (!item) return;
      const lat = parseFloat(item.dataset.lat || '0');
      const lon = parseFloat(item.dataset.lon || '0');
      if (lat && lon) {
        // Use the global map fly-to if available
        const deckMap = (window as unknown as Record<string, unknown>).__deckglMap;
        if (deckMap && typeof (deckMap as Record<string, unknown>).setCenter === 'function') {
          (deckMap as { setCenter: (lat: number, lng: number, zoom: number) => void }).setCenter(lat, lon, 6);
        }
      }
    });
  }

  private formatAge(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
