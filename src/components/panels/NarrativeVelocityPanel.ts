// src/components/panels/NarrativeVelocityPanel.ts
//
// FIXES for src/components/narrativeVelocityService.tsx:
//   - TS7016: @types/react not installed — project uses Preact/vanilla TS, not React
//   - TS17004: --jsx flag not set in tsconfig (and rightly so for this project)
//   - TS7026: No JSX.IntrinsicElements interface — again, no React in this project
//   - TS6133: unused NarrativeVelocityService, setVelocityData, setAlerts, selectedNarrative, setSelectedNarrative
//   - TS2307: Cannot find module '../../services/narrativeVelocityService' (wrong relative depth)
//   - TS2307: Cannot find module 'recharts' (not in package.json)
//
// SOLUTION: Rewritten as a vanilla TypeScript Panel class consistent with the
// rest of the codebase (see ChokepointFlowPanel.ts, BreakthroughsTickerPanel.ts).
// File renamed to NarrativeVelocityPanel.ts (.ts, not .tsx) — no JSX needed.
// Import path corrected to match featureRegistry.ts expectation.

import { Panel } from '../Panel';
import {
  NarrativeVelocityService,
  type NarrativeData,
  type VelocityResult,
} from '../../services/narrativeVelocityService';

export class NarrativeVelocityPanel extends Panel {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private velocityData: VelocityResult[] = [];
  private narratives: NarrativeData[] = [];
  private historical: NarrativeData[] = [];

  constructor() {
    super({ id: 'narrative-velocity', title: 'Narrative Velocity' });
    this.renderLoading();
    void this.loadData();
    this.pollInterval = setInterval(() => { void this.loadData(); }, 60_000);
  }

  private renderLoading(): void {
    this.content.innerHTML = `
      <div class="narrative-velocity-panel">
        <p class="loading-text">Loading narrative data…</p>
      </div>`;
  }

  private async loadData(): Promise<void> {
    try {
      this.velocityData = await NarrativeVelocityService.calculateVelocity(
        this.narratives,
        this.historical
      );
      this.renderContent();
    } catch (err) {
      console.error('[NarrativeVelocityPanel] load error:', err);
    }
  }

  private renderContent(): void {
    const alerts = this.velocityData.filter(v => v.alert);

    const alertsHtml = alerts.length > 0
      ? alerts.map(a => `
          <div class="velocity-alert">
            <strong>${a.keyword}</strong>
            <span class="acceleration">${a.accelerationFactor.toFixed(1)}x baseline</span>
            <span class="channels">${a.channels.length} channels</span>
          </div>`).join('')
      : '<p class="no-alerts">No active alerts</p>';

    const rowsHtml = this.velocityData.slice(0, 20).map(v => `
      <tr class="${v.alert ? 'alert-row' : v.trending ? 'trending-row' : ''}">
        <td>${v.keyword}</td>
        <td>${v.currentVelocity.toFixed(1)}/hr</td>
        <td>${v.baselineVelocity.toFixed(1)}/hr</td>
        <td>${v.accelerationFactor.toFixed(2)}x</td>
        <td>${v.channels.length}</td>
      </tr>`).join('');

    this.content.innerHTML = `
      <div class="narrative-velocity-panel">
        <h2>Telegram Narrative Velocity Tracker</h2>
        <p class="subtitle">Real-time narrative acceleration across 27+ channels</p>

        <section class="alerts-section">
          <h3>Active Alerts (${alerts.length})</h3>
          ${alertsHtml}
        </section>

        <section class="velocity-table-section">
          <h3>Top Narratives</h3>
          <table class="velocity-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Current</th>
                <th>Baseline</th>
                <th>Factor</th>
                <th>Channels</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </section>
      </div>`;
  }

  /** Feed new raw messages for NLP extraction */
  public async ingestMessages(messages: any[]): Promise<void> {
    const extracted = await NarrativeVelocityService.extractNarratives(messages);
    this.narratives = [...this.narratives, ...extracted].slice(-5000);
    await this.loadData();
  }

  /** Provide historical baseline data */
  public setHistorical(data: NarrativeData[]): void {
    this.historical = data;
  }

  public destroy(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    super.destroy();
  }
}
