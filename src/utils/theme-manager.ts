import { invalidateColorCache } from './theme-colors';

/**
 * Theme Manager — expanded to support 4 built-in themes plus custom color schemes.
 *
 * Built-in themes:
 *   - dark:     Default OSINT dark theme (black bg, green accents)
 *   - light:    Light background for daylight use
 *   - tactical: High-contrast green-on-black military/CRT aesthetic
 *
 * Custom color schemes are stored separately and overlay on top of a
 * chosen base theme, allowing users to tweak individual CSS variables
 * without building a full theme from scratch.
 */

export type Theme = 'dark' | 'light' | 'tactical' | 'palantir';
export type ThemePreference = 'auto' | 'dark' | 'light' | 'tactical' | 'palantir';

const STORAGE_KEY = 'osintview-theme';
const CUSTOM_COLORS_KEY = 'osintview-custom-colors';
const DEFAULT_THEME: Theme = 'dark';

// ────────────────────────────────────────────────────────────
// Custom color scheme types
// ────────────────────────────────────────────────────────────

/**
 * CustomColorScheme holds user-defined overrides for CSS variables.
 * Any property left undefined falls through to the base theme's value.
 */
export interface CustomColorScheme {
  name: string;
  /** Which built-in theme to use as the base (inherits any vars not overridden) */
  base: 'dark' | 'light' | 'tactical' | 'palantir';
  /** Override individual CSS variables — keys are variable names without '--' prefix */
  overrides: Record<string, string>;
}

/**
 * Pre-built custom schemes users can pick as starting points
 * in the color scheme builder.
 */
export const CUSTOM_SCHEME_PRESETS: CustomColorScheme[] = [
  {
    name: 'Midnight Blue',
    base: 'dark',
    overrides: {
      'bg': '#0a0a1a',
      'bg-secondary': '#0f0f24',
      'surface': '#12122a',
      'surface-hover': '#1a1a3a',
      'border': '#2a2a4a',
      'border-strong': '#3a3a6a',
      'panel-bg': '#12122a',
      'panel-border': '#2a2a4a',
      'map-bg': '#050520',
      'map-grid': '#1a1a4a',
      'map-country': '#0a0a30',
      'map-stroke': '#2a2a6a',
      'accent-primary': '#4488ff',
      'accent-primary-dim': '#1a3a6b',
    },
  },
  {
    name: 'Blood Red',
    base: 'dark',
    overrides: {
      'bg': '#0a0505',
      'bg-secondary': '#140808',
      'surface': '#1a0a0a',
      'surface-hover': '#2a1010',
      'border': '#3a1515',
      'border-strong': '#5a2020',
      'panel-bg': '#1a0a0a',
      'panel-border': '#3a1515',
      'map-bg': '#080202',
      'map-grid': '#2a0808',
      'map-country': '#1a0505',
      'map-stroke': '#4a1010',
      'accent-primary': '#ff4455',
      'accent-primary-dim': '#6b1a22',
      'semantic-positive': '#ff4455',
      'status-live': '#ff4455',
      'green': '#ff4455',
    },
  },
  {
    name: 'Amber Terminal',
    base: 'tactical',
    overrides: {
      'text': '#ffcc00',
      'text-secondary': '#cc9900',
      'text-dim': '#997700',
      'text-muted': '#775500',
      'accent': '#ffcc00',
      'accent-primary': '#ffcc00',
      'accent-primary-dim': '#6b5500',
      'border': '#332a00',
      'border-strong': '#554400',
      'panel-border': '#332a00',
      'semantic-positive': '#ffcc00',
      'status-live': '#ffcc00',
      'green': '#ffcc00',
    },
  },
  {
    name: 'Arctic',
    base: 'light',
    overrides: {
      'bg': '#f0f5fa',
      'bg-secondary': '#e5ecf5',
      'surface': '#ffffff',
      'surface-hover': '#eaf0f8',
      'border': '#c0d0e0',
      'panel-bg': '#ffffff',
      'panel-border': '#c0d0e0',
      'map-bg': '#d0e0f0',
      'map-grid': '#a0b8d0',
      'map-country': '#e0ecf8',
      'map-stroke': '#90a8c0',
      'accent-primary': '#0088cc',
      'accent-primary-dim': '#004466',
    },
  },
];

