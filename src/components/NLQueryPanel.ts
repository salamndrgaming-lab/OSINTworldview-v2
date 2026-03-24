import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { toApiUrl } from '@/services/runtime';

interface QueryResult {
  question: string;
  answer: string;
  sources: Array<{ type: string; title: string; relevance: number }>;
  timestamp: number;
}

export class NLQueryPanel extends Panel {
  private history: QueryResult[] = [];
  private isQuerying = false;

  constructor() {
    super({
      id: 'nl-query',
      title: '💬 Intel Query',
      defaultRowSpan: 2,
      infoTooltip: 'Godmode exclusive: Ask questions about the intelligence picture in natural language',
    });
    this.renderUI();
  }

  private renderUI(): void {
    const wrapper = h('div', { style: 'padding:8px;display:flex;flex-direction:column;height:100%' },
      h('div', { id: 'nl-query-history', style: 'flex:1;overflow-y:auto;margin-bottom:8px;font-size:13px' },
        h('div', { style: 'opacity:.5;text-align:center;padding:20px' },
          h('div', { style: 'font-size:20px;margin-bottom:6px' }, '💬'),
          h('div', {}, 'Ask anything about the current intelligence picture.'),
          h('div', { style: 'font-size:11px;margin-top:4px;opacity:.7' }, 'Examples: "What threats are active in the Middle East?" · "Any radiation anomalies?" · "Summarize today\'s conflicts"'),
        ),
      ),
      h('div', { style: 'display:flex;gap:6px' },
        h('input', {
          type: 'text',
          id: 'nl-query-input',
          placeholder: 'Ask a question...',
          style: 'flex:1;background:var(--bg-secondary,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:6px;padding:8px 12px;color:var(--text-primary,#fff);font-size:13px;outline:none',
          onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') this.submitQuery(); },
        }),
        h('button', {
          id: 'nl-query-btn',
          style: 'background:var(--accent,#4a90d9);color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer',
          onClick: () => this.submitQuery(),
        }, 'Ask'),
      ),
    );
    replaceChildren(this.content, wrapper);
  }

  private async submitQuery(): Promise<void> {
    const input = document.getElementById('nl-query-input') as HTMLInputElement;
    const question = (input?.value || '').trim();
    if (!question || this.isQuerying) return;

    input.value = '';
    this.isQuerying = true;
    const btn = document.getElementById('nl-query-btn');
    if (btn) btn.textContent = '⏳';

    this.addToHistory({ question, answer: '⏳ Searching intelligence...', sources: [], timestamp: Date.now() });

    try {
      const searchResp = await fetch(toApiUrl(`/api/search?q=${encodeURIComponent(question)}&k=8&format=json`));
      let searchResults: Array<{ data?: string; metadata?: Record<string, string>; score?: number }> = [];
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        searchResults = searchData.results || [];
      }

      const sitrepResp = await fetch(toApiUrl('/api/agent-sitrep?format=json'));
      let sitrepContext = '';
      if (sitrepResp.ok) {
        const sitrep = await sitrepResp.json();
        sitrepContext = sitrep.executive_summary?.slice(0, 300) || '';
      }

      // Step 3: Build context from search results (used for source attribution)

      // Step 4: Build a concise answer from the retrieved context
      // We synthesize locally since we can't call Groq from the browser
      const sources = searchResults.slice(0, 6).map(r => ({
        type: r.metadata?.type || 'unknown',
        title: (r.data || '').slice(0, 80),
        relevance: Math.round((r.score || 0) * 100),
      }));

      let answer: string;
      if (searchResults.length === 0 && !sitrepContext) {
        answer = 'No relevant intelligence found for this query. Try rephrasing or asking about a specific region, event type, or threat category.';
      } else {
        const topResults = searchResults.slice(0, 4);
        const summaryParts: string[] = [];

        if (sitrepContext) {
          summaryParts.push(`Current assessment: ${sitrepContext.slice(0, 200)}`);
        }

        const byType = new Map<string, string[]>();
        for (const r of topResults) {
          const type = r.metadata?.type || 'intel';
          const items = byType.get(type) || [];
          items.push((r.data || '').slice(0, 100));
          byType.set(type, items);
        }

        for (const [type, items] of byType) {
          const typeLabel = type.replace(/-/g, ' ');
          summaryParts.push(`${typeLabel}: ${items.join('; ')}`);
        }

        answer = summaryParts.join('\n\n');
      }

      const lastEntry = this.history[this.history.length - 1];
      if (lastEntry) {
        lastEntry.answer = answer;
        lastEntry.sources = sources;
      }

      this.renderHistory();
    } catch (err) {
      const lastEntry = this.history[this.history.length - 1];
      if (lastEntry) {
        lastEntry.answer = 'Query failed: ' + String(err);
      }
      this.renderHistory();
    } finally {
      this.isQuerying = false;
      if (btn) btn.textContent = 'Ask';
    }
  }

  private addToHistory(result: QueryResult): void {
    this.history.push(result);
    if (this.history.length > 20) this.history.shift();
    this.renderHistory();
  }

  private renderHistory(): void {
    const historyEl = document.getElementById('nl-query-history');
    if (!historyEl) return;

    const sourceColors: Record<string, string> = {
      'gdelt-intel': '#3b82f6', 'missile-strike': '#ef4444', 'disease-outbreak': '#f59e0b',
      'conflict-forecast': '#dc2626', 'poi': '#8b5cf6', 'agent-sitrep': '#06b6d4',
      'alert': '#f97316', 'unrest': '#eab308', unknown: '#6b7280',
    };

    let html = '';
    for (const entry of this.history) {
      html += `<div style="margin-bottom:12px">
        <div style="background:var(--accent,#4a90d9);color:#fff;padding:6px 10px;border-radius:8px 8px 8px 2px;display:inline-block;max-width:85%;font-size:13px;margin-bottom:4px">${escapeHtml(entry.question)}</div>
        <div style="background:var(--bg-tertiary,#141414);border:1px solid var(--border-color,#252525);padding:8px 10px;border-radius:2px 8px 8px 8px;font-size:12px;line-height:1.6;color:var(--text-secondary,#ccc);white-space:pre-wrap">${escapeHtml(entry.answer)}</div>`;

      if (entry.sources.length > 0) {
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">`;
        for (const s of entry.sources.slice(0, 5)) {
          const color = sourceColors[s.type] || '#6b7280';
          html += `<span style="background:${color}20;color:${color};border:1px solid ${color}40;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:600">${escapeHtml(s.type)} ${s.relevance}%</span>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }

    historyEl.innerHTML = html;
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  public async refresh(): Promise<void> {
    // No-op — history is maintained in memory
  }
}
