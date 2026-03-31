import type { MapLayers } from '@/types';
// boundary-ignore: isDesktopRuntime is a pure env probe with no service dependencies
import { isDesktopRuntime } from '@/services/runtime';

export type MapRenderer = 'flat' | 'globe';
export type MapVariant = 'full' | 'tech' | 'finance' | 'happy' | 'commodity' | 'godmode';

const _desktop = isDesktopRuntime();

export type LayerCategory =
  | 'conflict'
  | 'military'
  | 'infrastructure'
  | 'maritime-aviation'
  | 'intelligence'
  | 'environmental'
  | 'economic'
  | 'tech'
  | 'positive'
  | 'monitoring';

export interface LayerCategoryMeta {
  id: LayerCategory;
  label: string;
  icon: string;
  accentColor: string;
}

/** Category definitions with display metadata */
export const LAYER_CATEGORIES: LayerCategoryMeta[] = [
  { id: 'conflict',           label: 'Conflict & Threats',     icon: '⚔',  accentColor: 'var(--cat-threat, #e53e3e)' },
  { id: 'military',           label: 'Military & Defense',     icon: '🎖',  accentColor: 'var(--cat-threat, #e53e3e)' },
  { id: 'intelligence',       label: 'Intelligence',           icon: '🔍',  accentColor: 'var(--cat-intel, #9f7aea)' },
  { id: 'infrastructure',     label: 'Infrastructure',         icon: '🔗',  accentColor: 'var(--cat-infra, #38b2ac)' },
  { id: 'maritime-aviation',  label: 'Maritime & Aviation',    icon: '✈',   accentColor: 'var(--data-accent, #5b8dd9)' },
  { id: 'environmental',      label: 'Environmental',          icon: '🌍',  accentColor: 'var(--cat-news, #ed8936)' },
  { id: 'economic',           label: 'Economic',               icon: '💰',  accentColor: 'var(--cat-markets, #4299e1)' },
  { id: 'tech',               label: 'Technology',             icon: '💻',  accentColor: 'var(--cat-infra, #38b2ac)' },
  { id: 'positive',           label: 'Positive Signals',       icon: '☀',   accentColor: 'var(--cat-positive, #48bb78)' },
  { id: 'monitoring',         label: 'Monitoring & Overlays',  icon: '📡',  accentColor: 'var(--cat-monitor, #718096)' },
];

export interface LayerDefinition {
  key: keyof MapLayers;
  icon: string;
  i18nSuffix: string;
  fallbackLabel: string;
  renderers: MapRenderer[];
  premium?: 'locked' | 'enhanced';
  category: LayerCategory;
}

const def = (
  key: keyof MapLayers,
  icon: string,
  i18nSuffix: string,
  fallbackLabel: string,
  category: LayerCategory,
  renderers: MapRenderer[] = ['flat', 'globe'],
  premium?: 'locked' | 'enhanced',
): LayerDefinition => ({ key, icon, i18nSuffix, fallbackLabel, renderers, category, ...(premium && { premium }) });

