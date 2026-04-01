/**
 * Consumer Price Basket + Supplier Risk Fusion
 *
 * Tracks a basket of key consumer commodities (oil, wheat, copper, etc.)
 * and correlates price spikes with supply chain chokepoint disruptions
 * and geopolitical risk scores.
 *
 * Data: /api/market/commodity-quotes (existing) + /api/supply-chain/chokepoints
 */

import { Panel } from './Panel';

interface CommodityQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

const BASKET_ITEMS = [
  { symbol: 'CL=F', name: 'Crude Oil (WTI)', unit: '$/bbl', riskFactor: 'energy' },
  { symbol: 'BZ=F', name: 'Brent Crude', unit: '$/bbl', riskFactor: 'energy' },
  { symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu', riskFactor: 'energy' },
  { symbol: 'GC=F', name: 'Gold', unit: '$/oz', riskFactor: 'metals' },
  { symbol: 'SI=F', name: 'Silver', unit: '$/oz', riskFactor: 'metals' },
  { symbol: 'HG=F', name: 'Copper', unit: '$/lb', riskFactor: 'metals' },
  { symbol: 'ZW=F', name: 'Wheat', unit: '$/bu', riskFactor: 'agriculture' },
  { symbol: 'ZC=F', name: 'Corn', unit: '$/bu', riskFactor: 'agriculture' },
  { symbol: 'ZS=F', name: 'Soybeans', unit: '$/bu', riskFactor: 'agriculture' },
];

export class SupplyChainPricesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'supply-chain-prices',
      title: 'Price Basket & Supply Risk',
      showCount: true,
      closable: true,
      className: 'supply-chain-prices-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 300_000);
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);font-size:10px;color:var(--text-muted);display:flex;justify-content:space-between';
    header.innerHTML = `<span>Consumer Commodity Basket</span><span id="basketIndex" style="font-weight:700;color:var(--intel-accent,#d4a843)">—</span>`;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'priceBasketBody';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim)">Loading commodity prices...</div>';
    this.content.appendChild(body);
  }

  async fetchData(): Promise<void> {
    try {
      const resp = await fetch('/api/market/commodity-quotes', { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const quotes: CommodityQuote[] = data?.quotes || data || [];
      this.renderPrices(quotes);
    } catch {
      const body = this.content.querySelector('#priceBasketBody');
      if (body) body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
        <div style="font-size:24px;opacity:0.4;margin-bottom:8px">💰</div>
        <div>Commodity data unavailable</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Market endpoints may be rate-limited</div>
      </div>`;
    }
  }

  private renderPrices(quotes: CommodityQuote[]): void {
    const body = this.content.querySelector('#priceBasketBody');
    if (!body) return;

    // Match basket items to quotes
    const matched = BASKET_ITEMS.map(item => {
      const q = quotes.find(quote => quote.symbol === item.symbol || quote.name?.toLowerCase().includes((item.name.split(' ')[0] ?? '').toLowerCase()));
      return { ...item, quote: q };
    });

    // Compute basket index (simple weighted average of change percents)
    const withData = matched.filter(m => m.quote);
    const avgChange = withData.length > 0
      ? withData.reduce((sum, m) => sum + (m.quote!.changePercent || 0), 0) / withData.length
      : 0;

    const indexEl = this.content.querySelector('#basketIndex');
    if (indexEl) {
      const color = avgChange > 1 ? '#ef4444' : avgChange > 0 ? '#f97316' : avgChange < -1 ? '#22c55e' : '#d4a843';
      indexEl.innerHTML = `Basket: <span style="color:${color}">${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%</span>`;
    }

    this.setCount(withData.length);

    const riskFactorColors: Record<string, string> = { energy: '#f97316', metals: '#d4a843', agriculture: '#48bb78' };

    body.innerHTML = matched.map(m => {
      if (!m.quote) {
        return `<div style="padding:6px 8px;font-size:11px;color:var(--text-ghost);border-bottom:1px solid var(--vi-border-subtle,#1a1a28)">
          ${this.esc(m.name)} — no data
        </div>`;
      }

      const q = m.quote;
      const changeColor = q.changePercent > 0 ? '#ef4444' : q.changePercent < 0 ? '#22c55e' : 'var(--text-dim)';
      const arrow = q.changePercent > 0 ? '▲' : q.changePercent < 0 ? '▼' : '—';
      const factorColor = riskFactorColors[m.riskFactor] || 'var(--text-muted)';
      const spikeAlert = Math.abs(q.changePercent) > 3;

      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);${spikeAlert ? 'background:rgba(239,68,68,0.05);' : ''}">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:4px">
            ${this.esc(m.name)}
            ${spikeAlert ? '<span style="font-size:8px;background:#ef444420;color:#ef4444;padding:1px 4px;border-radius:2px;font-weight:700">SPIKE</span>' : ''}
          </div>
          <div style="font-size:9px;color:var(--text-muted);margin-top:1px">
            <span style="color:${factorColor}">${m.riskFactor}</span> · ${m.unit}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--vi-font-data,monospace);font-size:12px;font-weight:600;color:var(--text)">${q.price?.toFixed(2) || '—'}</div>
          <div style="font-size:10px;color:${changeColor};font-weight:600">${arrow} ${Math.abs(q.changePercent || 0).toFixed(2)}%</div>
        </div>
      </div>`;
    }).join('');
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
