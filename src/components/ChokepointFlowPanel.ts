// src/panels/ChokepointFlowPanel.ts
import { Panel } from '../components/Panel';
import { getChokepointFlow } from '../services/chokepoint-monitor';

export class ChokepointFlowPanel extends Panel {
  async render() {
    const flows = await getChokepointFlow();
    return `
      <div class="panel chokepoint-flow">
        <h3>Global Chokepoint Flow</h3>
        ${flows.map(f => `<div>${f.name}: ${f.vessels24h} vessels | Risk: ${f.riskScore}</div>`).join('')}
      </div>`;
  }
}