export const LAYER_REGISTRY: Record<keyof MapLayers, LayerDefinition> = {
  // Conflict & Threats
  iranAttacks:              def('iranAttacks',              '&#127919;', 'iranAttacks',              'Iran Attacks',             'conflict', ['flat', 'globe'], _desktop ? 'locked' : undefined),
  hotspots:                 def('hotspots',                 '&#127919;', 'intelHotspots',            'Intel Hotspots',           'conflict'),
  conflicts:                def('conflicts',                '&#9876;',   'conflictZones',            'Conflict Zones',           'conflict'),
  ucdpEvents:               def('ucdpEvents',               '&#9876;',   'ucdpEvents',               'Armed Conflict Events',    'conflict'),
  protests:                 def('protests',                 '&#128226;', 'protests',                 'Protests',                 'conflict'),
  missileStrikes:           def('missileStrikes',           '&#128165;', 'missileStrikes',           'Missile/Drone Strikes',    'conflict'),
  conflictForecast:         def('conflictForecast',         '&#128200;', 'conflictForecast',         'Conflict Forecast',        'conflict', ['flat']),
  warcam:                   def('warcam',                   '&#127909;', 'warcam',                   'Conflict Zone Media',      'conflict'),

  // Military & Defense
  bases:                    def('bases',                    '&#127963;', 'militaryBases',            'Military Bases',           'military'),
  nuclear:                  def('nuclear',                  '&#9762;',   'nuclearSites',             'Nuclear Sites',            'military'),
  irradiators:              def('irradiators',              '&#9888;',   'gammaIrradiators',         'Gamma Irradiators',        'military'),
  military:                 def('military',                 '&#9992;',   'militaryActivity',         'Military Activity',        'military'),
  spaceports:               def('spaceports',               '&#128640;', 'spaceports',               'Spaceports',               'military'),
  satellites:               def('satellites',               '&#128752;', 'satellites',               'Orbital Surveillance',     'military', ['flat', 'globe']),
  radiation:                def('radiation',                '&#9762;',   'radiation',                'Radiation Monitoring',     'military'),

  // Intelligence
  gpsJamming:               def('gpsJamming',               '&#128225;', 'gpsJamming',               'GPS Jamming',              'intelligence', ['flat', 'globe'], _desktop ? 'locked' : undefined),
  ciiChoropleth:            def('ciiChoropleth',            '&#127758;', 'ciiChoropleth',            'CII Instability',          'intelligence', ['flat'], _desktop ? 'enhanced' : undefined),
  cyberThreats:             def('cyberThreats',             '&#128737;', 'cyberThreats',             'Cyber Threats',            'intelligence'),
  sanctions:                def('sanctions',                '&#128683;', 'sanctions',                'Sanctions',                'intelligence', []),
  poi:                      def('poi',                      '&#128100;', 'poi',                      'Persons of Interest',      'intelligence'),
  diseaseOutbreaks:         def('diseaseOutbreaks',         '&#129440;', 'diseaseOutbreaks',         'Disease Outbreaks',        'intelligence'),

  // Infrastructure
  cables:                   def('cables',                   '&#128268;', 'underseaCables',           'Undersea Cables',          'infrastructure'),
  pipelines:                def('pipelines',                '&#128738;', 'pipelines',                'Pipelines',                'infrastructure'),
  datacenters:              def('datacenters',              '&#128421;', 'aiDataCenters',            'AI Data Centers',          'infrastructure'),
  outages:                  def('outages',                  '&#128225;', 'internetOutages',          'Internet Outages',         'infrastructure'),
  waterways:                def('waterways',                '&#9875;',   'strategicWaterways',       'Strategic Waterways',      'infrastructure'),

  // Maritime & Aviation
  ais:                      def('ais',                      '&#128674;', 'shipTraffic',              'Ship Traffic',             'maritime-aviation'),
  tradeRoutes:              def('tradeRoutes',              '&#9875;',   'tradeRoutes',              'Trade Routes',             'maritime-aviation'),
  flights:                  def('flights',                  '&#9992;',   'flightDelays',             'Aviation',                 'maritime-aviation'),

  // Environmental
  climate:                  def('climate',                  '&#127787;', 'climateAnomalies',         'Climate Anomalies',        'environmental'),
  weather:                  def('weather',                  '&#9928;',   'weatherAlerts',            'Weather Alerts',           'environmental'),
  natural:                  def('natural',                  '&#127755;', 'naturalEvents',            'Natural Events',           'environmental'),
  fires:                    def('fires',                    '&#128293;', 'fires',                    'Fires',                    'environmental'),
  displacement:             def('displacement',             '&#128101;', 'displacementFlows',        'Displacement Flows',       'environmental'),

  // Economic
  economic:                 def('economic',                 '&#128176;', 'economicCenters',          'Economic Centers',         'economic'),
  minerals:                 def('minerals',                 '&#128142;', 'criticalMinerals',         'Critical Minerals',        'economic'),
  stockExchanges:           def('stockExchanges',           '&#127963;', 'stockExchanges',           'Stock Exchanges',          'economic'),
  financialCenters:         def('financialCenters',         '&#128176;', 'financialCenters',         'Financial Centers',        'economic'),
  centralBanks:             def('centralBanks',             '&#127974;', 'centralBanks',             'Central Banks',            'economic'),
  commodityHubs:            def('commodityHubs',            '&#128230;', 'commodityHubs',            'Commodity Hubs',           'economic'),
  gulfInvestments:          def('gulfInvestments',          '&#127760;', 'gulfInvestments',          'GCC Investments',          'economic'),
  miningSites:              def('miningSites',              '&#128301;', 'miningSites',              'Mining Sites',             'economic'),
  processingPlants:         def('processingPlants',         '&#127981;', 'processingPlants',         'Processing Plants',        'economic'),
  commodityPorts:           def('commodityPorts',           '&#9973;',   'commodityPorts',           'Commodity Ports',          'economic'),

  // Technology
  startupHubs:              def('startupHubs',              '&#128640;', 'startupHubs',              'Startup Hubs',             'tech'),
  techHQs:                  def('techHQs',                  '&#127970;', 'techHQs',                  'Tech HQs',                 'tech'),
  accelerators:             def('accelerators',             '&#9889;',   'accelerators',             'Accelerators',             'tech'),
  cloudRegions:             def('cloudRegions',             '&#9729;',   'cloudRegions',             'Cloud Regions',            'tech'),
  techEvents:               def('techEvents',               '&#128197;', 'techEvents',               'Tech Events',              'tech'),

  // Positive Signals
  positiveEvents:           def('positiveEvents',           '&#127775;', 'positiveEvents',           'Positive Events',          'positive'),
  kindness:                 def('kindness',                 '&#128154;', 'kindness',                 'Acts of Kindness',         'positive'),
  happiness:                def('happiness',                '&#128522;', 'happiness',                'World Happiness',          'positive'),
  speciesRecovery:          def('speciesRecovery',          '&#128062;', 'speciesRecovery',          'Species Recovery',         'positive'),
  renewableInstallations:   def('renewableInstallations',   '&#9889;',   'renewableInstallations',   'Clean Energy',             'positive'),

  // Monitoring & Overlays
  webcams:                  def('webcams',                  '&#128247;', 'webcams',                  'Live Webcams',             'monitoring'),
  dayNight:                 def('dayNight',                 '&#127763;', 'dayNight',                 'Day/Night',                'monitoring', ['flat']),
};

