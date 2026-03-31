// src/components/panels/FlightAnomalyPanel.ts
// Stub panel — satisfies featureRegistry.ts import.
// Replace render() body with full implementation.

import { Panel } from '../Panel';

export class FlightAnomalyPanel extends Panel {
  constructor() {
    super({ id: 'flight-anomaly', title: 'Flight Anomaly Detector' });
    this.content.innerHTML = '<p>Flight Anomaly Detector — loading…</p>';
    void this.init();
  }

  private async init(): Promise<void> {
    // TODO: implement data loading
    this.content.innerHTML = `
      <div class="panel-stub">
        <h3>Flight Anomaly Detector</h3>
        <p>Panel initializing…</p>
      </div>`;
  }
}
