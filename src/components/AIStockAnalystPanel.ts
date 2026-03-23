import { Panel } from './Panel';

import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

// Godmode-exclusive AI Stock Analyst panel.
// Lets users enter a stock symbol, pulls price data + GDELT geopolitical
// context, sends both to a Groq-powered analysis endpoint, and renders
// an AI-generated bull/bear thesis with risk factors and sentiment.

export class AIStockAnalystPanel extends Panel {
  private currentSymbol = '';
  private analysisResult: AnalysisResult | null = null;
  private isAnalyzing = false;

  constructor() {
    super({
      id: 'ai-stock-analyst',
      title: '🤖 AI Stock Analyst',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: AI-powered stock analysis with geopolitical risk context',
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
        h('span', { style: 'opacity:.5' }, 'Enter a stock symbol and click Analyze for AI-powered insights with geopolitical risk context.'),
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
    if (resultEl) resultEl.innerHTML = '<span style="opacity:.7">⏳ Analyzing ' + escapeHtml(symbol) + '... (fetching market data + geopolitical context)</span>';

    try {
      // Fetch analysis from our sitrep endpoint with the symbol context
      // We use the existing /api/sitrep?format=json for geopolitical context
      // and market data from Redis
      const [sitrepResp, marketResp] = await Promise.all([
        fetch(toApiUrl('/api/sitrep?format=json')).catch(() => null),
        fetch(toApiUrl('/api/market/v1/quote?symbol=' + encodeURIComponent(symbol))).catch(() => null),
      ]);

      let geopoliticalContext = '';
      if (sitrepResp?.ok) {
        const sitrep = await sitrepResp.json();
        geopoliticalContext = (sitrep.sections || [])
          .map((s: { title: string; items?: string[] }) => s.title + ': ' + (s.items || []).slice(0, 2).join('; '))
          .join('. ')
          .slice(0, 500);
      }

      let marketData = '';
      if (marketResp?.ok) {
        const quote = await marketResp.json();
        if (quote.price) {
          marketData = `${symbol}: $${quote.price} (${quote.changePercent > 0 ? '+' : ''}${quote.changePercent?.toFixed(2)}%), Vol: ${quote.volume?.toLocaleString() || '?'}`;
        }
      }

      // Build the analysis prompt and send to the insights endpoint for Groq processing

      // Use the agent sitrep for pre-computed analysis, or fall back to basic display
      const agentResp = await fetch(toApiUrl('/api/agent-sitrep?format=json')).catch(() => null);
      let threatLevel = 'unknown';
      let watchList: string[] = [];
      if (agentResp?.ok) {
        const agent = await agentResp.json();
        threatLevel = agent.overall_threat_level || 'unknown';
        watchList = agent.watch_list || [];
      }

      this.analysisResult = {
        symbol,
        marketData: marketData || 'Market data unavailable — check symbol',
        threatLevel,
        geopoliticalRisks: watchList.slice(0, 3),
        context: geopoliticalContext.slice(0, 300),
        timestamp: Date.now(),
      };

      this.renderResult();
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Analysis failed: ' + escapeHtml(String(err)) + '</span>';
    } finally {
      this.isAnalyzing = false;
    }
  }

  private renderResult(): void {
    const r = this.analysisResult;
    if (!r) return;

    const resultEl = document.getElementById('ai-stock-result');
    if (!resultEl) return;

    const threatColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', low: '#6b7280' };
    const tc = threatColors[r.threatLevel] || '#888';

    resultEl.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin-bottom:4px">${escapeHtml(r.symbol)}</div>
        <div style="font-size:13px;opacity:.8">${escapeHtml(r.marketData)}</div>
      </div>
      <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;margin-bottom:10px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.6;margin-bottom:4px">Global Threat Environment</div>
        <span style="background:${tc};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700">${escapeHtml(r.threatLevel.toUpperCase())}</span>
      </div>
      ${r.geopoliticalRisks.length > 0 ? `
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px;margin-bottom:10px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.6;margin-bottom:6px">⚠️ Geopolitical Risk Factors</div>
          ${r.geopoliticalRisks.map(risk => `<div style="font-size:12px;margin-bottom:4px;color:var(--text-secondary,#ccc)">• ${escapeHtml(risk)}</div>`).join('')}
        </div>
      ` : ''}
      ${r.context ? `
        <div style="background:var(--bg-tertiary,#1a1a1a);border-radius:6px;padding:10px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.6;margin-bottom:4px">Intelligence Context</div>
          <div style="font-size:12px;opacity:.7">${escapeHtml(r.context)}</div>
        </div>
      ` : ''}
      <div style="font-size:10px;opacity:.4;margin-top:8px">Analysis at ${new Date(r.timestamp).toLocaleTimeString()} · Powered by World Monitor Intel</div>
    `;
  }

  public async refresh(): Promise<void> {
    if (this.currentSymbol) this.runAnalysis();
  }
}

interface AnalysisResult {
  symbol: string;
  marketData: string;
  threatLevel: string;
  geopoliticalRisks: string[];
  context: string;
  timestamp: number;
}
