/**
 * Time-Travel Map Slider Panel
 *
 * Lets analysts browse historical intelligence snapshots archived daily
 * by seed-snapshot.mjs. Fetches available dates from /api/snapshot,
 * then renders a date-picker and timeline slider. Selecting a date loads
 * the archived intelligence state as a structured summary.
 *
 * Data: /api/snapshot  (reads snapshots:index + snapshots:{YYYY-MM-DD})
 *
 * Note: The snapshot system stores summarized data, not full raw feeds.
 * This panel shows the historical intelligence summary — it does NOT
 * replay live map layers (that's a future Tier 3 enhancement).
 */

import { Panel } from './Panel';

interface SnapshotSource {
  [key: string]: unknown;
}

interface Snapshot {
  date: string;
  createdAt: number;
  sources: Record<string, SnapshotSource>;
}

export class TimeTravelPanel extends Panel {
  private availableDates: string[] = [];
  private currentSnapshot: Snapshot | null = null;
  private isLoading = false;

  constructor() {
    super({
      id: 'time-travel',
      title: 'Time Machine',
      showCount: false,
      closable: true,
      defaultRowSpan: 3,
      className: 'time-travel-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.loadIndex();
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    // Header / controls
    const controls = document.createElement('div');
    controls.id = 'tt-controls';
    controls.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);flex-shrink:0;';
    controls.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">
        ⏱ Historical Intelligence Replay
      </div>
      <div id="tt-picker-wrap" style="display:flex;align-items:center;gap:6px">
        <select id="tt-date-select" style="
          flex:1;padding:5px 8px;font-size:11px;background:var(--vi-bg,#0c0c10);
          border:1px solid var(--vi-border,#252535);border-radius:5px;color:var(--text);
          font-family:var(--vi-font-body,sans-serif);cursor:pointer;outline:none;
        ">
          <option value="">Loading snapshots…</option>
        </select>
        <button id="tt-load-btn" disabled style="
          padding:5px 10px;font-size:11px;font-weight:600;
          background:var(--intel-accent-subtle,rgba(212,168,67,0.08));
          border:1px solid var(--intel-accent-border,rgba(212,168,67,0.2));
          border-radius:5px;color:var(--intel-accent,#d4a843);cursor:pointer;
          font-family:var(--vi-font-body,sans-serif);opacity:0.5;white-space:nowrap;
        ">Load →</button>
      </div>
      <div id="tt-slider-wrap" style="display:none;margin-top:8px">
        <input type="range" id="tt-slider" min="0" max="0" value="0" style="
          width:100%;accent-color:var(--intel-accent,#d4a843);cursor:pointer;
        " />
        <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);margin-top:2px">
          <span id="tt-oldest-label"></span>
          <span id="tt-newest-label"></span>
        </div>
      </div>
    `;
    this.content.appendChild(controls);

    // Content area
    const body = document.createElement('div');
    body.id = 'tt-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
    body.innerHTML = this.emptyHTML();
    this.content.appendChild(body);

    // Wire events after DOM is attached
    requestAnimationFrame(() => this.bindEvents());
  }

  private bindEvents(): void {
    const select = this.content.querySelector('#tt-date-select') as HTMLSelectElement;
    const loadBtn = this.content.querySelector('#tt-load-btn') as HTMLButtonElement;
    const slider = this.content.querySelector('#tt-slider') as HTMLInputElement;

    select?.addEventListener('change', () => {
      if (loadBtn) {
        loadBtn.disabled = !select.value;
        loadBtn.style.opacity = select.value ? '1' : '0.5';
      }
    });

    loadBtn?.addEventListener('click', () => {
      const date = select?.value;
      if (date) void this.loadSnapshot(date);
    });

    slider?.addEventListener('input', () => {
      const idx = parseInt(slider.value, 10);
      const date = this.availableDates[idx];
      if (date && select) {
        select.value = date;
        if (loadBtn) { loadBtn.disabled = false; loadBtn.style.opacity = '1'; }
      }
    });
  }

  private async loadIndex(): Promise<void> {
    const body = this.content.querySelector('#tt-body');
    try {
      const resp = await fetch('/api/snapshot?format=json', {
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this.availableDates = Array.isArray(data.dates) ? data.dates : [];
      this.populateControls();
    } catch {
      if (body) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:26px;opacity:0.3;margin-bottom:8px">⏱</div>
          <div style="font-size:11px">Snapshot index unavailable</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Snapshots are archived daily via GitHub Actions</div>
        </div>`;
      }
    }
  }

  private populateControls(): void {
    const select = this.content.querySelector('#tt-date-select') as HTMLSelectElement;
    const loadBtn = this.content.querySelector('#tt-load-btn') as HTMLButtonElement;
    const sliderWrap = this.content.querySelector('#tt-slider-wrap') as HTMLElement;
    const slider = this.content.querySelector('#tt-slider') as HTMLInputElement;
    const oldestLabel = this.content.querySelector('#tt-oldest-label') as HTMLElement;
    const newestLabel = this.content.querySelector('#tt-newest-label') as HTMLElement;
    const body = this.content.querySelector('#tt-body');

    if (!select) return;

    if (this.availableDates.length === 0) {
      select.innerHTML = '<option value="">No snapshots available yet</option>';
      if (body) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:26px;opacity:0.3;margin-bottom:8px">⏱</div>
          <div style="font-size:11px">No snapshots yet</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">seed-snapshot.mjs runs daily after the main seed job</div>
        </div>`;
      }
      return;
    }

    // Populate dropdown — newest first
    select.innerHTML = this.availableDates.map(d =>
      `<option value="${d}">${d}</option>`
    ).join('');

    if (loadBtn) { loadBtn.disabled = false; loadBtn.style.opacity = '1'; }

    // Slider
    if (slider && sliderWrap) {
      slider.min = '0';
      slider.max = String(this.availableDates.length - 1);
      slider.value = '0';
      sliderWrap.style.display = 'block';
      if (oldestLabel) oldestLabel.textContent = this.availableDates[this.availableDates.length - 1] ?? '';
      if (newestLabel) newestLabel.textContent = this.availableDates[0] ?? '';
    }

    // Auto-load the most recent snapshot
    void this.loadSnapshot(this.availableDates[0] ?? '');
  }

  private async loadSnapshot(date: string): Promise<void> {
    if (!date || this.isLoading) return;
    this.isLoading = true;
    const body = this.content.querySelector('#tt-body');
    const loadBtn = this.content.querySelector('#tt-load-btn') as HTMLButtonElement;

    if (loadBtn) loadBtn.textContent = '⏳';
    if (body) {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
        <div style="width:22px;height:22px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:tt-spin 0.8s linear infinite;margin:0 auto 10px"></div>
        <div style="font-size:11px">Loading ${date}…</div>
        <style>@keyframes tt-spin{to{transform:rotate(360deg)}}</style>
      </div>`;
    }

    try {
      const resp = await fetch(`/api/snapshot?date=${encodeURIComponent(date)}&format=json`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const snapshot: Snapshot = await resp.json();
      this.currentSnapshot = snapshot;
      this.renderSnapshot(snapshot);
    } catch (err) {
      if (body) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:11px">Failed to load snapshot for ${date}</div>
        </div>`;
      }
      void err;
    } finally {
      this.isLoading = false;
      if (loadBtn) loadBtn.textContent = 'Load →';
    }
  }

  private renderSnapshot(snapshot: Snapshot): void {
    const body = this.content.querySelector('#tt-body');
    if (!body) return;

    const { date, createdAt, sources } = snapshot;
    const createdStr = createdAt ? new Date(createdAt).toUTCString() : 'Unknown';
    const sourceKeys = Object.keys(sources || {});

    let html = `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--intel-accent-border,rgba(212,168,67,0.2));border-radius:7px;padding:10px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--intel-accent,#d4a843)">📅 ${this.esc(date)}</div>
      <div style="font-size:9px;color:var(--text-muted);margin-top:2px">Archived: ${this.esc(createdStr)}</div>
      <div style="font-size:9px;color:var(--text-dim);margin-top:1px">${sourceKeys.length} intelligence sources archived</div>
    </div>`;

    // Render each source section
    for (const key of sourceKeys) {
      html += this.renderSourceBlock(key, sources[key]);
    }

    if (sourceKeys.length === 0) {
      html += `<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:11px">No source data in this snapshot</div>`;
    }

    body.innerHTML = html;
  }

  private renderSourceBlock(key: string, data: unknown): string {
    const labels: Record<string, string> = {
      missiles: '🚀 Missile Events',
      gdeltIntel: '🌐 GDELT Intelligence',
      poi: '👤 Persons of Interest',
      conflictForecast: '⚔️ Conflict Forecasts',
      diseaseOutbreaks: '🏥 Disease Outbreaks',
      radiation: '☢️ Radiation Monitor',
      unrest: '✊ Civil Unrest',
      earthquakes: '🌍 Earthquakes',
      cyberThreats: '💻 Cyber Threats',
      marketQuotes: '📈 Market Quotes',
      commodityQuotes: '🛢 Commodities',
      predictions: '🎯 Predictions',
      iranEvents: '🇮🇷 Iran Events',
      naturalEvents: '🌪 Natural Events',
      weatherAlerts: '⛈ Weather Alerts',
      outages: '🔴 Internet Outages',
      agentSitrep: '🤖 Agent SITREP',
      insights: '💡 AI Insights',
    };

    const label = labels[key] ?? `📦 ${key}`;
    const d = data as Record<string, unknown>;

    // Build a readable summary from the data shape
    let summary = '';

    if (d?.executive_summary) {
      summary = String(d.executive_summary).slice(0, 300);
    } else if (d?.worldBrief) {
      summary = String(d.worldBrief).slice(0, 300);
    } else if (typeof d?.eventCount === 'number') {
      summary = `${d.eventCount} events archived`;
      if (d?.events && Array.isArray(d.events)) {
        const items = (d.events as Array<Record<string, unknown>>).slice(0, 3)
          .map(e => String(e.title || e.place || '').slice(0, 80))
          .filter(Boolean);
        if (items.length) summary += ': ' + items.join(' · ');
      }
    } else if (typeof d?.personCount === 'number') {
      summary = `${d.personCount} persons tracked`;
      if (d?.persons && Array.isArray(d.persons)) {
        const names = (d.persons as Array<Record<string, unknown>>).slice(0, 4)
          .map(p => String(p.name || '')).filter(Boolean);
        if (names.length) summary += ': ' + names.join(', ');
      }
    } else if (typeof d?.forecastCount === 'number') {
      summary = `${d.forecastCount} country forecasts`;
    } else if (typeof d?.total === 'number') {
      summary = `${d.total} records`;
    } else if (typeof d?.count === 'number') {
      summary = `${d.count} items`;
    } else if (d?.topics && Array.isArray(d.topics)) {
      const topicIds = (d.topics as Array<Record<string, unknown>>).slice(0, 6)
        .map(t => String(t.id || '')).filter(Boolean);
      summary = `Topics: ${topicIds.join(', ')}`;
    } else if (d?.sectionTitles && Array.isArray(d.sectionTitles)) {
      summary = (d.sectionTitles as string[]).slice(0, 4).join(' · ');
    } else if (d?.topMovers && Array.isArray(d.topMovers)) {
      const movers = (d.topMovers as Array<Record<string, unknown>>).slice(0, 3)
        .map(m => `${m.symbol} ${Number(m.changePercent ?? 0) > 0 ? '+' : ''}${Number(m.changePercent ?? 0).toFixed(1)}%`)
        .join(' · ');
      summary = `Top movers: ${movers}`;
    } else if (d?._truncated) {
      summary = `Large dataset (${d._originalSize} bytes) — truncated in archive`;
    } else {
      summary = 'Archived';
    }

    return `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px;padding:8px 10px;margin-bottom:5px">
      <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:3px">${this.esc(label)}</div>
      <div style="font-size:10px;color:var(--text-dim);line-height:1.5">${this.esc(summary)}</div>
    </div>`;
  }

  private emptyHTML(): string {
    return `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="font-size:32px;opacity:0.3;margin-bottom:8px">⏱</div>
      <div style="font-size:11px;font-weight:500">Select a date to replay historical intelligence</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Daily snapshots archived automatically</div>
    </div>`;
  }

  private esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
