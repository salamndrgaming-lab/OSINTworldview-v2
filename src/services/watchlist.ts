/**
 * Watchlist Service
 *
 * Users can track specific items across categories:
 *   - Countries (ISO codes, e.g., 'UA', 'TW', 'IR')
 *   - Persons of Interest (names)
 *   - Stocks/Tickers (e.g., 'AAPL', 'TSLA')
 *   - Keywords (free-text terms to monitor in news feeds)
 *
 * The watchlist is persisted in localStorage and surfaced via
 * a dedicated Watchlist panel and optionally highlighted in
 * existing panels (news, POI, markets).
 */

const STORAGE_KEY = 'worldmonitor-watchlist';

export type WatchlistCategory = 'country' | 'poi' | 'stock' | 'keyword';

export interface WatchlistItem {
  id: string;
  category: WatchlistCategory;
  /** Display label (country name, person name, ticker, or keyword) */
  label: string;
  /** Machine-readable value (ISO code, ticker symbol, or raw keyword) */
  value: string;
  /** When this item was added */
  addedAt: number;
  /** Optional user note */
  note?: string;
}

// ────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────

export function getWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as WatchlistItem[];
    }
  } catch { /* noop */ }
  return [];
}

export function getWatchlistByCategory(category: WatchlistCategory): WatchlistItem[] {
  return getWatchlist().filter(i => i.category === category);
}

export function addToWatchlist(category: WatchlistCategory, label: string, value: string, note?: string): WatchlistItem {
  const items = getWatchlist();
  // Prevent duplicates by value+category
  const existing = items.find(i => i.category === category && i.value.toLowerCase() === value.toLowerCase());
  if (existing) return existing;

  const item: WatchlistItem = {
    id: 'wl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    category,
    label,
    value,
    addedAt: Date.now(),
    note,
  };
  items.push(item);
  persist(items);
  dispatchChange();
  return item;
}

export function removeFromWatchlist(id: string): void {
  const items = getWatchlist().filter(i => i.id !== id);
  persist(items);
  dispatchChange();
}

export function updateWatchlistNote(id: string, note: string): void {
  const items = getWatchlist();
  const item = items.find(i => i.id === id);
  if (item) {
    item.note = note || undefined;
    persist(items);
  }
}

export function clearWatchlist(): void {
  persist([]);
  dispatchChange();
}

export function isOnWatchlist(category: WatchlistCategory, value: string): boolean {
  return getWatchlist().some(i => i.category === category && i.value.toLowerCase() === value.toLowerCase());
}

function persist(items: WatchlistItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* noop */ }
}

function dispatchChange(): void {
  window.dispatchEvent(new CustomEvent('watchlist-changed'));
}

// ────────────────────────────────────────────────────────────
// Quick-add helpers for common use cases
// ────────────────────────────────────────────────────────────

export function watchCountry(code: string, name: string): WatchlistItem {
  return addToWatchlist('country', name, code.toUpperCase());
}

export function watchPOI(name: string): WatchlistItem {
  return addToWatchlist('poi', name, name);
}

export function watchStock(ticker: string, companyName?: string): WatchlistItem {
  return addToWatchlist('stock', companyName || ticker, ticker.toUpperCase());
}

export function watchKeyword(keyword: string): WatchlistItem {
  return addToWatchlist('keyword', keyword, keyword.toLowerCase());
}
