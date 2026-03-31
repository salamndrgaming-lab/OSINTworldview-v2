// src/components/narrativeVelocityService.ts
//
// *** RENAME/REPLACE: delete src/components/narrativeVelocityService.tsx ***
//
// FIXES for narrativeVelocityService.tsx:
//   - TS7016: @types/react not installed (not in package.json)
//   - TS17004: --jsx flag not set (this is a vanilla TS project)
//   - TS7026: No JSX.IntrinsicElements
//   - TS6133: unused NarrativeVelocityService, setVelocityData, setAlerts,
//             selectedNarrative, setSelectedNarrative
//   - TS2307: recharts not in package.json
//   - TS2307: '../../services/narrativeVelocityService' wrong relative depth
//
// SOLUTION: Rewritten as a vanilla Panel class (consistent with existing
// components: ChokepointFlowPanel.ts, BreakthroughsTickerPanel.ts, etc.)

import { Panel } from './Panel';
import {
  NarrativeVelocityService,
  type NarrativeData,
  type VelocityResult,
} from '../services/narrativeVelocityService';

export class NarrativeVelocityPanel extends Panel {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private velocityData: VelocityResult[] = [];
  private narratives: NarrativeData[] = [];
  private historical: NarrativeData[] = [];

  constructor() {
    super({ id: 'narrative-velocity', title: 'Narrative Velocity' });
    this.content.innerHTML = '<p>Loading narrative data…</p>';
    void this.loadData();
    this.pollInterval = setInterval(() => { void this.loadData(); }, 60_000);
  }

  private async loadData(): Promise<void> {
    try {
      this.velocityData = await NarrativeVelocityService.calculateVelocity(
        this.narratives,
        this.historical
      );
      this.render();
    } catch (err) {
      console.error('[NarrativeVelocityPanel]', err);
    }
  }

  private render(): void {
    const alerts = this.velocityData.filter(v => v.alert);
    const alertsHtml = alerts.length
      ? alerts.map(a => `
          <div class="velocity-alert">
            <strong>${a.keyword}</strong>
            <span class="acceleration">${a.accelerationFactor.toFixed(1)}x baseline</span>
            <span class="channels">${a.channels.length} channels</span>
          </div>`).join('')
      : '<p>No active alerts</p>';

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
        <p>Real-time narrative acceleration across 27+ channels</p>
        <section class="alerts-section">
          <h3>Active Alerts (${alerts.length})</h3>
          ${alertsHtml}
        </section>
        <section>
          <h3>Top Narratives</h3>
          <table class="velocity-table">
            <thead><tr><th>Keyword</th><th>Current</th><th>Baseline</th><th>Factor</th><th>Channels</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </section>
      </div>`;
  }

  public async ingestMessages(messages: any[]): Promise<void> {
    const extracted = await NarrativeVelocityService.extractNarratives(messages);
    this.narratives = [...this.narratives, ...extracted].slice(-5000);
    await this.loadData();
  }

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
