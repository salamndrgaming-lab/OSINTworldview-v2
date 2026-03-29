/**
 * Dashboard Layout Service
 *
 * Manages the overall dashboard layout mode:
 *   - auto:        Default responsive grid (auto-fill, minmax 280px)
 *   - 1-col:       Single column — panels stack vertically
 *   - 2-col:       Two columns fixed
 *   - 3-col:       Three columns fixed
 *   - 4-col:       Four columns fixed
 *   - split:       Split-screen — map pinned left (50%), panels scroll right (50%)
 *   - focus:       Focus mode — map hidden, panels only in wide grid
 *
 * Layout is applied by setting a CSS class on .main-content which
 * overrides the grid-template-columns on .panels-grid.
 *
 * Also manages TV/kiosk mode availability for all variants (not just happy).
 */

const STORAGE_KEY = 'worldmonitor-dashboard-layout';

export type DashboardLayout = 'auto' | '1-col' | '2-col' | '3-col' | '4-col' | 'split' | 'focus';

export interface LayoutOption {
  id: DashboardLayout;
  label: string;
  icon: string;
  description: string;
}

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { id: 'auto',  label: 'Auto',    icon: '\u25A6', description: 'Responsive grid — adapts to screen width' },
  { id: '1-col', label: '1 Col',   icon: '\u2590', description: 'Single column — panels stack vertically' },
  { id: '2-col', label: '2 Col',   icon: '\u258C', description: 'Two fixed columns' },
  { id: '3-col', label: '3 Col',   icon: '\u2261', description: 'Three fixed columns' },
  { id: '4-col', label: '4 Col',   icon: '\u2630', description: 'Four fixed columns' },
  { id: 'split', label: 'Split',   icon: '\u25EB', description: 'Map left, panels right (split-screen)' },
  { id: 'focus', label: 'Focus',   icon: '\u25A3', description: 'Panels only — map hidden' },
];

/**
 * Get the stored layout preference, or 'auto' if none.
 */
export function getStoredLayout(): DashboardLayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LAYOUT_OPTIONS.some(o => o.id === stored)) {
      return stored as DashboardLayout;
    }
  } catch { /* noop */ }
  return 'auto';
}

/**
 * Save and apply a dashboard layout.
 * Updates CSS classes on the DOM and persists the choice.
 */
export function applyLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch { /* noop */ }

  const mainContent = document.querySelector('.main-content');
  if (!mainContent) return;

  // Remove all existing layout classes
  for (const opt of LAYOUT_OPTIONS) {
    mainContent.classList.remove('layout-' + opt.id);
  }

  // Add the new layout class
  if (layout !== 'auto') {
    mainContent.classList.add('layout-' + layout);
  }

  // Handle split mode — map and panels side by side
  const mapSection = document.getElementById('mapSection');
  if (layout === 'split') {
    mainContent.classList.add('layout-split');
    if (mapSection) {
      mapSection.classList.remove('hidden');
      mapSection.style.display = '';
    }
  }

  // Handle focus mode — hide map
  if (layout === 'focus') {
    if (mapSection) {
      mapSection.style.display = 'none';
    }
  } else {
    // Restore map if not in focus mode (and not explicitly hidden by user)
    if (mapSection && mapSection.style.display === 'none' && !mapSection.classList.contains('hidden')) {
      mapSection.style.display = '';
    }
  }

  // Trigger resize so map redraws if needed
  window.dispatchEvent(new Event('resize'));

  // Dispatch event for other components to react
  window.dispatchEvent(new CustomEvent('layout-changed', { detail: { layout } }));
}

/**
 * Apply the stored layout on page load (call early, before panels mount).
 */
export function applyStoredLayout(): void {
  const layout = getStoredLayout();
  if (layout !== 'auto') {
    applyLayout(layout);
  }
}
