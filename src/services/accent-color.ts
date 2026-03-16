/**
 * Theme Accent Color Picker
 *
 * Adds a color picker to the settings panel that lets users
 * customize the accent color (default green #1aff8a) used
 * throughout the UI — status dots, active tabs, severity badges, etc.
 *
 * Location in repo: src/services/accent-color.ts
 */

const ACCENT_KEY = 'wm-accent-color';

export interface AccentPreset {
  name: string;
  color: string;
  dim: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Green',    color: '#1aff8a', dim: '#0c6b3a' },
  { name: 'Cyan',     color: '#00d4ff', dim: '#0a5a6b' },
  { name: 'Blue',     color: '#4488ff', dim: '#1a3a6b' },
  { name: 'Purple',   color: '#aa66ff', dim: '#4a2a6b' },
  { name: 'Pink',     color: '#ff66aa', dim: '#6b2a4a' },
  { name: 'Red',      color: '#ff4455', dim: '#6b1a22' },
  { name: 'Orange',   color: '#ff8c22', dim: '#6b3a0c' },
  { name: 'Gold',     color: '#ffcc00', dim: '#6b5500' },
  { name: 'White',    color: '#ffffff', dim: '#555555' },
];

const DEFAULT_ACCENT: AccentPreset = ACCENT_PRESETS[0] as AccentPreset;

/** Read stored accent or return default green */
export function getStoredAccent(): AccentPreset {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AccentPreset;
      if (parsed.color) return parsed;
    }
  } catch { /* noop */ }
  return DEFAULT_ACCENT;
}

/** Apply accent color to CSS custom properties on :root */
export function applyAccentColor(preset: AccentPreset): void {
  const root = document.documentElement;
  root.style.setProperty('--accent-primary', preset.color);
  root.style.setProperty('--accent-primary-dim', preset.dim);

  // Also override the semantic greens that use the accent color
  root.style.setProperty('--semantic-positive', preset.color);
  root.style.setProperty('--status-live', preset.color);
  root.style.setProperty('--green', preset.color);

  try {
    localStorage.setItem(ACCENT_KEY, JSON.stringify(preset));
  } catch { /* noop */ }

  window.dispatchEvent(new CustomEvent('accent-changed', { detail: preset }));
}

/** Apply stored accent on boot (call from main.ts or App.ts) */
export function initAccentColor(): void {
  applyAccentColor(getStoredAccent());
}

/**
 * Create and mount the accent color picker UI.
 * Call this from the settings/preferences panel.
 * Returns the DOM element for insertion.
 */
export function createAccentColorPicker(onPick?: (preset: AccentPreset) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'accent-picker';
  container.innerHTML = `
    <div class="accent-picker-label">ACCENT COLOR</div>
    <div class="accent-picker-swatches">
      ${ACCENT_PRESETS.map((p, i) => `
        <button
          class="accent-swatch"
          data-index="${i}"
          title="${p.name}"
          style="background: ${p.color};"
        ></button>
      `).join('')}
    </div>
  `;

  const current = getStoredAccent();
  highlightActive(container, current.color);

  container.querySelectorAll('.accent-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index') ?? '0', 10);
      const preset: AccentPreset = ACCENT_PRESETS[idx] ?? DEFAULT_ACCENT;
      applyAccentColor(preset);
      highlightActive(container, preset.color);
      if (onPick) onPick(preset);
    });
  });

  return container;
}

function highlightActive(container: HTMLElement, activeColor: string): void {
  const activeName = ACCENT_PRESETS.find(p => p.color === activeColor)?.name ?? '';
  container.querySelectorAll('.accent-swatch').forEach((btn) => {
    const isActive = (btn as HTMLElement).title === activeName;
    btn.classList.toggle('active', isActive);
  });
}