// ────────────────────────────────────────────────────────────
// Theme resolution helpers
// ────────────────────────────────────────────────────────────

function resolveThemeColor(theme: Theme, variant: string | undefined): string {
  if (theme === 'tactical') return '#000000';
  if (theme === 'palantir') return '#0a0d14';
  if (theme === 'dark') return variant === 'happy' ? '#1A2332' : '#0a0f0a';
  return variant === 'happy' ? '#FAFAF5' : '#f8f9fa';
}

function updateThemeMetaColor(theme: Theme, variant = document.documentElement.dataset.variant): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolveThemeColor(theme, variant);
}

// ────────────────────────────────────────────────────────────
// Storage: theme preference
// ────────────────────────────────────────────────────────────

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'tactical' || stored === 'palantir') return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_THEME;
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'auto' || stored === 'dark' || stored === 'light' || stored === 'tactical' || stored === 'palantir') {
      return stored;
    }
  } catch { /* noop */ }
  return 'auto';
}

function resolveAutoTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

let autoMediaQuery: MediaQueryList | null = null;
let autoMediaHandler: (() => void) | null = null;

function teardownAutoListener(): void {
  if (autoMediaQuery && autoMediaHandler) {
    autoMediaQuery.removeEventListener('change', autoMediaHandler);
    autoMediaQuery = null;
    autoMediaHandler = null;
  }
}

export function setThemePreference(pref: ThemePreference): void {
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* noop */ }
  teardownAutoListener();
  const effective: Theme = pref === 'auto' ? resolveAutoTheme() : pref;
  setTheme(effective);
  if (pref === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
    autoMediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    autoMediaHandler = () => setTheme(resolveAutoTheme());
    autoMediaQuery.addEventListener('change', autoMediaHandler);
  }
}

export function getCurrentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value === 'dark' || value === 'light' || value === 'tactical' || value === 'palantir') return value;
  return DEFAULT_THEME;
}

/**
 * Set the active theme: update DOM attribute, apply custom color overrides,
 * invalidate color cache, persist to localStorage, update meta theme-color,
 * and dispatch event.
 */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;

  // Clear any previous custom color overrides from inline styles
  clearCustomColorOverrides();

  // If there's a stored custom color scheme and the current theme matches
  // its base, re-apply the overrides on top of the theme's CSS rules.
  const customScheme = getStoredCustomScheme();
  if (customScheme && theme === customScheme.base) {
    applyCustomColorOverrides(customScheme.overrides);
  }

  invalidateColorCache();
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
  updateThemeMetaColor(theme);
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

/**
 * Apply the stored theme preference to the document before components mount.
 * Only sets the data-theme attribute and meta theme-color — does NOT dispatch
 * events or invalidate the color cache (components aren't mounted yet).
 */
export function applyStoredTheme(): void {
  const variant = document.documentElement.dataset.variant;

  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* noop */ }

  // URL override: ?theme=palantir activates without touching localStorage
  try {
    const urlTheme = new URL(window.location.href).searchParams.get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light' || urlTheme === 'tactical' || urlTheme === 'palantir') {
      raw = urlTheme;
    }
  } catch { /* noop */ }

  const hasExplicitPreference =
    raw === 'dark' || raw === 'light' || raw === 'tactical' || raw === 'palantir' || raw === 'auto';

  let effective: Theme;
  if (raw === 'auto') {
    effective = resolveAutoTheme();
  } else if (raw === 'tactical') {
    effective = 'tactical';
  } else if (raw === 'palantir') {
    effective = 'palantir';
  } else if (hasExplicitPreference) {
    effective = raw as Theme;
  } else {
    effective = variant === 'happy' ? 'light' : DEFAULT_THEME;
  }

  document.documentElement.dataset.theme = effective;
  updateThemeMetaColor(effective, variant);

  // Apply custom scheme overrides early to prevent flash of wrong colors
  const customScheme = getStoredCustomScheme();
  if (customScheme && effective === customScheme.base) {
    applyCustomColorOverrides(customScheme.overrides);
  }
}

// ────────────────────────────────────────────────────────────
// Custom color scheme storage and application
// ────────────────────────────────────────────────────────────

export function getStoredCustomScheme(): CustomColorScheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CustomColorScheme;
      if (parsed && parsed.base && parsed.overrides) return parsed;
    }
  } catch { /* noop */ }
  return null;
}

