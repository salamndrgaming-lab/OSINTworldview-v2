import { panelRegistry } from '../utils/panelRegistry';

// Import all panel components
import { ChokepointSimulatorPanel } from '../components/panels/ChokepointSimulatorPanel';
import { SupplierRiskPanel } from '../components/panels/SupplierRiskPanel';
import { NarrativeVelocityPanel } from '../components/panels/NarrativeVelocityPanel';
import { FlightAnomalyPanel } from '../components/panels/FlightAnomalyPanel';
import { SanctionsGraphPanel } from '../components/panels/SanctionsGraphPanel';
import { SatelliteCorrelationPanel } from '../components/panels/SatelliteCorrelationPanel';
import { CyberGeopoliticalPanel } from '../components/panels/CyberGeopoliticalPanel';
import { CIIBacktestPanel } from '../components/panels/CIIBacktestPanel';
import { WebcamVerificationPanel } from '../components/panels/WebcamVerificationPanel';
import { AutoBriefPanel } from '../components/panels/AutoBriefPanel';
import { EliteTravelPanel } from '../components/panels/EliteTravelPanel';
import { DarkPoolPanel } from '../components/panels/DarkPoolPanel';
import { CableCutPanel } from '../components/panels/CableCutPanel';
import { DeepfakeTrackerPanel } from '../components/panels/DeepfakeTrackerPanel';
import { PortCongestionPanel } from '../components/panels/PortCongestionPanel';
import { PEPNetworkPanel } from '../components/panels/PEPNetworkPanel';
import { ElectionInterferencePanel } from '../components/panels/ElectionInterferencePanel';
import { MineralsFlowPanel } from '../components/panels/MineralsFlowPanel';
import { ReportCompilerPanel } from '../components/panels/ReportCompilerPanel';
import { AirGappedFusionPanel } from '../components/panels/AirGappedFusionPanel';

/**
 * Register all features in the system
 */
export function registerAllFeatures(): void {
  // Koala-Inspired Features
  panelRegistry.registerAll([
    {
      id: 'chokepoint-simulator',
      name: 'Chokepoint Flow Simulator',
      component: ChokepointSimulatorPanel,
      icon: 'flow-chart',
      category: 'maritime',
      order: 10,
      description: 'Monte-Carlo simulation for bottleneck prediction with economic impact',
    },
    {
      id: 'supplier-risk',
      name: 'Supplier Risk Tracker',
      component: SupplierRiskPanel,
      icon: 'network',
      category: 'economic',
      order: 20,
      description: 'Hidden ownership detection correlated with price movements',
    },
    {
      id: 'narrative-velocity',
      name: 'Narrative Velocity',
      component: NarrativeVelocityPanel,
      icon: 'trending-up',
      category: 'social',
      order: 30,
      description: 'Telegram narrative acceleration tracking across 27+ channels',
    },
    {
      id: 'flight-anomaly',
      name: 'Flight Anomaly Detector',
      component: FlightAnomalyPanel,
      icon: 'plane',
      category: 'aviation',
      order: 40,
      description: 'Ghost fleet and military posture anomaly detection',
    },
    {
      id: 'sanctions-graph',
      name: 'Sanctions Evasion',
      component: SanctionsGraphPanel,
      icon: 'ban',
      category: 'compliance',
      order: 50,
      description: 'Dynamic entity graphs for sanctions evasion detection',
    },
    {
      id: 'satellite-correlation',
      name: 'Satellite Correlation',
      component: SatelliteCorrelationPanel,
      icon: 'satellite',
      category: 'space',
      order: 60,
      description: 'Surveillance window predictor with ground event correlation',
    },
    {
      id: 'cyber-geopolitical',
      name: 'Cyber Threat Fusion',
      component: CyberGeopoliticalPanel,
      icon: 'shield',
      category: 'cyber',
      order: 70,
      description: 'C2 server mapping with geopolitical sponsor probability',
    },
    {
      id: 'cii-backtest',
      name: 'CII Backtesting',
      component: CIIBacktestPanel,
      icon: 'history',
      category: 'analysis',
      order: 80,
      description: 'Historical CII replay for what-if scenario testing',
    },
    {
      id: 'webcam-verification',
      name: 'Webcam Verification',
      component: WebcamVerificationPanel,
      icon: 'camera',
      category: 'verification',
      order: 90,
      description: 'AI-powered event verification via live webcam feeds',
    },
    {
      id: 'auto-brief',
      name: 'Auto Brief Generator',
      component: AutoBriefPanel,
      icon: 'file-text',
      category: 'analysis',
      order: 100,
      description: 'Automated intelligence briefs with probability trees',
    },
  ]);
  
  // Original Features
  panelRegistry.registerAll([
    {
      id: 'elite-travel',
      name: 'Elite Travel Tracker',
      component: EliteTravelPanel,
      icon: 'users',
      category: 'tracking',
      order: 110,
      description: 'Track 500+ VIP movements and detect meetings',
    },
    {
      id: 'dark-pool',
      name: 'Dark Pool Monitor',
      component: DarkPoolPanel,
      icon: 'dollar-sign',
      category: 'finance',
      order: 120,
      description: 'FINRA dark pool and insider flow analysis',
    },
    {
      id: 'cable-cut',
      name: 'Cable Cut Forecaster',
      component: CableCutPanel,
      icon: 'link',
      category: 'infrastructure',
      order: 130,
      description: 'Submarine cable disruption prediction',
    },
    {
      id: 'deepfake-tracker',
      name: 'Deepfake Tracker',
      component: DeepfakeTrackerPanel,
      icon: 'video',
      category: 'verification',
      order: 140,
      description: 'Propaganda velocity and deepfake origin tracking',
    },
    {
      id: 'port-congestion',
      name: 'Port Congestion',
      component: PortCongestionPanel,
      icon: 'anchor',
      category: 'maritime',
      order: 150,
      description: 'Real-time congestion heatmap for 200+ ports',
    },
    {
      id: 'pep-network',
      name: 'PEP Network',
      component: PEPNetworkPanel,
      icon: 'user-check',
      category: 'compliance',
      order: 160,
      description: 'Politically exposed persons influence network',
    },
    {
      id: 'election-interference',
      name: 'Election Signals',
      component: ElectionInterferencePanel,
      icon: 'vote-yea',
      category: 'political',
      order: 170,
      description: 'Election interference detection across 50+ countries',
    },
    {
      id: 'minerals-flow',
      name: 'Minerals Tracker',
      component: MineralsFlowPanel,
      icon: 'gem',
      category: 'commodities',
      order: 180,
      description: 'Critical minerals flow and supply-shock prediction',
    },
    {
      id: 'report-compiler',
      name: 'Report Compiler',
      component: ReportCompilerPanel,
      icon: 'download',
      category: 'tools',
      order: 190,
      description: 'Courtroom-ready evidence export with chain-of-custody',
    },
    {
      id: 'air-gapped-fusion',
      name: 'Air-Gapped Fusion',
      component: AirGappedFusionPanel,
      icon: 'lock',
      category: 'enterprise',
      order: 200,
      description: 'Multi-tenant private data fusion (Enterprise)',
      requiresAuth: true,
      permissions: ['enterprise'],
    },
  ]);
  
  console.log('✓ All 20 features registered successfully');
  
  // Validate registration
  const validation = panelRegistry.validate();
  if (!validation.valid) {
    console.error('Feature registration errors:', validation.errors);
  } else {
    console.log('✓ All features validated successfully');
  }
}