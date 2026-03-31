// src/components/ChokepointFlowPanel.ts
import { Panel } from './Panel';           // ← correct local import (you are in components/)
import { getChokepointFlow } from '../services/chokepoint-monitor';

export class ChokepointFlowPanel extends Panel {
  async render() {
    const flows = await getChokepointFlow();
    return `
      <div class="panel chokepoint-flow">
        <h3>Global Chokepoint Flow</h3>
        ${flows.map((f: any) => `<div>${f.name}: ${f.vessels24h} vessels | Risk: ${f.riskScore}</div>`).join('')}
      </div>`;
  }
}