// Copyright (C) 2026 Chip / salamndrgaming-lab
/**
 * Agent Council Panel
 *
 * Displays the output of the 6-agent intelligence council:
 * - Chair synthesis (cross-domain findings, threat level, top priority)
 * - Individual agent reports (game theory, network, complexity, behavioral, historian, signals)
 * - Watch items for the next 24h
 *
 * Data: /api/council/synthesis
 */

import { Panel } from './Panel';

interface CouncilFinding {
  title: string;
  synthesis: string;
  contributingAgents: string[];
  confidence: 'high' | 'medium' | 'low';
  priority: number;
}

interface AgentReport {
  agentId: string;
  summary: string;
  findingCount: number;
}

interface CouncilConflict {
  topic: string;
  agentA: string;
  agentB: string;
  resolution: string;
}

interface CouncilSynthesis {
  crossDomainFindings: CouncilFinding[];
  conflicts: CouncilConflict[];
  overallAssessment: string;
  threatLevel: 'critical' | 'elevated' | 'guarded' | 'low';
  topPriority: string;
  watchItems: string[];
  agentReports: AgentReport[];
  meta: {
    generatedAt: string;
    agentSuccessCount: number;
    agentTotalCount: number;
    chairStatus: string;
    sourceCount?: number;
    provider?: string;
    model?: string;
    durationMs?: number;
  } | null;
}

interface AgentDetail {
  agentId: string;
  findings: Array<{ title: string; analysis: string; [key: string]: unknown }>;
  summary: string;
  meta?: { generatedAt: string; provider: string; model: string };
}

const THREAT_COLORS: Record<string, string> = {
  critical: '#ef4444',
  elevated: '#f97316',
  guarded:  '#d4a843',
  low:      '#22c55e',
};

const AGENT_LABELS: Record<string, { icon: string; name: string }> = {
  'game-theorist':       { icon: '\u265F', name: 'Game Theorist' },        // chess pawn
  'network-analyst':     { icon: '\u2B83', name: 'Network Analyst' },
  'complexity-theorist': { icon: '\u2235', name: 'Complexity Theorist' },   // because
  'behavioral-analyst':  { icon: '\u2609', name: 'Behavioral Analyst' },    // sun
  'historian':           { icon: '\u231B', name: 'Historian' },             // hourglass
  'signals-officer':     { icon: '\u2637', name: 'Signals Officer' },       // trigram
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   '#22c55e',
  medium: '#d4a843',
  low:    '#6b7280',
};

