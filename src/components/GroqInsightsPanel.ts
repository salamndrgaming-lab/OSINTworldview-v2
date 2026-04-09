/**
 * GroqInsightsPanel.ts — AI Insights Dashboard Panel
 * OSINTview OSINT Platform
 *
 * Drop into: src/components/GroqInsightsPanel.ts
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface GroqInsight {
  id: string;
  type: 'brief' | 'threat' | 'poi_highlight' | 'trend' | 'entity_link' | 'market' | 'geopolitical';
  title: string;
  content: string;
  severity: 'info' | 'watch' | 'warning' | 'critical';
  confidence: number;
  timestamp: string;
  sources: string[];
  relatedPOIs: string[];
  tags: string[];
  region?: string;
}

interface InsightsResponse {
  brief: string;
  generatedAt: string;
  model: string;
  insights: GroqInsight[];
  threatLevel: 'stable' | 'elevated' | 'high' | 'critical';
  topTrends: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  info: { color: '#3b82f6', icon: 'ℹ', label: 'INFO' },
  watch: { color: '#eab308', icon: '◉', label: 'WATCH' },
  warning: { color: '#f97316', icon: '⚠', label: 'WARNING' },
  critical: { color: '#ef4444', icon: '⛊', label: 'CRITICAL' },
};

const THREAT_LEVEL_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  stable: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', label: 'STABLE' },
  elevated: { color: '#eab308', bg: 'rgba(234,179,8,0.08)', label: 'ELEVATED' },
  high: { color: '#f97316', bg: 'rgba(249,115,22,0.08)', label: 'HIGH' },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', label: 'CRITICAL' },
};

const DEFAULT_THREAT_LEVEL = { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', label: 'STABLE' };

const TYPE_ICONS: Record<string, string> = {
  brief: '📋',
  threat: '🎯',
  poi_highlight: '👤',
  trend: '📈',
  entity_link: '🔗',
  market: '💹',
  geopolitical: '🌍',
};

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function confidencePips(confidence: number): string {
  const filled = Math.round(confidence * 5);
  return Array.from({ length: 5 }, (_, i) =>
    `<span style="color:${i < filled ? 'var(--gi-accent)' : 'var(--gi-muted)'};font-size:8px">●</span>`
  ).join('');
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById('groq-insights-styles')) return;

  const style = document.createElement('style');
  style.id = 'groq-insights-styles';
  style.textContent = `
    :root {
      --gi-bg: #0a0e17;
      --gi-surface: #111827;
      --gi-surface-hover: #1a2332;
      --gi-border: #1e293b;
      --gi-text: #e2e8f0;
      --gi-text-dim: #94a3b8;
      --gi-text-muted: #64748b;
      --gi-muted: #1e293b;
      --gi-accent: var(--accent-color, #3b82f6);
      --gi-radius: 8px;
      --gi-transition: 200ms cubic-bezier(.4,0,.2,1);
    }

    .gi-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--gi-bg); font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace; }

    .gi-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--gi-surface); border-bottom: 1px solid var(--gi-border); flex-shrink: 0; }
    .gi-header-title { font-size: 13px; font-weight: 700; color: var(--gi-text); display: flex; align-items: center; gap: 8px; }
    .gi-header-model { font-size: 10px; color: var(--gi-text-muted); padding: 2px 6px; background: var(--gi-muted); border-radius: 4px; }
    .gi-header-time { font-size: 10px; color: var(--gi-text-muted); margin-left: auto; }
    .gi-refresh-btn { padding: 4px 10px; background: var(--gi-muted); border: 1px solid var(--gi-border); border-radius: var(--gi-radius); color: var(--gi-text-dim); font-size: 11px; font-family: inherit; cursor: pointer; transition: all var(--gi-transition); }
    .gi-refresh-btn:hover { background: var(--gi-surface-hover); border-color: var(--gi-accent); color: var(--gi-accent); }
    .gi-refresh-btn.spinning { animation: gi-spin 1s linear infinite; pointer-events: none; }
    @keyframes gi-spin { to { transform: rotate(360deg); } }

    .gi-threat-banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--gi-border); flex-shrink: 0; }
    .gi-threat-level { font-size: 11px; font-weight: 700; letter-spacing: 1px; padding: 4px 12px; border-radius: 4px; }
    .gi-threat-pulse { width: 8px; height: 8px; border-radius: 50%; animation: gi-pulse 2s ease infinite; }
    @keyframes gi-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }
    .gi-threat-trends { flex: 1; display: flex; gap: 6px; flex-wrap: wrap; }
    .gi-trend-chip { padding: 2px 8px; background: var(--gi-muted); border-radius: 10px; font-size: 10px; color: var(--gi-text-dim); }

    .gi-brief { padding: 16px; border-bottom: 1px solid var(--gi-border); flex-shrink: 0; }
    .gi-brief-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--gi-text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .gi-brief-label::after { content: ''; flex: 1; height: 1px; background: var(--gi-border); }
    .gi-brief-text { font-size: 12px; color: var(--gi-text-dim); line-height: 1.7; max-height: 120px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--gi-border) transparent; }

    .gi-tabs { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid var(--gi-border); flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
    .gi-tabs::-webkit-scrollbar { display: none; }
    .gi-tab { padding: 4px 10px; background: none; border: 1px solid transparent; border-radius: var(--gi-radius); color: var(--gi-text-muted); font-size: 10px; font-family: inherit; cursor: pointer; white-space: nowrap; transition: all var(--gi-transition); }
    .gi-tab:hover { color: var(--gi-text-dim); }
    .gi-tab.active { background: color-mix(in srgb, var(--gi-accent) 12%, transparent); border-color: color-mix(in srgb, var(--gi-accent) 30%, transparent); color: var(--gi-accent); }

    .gi-feed { flex: 1; overflow-y: auto; padding: 12px 16px; scrollbar-width: thin; scrollbar-color: var(--gi-border) transparent; }

    .gi-insight-card { background: var(--gi-surface); border: 1px solid var(--gi-border); border-radius: 10px; padding: 14px; margin-bottom: 10px; position: relative; overflow: hidden; transition: all var(--gi-transition); animation: gi-card-in 0.3s ease both; }
    .gi-insight-card::before { content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 3px; background: var(--insight-color, var(--gi-accent)); }
    .gi-insight-card:hover { border-color: var(--gi-border); background: var(--gi-surface-hover); }
    @keyframes gi-card-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }

    .gi-insight-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .gi-insight-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .gi-insight-title { font-size: 13px; font-weight: 700; color: var(--gi-text); flex: 1; line-height: 1.3; }
    .gi-insight-severity { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }

    .gi-insight-content { font-size: 12px; color: var(--gi-text-dim); line-height: 1.6; padding-left: 24px; }

    .gi-insight-meta { display: flex; align-items: center; gap: 10px; padding-left: 24px; margin-top: 10px; flex-wrap: wrap; }
    .gi-insight-time { font-size: 10px; color: var(--gi-text-muted); }
    .gi-insight-confidence { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--gi-text-muted); }
    .gi-insight-tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .gi-insight-tag { padding: 1px 6px; background: var(--gi-muted); border-radius: 3px; font-size: 9px; color: var(--gi-text-muted); }
    .gi-insight-pois { display: flex; gap: 4px; flex-wrap: wrap; }
    .gi-insight-poi { padding: 1px 6px; background: color-mix(in srgb, var(--gi-accent) 12%, transparent); border-radius: 3px; font-size: 9px; color: var(--gi-accent); cursor: pointer; }
    .gi-insight-poi:hover { background: color-mix(in srgb, var(--gi-accent) 25%, transparent); }

    .gi-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--gi-text-muted); gap: 12px; }
    .gi-loading-brain { font-size: 32px; animation: gi-brain-pulse 1.5s ease infinite; }
    @keyframes gi-brain-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.7; } }

    .gi-empty { padding: 40px 20px; text-align: center; color: var(--gi-text-muted); font-size: 12px; }

    @media (max-width: 768px) {
      .gi-insight-content { padding-left: 0; }
      .gi-insight-meta { padding-left: 0; }
      .gi-header { flex-wrap: wrap; }
    }
  `;
  document.head.appendChild(style);
}

// ── Main Component ───────────────────────────────────────────────────────────

export class GroqInsightsPanel {
  private container: HTMLElement;
  private data: InsightsResponse | null = null;
  private filteredInsights: GroqInsight[] = [];
  private activeFilter = 'all';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private onPOIClick: ((poiName: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    injectStyles();
  }

  onPOIClicked(cb: (poiName: string) => void): void {
    this.onPOIClick = cb;
  }

  async init(): Promise<void> {
    this.container.innerHTML = `
      <div class="gi-panel">
        <div class="gi-loading">
          <div class="gi-loading-brain">🧠</div>
          <div>Groq AI analyzing intelligence feeds…</div>
        </div>
      </div>`;

    await this.fetchInsights();
    this.render();

    this.refreshInterval = setInterval(() => { void this.fetchInsights().then(() => this.render()); }, 300000);
  }

  private async fetchInsights(): Promise<void> {
    try {
      const res = await fetch('/api/insights');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
    } catch (err) {
      console.error('[GroqInsights] Failed to fetch:', err);
      if (!this.data) {
        this.data = {
          brief: 'Unable to connect to Groq AI analysis endpoint. Waiting for data…',
          generatedAt: new Date().toISOString(),
          model: 'offline',
          insights: [],
          threatLevel: 'stable',
          topTrends: [],
        };
      }
    }
    this.applyFilter();
  }

  private applyFilter(): void {
    if (!this.data) {
      this.filteredInsights = [];
      return;
    }

    if (this.activeFilter === 'all') {
      this.filteredInsights = [...this.data.insights];
    } else {
      this.filteredInsights = this.data.insights.filter((i) => i.type === this.activeFilter);
    }

    const severityOrder: Record<string, number> = { critical: 0, warning: 1, watch: 2, info: 3 };
    this.filteredInsights.sort((a, b) => {
      const sd = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
      if (sd !== 0) return sd;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }

  private render(): void {
    if (!this.data) return;

    const tl = THREAT_LEVEL_CONFIG[this.data.threatLevel] ?? DEFAULT_THREAT_LEVEL;
    const types = ['all', ...new Set(this.data.insights.map((i) => i.type))];
    const currentData = this.data;

    const panel = this.container.querySelector('.gi-panel') || this.container;
    panel.innerHTML = `
      <div class="gi-header">
        <div class="gi-header-title">🧠 <span>AI Intelligence Feed</span></div>
        <span class="gi-header-model">${escapeHtml(currentData.model)}</span>
        <span class="gi-header-time">${relativeTime(currentData.generatedAt)}</span>
        <button class="gi-refresh-btn" title="Refresh analysis">↻</button>
      </div>

      <div class="gi-threat-banner" style="background:${tl.bg}">
        <div class="gi-threat-pulse" style="background:${tl.color}"></div>
        <div class="gi-threat-level" style="color:${tl.color};background:${tl.bg};border:1px solid ${tl.color}30">THREAT: ${tl.label}</div>
        <div class="gi-threat-trends">
          ${currentData.topTrends.map((t) => `<span class="gi-trend-chip">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>

      <div class="gi-brief">
        <div class="gi-brief-label">📋 Executive Brief</div>
        <div class="gi-brief-text">${escapeHtml(currentData.brief)}</div>
      </div>

      <div class="gi-tabs">
        ${types.map((t) => {
          const icon = t === 'all' ? '◉' : (TYPE_ICONS[t] || '●');
          const label = t === 'all' ? 'All' : t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const count = t === 'all' ? currentData.insights.length : currentData.insights.filter((i) => i.type === t).length;
          return `<button class="gi-tab ${this.activeFilter === t ? 'active' : ''}" data-filter="${t}">${icon} ${label} (${count})</button>`;
        }).join('')}
      </div>

      <div class="gi-feed">
        ${this.filteredInsights.length === 0
          ? '<div class="gi-empty">No insights match this filter</div>'
          : this.filteredInsights.map((insight, i) => this.renderInsightCard(insight, i)).join('')}
      </div>
    `;

    this.bindEvents(panel);
  }

  private renderInsightCard(insight: GroqInsight, index: number): string {
    const sev = SEVERITY_CONFIG[insight.severity] || { color: '#3b82f6', icon: 'ℹ', label: 'INFO' };
    const icon = TYPE_ICONS[insight.type] || '●';

    return `
      <div class="gi-insight-card" style="--insight-color:${sev.color}; animation-delay:${index * 30}ms">
        <div class="gi-insight-header">
          <span class="gi-insight-icon">${icon}</span>
          <div class="gi-insight-title">${escapeHtml(insight.title)}</div>
          <span class="gi-insight-severity" style="color:${sev.color}; background:${sev.color}15; border:1px solid ${sev.color}30">${sev.icon} ${sev.label}</span>
        </div>
        <div class="gi-insight-content">${escapeHtml(insight.content)}</div>
        <div class="gi-insight-meta">
          <span class="gi-insight-time">${relativeTime(insight.timestamp)}</span>
          <span class="gi-insight-confidence">Conf: ${confidencePips(insight.confidence)}</span>
          ${insight.region ? `<span class="gi-insight-tag">${escapeHtml(insight.region)}</span>` : ''}
        </div>
        ${insight.relatedPOIs.length > 0 ? `<div class="gi-insight-meta"><div class="gi-insight-pois">${insight.relatedPOIs.map((p) => `<span class="gi-insight-poi" data-poi="${escapeHtml(p)}">👤 ${escapeHtml(p)}</span>`).join('')}</div></div>` : ''}
        ${insight.tags.length > 0 ? `<div class="gi-insight-meta"><div class="gi-insight-tags">${insight.tags.slice(0, 6).map((t) => `<span class="gi-insight-tag">#${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
      </div>
    `;
  }

  private bindEvents(panel: Element): void {
    const refreshBtn = panel.querySelector('.gi-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('spinning');
        void this.fetchInsights().then(() => this.render());
      });
    }

    panel.querySelectorAll('.gi-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.activeFilter = (tab as HTMLElement).dataset.filter || 'all';
        this.applyFilter();
        this.render();
      });
    });

    panel.querySelectorAll('.gi-insight-poi').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const poiName = (el as HTMLElement).dataset.poi;
        if (poiName && this.onPOIClick) {
          this.onPOIClick(poiName);
        }
      });
    });
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container.innerHTML = '';
  }
}

export default GroqInsightsPanel;
