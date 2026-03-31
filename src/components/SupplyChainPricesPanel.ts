// src/panels/SupplyChainPricesPanel.ts
import { Panel } from '../components/Panel';
import { getConsumerSnapshot } from '../../consumer-prices-core/src/price-extractor';

export class SupplyChainPricesPanel extends Panel {
  async render() {
    const snapshot = await getConsumerSnapshot();
    return `<div class="panel consumer-prices">Basket Index: ${snapshot.basketIndex.toFixed(2)} | Spikes: ${snapshot.spikes.length}</div>`;
  }
}