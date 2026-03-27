import { Panel } from './Panel';
import { toApiUrl } from '@/services/runtime';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';


// Godmode-exclusive Stock Backtest panel.
// Tries the real upstream backtestStock RPC first (no premium gate on server).
// Falls back to a local SMA crossover engine if the upstream is unavailable.

interface BacktestResult {
  symbol: string;
  strategy: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  signals: Array<{ date: string; type: 'buy' | 'sell'; price: number }>;
  equityCurve: Array<{ date: string; value: number }>;
  ranAt: number;
}

export class StockBacktestPanel extends Panel {
  private result: BacktestResult | null = null;
  private isRunning = false;

  constructor() {
    super({
      id: 'stock-backtest-gm',
      title: '📈 Stock Backtest',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Run moving average crossover backtests on stocks with geopolitical risk overlay',
    });
    this.renderForm();
  }

  private renderForm(): void {
    const wrapper = h('div', { style: 'padding:8px' },
      h('div', { style: 'font-size:12px;opacity:.6;margin-bottom:8px' },
        'SMA Crossover Backtest — tests fast/slow moving average crossover strategy. Uses simulated price data with realistic market dynamics (random walk with drift).',
      ),
      h('div', { style: 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap' },
        h('input', {
          type: 'text', id: 'bt-symbol', placeholder: 'Symbol (e.g. AAPL)',
          style: 'width:100px;background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px;color:var(--text-primary,#fff);font-size:13px;outline:none',
        }),
        h('input', {
          type: 'number', id: 'bt-fast', placeholder: 'Fast MA', value: '10',
          style: 'width:70px;background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px;color:var(--text-primary,#fff);font-size:13px;outline:none',
        }),
        h('input', {
          type: 'number', id: 'bt-slow', placeholder: 'Slow MA', value: '30',
          style: 'width:70px;background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px;color:var(--text-primary,#fff);font-size:13px;outline:none',
        }),
        h('button', {
          style: 'background:var(--accent,#4a90d9);color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer',
          onClick: () => this.runBacktest(),
        }, 'Run Backtest'),
      ),
      h('div', { id: 'bt-result', style: 'font-size:13px;line-height:1.6;color:var(--text-secondary,#ccc)' },
        h('span', { style: 'opacity:.5' }, 'Configure parameters and click Run Backtest. Uses SMA crossover: buy when fast MA crosses above slow MA, sell when it crosses below.'),
      ),
    );
    replaceChildren(this.content, wrapper);
  }

  private async runBacktest(): Promise<void> {
    const symbolInput = document.getElementById('bt-symbol') as HTMLInputElement;
    const fastInput = document.getElementById('bt-fast') as HTMLInputElement;
    const slowInput = document.getElementById('bt-slow') as HTMLInputElement;
    const resultEl = document.getElementById('bt-result');

    const symbol = (symbolInput?.value || '').trim().toUpperCase();
    const fastPeriod = parseInt(fastInput?.value || '10', 10);
    const slowPeriod = parseInt(slowInput?.value || '30', 10);

    if (!symbol || this.isRunning) return;
    if (fastPeriod >= slowPeriod) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Fast MA period must be less than slow MA period</span>';
      return;
    }

    this.isRunning = true;
    if (resultEl) resultEl.innerHTML = '<span style="opacity:.7">⏳ Running backtest for ' + escapeHtml(symbol) + '...</span>';

    try {
      // Step 1: Try the real upstream backtestStock RPC (no premium gate)
      let usedUpstream = false;
      try {
        const btResp = await fetch(toApiUrl(`/api/market/v1/backtest-stock?symbol=${encodeURIComponent(symbol)}&eval_window_days=7`));
        if (btResp.ok) {
          const bt = await btResp.json();
          if (bt.available !== false && bt.evaluationsRun > 0) {
            // Render the real upstream backtest result
            this.renderUpstreamResult(bt);
            usedUpstream = true;
          }
        }
      } catch { /* fall through to local engine */ }

      // Step 2: Fall back to local SMA crossover engine
      if (!usedUpstream) {
        let prices: Array<{ date: string; close: number }> = [];
        prices = this.generateSyntheticPrices(symbol, 120);
        this.result = this.computeBacktest(symbol, prices, fastPeriod, slowPeriod);
        this.renderResult();
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Backtest failed: ' + escapeHtml(String(err)) + '</span>';
    } finally {
      this.isRunning = false;
    }
  }

  // Generate synthetic price data when real history isn't available
  private generateSyntheticPrices(_symbol: string, days: number): Array<{ date: string; close: number }> {
    const prices: Array<{ date: string; close: number }> = [];
    let price = 100 + Math.random() * 200; // Random starting price
    const now = Date.now();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now - i * 86400_000).toISOString().split('T')[0] ?? '';
      // Random walk with slight upward drift
      price *= 1 + (Math.random() - 0.48) * 0.03;
      prices.push({ date, close: Math.round(price * 100) / 100 });
    }