const VARIANT_LAYER_ORDER: Record<MapVariant, Array<keyof MapLayers>> = {
  full: [
    'iranAttacks', 'hotspots', 'conflicts',
    'bases', 'nuclear', 'irradiators', 'spaceports',
    'cables', 'pipelines', 'datacenters', 'military',
    'ais', 'tradeRoutes', 'flights', 'protests',
    'ucdpEvents', 'displacement', 'climate', 'weather',
    'outages', 'cyberThreats', 'natural', 'fires',
    'waterways', 'economic', 'minerals', 'gpsJamming',
    'satellites', 'ciiChoropleth', 'dayNight', 'webcams', 'poi', 'missileStrikes',
    'conflictForecast', 'diseaseOutbreaks', 'radiation', 'warcam',
  ],
  tech: [
    'startupHubs', 'techHQs', 'accelerators', 'cloudRegions',
    'datacenters', 'cables', 'outages', 'cyberThreats',
    'techEvents', 'natural', 'fires', 'dayNight',
  ],
  finance: [
    'stockExchanges', 'financialCenters', 'centralBanks', 'commodityHubs',
    'gulfInvestments', 'tradeRoutes', 'cables', 'pipelines',
    'outages', 'weather', 'economic', 'waterways',
    'natural', 'cyberThreats', 'dayNight',
  ],
  happy: [
    'positiveEvents', 'kindness', 'happiness',
    'speciesRecovery', 'renewableInstallations',
  ],
  commodity: [
    'miningSites', 'processingPlants', 'commodityPorts', 'commodityHubs',
    'minerals', 'pipelines', 'waterways', 'tradeRoutes',
    'ais', 'economic', 'fires', 'climate',
    'natural', 'weather', 'outages', 'dayNight',
  ],
  godmode: [
    'iranAttacks', 'hotspots', 'conflicts', 'missileStrikes',
    'bases', 'nuclear', 'irradiators', 'spaceports',
    'cables', 'pipelines', 'datacenters', 'military',
    'ais', 'tradeRoutes', 'flights', 'protests',
    'ucdpEvents', 'displacement', 'climate', 'weather',
    'outages', 'cyberThreats', 'natural', 'fires',
    'waterways', 'economic', 'minerals', 'gpsJamming',
    'satellites', 'ciiChoropleth', 'dayNight', 'webcams',
    'poi', 'conflictForecast', 'diseaseOutbreaks', 'radiation', 'warcam',
  ],
};

