import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'chokepoint-flow', label: 'Chokepoints', loader: () => import('./ChokepointFlowPanel').then(m => new m.ChokepointFlowPanel()) },
  { id: 'supply-chain', label: 'Supply Chain', loader: () => import('./SupplyChainPanel').then(m => new m.SupplyChainPanel()) },
  { id: 'trade-policy', label: 'Trade Policy', loader: () => import('./TradePolicyPanel').then(m => new m.TradePolicyPanel()) },
  { id: 'supply-chain-prices', label: 'Consumer Prices', loader: () => import('./SupplyChainPricesPanel').then(m => new m.SupplyChainPricesPanel()) },
];

export class SupplyHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'supply-hub', title: 'Supply & Trade', defaultRowSpan: 2 }, TABS);
  }
}
