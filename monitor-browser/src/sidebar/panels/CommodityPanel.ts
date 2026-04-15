import { IntelPanel, escapeHtml } from '../panel-base';

interface Quote {
  symbol?: string;
  name?: string;
  price?: number | string;
  change?: number | string;
  change_percent?: number | string;
  changePercent?: number | string;
  unit?: string;
}

interface QuotesPayload {
  quotes?: Quote[];
  data?: Quote[];
  items?: Quote[];
}

const API_BASE =
  (import.meta.env['VITE_INTEL_API_BASE'] as string | undefined) ??
  'https://osint-worldview.vercel.app';
const QUOTES_URL = `${API_BASE}/api/market/commodity-quotes`;

export class CommodityPanel extends IntelPanel {
  readonly id = 'commodities';
  readonly title = 'Commodity Pulse';
  readonly icon = '⧗';

  private grid!: HTMLElement;

  constructor(container: HTMLElement) {
    super(container, { pollIntervalMs: 10 * 60 * 1000 });
  }

  protected buildUI(): void {
    this.contentEl.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'commodity-grid';
    this.contentEl.appendChild(this.grid);
    this.renderLoadingState();
  }

  protected async fetchData(): Promise<void> {
    const payload = await this.fetchIntelJson<QuotesPayload | Quote[]>(QUOTES_URL);
    const quotes = normalizeQuotes(payload).slice(0, 6);
    this.renderGrid(quotes);
  }

  private renderGrid(quotes: Quote[]): void {
    this.grid.innerHTML = '';
    if (quotes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'commodity-empty';
      empty.textContent = 'No quotes available.';
      this.grid.appendChild(empty);
      return;
    }
    for (const q of quotes) {
      this.grid.appendChild(this.renderQuote(q));
    }
  }

  private renderQuote(q: Quote): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'commodity-cell';

    const pct = toNumber(q.changePercent ?? q.change_percent ?? q.change);
    const direction = pct === null ? 0 : pct >= 0 ? 1 : -1;
    cell.dataset['dir'] = String(direction);

    const name = document.createElement('div');
    name.className = 'commodity-name';
    name.textContent = q.name ?? q.symbol ?? '—';
    cell.appendChild(name);

    const price = document.createElement('div');
    price.className = 'commodity-price';
    price.textContent = formatPrice(q.price);
    cell.appendChild(price);

    const change = document.createElement('div');
    change.className = 'commodity-change';
    change.innerHTML = `
      <span class="commodity-arrow">${direction > 0 ? '▲' : direction < 0 ? '▼' : '·'}</span>
      <span>${escapeHtml(formatPct(pct))}</span>
    `;
    cell.appendChild(change);

    return cell;
  }
}

function normalizeQuotes(payload: QuotesPayload | Quote[]): Quote[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.quotes)) return payload.quotes;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function toNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = v.replace(/[%,+]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v: number | string | undefined): string {
  const n = toNumber(v);
  if (n === null) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function formatPct(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
