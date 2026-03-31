// src/components/panels/EliteTravelPanel.ts
// Stub panel — satisfies featureRegistry.ts import.
// Replace render() body with full implementation.

import { Panel } from '../Panel';

export class EliteTravelPanel extends Panel {
  constructor() {
    super({ id: 'elite-travel', title: 'Elite Travel Tracker' });
    this.content.innerHTML = '<p>Elite Travel Tracker — loading…</p>';
    void this.init();
  }

  private async init(): Promise<void> {
    // TODO: implement data loading
    this.content.innerHTML = `
      <div class="panel-stub">
        <h3>Elite Travel Tracker</h3>
        <p>Panel initializing…</p>
      </div>`;
  }
}
