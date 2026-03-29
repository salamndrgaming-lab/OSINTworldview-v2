/**
 * Panel Presets Service
 *
 * Provides curated panel layout presets that let users switch between
 * different "views" of the platform with one click. Each preset defines
 * which panels are enabled and which are disabled.
 *
 * Presets work by:
 * 1. Saving the user's current panel config as a "custom" snapshot before switching
 * 2. Applying the preset's enable/disable rules on top of the full panel config
 * 3. Persisting the active preset name in localStorage so it survives reload
 *
 * The "Custom" preset is special — it restores whatever config the user
 * had before they started switching presets, or the default config if
 * no snapshot exists.
 */

import type { PanelConfig } from '@/types';

const ACTIVE_PRESET_KEY = 'worldmonitor-panel-preset';
const CUSTOM_SNAPSHOT_KEY = 'worldmonitor-panel-preset-snapshot';

// ────────────────────────────────────────────────────────────
// Preset definitions
// ────────────────────────────────────────────────────────────

export interface PanelPreset {
  /** Unique identifier */
  id: string;
  /** Display name shown in the UI */
  name: string;
  /** Short description for tooltip */
  description: string;
  /** Icon/emoji for the button */
  icon: string;
  /**
   * Panel keys to ENABLE. All other panels (except 'map') will be disabled.
   * If empty/undefined, this is a "restore custom" action.
   */
  enabledPanels?: string[];
}

/**
 * Built-in presets. The order here determines the order in the UI.
 * 'custom' is always first and represents the user's personal config.
 */
export const PANEL_PRESETS: PanelPreset[] = [
  {
    id: 'custom',
    name: 'Custom',
    description: 'Your personalized panel layout',
    icon: '\u2699',
  },
  {
    id: 'intel',
    name: 'Intel View',
    description: 'Intelligence feeds, threat analysis, and geopolitical monitoring',
    icon: '\uD83D\uDD0D',
    enabledPanels: [
      'map', 'live-news', 'insights', 'strategic-posture', 'cii',
      'strategic-risk', 'intel', 'gdelt-intel', 'poi', 'cascade',
      'military-correlation', 'escalation-correlation', 'telegram-intel',
      'oref-sirens', 'security-advisories', 'ucdp-events',
    ],
  },
  {
    id: 'markets',
    name: 'Markets',
    description: 'Financial markets, commodities, and economic indicators',
    icon: '\uD83D\uDCC8',
    enabledPanels: [
      'map', 'live-news', 'markets', 'commodities', 'economic',
      'trade-policy', 'supply-chain', 'finance', 'heatmap',
      'macro-signals', 'etf-flows', 'stablecoins', 'crypto',
      'polymarket', 'gulf-economies', 'insights',
    ],
  },
  {
    id: 'regional',
    name: 'Regional News',
    description: 'Regional news feeds from every major world region',
    icon: '\uD83C\uDF0D',
    enabledPanels: [
      'map', 'live-news', 'politics', 'us', 'europe', 'middleeast',
      'africa', 'latam', 'asia', 'insights', 'strategic-posture',
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials — map, live news, and AI insights',
    icon: '\u26A1',
    enabledPanels: [
      'map', 'live-news', 'insights',
    ],
  },
  {
    id: 'full',
    name: 'Full OSINT',
    description: 'Everything enabled — maximum intelligence coverage',
    icon: '\uD83D\uDEE1',
    // enabledPanels is undefined — we'll enable ALL panels
  },
];

// ────────────────────────────────────────────────────────────
// State management
// ────────────────────────────────────────────────────────────

/**
 * Get the currently active preset ID, or 'custom' if none stored.
 */
export function getActivePresetId(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_PRESET_KEY);
    if (stored && PANEL_PRESETS.some(p => p.id === stored)) return stored;
  } catch { /* noop */ }
  return 'custom';
}

/**
 * Save a snapshot of the current panel settings before switching presets.
 * This lets us restore the user's config when they go back to "Custom".
 */
export function saveCustomSnapshot(panelSettings: Record<string, PanelConfig>): void {
  try {
    // Only save the enabled/disabled state, not the full config
    const snapshot: Record<string, boolean> = {};
    for (const [key, config] of Object.entries(panelSettings)) {
      snapshot[key] = config.enabled;
    }
    localStorage.setItem(CUSTOM_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch { /* noop */ }
}

/**
 * Load the saved custom snapshot (panel key -> enabled boolean).
 * Returns null if no snapshot exists.
 */
function loadCustomSnapshot(): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(CUSTOM_SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
    }
  } catch { /* noop */ }
  return null;
}

/**
 * Apply a preset to the given panel settings.
 * Returns a new Record with the preset's enable/disable rules applied.
 *
 * For 'custom': restores the saved snapshot.
 * For 'full': enables all panels.
 * For others: enables only the panels in the preset's enabledPanels list.
 */
export function applyPreset(
  presetId: string,
  currentSettings: Record<string, PanelConfig>,
): Record<string, PanelConfig> {
  const preset = PANEL_PRESETS.find(p => p.id === presetId);
  if (!preset) return currentSettings;

  // Clone the settings so we don't mutate the original
  const result: Record<string, PanelConfig> = {};
  for (const [key, config] of Object.entries(currentSettings)) {
    result[key] = { ...config };
  }

  if (presetId === 'custom') {
    // Restore from snapshot
    const snapshot = loadCustomSnapshot();
    if (snapshot) {
      for (const [key, config] of Object.entries(result)) {
        if (key in snapshot) {
          config.enabled = snapshot[key]!;
        }
      }
    }
    // If no snapshot, leave settings as-is (user's current config IS the custom)
  } else if (presetId === 'full') {
    // Enable everything
    for (const config of Object.values(result)) {
      config.enabled = true;
    }
  } else if (preset.enabledPanels) {
    // Enable only the preset's panels, disable everything else
    // Always keep 'map' enabled
    const enableSet = new Set(preset.enabledPanels);
    enableSet.add('map');
    for (const [key, config] of Object.entries(result)) {
      config.enabled = enableSet.has(key);
    }
  }

  // Persist the active preset
  try {
    localStorage.setItem(ACTIVE_PRESET_KEY, presetId);
  } catch { /* noop */ }

  return result;
}

/**
 * Clear the active preset (revert to custom).
 * Called when the user manually toggles individual panels,
 * which implicitly means they're customizing beyond any preset.
 */
export function clearActivePreset(): void {
  try {
    localStorage.setItem(ACTIVE_PRESET_KEY, 'custom');
  } catch { /* noop */ }
}
