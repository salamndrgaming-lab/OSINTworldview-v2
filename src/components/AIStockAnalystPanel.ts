import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

export class AIStockAnalystPanel extends Panel {
  private currentSymbol = '';
  private isAnalyzing = false;

  constructor() {
    super({
      id: 'ai-stock-analyst',
      title: '🤖 AI Stock Analyst',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Full technical + geopolitical stock analysis',
    });
    this.renderInput();
  }

  private renderInput(): void {
    const wrapper = h('div', { style: 'padding:8px' },
      h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' },
        h('input', {
          type: 'text',
          id: 'ai-stock-input',
          placeholder: 'Enter symbol (e.g. AAPL, TSLA)',
          style: 'flex:1;background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px 12px;color:var(--text-primary,#fff);font-size:13px;outline:none',
          onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') this.runAnalysis(); },
        }),
        h('button', {
          style: 'background:var(--accent,#4a90d9);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;white-space:nowrap',
          onClick: () => this.runAnalysis(),
        }, 'Analyze'),
      ),
      h('div', { id: 'ai-stock-result', style: 'font-size:13px;line-height:1.6;color:var(--text-secondary,#ccc)' },
        h('span', { style: 'opacity:.5' }, 'Enter a stock symbol for full technical analysis with geopolitical risk overlay.'),
      ),
    );
    replaceChildren(this.content, wrapper);
  }

  private async runAnalysis(): Promise<void> {
    const input = document.getElementById('ai-stock-input') as HTMLInputElement;
    const symbol = (input?.value || '').trim().toUpperCase();
    if (!symbol || this.isAnalyzing) return;

    this.currentSymbol = symbol;
    this.isAnalyzing = true;
    const resultEl = document.getElementById('ai-stock-result');
    if (resultEl) resultEl.innerHTML = '<span style="opacity:.7">⏳ Analyzing ' + escapeHtml(symbol) + '...</span>';

    try {
      const [analysisResp, sitrepResp] = await Promise.all([
        fetch(toApiUrl(`/api/market/v1/analyze-stock?symbol=${encodeURIComponent(symbol)}&include_news=true`)).catch(() => null),
        fetch(toApiUrl('/api/agent-sitrep?format=json')).catch(() => null),
      ]);

      const analysis: Record<string, unknown> | null = analysisResp?.ok ? await analysisResp.json() : null;
      let threatLevel = 'unknown';
      let watchList: string[] = [];
      if (sitrepResp?.ok) {
        const sitrep = await sitrepResp.json();
        threatLevel = sitrep.overall_threat_level || 'unknown';
        watchList = sitrep.watch_list || [];
      }

      if (analysis && analysis.available !== false) {
        this.renderRealAnalysis(analysis, threatLevel, watchList);
      } else {
        this.renderFallback(symbol, threatLevel, watchList);
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Analysis failed: ' + escapeHtml(String(err)) + '</span>';
    } finally {
      this.isAnalyzing = false;
    }
  }

  private renderRealAnalysis(a: Record<string, unknown>, threatLevel: string, watchList: string[]): void {
    const resultEl = document.getElementById('ai-stock-result');
    if (!resultEl) return;

    const signalColors: Record<string, string> = {
      'Strong buy': '#22c55e', 'Buy': '#4ade80', 'Hold': '#eab308',
      'Watch': '#f59e0b', 'Sell': '#ef4444', 'Strong sell': '#dc2626',
    };
    const signalColor = signalColors[a.signal as string] || '#888';
    const changeColor = (a.changePercent as number) >= 0 ? '#22c55e' : '#ef4444';
    const changeSign = (a.changePercent as number) >= 0 ? '+' : '';
    const threatColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', low: '#6b7280' };
    const tc = threatColors[threatLevel] || '#888';

    let html = `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:18px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(a.display || a.symbol))}</div>
        <span style="background:${signalColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${escapeHtml(String(a.signal || '?'))}</span>
      </div>
      <div style="font-size:14px;margin-top:2px">
        <span style="color:var(--text-primary,#fff);font-weight:600">$${Number(a.currentPrice || 0).toFixed(2)}</span>
        <span style="color:${changeColor};font-size:12px;margin-left:6px">${changeSign}${Number(a.changePercent || 0).toFixed(2)}%</span>
      </div>
    </div>`;

    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
      <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:8px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Trend</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(a.trendStatus || '?'))}</div>
      </div>
      <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:8px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:.5">MACD</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(a.macdStatus || '?'))}</div>
      </div>
      <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:8px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:.5">RSI</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(a.rsiStatus || '?'))}</div>
      </div>
      <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:8px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:.5">Volume</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(String(a.volumeStatus || '?'))}</div>
      </div>
    </div>`;

    if (a.summary) {
      html += `<div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;margin-bottom:8px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5;margin-bottom:4px">AI Analysis</div>
        <div style="font-size:12px;color:var(--text-secondary,#ccc)">${escapeHtml(String(a.summary).slice(0, 300))}</div>
      </div>`;
    }

    const bulls = Array.isArray(a.bullishFactors) ? a.bullishFactors as string[] : [];
    const risks = Array.isArray(a.riskFactors) ? a.riskFactors as string[] : [];
    if (bulls.length > 0 || risks.length > 0) {
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">`;
      if (bulls.length > 0) {
        html += `<div style="background:#22c55e10;border:1px solid #22c55e30;border-radius:6px;padding:8px">
          <div style="font-size:10px;color:#22c55e;font-weight:700;margin-bottom:4px">🟢 BULLISH</div>
          ${bulls.slice(0, 3).map(b => `<div style="font-size:11px;color:#ccc;margin-bottom:2px">• ${escapeHtml(String(b).slice(0, 60))}</div>`).join('')}
        </div>`;
      }
      if (risks.length > 0) {
        html += `<div style="background:#ef444410;border:1px solid #ef444430;border-radius:6px;padding:8px">
          <div style="font-size:10px;color:#ef4444;font-weight:700;margin-bottom:4px">🔴 RISKS</div>
          ${risks.slice(0, 3).map(r => `<div style="font-size:11px;color:#ccc;margin-bottom:2px">• ${escapeHtml(String(r).slice(0, 60))}</div>`).join('')}
        </div>`;
      }
      html += `</div>`;
    }

    html += `<div style="background:var(--bg-tertiary,#1a1a1a);border-left:3px solid ${tc};border-radius:6px;padding:8px;margin-bottom:6px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5;margin-bottom:3px">🛡️ Geopolitical Environment</div>
      <span style="background:${tc};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700">${escapeHtml(threatLevel.toUpperCase())}</span>
      ${watchList.length > 0 ? `<div style="font-size:11px;opacity:.6;margin-top:4px">${watchList.slice(0, 2).map(w => '⚠️ ' + escapeHtml(String(w).slice(0, 60))).join('<br>')}</div>` : ''}
    </div>`;

    const support = Array.isArray(a.supportLevels) ? a.supportLevels as number[] : [];
    const resistance = Array.isArray(a.resistanceLevels) ? a.resistanceLevels as number[] : [];
    if (support.length > 0 || resistance.length > 0) {
      html += `<div style="font-size:11px;opacity:.6;margin-top:4px">`;
      if (support.length > 0) html += `Support: ${support.map(s => '$' + Number(s).toFixed(2)).join(', ')} · `;
      if (resistance.length > 0) html += `Resistance: ${resistance.map(r => '$' + Number(r).toFixed(2)).join(', ')}`;
      html += `</div>`;
    }

    html += `<div style="font-size:10px;opacity:.3;margin-top:6px">Analysis powered by OSINTview · Not financial advice</div>`;
    resultEl.innerHTML = html;
  }

  private renderFallback(symbol: string, threatLevel: string, watchList: string[]): void {
    const resultEl = document.getElementById('ai-stock-result');
    if (!resultEl) return;
    const tc = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', low: '#6b7280' }[threatLevel] || '#888';

    resultEl.innerHTML = `
      <div style="margin-bottom:10px">
        <div style="font-size:16px;font-weight:700;color:var(--text-primary,#fff)">${escapeHtml(symbol)}</div>
        <div style="font-size:12px;color:#f59e0b;margin-top:4px">⚠️ Symbol not found or market data unavailable</div>
      </div>
      <div style="background:var(--bg-tertiary,#1a1a1a);border-left:3px solid ${tc};border-radius:6px;padding:10px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.5;margin-bottom:4px">🛡️ Geopolitical Risk Context</div>
        <span style="background:${tc};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700">${escapeHtml(threatLevel.toUpperCase())}</span>
        ${watchList.length > 0 ? `<div style="margin-top:6px">${watchList.slice(0, 3).map(w => `<div style="font-size:11px;opacity:.6">⚠️ ${escapeHtml(String(w).slice(0, 80))}</div>`).join('')}</div>` : ''}
      </div>`;
  }

  public async refresh(): Promise<void> {
    if (this.currentSymbol) this.runAnalysis();
  }
}
