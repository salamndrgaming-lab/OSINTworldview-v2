/**
 * Autonomous Hypothesis Generator Panel
 *
 * Displays AI-generated geopolitical hypotheses seeded every 3 hours
 * by Groq llama-3.3-70b-versatile analyzing live intelligence signals.
 *
 * Each hypothesis shows: title, probability bar, timeframe, category badge,
 * supporting signal citations, and AI reasoning.
 *
 * Data: /api/intelligence/hypotheses
 */

import { Panel } from './Panel';

interface Hypothesis {
  title: string;
  probability: number;
  timeframe: string;
  category: string;
  signals: string[];
  reasoning: string;
}

interface HypothesisData {
  hypotheses: Hypothesis[];
  generatedAt: string | null;
  signalCount: number;
  model: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  military:    '#ef4444',
  nuclear:     '#dc2626',
  cyber:       '#8b5cf6',
  maritime:    '#3b82f6',
  energy:      '#f97316',
  economic:    '#d4a843',
  political:   '#6b7280',
  humanitarian:'#22c55e',
};

export class HypothesisGeneratorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'hypothesis-generator',
      title: 'Hypothesis Generator',
      showCount: true,
      closable: true,
      defaultRowSpan: 3,
      className: 'hypothesis-generator-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchData();
    // Refresh every 30 min to pick up newly seeded hypotheses
    this.refreshTimer = setInterval(() => { void this.fetchData(); }, 1_800_000);
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase">
        🔮 AI-Generated Future Events
      </div>
      <div id="hypo-meta" style="font-size:9px;color:var(--text-muted)"></div>
    `;
    this.content.appendChild(header);

    const list = document.createElement('div');
    list.id = 'hypo-list';
    list.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    list.innerHTML = this.loadingHTML();
    this.content.appendChild(list);
  }

  private loadingHTML(): string {
    return `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="width:24px;height:24px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:hypo-spin 0.8s linear infinite;margin:0 auto 12px"></div>
      <div style="font-size:11px">Loading hypotheses...</div>
      <style>@keyframes hypo-spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  private async fetchData(): Promise<void> {
    const list = this.content.querySelector('#hypo-list');
    if (!list) return;

    try {
      const resp = await fetch('/api/intelligence/hypotheses', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: HypothesisData = await resp.json();
      this.render(data);
    } catch (err) {
      if (list) {
        list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:28px;opacity:0.3;margin-bottom:8px">🔮</div>
          <div style="font-size:11px">Hypotheses unavailable</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Seeded every 3 hours via Groq AI</div>
        </div>`;
      }
      void err;
    }
  }

  private render(data: HypothesisData): void {
    const list = this.content.querySelector('#hypo-list');
    const meta = this.content.querySelector('#hypo-meta');
    if (!list) return;

    const { hypotheses = [], generatedAt, signalCount, model } = data;
    this.setCount(hypotheses.length);

    if (meta && generatedAt) {
      const age = Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000);
      const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      meta.textContent = `${signalCount ?? '?'} signals · ${ageStr}`;
    }

    if (hypotheses.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
        <div style="font-size:28px;opacity:0.3;margin-bottom:8px">🔮</div>
        <div style="font-size:11px;font-weight:500">No hypotheses generated yet</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Seed runs every 3 hours via GitHub Actions</div>
      </div>`;
      return;
    }

    const modelLabel = model?.includes('fallback') ? '⚡ Keyword Engine' : '🤖 Groq AI';

    list.innerHTML = hypotheses.map(h => this.renderHypothesis(h)).join('') +
      `<div style="text-align:center;padding:6px 0 4px;font-size:8px;color:var(--text-ghost)">${modelLabel} · Refreshes every 3h</div>`;
  }

  private renderHypothesis(h: Hypothesis): string {
    const catColor = CATEGORY_COLORS[h.category] || '#6b7280';
    const probColor = h.probability >= 70 ? '#ef4444' : h.probability >= 50 ? '#f97316' : h.probability >= 35 ? '#d4a843' : '#6b7280';
    const signalItems = h.signals.slice(0, 3).map(s =>
      `<span style="display:inline-block;background:var(--vi-bg,#0c0c10);border:1px solid var(--vi-border,#252535);border-radius:4px;padding:1px 5px;font-size:8px;color:var(--text-muted);margin:1px 2px 1px 0">${this.esc(s)}</span>`
    ).join('');

    return `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:6px;border-left:3px solid ${catColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.4;flex:1">${this.esc(h.title)}</div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-size:18px;font-weight:800;color:${probColor};line-height:1">${h.probability}%</div>
          <div style="font-size:8px;color:var(--text-muted)">probability</div>
        </div>
      </div>
      <div style="height:4px;background:var(--vi-bg,#0c0c10);border-radius:2px;margin-bottom:6px;overflow:hidden">
        <div style="height:100%;width:${h.probability}%;background:${probColor};border-radius:2px;opacity:0.75"></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <span style="font-size:9px;font-weight:600;color:${catColor};text-transform:uppercase;letter-spacing:0.5px">${this.esc(h.category)}</span>
        <span style="font-size:9px;color:var(--text-muted)">·</span>
        <span style="font-size:9px;color:var(--text-dim)">⏱ ${this.esc(h.timeframe)}</span>
      </div>
      ${h.reasoning ? `<div style="font-size:10px;color:var(--text-dim);line-height:1.4;margin-bottom:5px;font-style:italic">${this.esc(h.reasoning)}</div>` : ''}
      ${signalItems ? `<div style="margin-top:4px">${signalItems}</div>` : ''}
    </div>`;
  }

  private esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
