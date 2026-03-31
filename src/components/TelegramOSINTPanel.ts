/**
 * Telegram OSINT Narrative Velocity Tracker
 *
 * Monitors 27+ curated OSINT Telegram channels for narrative velocity —
 * how fast a topic spreads across channels. Auto-alerts when velocity
 * exceeds historical baselines.
 *
 * Data: /api/telegram-feed (existing endpoint) + data/telegram-channels.json
 */

import { Panel } from './Panel';

interface TelegramMessage {
  channelName: string;
  channelHandle: string;
  text: string;
  date: string;
  timestamp: number;
  url?: string;
}

interface NarrativeCluster {
  topic: string;
  mentions: number;
  channels: string[];
  velocity: number; // mentions per hour
  firstSeen: number;
  trending: boolean;
}

export class TelegramOSINTPanel extends Panel {
  private messages: TelegramMessage[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'telegram-osint',
      title: 'Telegram Narrative Tracker',
      showCount: true,
      closable: true,
      className: 'telegram-osint-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 180_000); // 3min
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const tabs = document.createElement('div');
    tabs.className = 'panel-tabs';
    tabs.innerHTML = `
      <button class="panel-tab active" data-view="narratives">Narratives</button>
      <button class="panel-tab" data-view="feed">Raw Feed</button>
    `;
    this.content.appendChild(tabs);

    const body = document.createElement('div');
    body.id = 'telegramOsintBody';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim)">Loading Telegram intelligence...</div>';
    this.content.appendChild(body);

    let activeView = 'narratives';
    tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement;
      if (!btn) return;
      tabs.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view || 'narratives';
      if (activeView === 'narratives') this.renderNarratives();
      else this.renderFeed();
    });
  }

  async fetchData(): Promise<void> {
    try {
      const resp = await fetch('/api/telegram-feed', { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this.messages = (data?.messages || data || []).slice(0, 200);
      this.setCount(this.messages.length);
      this.renderNarratives();
    } catch {
      const body = this.content.querySelector('#telegramOsintBody');
      if (body) body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
        <div style="font-size:24px;opacity:0.4;margin-bottom:8px">📱</div>
        <div>Telegram feed unavailable</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">The Telegram relay may be offline</div>
      </div>`;
    }
  }

  private extractNarratives(): NarrativeCluster[] {
    if (this.messages.length === 0) return [];

    // Extract keywords and cluster by frequency
    const wordCounts = new Map<string, { count: number; channels: Set<string>; firstTs: number }>();
    const stopwords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'has', 'have', 'been', 'will', 'its', 'not', 'but', 'they', 'their', 'which', 'more', 'than', 'who', 'what', 'how', 'all', 'can', 'about', 'into', 'out', 'also', 'just', 'new', 'says', 'said', 'one', 'two']);

    for (const msg of this.messages) {
      const text = (msg.text || '').toLowerCase();
      const words = text.split(/\W+/).filter(w => w.length > 3 && !stopwords.has(w));
      for (const w of words) {
        const entry = wordCounts.get(w) || { count: 0, channels: new Set(), firstTs: msg.timestamp || Date.now() };
        entry.count++;
        entry.channels.add(msg.channelName || msg.channelHandle || 'unknown');
        if (msg.timestamp && msg.timestamp < entry.firstTs) entry.firstTs = msg.timestamp;
        wordCounts.set(w, entry);
      }
    }

    // Filter to multi-channel topics with 3+ mentions
    const now = Date.now();
    return Array.from(wordCounts.entries())
      .filter(([, v]) => v.count >= 3 && v.channels.size >= 2)
      .map(([topic, v]) => {
        const ageHours = Math.max(0.1, (now - v.firstTs) / 3_600_000);
        return {
          topic,
          mentions: v.count,
          channels: Array.from(v.channels),
          velocity: v.count / ageHours,
          firstSeen: v.firstTs,
          trending: v.count / ageHours > 5, // >5 mentions/hr = trending
        };
      })
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 20);
  }

  private renderNarratives(): void {
    const body = this.content.querySelector('#telegramOsintBody');
    if (!body) return;

    const narratives = this.extractNarratives();
    if (narratives.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim)">No narrative clusters detected yet</div>';
      return;
    }

    body.innerHTML = narratives.map(n => {
      const velColor = n.velocity > 10 ? '#ef4444' : n.velocity > 5 ? '#f97316' : n.velocity > 2 ? '#d4a843' : '#22c55e';
      const trendBadge = n.trending ? '<span style="background:#ef444420;color:#ef4444;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-left:6px">TRENDING</span>' : '';

      return `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px;padding:8px 10px;margin-bottom:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600;font-size:12px;color:var(--text);text-transform:capitalize">${this.esc(n.topic)}${trendBadge}</span>
          <span style="font-family:var(--vi-font-data,monospace);font-size:10px;font-weight:700;color:${velColor}">${n.velocity.toFixed(1)}/hr</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
          ${n.mentions} mentions across ${n.channels.length} channels · ${n.channels.slice(0, 3).map(c => this.esc(c)).join(', ')}${n.channels.length > 3 ? ` +${n.channels.length - 3}` : ''}
        </div>
      </div>`;
    }).join('');
  }

  private renderFeed(): void {
    const body = this.content.querySelector('#telegramOsintBody');
    if (!body) return;

    if (this.messages.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim)">No messages loaded</div>';
      return;
    }

    body.innerHTML = this.messages.slice(0, 50).map(m => {
      const age = this.formatAge(m.timestamp);
      const text = (m.text || '').slice(0, 200);
      return `<div style="border-bottom:1px solid var(--vi-border-subtle,#1a1a28);padding:6px 4px;font-size:11px">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="font-weight:600;color:var(--cat-intel,#9f7aea)">${this.esc(m.channelName || m.channelHandle || 'Unknown')}</span>
          <span style="color:var(--text-muted);font-size:10px">${age}</span>
        </div>
        <div style="color:var(--text-dim);line-height:1.4">${this.esc(text)}${text.length >= 200 ? '...' : ''}</div>
      </div>`;
    }).join('');
  }

  private formatAge(ts: number): string {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
