// src/components/panels/FlightAnomalyPanel.ts
// Stub — satisfies featureRegistry.ts import.
// Extends the real Panel base class (src/components/Panel.ts).

import { Panel } from '../Panel';

export class FlightAnomalyPanel extends Panel {
  constructor() {
    super({ id: 'flight-anomaly', title: 'Flight Anomaly Detector' });
    this.content.innerHTML = '<p>Flight Anomaly Detector — initializing…</p>';
    void this.init();
  }

  private async init(): Promise<void> {
    this.content.innerHTML = `
      <div class="panel-stub">
        <h3>Flight Anomaly Detector</h3>
        <p>Panel loaded. Implementation pending.</p>
      </div>`;
  }
}
