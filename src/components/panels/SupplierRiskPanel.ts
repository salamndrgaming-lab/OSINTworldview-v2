// src/components/panels/SupplierRiskPanel.ts
// Stub panel — satisfies featureRegistry.ts import.
// Replace render() body with full implementation.

import { Panel } from '../Panel';

export class SupplierRiskPanel extends Panel {
  constructor() {
    super({ id: 'supplier-risk', title: 'Supplier Risk Tracker' });
    this.content.innerHTML = '<p>Supplier Risk Tracker — loading…</p>';
    void this.init();
  }

  private async init(): Promise<void> {
    // TODO: implement data loading
    this.content.innerHTML = `
      <div class="panel-stub">
        <h3>Supplier Risk Tracker</h3>
        <p>Panel initializing…</p>
      </div>`;
  }
}