export class AgentCouncilPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'agent-council',
      title: 'Agent Council',
      showCount: true,
      closable: true,
      defaultRowSpan: 3,
      className: 'agent-council-panel',
    });
    this.content.innerHTML = '';
    this.buildUI();
    void this.fetchSynthesis();
    this.refreshTimer = setInterval(() => { void this.fetchSynthesis(); }, 1_800_000);
  }

  private buildUI(): void {
    this.content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.className = 'council-header';
    header.style.cssText =
      'padding:8px 10px;border-bottom:1px solid var(--vi-border-subtle,#1a1a28);' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = `
      <div style="font-size:10px;font-weight:600;color:var(--text-secondary);letter-spacing:0.5px;text-transform:uppercase">
        COUNCIL SYNTHESIS
      </div>
      <div id="council-meta" style="font-size:9px;color:var(--text-muted)"></div>
    `;
    this.content.appendChild(header);

    const body = document.createElement('div');
    body.id = 'council-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;';
    body.innerHTML = this.loadingHTML();
    this.content.appendChild(body);
  }

  private loadingHTML(): string {
    return `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
      <div style="width:24px;height:24px;border:2px solid var(--vi-border,#333);border-top-color:var(--intel-accent,#d4a843);border-radius:50%;animation:council-spin 0.8s linear infinite;margin:0 auto 12px"></div>
      <div style="font-size:11px">Loading council synthesis...</div>
      <style>@keyframes council-spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  private async fetchSynthesis(): Promise<void> {
    const body = this.content.querySelector('#council-body');
    if (!body) return;

    try {
      const resp = await fetch('/api/council/synthesis', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: CouncilSynthesis = await resp.json();
      this.renderSynthesis(data);
    } catch {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
        <div style="font-size:28px;opacity:0.3;margin-bottom:8px">\u2696</div>
        <div style="font-size:11px">Council synthesis unavailable</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Seeded every 3 hours via Agent Council pipeline</div>
      </div>`;
    }
  }

  private async fetchAgentDetail(agentId: string): Promise<void> {
    const body = this.content.querySelector('#council-body');
    if (!body) return;

    body.innerHTML = this.loadingHTML();

    try {
      const resp = await fetch(`/api/council/synthesis?agent=${encodeURIComponent(agentId)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: AgentDetail = await resp.json();
      this.renderAgentDetail(data, agentId);
    } catch {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim)">
        <div style="font-size:11px">Agent report unavailable</div>
      </div>`;
    }
  }

  private renderSynthesis(data: CouncilSynthesis): void {
    const body = this.content.querySelector('#council-body');
    const metaEl = this.content.querySelector('#council-meta');
    if (!body) return;

    const {
      crossDomainFindings = [], overallAssessment, threatLevel = 'guarded',
      topPriority, watchItems = [], agentReports = [], conflicts = [], meta,
    } = data;

    this.setCount(crossDomainFindings.length);

    // Meta info
    if (metaEl && meta?.generatedAt) {
      const age = Math.round((Date.now() - new Date(meta.generatedAt).getTime()) / 60000);
      const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      metaEl.textContent = `${meta.agentSuccessCount}/${meta.agentTotalCount} agents \u00B7 ${ageStr}`;
    }

    if (!overallAssessment) {
      body.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-dim)">
        <div style="font-size:28px;opacity:0.3;margin-bottom:8px">\u2696</div>
        <div style="font-size:11px;font-weight:500">No council analysis yet</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Runs after all other seeds complete (every 3h)</div>
      </div>`;
      return;
    }

    const threatColor = THREAT_COLORS[threatLevel] || '#6b7280';
    let html = '';

    // Threat level + top priority
    html += `<div style="background:${threatColor}10;border:1px solid ${threatColor}33;border-radius:7px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:10px;font-weight:700;color:${threatColor};text-transform:uppercase;letter-spacing:0.5px">${this.esc(threatLevel)} THREAT</span>
      </div>
      ${topPriority ? `<div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.4">${this.esc(topPriority)}</div>` : ''}
    </div>`;

    // Overall assessment
    html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:8px">
      <div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">CHAIR ASSESSMENT</div>
      <div style="font-size:11px;color:var(--text-dim);line-height:1.5">${this.esc(overallAssessment)}</div>
    </div>`;

    // Cross-domain findings
    if (crossDomainFindings.length > 0) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:4px 2px">CROSS-DOMAIN FINDINGS</div>`;
      for (const f of crossDomainFindings.sort((a, b) => a.priority - b.priority)) {
        const confColor = CONFIDENCE_COLORS[f.confidence] || '#6b7280';
        const agents = f.contributingAgents.map(a => {
          const label = AGENT_LABELS[a];
          return label ? `${label.icon} ${label.name}` : a;
        }).join(', ');

        html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:6px;border-left:3px solid ${confColor}">
          <div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:4px">${this.esc(f.title)}</div>
          <div style="font-size:10px;color:var(--text-dim);line-height:1.4;margin-bottom:6px">${this.esc(f.synthesis)}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:8px;font-weight:600;color:${confColor};text-transform:uppercase">${this.esc(f.confidence)} confidence</span>
            <span style="font-size:8px;color:var(--text-ghost)">\u00B7</span>
            <span style="font-size:8px;color:var(--text-muted)">${agents}</span>
          </div>
        </div>`;
      }
    }

    // Conflicts between agents
    if (conflicts.length > 0) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:4px 2px;margin-top:4px">RESOLVED CONFLICTS</div>`;
      for (const c of conflicts) {
        html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:8px;margin-bottom:4px;font-size:10px">
          <div style="color:var(--text);font-weight:500;margin-bottom:3px">${this.esc(c.topic)}</div>
          <div style="color:var(--text-muted);font-size:9px;margin-bottom:3px">${this.esc(c.agentA)} vs ${this.esc(c.agentB)}</div>
          <div style="color:var(--text-dim);line-height:1.4">${this.esc(c.resolution)}</div>
        </div>`;
      }
    }

    // Watch items
    if (watchItems.length > 0) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:4px 2px;margin-top:4px">24H WATCH LIST</div>`;
      html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:8px;margin-bottom:8px">`;
      for (const item of watchItems) {
        html += `<div style="font-size:10px;color:var(--text-dim);padding:3px 0;display:flex;align-items:flex-start;gap:6px">
          <span style="color:var(--intel-accent,#d4a843);flex-shrink:0">\u25B8</span>
          <span style="line-height:1.4">${this.esc(item)}</span>
        </div>`;
      }
      html += `</div>`;
    }

    // Agent reports (clickable to drill in)
    if (agentReports.length > 0) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:4px 2px;margin-top:4px">AGENT REPORTS</div>`;
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px">`;
      for (const r of agentReports) {
        const label = AGENT_LABELS[r.agentId] || { icon: '\u2022', name: r.agentId };
        html += `<button class="council-agent-btn" data-agent="${this.esc(r.agentId)}" style="
          background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:6px;
          padding:8px;cursor:pointer;text-align:left;font-family:inherit;transition:border-color 0.15s;
        ">
          <div style="font-size:14px;margin-bottom:3px">${label.icon}</div>
          <div style="font-size:10px;font-weight:600;color:var(--text)">${label.name}</div>
          <div style="font-size:9px;color:var(--text-muted)">${r.findingCount} findings</div>
        </button>`;
      }
      html += `</div>`;
    }

    body.innerHTML = html;

    // Wire up agent drill-in buttons
    body.querySelectorAll('.council-agent-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const agentId = (btn as HTMLElement).dataset.agent;
        if (agentId) {
          void this.fetchAgentDetail(agentId);
        }
      });
      // Hover style
      (btn as HTMLElement).addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.borderColor = 'var(--intel-accent,#d4a843)';
      });
      (btn as HTMLElement).addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.borderColor = 'var(--vi-border,#252535)';
      });
    });
  }

  private renderAgentDetail(data: AgentDetail, agentId: string): void {
    const body = this.content.querySelector('#council-body');
    if (!body) return;

    const label = AGENT_LABELS[agentId] || { icon: '\u2022', name: agentId };
    const findings = Array.isArray(data.findings) ? data.findings : [];

    let html = '';

    // Back button
    html += `<button id="council-back-btn" style="
      background:none;border:none;color:var(--intel-accent,#d4a843);cursor:pointer;
      font-family:inherit;font-size:10px;padding:4px 0;margin-bottom:8px;display:flex;align-items:center;gap:4px;
    ">\u2190 Back to Synthesis</button>`;

    // Agent header
    html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:8px">
      <div style="font-size:18px;margin-bottom:4px">${label.icon}</div>
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">${label.name}</div>
      ${data.summary ? `<div style="font-size:10px;color:var(--text-dim);line-height:1.5">${this.esc(data.summary)}</div>` : ''}
      ${data.meta?.generatedAt ? `<div style="font-size:8px;color:var(--text-ghost);margin-top:4px">${data.meta.provider} \u00B7 ${data.meta.model}</div>` : ''}
    </div>`;

    // Findings
    if (findings.length > 0) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:4px 2px">FINDINGS (${findings.length})</div>`;
      for (const f of findings) {
        html += `<div style="background:var(--vi-surface,#12121a);border:1px solid var(--vi-border,#252535);border-radius:7px;padding:10px;margin-bottom:6px">
          <div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:4px">${this.esc(f.title)}</div>
          <div style="font-size:10px;color:var(--text-dim);line-height:1.4">${this.esc(f.analysis)}</div>
        </div>`;
      }
    } else {
      html += `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:10px">No findings from this agent</div>`;
    }

    body.innerHTML = html;

    // Wire back button
    const backBtn = body.querySelector('#council-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        void this.fetchSynthesis();
      });
    }
  }

  /** Accept data pushed from data-loader bootstrap hydration */
  public setData(data: CouncilSynthesis): void {
    if (data?.overallAssessment) {
      this.renderSynthesis(data);
    }
  }

  private esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    super.destroy();
  }
}