const SVG_ONLY_LAYERS: Partial<Record<MapVariant, Array<keyof MapLayers>>> = {
  full: ['sanctions'],
  finance: ['sanctions'],
  commodity: ['sanctions'],
};

const I18N_PREFIX = 'components.deckgl.layers.';

export function getLayersForVariant(variant: MapVariant, renderer: MapRenderer): LayerDefinition[] {
  const keys = VARIANT_LAYER_ORDER[variant] ?? VARIANT_LAYER_ORDER.full;
  return keys
    .map(k => LAYER_REGISTRY[k])
    .filter(d => d.renderers.includes(renderer));
}

/** Group layers by category, preserving variant order within each group */
export function getGroupedLayersForVariant(
  variant: MapVariant,
  renderer: MapRenderer,
): { category: LayerCategoryMeta; layers: LayerDefinition[] }[] {
  const defs = getLayersForVariant(variant, renderer);
  const groups = new Map<LayerCategory, LayerDefinition[]>();

  for (const d of defs) {
    const arr = groups.get(d.category) || [];
    arr.push(d);
    groups.set(d.category, arr);
  }

  return LAYER_CATEGORIES
    .filter(cat => groups.has(cat.id))
    .map(cat => ({ category: cat, layers: groups.get(cat.id)! }));
}

export function getAllowedLayerKeys(variant: MapVariant): Set<keyof MapLayers> {
  const keys = new Set(VARIANT_LAYER_ORDER[variant] ?? VARIANT_LAYER_ORDER.full);
  for (const k of SVG_ONLY_LAYERS[variant] ?? []) keys.add(k);
  return keys;
}

export function sanitizeLayersForVariant(layers: MapLayers, variant: MapVariant): MapLayers {
  const allowed = getAllowedLayerKeys(variant);
  const sanitized = { ...layers };
  for (const key of Object.keys(sanitized) as Array<keyof MapLayers>) {
    if (!allowed.has(key)) sanitized[key] = false;
  }
  return sanitized;
}

