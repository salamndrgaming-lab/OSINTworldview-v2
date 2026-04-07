import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'economic', label: 'Indicators', loader: () => import('./EconomicPanel').then(m => new m.EconomicPanel()) },
  { id: 'gulf-economies', label: 'Gulf', loader: () => import('./GulfEconomiesPanel').then(m => new m.GulfEconomiesPanel()) },
  { id: 'macro-signals', label: 'Market Radar', loader: () => import('./MacroSignalsPanel').then(m => new m.MacroSignalsPanel()) },
];

export class EconomicHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'economic-hub', title: 'Economic Intelligence', defaultRowSpan: 2 }, TABS);
  }
}
