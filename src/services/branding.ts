/**
 * Branding Service — custom logo, header text, and favicon.
 *
 * Allows users to personalize the platform appearance:
 *   - Custom header text (replaces "MONITOR" logo text)
 *   - Custom logo URL (displayed next to header text)
 *   - Custom favicon URL
 *
 * All values persist in localStorage and are applied on page load
 * before first paint to prevent flash of default branding.
 */

const STORAGE_KEY = 'worldmonitor-branding';

export interface BrandingConfig {
  /** Custom header text — replaces "MONITOR" in the header bar */
  headerText?: string;
  /** URL to a custom logo image (max 32px height) */
  logoUrl?: string;
  /** URL to a custom favicon (16x16 or 32x32) */
  faviconUrl?: string;
}

const DEFAULT_HEADER_TEXT = 'MONITOR';

/**
 * Load stored branding config.
 */
export function getStoredBranding(): BrandingConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as BrandingConfig;
    }
  } catch { /* noop */ }
  return {};
}

/**
 * Save branding config and apply it to the DOM.
 */
export function saveBranding(config: BrandingConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* noop */ }
  applyBranding(config);
}

/**
 * Clear custom branding and restore defaults.
 */
export function clearBranding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
  applyBranding({});
}

/**
 * Apply branding to the DOM. Call on page load and after save.
 */
export function applyBranding(config?: BrandingConfig): void {
  const branding = config ?? getStoredBranding();

  // Header text
  const logoEl = document.querySelector('.logo');
  if (logoEl) {
    logoEl.textContent = branding.headerText || DEFAULT_HEADER_TEXT;
  }

  // Custom logo image
  const headerLeft = document.querySelector('.header-left');
  if (headerLeft) {
    // Remove any existing custom logo
    headerLeft.querySelector('.custom-logo')?.remove();
    if (branding.logoUrl) {
      const img = document.createElement('img');
      img.className = 'custom-logo';
      img.src = branding.logoUrl;
      img.alt = '';
      img.style.cssText = 'height:24px;width:auto;margin-right:6px;vertical-align:middle;border-radius:3px';
      img.onerror = () => img.remove();
      // Insert before the .logo text
      const logo = headerLeft.querySelector('.logo');
      if (logo) {
        logo.insertAdjacentElement('beforebegin', img);
      }
    }
  }

  // Custom favicon
  if (branding.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }
}

/**
 * Apply stored branding on boot — call early before first paint.
 */
export function applyStoredBranding(): void {
  const config = getStoredBranding();
  if (config.headerText || config.logoUrl || config.faviconUrl) {
    // Defer to next frame so DOM elements exist
    requestAnimationFrame(() => applyBranding(config));
  }
}
