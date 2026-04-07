import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'strategic-posture', label: 'Posture', loader: () => import('./StrategicPosturePanel').then(m => new m.StrategicPosturePanel()) },
  { id: 'warcam', label: 'Warcam', loader: () => import('./WarcamPanel').then(m => new m.WarcamPanel()) },
  { id: 'missile-tracker', label: 'Missiles', loader: () => import('./MissileTrackerPanel').then(m => new m.MissileTrackerPanel()) },
  { id: 'ucdp-events', label: 'UCDP', loader: () => import('./UcdpEventsPanel').then(m => new m.UcdpEventsPanel()) },
];

export class ConflictHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'conflict-hub', title: 'Conflict Theater', defaultRowSpan: 2 }, TABS);
  }
}
