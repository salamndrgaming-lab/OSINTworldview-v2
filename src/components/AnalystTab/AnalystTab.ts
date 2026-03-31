// src/components/AnalystTab/AnalystTab.ts
//
// *** RENAME: delete AnalystTab.tsx, use this .ts file ***
//
// FIXES:
//   - TS7016: @types/react not installed
//   - TS17004: --jsx not set
//   - TS7026: No JSX.IntrinsicElements
//   - TS2307: react-redux, ../../store/analystSlice, ../../store — none exist
//   - TS2307: ./AnalystSection, ../common/LoadingSpinner, ../common/ErrorBoundary — none exist
//
// Rewritten as vanilla Panel. Data fetched directly via AnalystService.

import { Panel } from '../Panel';
import { AnalystService, type AnalystData } from '../../services/analystService';

export class AnalystTab extends Panel {
  private data: AnalystData | null = null;
  private loading = false;
  private errorMsg = '';
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'analyst-tab', title: 'Analyst Dashboard' });
    void this.fetchData();
    this.pollInterval = setInterval(() => { void this.fetchData(); }, 30_000);
  }

  private async fetchData(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.errorMsg = '';
    this.render();

    try {
      this.data = await AnalystService.fetchData();
    } catch (err) {
      this.errorMsg = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private sectionHtml(
    title: string,
    items: Array<{ id?: string; title?: string; [k: string]: unknown }>,
    emptyMsg: string
  ): string {
    if (items.length === 0) {
      return `<section class="analyst-section"><h3>${title}</h3><p>${emptyMsg}</p></section>`;
    }
    const rows = items.map(item => `
      <div class="analyst-item">
        <strong>${item['title'] ?? item['keyword'] ?? item['type'] ?? 'Item'}</strong>
      </div>`).join('');
    return `<section class="analyst-section"><h3>${title}</h3>${rows}</section>`;
  }

  private render(): void {
    if (this.loading && !this.data) {
      this.content.innerHTML = `<div class="analyst-tab loading"><p>Loading analyst data…</p></div>`;
      return;
    }

    if (this.errorMsg) {
      this.content.innerHTML = `
        <div class="analyst-tab error">
          <h3>Error Loading Data</h3>
          <p>${this.errorMsg}</p>
          <button id="analyst-retry">Retry</button>
        </div>`;
      this.content.querySelector('#analyst-retry')?.addEventListener('click', () => {
        void this.fetchData();
      });
      return;
    }

    const d = this.data;
    if (!d) return;

    this.content.innerHTML = `
      <div class="analyst-tab">
        <div class="analyst-header">
          <h2>Analyst Dashboard</h2>
          <span class="last-updated">Updated: ${new Date().toLocaleTimeString()}</span>
        </div>
        ${this.sectionHtml('Intelligence Briefs', d.intelligence, 'No intelligence briefs available')}
        ${this.sectionHtml('Correlation Analysis', d.correlation, 'No correlations detected')}
        ${this.sectionHtml('Threat Assessment', d.threats, 'No active threats')}
        ${this.sectionHtml('Detailed Analysis', d.analysis, 'No analysis reports available')}
      </div>`;
  }

  public destroy(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    super.destroy();
  }
}
