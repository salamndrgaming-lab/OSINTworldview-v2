import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'gdelt-intel', label: 'GDELT Feed', loader: () => import('./GdeltIntelPanel').then(m => new m.GdeltIntelPanel()) },
  { id: 'narrative-drift', label: 'Narrative Drift', loader: () => import('./NarrativeDriftPanel').then(m => new m.NarrativeDriftPanel()) },
  { id: 'hypothesis-generator', label: 'Hypotheses', loader: () => import('./HypothesisGeneratorPanel').then(m => new m.HypothesisGeneratorPanel()) },
  { id: 'auto-brief', label: 'Auto-Briefs', loader: () => import('./AutoBriefPanel').then(m => new m.AutoBriefPanel()) },
  { id: 'cross-source-signals', label: 'Cross-Source', loader: () => import('./CrossSourceSignalsPanel').then(m => new m.CrossSourceSignalsPanel()) },
  { id: 'insights', label: 'AI Insights', loader: () => import('./InsightsPanel').then(m => new m.InsightsPanel()) },
  { id: 'cascade', label: 'Cascade', loader: () => import('./CascadePanel').then(m => new m.CascadePanel()) },
  { id: 'agent-council', label: 'Council', loader: () => import('./AgentCouncilPanel').then(m => new m.AgentCouncilPanel()) },
];

export class IntelHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'intel-hub', title: 'Intelligence Command', defaultRowSpan: 3 }, TABS);
  }
}
