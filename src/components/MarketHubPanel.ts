import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'markets', label: 'Markets', loader: () => import('./MarketPanel').then(m => new m.MarketPanel()) },
  { id: 'commodities', label: 'Commodities', loader: () => import('./MarketPanel').then(m => new m.CommoditiesPanel()) },
  { id: 'crypto', label: 'Crypto', loader: () => import('./MarketPanel').then(m => new m.CryptoPanel()) },
  { id: 'stablecoins', label: 'Stablecoins', loader: () => import('./StablecoinPanel').then(m => new m.StablecoinPanel()) },
  { id: 'etf-flows', label: 'ETF Flows', loader: () => import('./ETFFlowsPanel').then(m => new m.ETFFlowsPanel()) },
  { id: 'heatmap', label: 'Heatmap', loader: () => import('./MarketPanel').then(m => new m.HeatmapPanel()) },
];

export class MarketHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'market-hub', title: 'Markets & Finance', defaultRowSpan: 2 }, TABS);
  }
}
