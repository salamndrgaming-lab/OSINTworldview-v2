import { bus, type BreakingAlert } from '../../events/bus';
import { IntelPanel, escapeHtml, formatRelative } from '../panel-base';

interface InsightItem {
  id?: string;
  title?: string;
  headline?: string;
  summary?: string;
  description?: string;
  severity?: string;
  source?: string;
  region?: string;
  published_at?: string;
  publishedAt?: string;
  timestamp?: string | number;
  url?: string;
  link?: string;
}

interface InsightsPayload {
  items?: InsightItem[];
  insights?: InsightItem[];
  data?: InsightItem[];
}

const API_BASE =
  (import.meta.env['VITE_INTEL_API_BASE'] as string | undefined) ??
  'https://osint-worldview.vercel.app';
const INSIGHTS_URL = `${API_BASE}/api/insights`;

export class ThreatFeedPanel extends IntelPanel {
  readonly id = 'threat-feed';
  readonly title = 'Live Threat Feed';
  readonly icon = '◉';

  private list!: HTMLElement;
  private seenIds = new Set<string>();
  private bootstrapped = false;

  constructor(container: HTMLElement) {
    super(container, { pollIntervalMs: 5 * 60 * 1000 });
  }

  protected buildUI(): void {
    this.contentEl.innerHTML = '';
    this.list = document.createElement('ul');
    this.list.className = 'threat-feed-list';
    this.contentEl.appendChild(this.list);
    this.renderLoadingState();
  }

  protected async fetchData(): Promise<void> {
    const payload = await this.fetchIntelJson<InsightsPayload | InsightItem[]>(INSIGHTS_URL);
    const items = normalizeItems(payload).slice(0, 5);
    this.renderItems(items);
    this.announceNew(items);
  }

  private renderItems(items: InsightItem[]): void {
    this.list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'threat-feed-empty';
      empty.textContent = 'No active threats.';
      this.list.appendChild(empty);
      return;
    }
    for (const item of items) {
      this.list.appendChild(this.renderItem(item));
    }
  }

  private renderItem(item: InsightItem): HTMLElement {
    const el = document.createElement('li');
    el.className = 'threat-feed-item';
    el.dataset['severity'] = normalizeSeverity(item.severity);

    const bar = document.createElement('span');
    bar.className = 'threat-feed-bar';
    el.appendChild(bar);

    const body = document.createElement('div');
    body.className = 'threat-feed-body';

    const headline = document.createElement('div');
    headline.className = 'threat-feed-headline';
    headline.textContent = item.headline ?? item.title ?? 'Untitled signal';
    body.appendChild(headline);

    const meta = document.createElement('div');
    meta.className = 'threat-feed-meta';
    const source = item.source ?? item.region ?? 'OSINT';
    const ts = parseTs(item);
    meta.innerHTML = `
      <span class="threat-feed-source">${escapeHtml(source)}</span>
      <span class="threat-feed-time">${escapeHtml(ts ? formatRelative(ts) : '—')}</span>
    `;
    body.appendChild(meta);

    const summary = item.summary ?? item.description;
    if (summary) {
      const details = document.createElement('div');
      details.className = 'threat-feed-summary';
      details.textContent = summary;
      details.hidden = true;
      body.appendChild(details);
      el.addEventListener('click', () => {
        details.hidden = !details.hidden;
        el.classList.toggle('is-expanded', !details.hidden);
      });
    }

    el.appendChild(body);
    return el;
  }

  private announceNew(items: InsightItem[]): void {
    // Skip the very first load to avoid spamming breaking-intel on startup.
    if (!this.bootstrapped) {
      for (const it of items) {
        const id = itemId(it);
        if (id) this.seenIds.add(id);
      }
      this.bootstrapped = true;
      return;
    }
    for (const it of items) {
      const id = itemId(it);
      if (!id || this.seenIds.has(id)) continue;
      this.seenIds.add(id);
      const alert: BreakingAlert = {
        id,
        headline: it.headline ?? it.title ?? 'New signal',
        severity: normalizeSeverity(it.severity),
        source: it.source ?? 'OSINT',
        timestamp: parseTs(it) ?? Date.now(),
        ...(it.url || it.link ? { url: it.url ?? it.link } : {}),
      };
      bus.emit('intel:breaking', { alert });
    }
  }
}

function normalizeItems(payload: InsightsPayload | InsightItem[]): InsightItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.insights)) return payload.insights;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function normalizeSeverity(raw: string | undefined): BreakingAlert['severity'] {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('crit')) return 'critical';
  if (s === 'high' || s === '3') return 'high';
  if (s === 'medium' || s === 'med' || s === '2') return 'medium';
  if (s === 'low' || s === '1') return 'low';
  return 'info';
}

function parseTs(it: InsightItem): number | null {
  const raw = it.published_at ?? it.publishedAt ?? it.timestamp;
  if (raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function itemId(it: InsightItem): string | null {
  if (it.id) return String(it.id);
  const headline = it.headline ?? it.title;
  if (!headline) return null;
  const ts = parseTs(it);
  return `${headline}:${ts ?? 0}`;
}
