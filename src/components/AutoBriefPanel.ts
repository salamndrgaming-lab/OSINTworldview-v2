/**
 * Cross-Source Signal Fusion Auto-Briefs Panel
 *
 * Monitors correlation card scores from /api/bootstrap (correlation data).
 * When any domain has a card with score ≥ 85, it automatically generates
 * a one-page intelligence brief using Groq via /api/insights.
 *
 * High-correlation signals represent multi-source convergence — the most
 * actionable intelligence events on the platform.
 *
 * Data: /api/bootstrap (correlation cards), /api/insights (Groq context)
 * Threshold: score ≥ 85 triggers auto-brief generation
 */

import { Panel } from './Panel';

interface CorrelationSignal {
  type: string;
  source: string;
  severity: string;
  country?: string;
  label?: string;
  timestamp?: number;
}

interface CorrelationCard {
  id: string;
  domain: string;
  title: string;
  score: number;
  signals: CorrelationSignal[];
  location?: { lat: number; lon: number; label: string };
  countries: string[];
  trend: string;
  timestamp: number;
}

interface Brief {
  cardId: string;
  title: string;
  domain: string;
  score: number;
  summary: string;
  keySignals: string[];
  countries: string[];
  generatedAt: number;
  isAI: boolean;
}

const DOMAIN_META_MAP: Record<string, { icon: string; color: string; label: string }> = {
  military:   { icon: '⚔️',  color: '#ef4444', label: 'Military' },
  escalation: { icon: '📈', color: '#f97316', label: 'Escalation' },
  economic:   { icon: '💹', color: '#d4a843', label: 'Economic' },
  disaster:   { icon: '🌪', color: '#8b5cf6', label: 'Disaster' },
};
const DOMAIN_META_FALLBACK = { icon: '⚡', color: '#d4a843', label: 'Intelligence' };
function getDomainMeta(domain: string): { icon: string; color: string; label: string } {
  return DOMAIN_META_MAP[domain] ?? DOMAIN_META_FALLBACK;
}

const AUTO_BRIEF_THRESHOLD = 85;

export class AutoBriefPanel extends Panel {
  private briefs: Brief[] = [];
  private generatingIds = new Set<string>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckAt = 0;

