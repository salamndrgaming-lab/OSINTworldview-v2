import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'signal-confidence', label: 'Confidence', loader: () => import('./SignalConfidencePanel').then(m => new m.SignalConfidencePanel()) },
  { id: 'counterfactual-sim', label: 'Counterfactual', loader: () => import('./CounterfactualSimPanel').then(m => new m.CounterfactualSimPanel()) },
  { id: 'time-travel', label: 'Time Machine', loader: () => import('./TimeTravelPanel').then(m => new m.TimeTravelPanel()) },
  { id: 'military-correlation', label: 'Force Posture', loader: () => import('./MilitaryCorrelationPanel').then(m => new m.MilitaryCorrelationPanel()) },
  { id: 'escalation-correlation', label: 'Escalation', loader: () => import('./EscalationCorrelationPanel').then(m => new m.EscalationCorrelationPanel()) },
  { id: 'economic-correlation', label: 'Econ Warfare', loader: () => import('./EconomicCorrelationPanel').then(m => new m.EconomicCorrelationPanel()) },
  { id: 'disaster-correlation', label: 'Disaster', loader: () => import('./DisasterCorrelationPanel').then(m => new m.DisasterCorrelationPanel()) },
];

export class SignalsHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'signals-hub', title: 'Signals & Correlation', defaultRowSpan: 2 }, TABS);
  }
}