/**
 * Save a custom color scheme to localStorage and apply it if the
 * current theme matches the scheme's base.
 */
export function saveCustomScheme(scheme: CustomColorScheme): void {
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(scheme));
  } catch { /* noop */ }

  const current = getCurrentTheme();
  if (current === scheme.base) {
    clearCustomColorOverrides();
    applyCustomColorOverrides(scheme.overrides);
    invalidateColorCache();
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: current } }));
  }
}

export function clearCustomScheme(): void {
  try {
    localStorage.removeItem(CUSTOM_COLORS_KEY);
  } catch { /* noop */ }
  clearCustomColorOverrides();
  invalidateColorCache();
}

/**
 * Apply a dictionary of CSS variable overrides to :root via inline styles.
 */
function applyCustomColorOverrides(overrides: Record<string, string>): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(overrides)) {
    if (value) {
      root.style.setProperty('--' + key, value);
    }
  }
}

/** All CSS properties that custom schemes may override */
const OVERRIDABLE_PROPS = [
  'bg', 'bg-secondary', 'surface', 'surface-hover', 'surface-active',
  'border', 'border-strong', 'border-subtle',
  'text', 'text-secondary', 'text-dim', 'text-muted', 'text-faint', 'text-ghost',
  'accent',
  'overlay-subtle', 'overlay-light', 'overlay-medium', 'overlay-heavy',
  'shadow-color', 'darken-light', 'darken-medium', 'darken-heavy',
  'scrollbar-thumb', 'scrollbar-thumb-hover',
  'input-bg',
  'panel-bg', 'panel-border',
  'map-bg', 'map-grid', 'map-country', 'map-stroke',
  'accent-primary', 'accent-primary-dim',
  'semantic-positive', 'semantic-critical', 'semantic-high', 'semantic-elevated',
  'semantic-normal', 'semantic-low', 'semantic-info',
  'status-live', 'status-cached', 'status-unavailable',
  'threat-critical', 'threat-high', 'threat-medium', 'threat-low', 'threat-info',
  'green', 'red', 'yellow',
];

function clearCustomColorOverrides(): void {
  const root = document.documentElement;
  for (const prop of OVERRIDABLE_PROPS) {
    root.style.removeProperty('--' + prop);
  }
}

// ────────────────────────────────────────────────────────────
// Color scheme builder helpers (for the settings UI)
// ────────────────────────────────────────────────────────────

export interface ColorGroup {
  label: string;
  vars: { name: string; label: string }[];
}

/**
 * Returns groups of editable CSS variables for the color scheme builder UI.
 */
export function getEditableColorGroups(): ColorGroup[] {
  return [
    {
      label: 'Backgrounds',
      vars: [
        { name: 'bg', label: 'Page background' },
        { name: 'bg-secondary', label: 'Secondary background' },
        { name: 'surface', label: 'Surface (panels, cards)' },
        { name: 'surface-hover', label: 'Surface hover' },
      ],
    },
    {
      label: 'Text',
      vars: [
        { name: 'text', label: 'Primary text' },
        { name: 'text-secondary', label: 'Secondary text' },
        { name: 'text-dim', label: 'Dim text' },
        { name: 'accent', label: 'Accent text' },
      ],
    },
    {
      label: 'Borders',
      vars: [
        { name: 'border', label: 'Default border' },
        { name: 'border-strong', label: 'Strong border' },
        { name: 'panel-border', label: 'Panel border' },
      ],
    },
    {
      label: 'Panels',
      vars: [
        { name: 'panel-bg', label: 'Panel background' },
        { name: 'input-bg', label: 'Input background' },
      ],
    },
    {
      label: 'Map',
      vars: [
        { name: 'map-bg', label: 'Map background' },
        { name: 'map-grid', label: 'Map grid lines' },
        { name: 'map-country', label: 'Country fill' },
        { name: 'map-stroke', label: 'Country borders' },
      ],
    },
    {
      label: 'Accent & Status',
      vars: [
        { name: 'accent-primary', label: 'Accent color' },
        { name: 'accent-primary-dim', label: 'Accent dim' },
        { name: 'status-live', label: 'Live indicator' },
        { name: 'green', label: 'Positive/green' },
      ],
    },
  ];
}