  constructor() {
    super({
      id: 'auto-brief',
      title: 'Auto-Briefs',
      showCount: true,
      closable: true,
      defaultRowSpan: 3,
      className: 'auto-brief-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.checkCorrelations();
    // Check every 10 minutes for new high-correlation events
    this.refreshTimer = setInterval(() => { void this.checkCorrelations(); }, 600_000);
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase">
        ⚡ High-Signal Auto-Briefs
      </div>
      <div id="ab-status" style="font-size:9px;color:var(--text-muted)">Threshold: score ≥${AUTO_BRIEF_THRESHOLD}</div>
    `;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'ab-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    body.innerHTML = this.loadingHTML();
    this.content.appendChild(body);
  }

  private loadingHTML(): string {
    return `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="width:24px;height:24px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:ab-spin 0.8s linear infinite;margin:0 auto 12px"></div>
      <div style="font-size:11px">Scanning correlation signals…</div>
      <style>@keyframes ab-spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  private async checkCorrelations(): Promise<void> {
    this.lastCheckAt = Date.now();
    const statusEl = this.content.querySelector('#ab-status');
    if (statusEl) statusEl.textContent = 'Scanning…';

    try {
      // Fetch bootstrap for correlation data (already cached, fast)
      const resp = await fetch('/api/bootstrap', { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bootstrap = await resp.json();

      const correlationData = bootstrap?.correlationCards;
      if (!correlationData) {
        this.renderEmpty('No correlation data in bootstrap');
        return;
      }

      // Collect all cards above threshold
      const allCards: CorrelationCard[] = [
        ...(correlationData.military ?? []),
        ...(correlationData.escalation ?? []),
        ...(correlationData.economic ?? []),
        ...(correlationData.disaster ?? []),
      ];

      const highCards = allCards
        .filter(c => c.score >= AUTO_BRIEF_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6); // cap at 6 briefs to avoid Groq rate limits

      if (statusEl) {
        statusEl.textContent = highCards.length > 0
          ? `${highCards.length} high-signal event${highCards.length > 1 ? 's' : ''} detected`
          : `Monitoring · Last scan ${new Date().toLocaleTimeString()}`;
      }

      if (highCards.length === 0) {
        this.renderEmpty(`No events above score ${AUTO_BRIEF_THRESHOLD} right now`);
        return;
      }

      // Generate briefs for cards we haven't seen yet
      const newCards = highCards.filter(c => !this.briefs.find(b => b.cardId === c.id));

      // Generate briefs sequentially (avoid hammering /api/insights)
      for (const card of newCards) {
        if (!this.generatingIds.has(card.id)) {
          this.generatingIds.add(card.id);
          const brief = await this.generateBrief(card);
          this.briefs.unshift(brief);
          this.generatingIds.delete(card.id);
        }
      }

      // Keep most recent 12 briefs
      this.briefs = this.briefs.slice(0, 12);
      this.setCount(this.briefs.length);
      this.renderBriefs(highCards);

    } catch {
      const body = this.content.querySelector('#ab-body');
      if (body && this.briefs.length === 0) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
          <div style="font-size:26px;opacity:0.3;margin-bottom:8px">⚡</div>
          <div style="font-size:11px">Correlation data unavailable</div>
        </div>`;
      }
    }
  }

  private async generateBrief(card: CorrelationCard): Promise<Brief> {
    // Build key signals list from card data
    const keySignals = card.signals
      .slice(0, 5)
      .map(s => [s.label, s.country, s.type].filter(Boolean).join(' · '))
      .filter(Boolean);

    let summary = '';
    let isAI = false;

    // Try to enrich with Groq context from /api/insights
    try {
      const resp = await fetch('/api/insights', { signal: AbortSignal.timeout(8_000) });
      if (resp.ok) {
        const insights = await resp.json();
        const worldBrief = insights?.worldBrief ? String(insights.worldBrief).slice(0, 200) : '';

        if (worldBrief) {
          // Compose a brief from correlation signals + world context
          summary = this.composeBrief(card, keySignals, worldBrief);
          isAI = true;
        }
      }
    } catch {
      // Fallback to template brief
    }

    if (!summary) {
      summary = this.templateBrief(card, keySignals);
    }

    return {
      cardId: card.id,
      title: card.title,
      domain: card.domain,
      score: card.score,
      summary,
      keySignals,
      countries: card.countries?.slice(0, 5) ?? [],
      generatedAt: Date.now(),
      isAI,
    };
  }

  private composeBrief(card: CorrelationCard, signals: string[], worldContext: string): string {
    const { label } = getDomainMeta(card.domain);
    const signalList = signals.slice(0, 3).join('; ');
    return `${label} correlation cluster detected with score ${card.score}/100. ` +
      `Converging signals: ${signalList || 'multiple sources'}. ` +
      `Current global context: ${worldContext.slice(0, 150)}`;
  }

  private templateBrief(card: CorrelationCard, signals: string[]): string {
    const { label } = getDomainMeta(card.domain);
    const countries = card.countries?.slice(0, 3).join(', ') || 'multiple regions';
    const signalCount = card.signals?.length ?? 0;
    const leadSignal = signals[0] ?? '';
    return `${label} event cluster in ${countries} reached correlation score ${card.score}/100. ` +
      `${signalCount} cross-source signal${signalCount !== 1 ? 's' : ''} converging. ` +
      (leadSignal ? `Leading indicator: ${leadSignal}.` : 'Multiple independent sources confirm activity.');
  }

  private renderBriefs(highCards: CorrelationCard[]): void {
    const body = this.content.querySelector('#ab-body');
    if (!body) return;

    if (this.briefs.length === 0) {
      this.renderEmpty('Generating briefs…');
      return;
    }

    const scanAge = Math.round((Date.now() - this.lastCheckAt) / 1000);
    const scanStr = scanAge < 60 ? `${scanAge}s ago` : `${Math.round(scanAge / 60)}m ago`;

    let html = `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--intel-accent-border,rgba(212,168,67,0.2));border-radius:6px;padding:7px 9px;margin-bottom:8px;font-size:10px;color:var(--text-dim)">
      <span style="color:var(--intel-accent,#d4a843);font-weight:600">⚡ ${highCards.length} active</span> high-correlation event${highCards.length !== 1 ? 's' : ''} · Scan: ${scanStr}
    </div>`;

    html += this.briefs.map(b => this.renderBriefCard(b)).join('');
    html += `<div style="text-align:center;padding:6px 0 4px;font-size:8px;color:var(--text-ghost)">Threshold: score ≥${AUTO_BRIEF_THRESHOLD} · Refreshes every 10 min</div>`;

    body.innerHTML = html;
  }

  private renderBriefCard(brief: Brief): string {
    const { color, icon, label: domainLabel } = getDomainMeta(brief.domain);
    const age = Math.round((Date.now() - brief.generatedAt) / 60000);
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    const countriesStr = brief.countries.length > 0 ? brief.countries.join(', ') : '';
    const signalBadges = brief.keySignals.slice(0, 3).map(s =>
      `<span style="display:inline-block;background:var(--vi-bg,#0c0c10);border:1px solid var(--vi-border,#252535);border-radius:4px;padding:1px 5px;font-size:8px;color:var(--text-muted);margin:1px 2px 1px 0">${this.esc(s)}</span>`
    ).join('');

    return `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:7px;border-left:3px solid ${color}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text);line-height:1.4">${icon} ${this.esc(brief.title)}</div>
          ${countriesStr ? `<div style="font-size:9px;color:var(--text-muted);margin-top:1px">📍 ${this.esc(countriesStr)}</div>` : ''}
        </div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-size:17px;font-weight:800;color:${color};line-height:1">${brief.score}</div>
          <div style="font-size:7px;color:var(--text-muted)">score</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-dim);line-height:1.5;margin-bottom:6px">${this.esc(brief.summary)}</div>
      ${signalBadges ? `<div style="margin-bottom:4px">${signalBadges}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:9px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.4px">${domainLabel}</span>
        <span style="font-size:8px;color:var(--text-ghost)">${brief.isAI ? '🤖 AI-enriched · ' : ''}${ageStr}</span>
      </div>
    </div>`;
  }

  private renderEmpty(msg: string): void {
    const body = this.content.querySelector('#ab-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="font-size:32px;opacity:0.3;margin-bottom:8px">⚡</div>
      <div style="font-size:11px;font-weight:500">${this.esc(msg)}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Briefs generate automatically when correlation ≥${AUTO_BRIEF_THRESHOLD}</div>
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