    return prices;
  }

  private computeBacktest(
    symbol: string,
    prices: Array<{ date: string; close: number }>,
    fastPeriod: number,
    slowPeriod: number,
  ): BacktestResult {
    // Calculate SMAs
    const smaFast: number[] = [];
    const smaSlow: number[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (i >= fastPeriod - 1) {
        const sum = prices.slice(i - fastPeriod + 1, i + 1).reduce((s, p) => s + p.close, 0);
        smaFast[i] = sum / fastPeriod;
      }
      if (i >= slowPeriod - 1) {
        const sum = prices.slice(i - slowPeriod + 1, i + 1).reduce((s, p) => s + p.close, 0);
        smaSlow[i] = sum / slowPeriod;
      }
    }

    // Generate signals
    const signals: Array<{ date: string; type: 'buy' | 'sell'; price: number }> = [];
    let position: 'long' | 'flat' = 'flat';
    let equity = 10000;
    let shares = 0;
    let maxEquity = equity;
    let maxDrawdown = 0;
    const equityCurve: Array<{ date: string; value: number }> = [];
    const returns: number[] = [];
    let prevEquity = equity;

    for (let i = slowPeriod; i < prices.length; i++) {
      const fastAbove = (smaFast[i] ?? 0) > (smaSlow[i] ?? 0);
      const fastAbovePrev = (smaFast[i - 1] ?? 0) > (smaSlow[i - 1] ?? 0);
      const currentPrice = prices[i]!;

      // Buy signal: fast crosses above slow
      if (fastAbove && !fastAbovePrev && position === 'flat') {
        shares = Math.floor(equity / currentPrice.close);
        if (shares > 0) {
          equity -= shares * currentPrice.close;
          position = 'long';
          signals.push({ date: currentPrice.date, type: 'buy', price: currentPrice.close });
        }
      }

      // Sell signal: fast crosses below slow
      if (!fastAbove && fastAbovePrev && position === 'long') {
        equity += shares * currentPrice.close;
        position = 'flat';
        shares = 0;
        signals.push({ date: currentPrice.date, type: 'sell', price: currentPrice.close });
      }

      // Track equity
      const currentEquity = equity + shares * currentPrice.close;
      equityCurve.push({ date: currentPrice.date, value: Math.round(currentEquity * 100) / 100 });

      // Track drawdown
      maxEquity = Math.max(maxEquity, currentEquity);
      const dd = (maxEquity - currentEquity) / maxEquity;
      maxDrawdown = Math.max(maxDrawdown, dd);

      // Track returns for Sharpe
      const dailyReturn = (currentEquity - prevEquity) / prevEquity;
      returns.push(dailyReturn);
      prevEquity = currentEquity;
    }

    // Close any open position at end
    if (position === 'long' && shares > 0) {
      const lastPrice = prices[prices.length - 1];
      if (lastPrice) equity += shares * lastPrice.close;
      shares = 0;
    }

    const finalEquity = equity;
    const totalReturn = ((finalEquity - 10000) / 10000) * 100;

    // Win rate
    const trades: Array<{ buyPrice: number; sellPrice: number }> = [];
    for (let i = 0; i < signals.length - 1; i += 2) {
      const buy = signals[i];
      const sell = signals[i + 1];
      if (buy && sell && buy.type === 'buy' && sell.type === 'sell') {
        trades.push({ buyPrice: buy.price, sellPrice: sell.price });
      }
    }
    const wins = trades.filter(t => t.sellPrice > t.buyPrice).length;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    // Sharpe ratio (annualized, assuming 252 trading days)
    const meanReturn = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
    const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length || 1));
    const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

    return {
      symbol,
      strategy: `SMA(${fastPeriod}/${slowPeriod}) Crossover`,
      trades: trades.length,
      winRate: Math.round(winRate * 10) / 10,
      totalReturn: Math.round(totalReturn * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      signals: signals.slice(-10), // Last 10 signals
      equityCurve: equityCurve.slice(-30), // Last 30 days
      ranAt: Date.now(),
    };
  }

  private renderUpstreamResult(bt: Record<string, unknown>): void {
    const resultEl = document.getElementById('bt-result');
    if (!resultEl) return;

    const totalReturn = Number(bt.cumulativeSimulatedReturnPct || 0);
    const winRate = Number(bt.winRate || 0) * 100;
    const returnColor = totalReturn >= 0 ? '#22c55e' : '#ef4444';
    const returnSign = totalReturn >= 0 ? '+' : '';
    const signalColors: Record<string, string> = {
      'Strong buy': '#22c55e', 'Buy': '#4ade80', 'Hold': '#eab308',
      'Watch': '#f59e0b', 'Sell': '#ef4444', 'Strong sell': '#dc2626',
    };
    const sigColor = signalColors[bt.latestSignal as string] || '#888';

    let html = `
      <div style="margin-bottom:12px">
        <div style="font-size:16px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(bt.display || bt.symbol))} — Signal Backtest</div>
        <div style="font-size:11px;opacity:.4">Real analysis backtest · ${bt.evaluationsRun || 0} evaluations over ${bt.evalWindowDays || 7}d · ${bt.engineVersion || 'v1'}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Cumulative Return</div>
          <div style="font-size:20px;font-weight:700;color:${returnColor}">${returnSign}${totalReturn.toFixed(2)}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Win Rate</div>
          <div style="font-size:20px;font-weight:700;color:var(--text-primary,#fff)">${winRate.toFixed(1)}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Direction Accuracy</div>
          <div style="font-size:20px;font-weight:700;color:var(--text-primary,#fff)">${(Number(bt.directionAccuracy || 0) * 100).toFixed(1)}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Latest Signal</div>
          <div style="font-size:14px;font-weight:700;color:${sigColor}">${escapeHtml(String(bt.latestSignal || '?'))}</div>
        </div>
      </div>`;

    if (bt.summary) {
      html += `<div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;margin-bottom:8px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5;margin-bottom:4px">AI Summary</div>
        <div style="font-size:12px;color:var(--text-secondary,#ccc)">${escapeHtml(String(bt.summary).slice(0, 300))}</div>
      </div>`;
    }

    // Recent evaluations
    const evals = Array.isArray(bt.evaluations) ? bt.evaluations as Array<Record<string, unknown>> : [];
    if (evals.length > 0) {
      html += `<div style="font-size:11px;opacity:.5;margin-bottom:4px">Recent Evaluations:</div>`;
      for (const ev of evals.slice(-6)) {
        const retPct = Number(ev.simulatedReturnPct || 0);
        const retColor = retPct >= 0 ? '#22c55e' : '#ef4444';
        const correct = ev.directionCorrect ? '✅' : '❌';
        html += `<div style="font-size:12px;margin-bottom:2px;display:flex;justify-content:space-between">
          <span>${correct} ${escapeHtml(String(ev.signal || '?'))} @ $${Number(ev.entryPrice || 0).toFixed(2)}</span>
          <span style="color:${retColor}">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</span>
        </div>`;
      }
    }

    html += `<div style="font-size:10px;opacity:.3;margin-top:8px">⚠️ Historical backtest — not financial advice. Past performance does not guarantee future results.</div>`;
    resultEl.innerHTML = html;
  }

  private renderResult(): void {
    const r = this.result;
    if (!r) return;

    const resultEl = document.getElementById('bt-result');
    if (!resultEl) return;

    const returnColor = r.totalReturn >= 0 ? '#22c55e' : '#ef4444';
    const returnSign = r.totalReturn >= 0 ? '+' : '';
    const sharpeColor = r.sharpeRatio > 1 ? '#22c55e' : r.sharpeRatio > 0 ? '#eab308' : '#ef4444';

    let html = `
      <div style="margin-bottom:12px">
        <div style="font-size:16px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(r.symbol)} — ${escapeHtml(r.strategy)}</div>
        <div style="font-size:11px;opacity:.4">Backtest at ${new Date(r.ranAt).toLocaleTimeString()} · Starting capital: $10,000</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Total Return</div>
          <div style="font-size:20px;font-weight:700;color:${returnColor}">${returnSign}${r.totalReturn}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Win Rate</div>
          <div style="font-size:20px;font-weight:700;color:var(--text-primary,#fff)">${r.winRate}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Max Drawdown</div>
          <div style="font-size:20px;font-weight:700;color:#ef4444">-${r.maxDrawdown}%</div>
        </div>
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Sharpe Ratio</div>
          <div style="font-size:20px;font-weight:700;color:${sharpeColor}">${r.sharpeRatio}</div>
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:11px;opacity:.5;margin-bottom:4px">${r.trades} completed trades</div>
      </div>`;

    // Mini equity curve (text-based sparkline)
    if (r.equityCurve.length > 0) {
      const vals = r.equityCurve.map(e => e.value);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      const bars = vals.map(v => {
        const pct = ((v - min) / range) * 100;
        return `<div style="display:inline-block;width:${100 / vals.length}%;height:${Math.max(4, pct * 0.4)}px;background:${v >= 10000 ? '#22c55e' : '#ef4444'};vertical-align:bottom"></div>`;
      }).join('');

      html += `<div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:8px;margin-bottom:10px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5;margin-bottom:4px">Equity Curve (last 30d)</div>
        <div style="height:40px;display:flex;align-items:flex-end;overflow:hidden">${bars}</div>
        <div style="display:flex;justify-content:space-between;font-size:10px;opacity:.4;margin-top:2px">
          <span>$${min.toLocaleString()}</span>
          <span>$${max.toLocaleString()}</span>
        </div>
      </div>`;
    }

    // Recent signals
    if (r.signals.length > 0) {
      html += `<div style="font-size:11px;opacity:.5;margin-bottom:4px">Recent Signals:</div>`;
      for (const sig of r.signals.slice(-6)) {
        const sigColor = sig.type === 'buy' ? '#22c55e' : '#ef4444';
        const sigIcon = sig.type === 'buy' ? '🟢' : '🔴';
        html += `<div style="font-size:12px;margin-bottom:2px">${sigIcon} <span style="color:${sigColor};font-weight:700">${sig.type.toUpperCase()}</span> $${sig.price.toFixed(2)} on ${escapeHtml(sig.date)}</div>`;
      }
    }

    html += `<div style="font-size:10px;opacity:.3;margin-top:8px">⚠️ Uses simulated price data. This is a strategy testing tool, not financial advice. Past performance does not guarantee future results.</div>`;

    resultEl.innerHTML = html;
  }

  public async refresh(): Promise<void> {
    if (this.result) this.runBacktest();
  }
}
