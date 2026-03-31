// src/components/panels/ChokepointSimulatorPanel.ts
// Stub panel — satisfies featureRegistry.ts import.
// Replace render() body with full implementation.

import { Panel } from '../Panel';

export class ChokepointSimulatorPanel extends Panel {
  constructor() {
    super({ id: 'chokepoint-simulator', title: 'Chokepoint Flow Simulator' });
    this.content.innerHTML = '<p>Chokepoint Flow Simulator — loading…</p>';
    void this.init();
  }

  private async init(): Promise<void> {
    // TODO: implement data loading
    this.content.innerHTML = `
      <div class="panel-stub">
        <h3>Chokepoint Flow Simulator</h3>
        <p>Panel initializing…</p>
      </div>`;
  }
}
