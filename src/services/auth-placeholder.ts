/**
 * Auth Placeholder Service
 * 
 * Renders a user avatar button in the header with a dropdown menu.
 * Currently shows a "guest" state with an upgrade CTA — this will
 * be wired to a real auth provider (Supabase, Clerk, etc.) later.
 * 
 * The dropdown provides:
 * - User identity (Guest for now)
 * - Plan indicator (Free)
 * - Upgrade to Pro CTA
 * - Settings link
 * - Theme toggle
 * - Sign in / Sign out placeholder
 */

import { getCurrentTheme, setTheme } from '@/utils/theme-manager';

/** Render the auth avatar button + dropdown HTML */
export function renderAuthPlaceholder(): string {
  return `<div class="auth-wrapper" style="position:relative">
    <button class="auth-avatar-btn" id="authAvatarBtn" title="Account" aria-label="Account">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    </button>
    <div class="auth-dropdown" id="authDropdown">
      <div class="auth-dropdown-header">
        <div class="auth-user-name">Guest User</div>
        <span class="auth-user-plan">FREE PLAN</span>
      </div>
      <button class="auth-dropdown-upgrade" id="authUpgradeBtn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Upgrade to Pro
      </button>
      <div class="auth-dropdown-divider"></div>
      <button class="auth-dropdown-item" id="authSettingsBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Settings
      </button>
      <button class="auth-dropdown-item" id="authThemeBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <span id="authThemeLabel">${getCurrentTheme() === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
      </button>
      <div class="auth-dropdown-divider"></div>
      <button class="auth-dropdown-item" id="authSignInBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign In
      </button>
    </div>
  </div>`;
}

/** Initialize auth placeholder event listeners */
export function initAuthPlaceholder(): void {
  const avatarBtn = document.getElementById('authAvatarBtn');
  const dropdown = document.getElementById('authDropdown');

  if (!avatarBtn || !dropdown) return;

  let isOpen = false;

  // Toggle dropdown
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen = !isOpen;
    dropdown.classList.toggle('open', isOpen);
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !dropdown.contains(e.target as Node) && e.target !== avatarBtn) {
      isOpen = false;
      dropdown.classList.remove('open');
    }
  });

  // Settings button — trigger the settings modal
  document.getElementById('authSettingsBtn')?.addEventListener('click', () => {
    isOpen = false;
    dropdown.classList.remove('open');
    // Trigger the unified settings panel (same as the gear icon)
    const settingsMount = document.getElementById('unifiedSettingsMount');
    const settingsBtn = settingsMount?.querySelector('button');
    settingsBtn?.click();
  });

  // Theme toggle
  document.getElementById('authThemeBtn')?.addEventListener('click', () => {
    const current = getCurrentTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const label = document.getElementById('authThemeLabel');
    if (label) label.textContent = next === 'dark' ? 'Light Mode' : 'Dark Mode';
  });

  // Upgrade button — placeholder
  document.getElementById('authUpgradeBtn')?.addEventListener('click', () => {
    isOpen = false;
    dropdown.classList.remove('open');
    alert('Pro subscriptions coming soon! Follow @osintview for updates.');
  });

  // Sign in — placeholder
  document.getElementById('authSignInBtn')?.addEventListener('click', () => {
    isOpen = false;
    dropdown.classList.remove('open');
    alert('Authentication coming soon. Your local settings and workspaces are saved in your browser.');
  });
}