export const LAYER_SYNONYMS: Record<string, Array<keyof MapLayers>> = {
  aviation: ['flights'],
  flight: ['flights'],
  airplane: ['flights'],
  plane: ['flights'],
  notam: ['flights'],
  ship: ['ais', 'tradeRoutes'],
  vessel: ['ais'],
  maritime: ['ais', 'waterways', 'tradeRoutes'],
  sea: ['ais', 'waterways', 'cables'],
  ocean: ['cables', 'waterways'],
  war: ['conflicts', 'ucdpEvents', 'military'],
  battle: ['conflicts', 'ucdpEvents'],
  army: ['military', 'bases'],
  navy: ['military', 'ais'],
  missile: ['iranAttacks', 'military'],
  nuke: ['nuclear'],
  radiation: ['nuclear', 'irradiators'],
  space: ['spaceports', 'satellites'],
  orbit: ['satellites'],
  internet: ['outages', 'cables', 'cyberThreats'],
  cyber: ['cyberThreats', 'outages'],
  hack: ['cyberThreats'],
  earthquake: ['natural'],
  volcano: ['natural'],
  tsunami: ['natural'],
  storm: ['weather', 'natural'],
  hurricane: ['weather', 'natural'],
  typhoon: ['weather', 'natural'],
  cyclone: ['weather', 'natural'],
  flood: ['weather', 'natural'],
  wildfire: ['fires'],
  forest: ['fires'],
  refugee: ['displacement'],
  migration: ['displacement'],
  riot: ['protests'],
  demonstration: ['protests'],
  oil: ['pipelines', 'commodityHubs'],
  gas: ['pipelines'],
  energy: ['pipelines', 'renewableInstallations'],
  solar: ['renewableInstallations'],
  wind: ['renewableInstallations'],
  green: ['renewableInstallations', 'speciesRecovery'],
  money: ['economic', 'financialCenters', 'stockExchanges'],
  bank: ['centralBanks', 'financialCenters'],
  stock: ['stockExchanges'],
  trade: ['tradeRoutes', 'waterways'],
  cloud: ['cloudRegions', 'datacenters'],
  ai: ['datacenters'],
  startup: ['startupHubs', 'accelerators'],
  tech: ['techHQs', 'techEvents', 'startupHubs', 'cloudRegions', 'datacenters'],
  gps: ['gpsJamming'],
  jamming: ['gpsJamming'],
  mineral: ['minerals', 'miningSites'],
  mining: ['miningSites'],
  port: ['commodityPorts'],
  happy: ['happiness', 'kindness', 'positiveEvents'],
  good: ['positiveEvents', 'kindness'],
  animal: ['speciesRecovery'],
  wildlife: ['speciesRecovery'],
  gulf: ['gulfInvestments'],
  gcc: ['gulfInvestments'],
  sanction: ['sanctions'],
  night: ['dayNight'],
  sun: ['dayNight'],
  webcam: ['webcams'],
  camera: ['webcams'],
  livecam: ['webcams'],
};

export function resolveLayerLabel(def: LayerDefinition, tFn?: (key: string) => string): string {
  if (tFn) {
    const translated = tFn(I18N_PREFIX + def.i18nSuffix);
    if (translated && translated !== I18N_PREFIX + def.i18nSuffix) return translated;
  }
  return def.fallbackLabel;
}

export function bindLayerSearch(container: HTMLElement): void {
  const searchInput = container.querySelector('.layer-search') as HTMLInputElement | null;
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    const synonymHits = new Set<string>();
    if (q) {
      for (const [alias, keys] of Object.entries(LAYER_SYNONYMS)) {
        if (alias.includes(q)) keys.forEach(k => synonymHits.add(k));
      }
    }
    // Show/hide individual toggles
    container.querySelectorAll('.layer-toggle').forEach(label => {
      const el = label as HTMLElement;
      if (el.hasAttribute('data-layer-hidden')) return;
      if (!q) { el.style.display = ''; return; }
      const key = label.getAttribute('data-layer') || '';
      const text = label.textContent?.toLowerCase() || '';
      const match = text.includes(q) || key.toLowerCase().includes(q) || synonymHits.has(key);
      el.style.display = match ? '' : 'none';
    });
    // Show/hide category groups — hide a group if all its layers are hidden
    container.querySelectorAll('.layer-category-group').forEach(group => {
      const el = group as HTMLElement;
      const visibleToggles = el.querySelectorAll('.layer-toggle:not([style*="display: none"])');
      el.style.display = (!q || visibleToggles.length > 0) ? '' : 'none';
      // Auto-expand groups with matches when searching
      if (q && visibleToggles.length > 0) {
        el.setAttribute('open', '');
      }
    });
  });
}
