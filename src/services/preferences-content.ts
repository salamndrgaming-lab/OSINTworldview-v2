import { LANGUAGES, getCurrentLanguage, changeLanguage, t } from '@/services/i18n';
import { getAiFlowSettings, setAiFlowSetting, getStreamQuality, setStreamQuality, STREAM_QUALITY_OPTIONS } from '@/services/ai-flow-settings';
import { getMapProvider, setMapProvider, MAP_PROVIDER_OPTIONS, MAP_THEME_OPTIONS, getMapTheme, setMapTheme, type MapProvider } from '@/config/basemap';
import { getLiveStreamsAlwaysOn, setLiveStreamsAlwaysOn } from '@/services/live-stream-settings';
import { getGlobeVisualPreset, setGlobeVisualPreset, GLOBE_VISUAL_PRESET_OPTIONS, type GlobeVisualPreset } from '@/services/globe-render-settings';
import type { StreamQuality } from '@/services/ai-flow-settings';
import {
  getThemePreference,
  setThemePreference,
  getCurrentTheme,
  getStoredCustomScheme,
  saveCustomScheme,
  clearCustomScheme,
  getEditableColorGroups,
  CUSTOM_SCHEME_PRESETS,
  type ThemePreference,
  type CustomColorScheme,
} from '@/utils/theme-manager';
import { getFontFamily, setFontFamily, type FontFamily } from '@/services/font-settings';
import { escapeHtml } from '@/utils/sanitize';
import { trackLanguageChange } from '@/services/analytics';
import { exportSettings, importSettings, type ImportResult } from '@/utils/settings-persistence';
import { createAccentColorPicker } from '@/services/accent-color';
import { getTelegramConfig, saveTelegramConfig, clearTelegramConfig, testTelegramConnection, sendReport } from '@/services/telegram-report';
import { getStoredBranding as getStoredBrandingConfig, saveBranding, clearBranding } from '@/services/branding';
import { getWatchlist, addToWatchlist, removeFromWatchlist, clearWatchlist, type WatchlistCategory } from '@/services/watchlist';
const DESKTOP_RELEASES_URL = 'https://github.com/salamndrgaming-lab/OSINTworldview-v2/releases';

export interface PreferencesHost {
  isDesktopApp: boolean;
  onMapProviderChange?: (provider: MapProvider) => void;
}

export interface PreferencesResult {
  html: string;
  attach: (container: HTMLElement) => () => void;
}

function toggleRowHtml(id: string, label: string, desc: string, checked: boolean): string {
  return `
    <div class="ai-flow-toggle-row">
      <div class="ai-flow-toggle-label-wrap">
        <div class="ai-flow-toggle-label">${label}</div>
        <div class="ai-flow-toggle-desc">${desc}</div>
      </div>
      <label class="ai-flow-switch">
        <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
        <span class="ai-flow-slider"></span>
      </label>
    </div>
  `;
}

function renderMapThemeDropdown(container: HTMLElement, provider: MapProvider): void {
  const select = container.querySelector<HTMLSelectElement>('#us-map-theme');
  if (!select) return;
  const currentTheme = getMapTheme(provider);
  select.innerHTML = MAP_THEME_OPTIONS[provider]
    .map(opt => `<option value="${opt.value}"${opt.value === currentTheme ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`)
    .join('');
}

function updateAiStatus(container: HTMLElement): void {
  const settings = getAiFlowSettings();
  const dot = container.querySelector('#usStatusDot');
  const text = container.querySelector('#usStatusText');
  if (!dot || !text) return;

  dot.className = 'ai-flow-status-dot';
  if (settings.cloudLlm && settings.browserModel) {
    dot.classList.add('active');
    text.textContent = t('components.insights.aiFlowStatusCloudAndBrowser');
  } else if (settings.cloudLlm) {
    dot.classList.add('active');
    text.textContent = t('components.insights.aiFlowStatusActive');
  } else if (settings.browserModel) {
    dot.classList.add('browser-only');
    text.textContent = t('components.insights.aiFlowStatusBrowserOnly');
  } else {
    dot.classList.add('disabled');
    text.textContent = t('components.insights.aiFlowStatusDisabled');
  }
}

// ────────────────────────────────────────────────────────────
// Color scheme builder HTML generator
// ────────────────────────────────────────────────────────────

function renderColorSchemeBuilder(): string {
  const storedScheme = getStoredCustomScheme();
  const groups = getEditableColorGroups();

  let html = '';

  // Preset buttons
  html += '<div class="color-scheme-section-label">PRESETS</div>';
  html += '<div class="color-scheme-presets">';
  for (let i = 0; i < CUSTOM_SCHEME_PRESETS.length; i++) {
    const preset = CUSTOM_SCHEME_PRESETS[i]!;
    const isActive = storedScheme?.name === preset.name;
    const bgColor = preset.overrides['bg'] || preset.overrides['surface'] || '#141414';
    const accentColor = preset.overrides['accent-primary'] || preset.overrides['accent'] || '#1aff8a';
    html += `<button class="color-scheme-preset${isActive ? ' active' : ''}" data-cs-preset="${i}" title="${escapeHtml(preset.name)} (based on ${preset.base})">`;
    html += `<span class="color-scheme-preset-swatch" style="background:linear-gradient(135deg, ${bgColor} 50%, ${accentColor} 50%)"></span>`;
    html += `${escapeHtml(preset.name)}`;
    html += '</button>';
  }
  html += '</div>';

  // Color editor groups
  html += '<div class="color-scheme-section-label">CUSTOM EDITOR</div>';
  html += '<div id="cs-editor">';

  for (const group of groups) {
    html += '<div class="color-editor-group">';
    html += `<div class="color-editor-group-label">${escapeHtml(group.label)}</div>`;
    for (const v of group.vars) {
      // Read the current computed value for this CSS variable
      const currentVal = storedScheme?.overrides[v.name] || '';
      html += '<div class="color-editor-row">';
      html += `<input type="color" class="color-editor-swatch" data-cs-var="${v.name}" value="${currentVal || '#000000'}" title="${escapeHtml(v.label)}">`;
      html += `<span class="color-editor-label">${escapeHtml(v.label)}</span>`;
      html += `<span class="color-editor-value" data-cs-val="${v.name}">${currentVal || '—'}</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';

  // Action buttons
  html += '<div class="color-scheme-actions">';
  html += '<button class="cs-btn-apply" id="cs-apply-btn">Apply Custom Colors</button>';
  html += '<button class="cs-btn-reset" id="cs-reset-btn">Reset to Default</button>';
  html += '</div>';

  return html;
}

// ────────────────────────────────────────────────────────────
// Main render function
// ────────────────────────────────────────────────────────────

export function renderPreferences(host: PreferencesHost): PreferencesResult {
  const settings = getAiFlowSettings();
  const currentLang = getCurrentLanguage();
  let html = '';

  // ── Display group ──
  html += '<details class="ov-pref-group" open>';
  html += `<summary>${t('preferences.display')}</summary>`;
  html += '<div class="ov-pref-group-content">';

  // Appearance — now includes tactical
  const currentThemePref = getThemePreference();
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('preferences.theme')}</div>
      <div class="ai-flow-toggle-desc">${t('preferences.themeDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-theme">';
  for (const opt of [
    { value: 'auto', label: t('preferences.themeAuto') },
    { value: 'dark', label: t('preferences.themeDark') },
    { value: 'light', label: t('preferences.themeLight') },
    { value: 'tactical', label: 'Tactical (Green-on-Black)' },
  ] as { value: ThemePreference; label: string }[]) {
    const selected = opt.value === currentThemePref ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  // Font family
  const currentFont = getFontFamily();
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('preferences.fontFamily')}</div>
      <div class="ai-flow-toggle-desc">${t('preferences.fontFamilyDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-font-family">';
  for (const opt of [
    { value: 'mono', label: t('preferences.fontMono') },
    { value: 'system', label: t('preferences.fontSystem') },
  ] as { value: FontFamily; label: string }[]) {
    const selected = opt.value === currentFont ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  // Map tile provider
  const currentProvider = getMapProvider();
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('preferences.mapProvider')}</div>
      <div class="ai-flow-toggle-desc">${t('preferences.mapProviderDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-map-provider">';
  for (const opt of MAP_PROVIDER_OPTIONS) {
    const selected = opt.value === currentProvider ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  // Map theme
  const currentMapTheme = getMapTheme(currentProvider);
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('preferences.mapTheme')}</div>
      <div class="ai-flow-toggle-desc">${t('preferences.mapThemeDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-map-theme">';
  for (const opt of MAP_THEME_OPTIONS[currentProvider]) {
    const selected = opt.value === currentMapTheme ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  html += toggleRowHtml('us-map-flash', t('components.insights.mapFlashLabel'), t('components.insights.mapFlashDesc'), settings.mapNewsFlash);

  // 3D Globe Visual Preset
  const currentPreset = getGlobeVisualPreset();
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('preferences.globePreset')}</div>
      <div class="ai-flow-toggle-desc">${t('preferences.globePresetDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-globe-visual-preset">';
  for (const opt of GLOBE_VISUAL_PRESET_OPTIONS) {
    const selected = opt.value === currentPreset ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  // Language
  html += `<div class="ai-flow-section-label">${t('header.languageLabel')}</div>`;
  html += '<select class="unified-settings-lang-select" id="us-language">';
  for (const lang of LANGUAGES) {
    const selected = lang.code === currentLang ? ' selected' : '';
    html += `<option value="${lang.code}"${selected}>${lang.flag} ${escapeHtml(lang.label)}</option>`;
  }
  html += '</select>';
  if (currentLang === 'vi') {
    html += `<div class="ai-flow-toggle-desc">${t('components.languageSelector.mapLabelsFallbackVi')}</div>`;
  }

  html += '</div></details>';

  // ── Intelligence group ──
  html += '<details class="ov-pref-group">';
  html += `<summary>${t('preferences.intelligence')}</summary>`;
  html += '<div class="ov-pref-group-content">';

  if (!host.isDesktopApp) {
    html += toggleRowHtml('us-cloud', t('components.insights.aiFlowCloudLabel'), t('components.insights.aiFlowCloudDesc'), settings.cloudLlm);
    html += toggleRowHtml('us-browser', t('components.insights.aiFlowBrowserLabel'), t('components.insights.aiFlowBrowserDesc'), settings.browserModel);
    html += `<div class="ai-flow-toggle-warn" style="display:${settings.browserModel ? 'block' : 'none'}">${t('components.insights.aiFlowBrowserWarn')}</div>`;
    html += `
      <div class="ai-flow-cta">
        <div class="ai-flow-cta-title">${t('components.insights.aiFlowOllamaCta')}</div>
        <div class="ai-flow-cta-desc">${t('components.insights.aiFlowOllamaCtaDesc')}</div>
        <a href="${DESKTOP_RELEASES_URL}" target="_blank" rel="noopener noreferrer" class="ai-flow-cta-link">${t('components.insights.aiFlowDownloadDesktop')}</a>
      </div>
    `;
  }

  html += toggleRowHtml('us-headline-memory', t('components.insights.headlineMemoryLabel'), t('components.insights.headlineMemoryDesc'), settings.headlineMemory);

  html += '</div></details>';

  // ── Media group ──
  html += '<details class="ov-pref-group">';
  html += `<summary>${t('preferences.media')}</summary>`;
  html += '<div class="ov-pref-group-content">';

  const currentQuality = getStreamQuality();
  html += `<div class="ai-flow-toggle-row">
    <div class="ai-flow-toggle-label-wrap">
      <div class="ai-flow-toggle-label">${t('components.insights.streamQualityLabel')}</div>
      <div class="ai-flow-toggle-desc">${t('components.insights.streamQualityDesc')}</div>
    </div>
  </div>`;
  html += '<select class="unified-settings-select" id="us-stream-quality">';
  for (const opt of STREAM_QUALITY_OPTIONS) {
    const selected = opt.value === currentQuality ? ' selected' : '';
    html += `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  html += '</select>';

  html += toggleRowHtml(
    'us-live-streams-always-on',
    t('components.insights.streamAlwaysOnLabel'),
    t('components.insights.streamAlwaysOnDesc'),
    getLiveStreamsAlwaysOn(),
  );

  html += '</div></details>';

  // ── Panels group ──
  html += '<details class="ov-pref-group">';
  html += `<summary>${t('preferences.panels')}</summary>`;
  html += '<div class="ov-pref-group-content">';
  html += toggleRowHtml('us-badge-anim', t('components.insights.badgeAnimLabel'), t('components.insights.badgeAnimDesc'), settings.badgeAnimation);
  html += '</div></details>';

  // ── Data & Community group ──
  html += '<details class="ov-pref-group">';
  html += `<summary>${t('preferences.dataAndCommunity')}</summary>`;
  html += '<div class="ov-pref-group-content">';
  html += `
    <div class="us-data-mgmt">
      <button type="button" class="settings-btn settings-btn-secondary" id="usExportBtn">${t('components.settings.exportSettings')}</button>
      <button type="button" class="settings-btn settings-btn-secondary" id="usImportBtn">${t('components.settings.importSettings')}</button>
      <input type="file" id="usImportInput" accept=".json" class="us-hidden-input" />
    </div>
    <div class="us-data-mgmt-toast" id="usDataMgmtToast"></div>
  `;
  
  html += '</div></details>';

  // ── Accent Color group ──
  html += '<details class="ov-pref-group">';
  html += '<summary>Accent Color</summary>';
  html += '<div class="ov-pref-group-content">';
  html += '<div id="accent-color-picker-mount"></div>';
  html += '</div></details>';

  // ── Color Scheme Builder group (NEW) ──
  html += '<details class="ov-pref-group">';
  html += '<summary>Color Scheme</summary>';
  html += '<div class="ov-pref-group-content">';
  html += '<div class="ai-flow-toggle-desc" style="margin-bottom:10px">';
  html += 'Choose a preset color scheme or build your own. Custom colors overlay the current base theme (dark, light, or tactical). Changes apply in real-time.';
  html += '</div>';
  html += renderColorSchemeBuilder();
  html += '</div></details>';

  // ── Branding group (NEW) ──
  html += '<details class="ov-pref-group">';
  html += '<summary>Branding</summary>';
  html += '<div class="ov-pref-group-content">';
  html += '<div class="ai-flow-toggle-desc" style="margin-bottom:10px">';
  html += 'Customize the platform header, logo, and favicon. Changes persist across sessions.';
  html += '</div>';
  const currentBranding = getStoredBrandingConfig();
  html += '<div class="ai-flow-toggle-row"><div class="ai-flow-toggle-label-wrap"><div class="ai-flow-toggle-label">Header Text</div><div class="ai-flow-toggle-desc">Replaces "MONITOR" in the header bar</div></div></div>';
  html += '<input type="text" class="unified-settings-select" id="branding-header-text" placeholder="MONITOR" value="' + escapeHtml(currentBranding.headerText || '') + '" style="width:100%;font-family:var(--font-mono);font-size:11px;margin-bottom:8px" />';
  html += '<div class="ai-flow-toggle-row"><div class="ai-flow-toggle-label-wrap"><div class="ai-flow-toggle-label">Logo URL</div><div class="ai-flow-toggle-desc">URL to a small logo image (max 32px height)</div></div></div>';
  html += '<input type="text" class="unified-settings-select" id="branding-logo-url" placeholder="https://example.com/logo.png" value="' + escapeHtml(currentBranding.logoUrl || '') + '" style="width:100%;font-family:var(--font-mono);font-size:11px;margin-bottom:8px" />';
  html += '<div class="ai-flow-toggle-row"><div class="ai-flow-toggle-label-wrap"><div class="ai-flow-toggle-label">Favicon URL</div><div class="ai-flow-toggle-desc">URL to a custom favicon (16x16 or 32x32)</div></div></div>';
  html += '<input type="text" class="unified-settings-select" id="branding-favicon-url" placeholder="https://example.com/favicon.ico" value="' + escapeHtml(currentBranding.faviconUrl || '') + '" style="width:100%;font-family:var(--font-mono);font-size:11px;margin-bottom:10px" />';
  html += '<div style="display:flex;gap:8px">';
  html += '<button type="button" class="cs-btn-apply" id="branding-save-btn">Save Branding</button>';
  html += '<button type="button" class="cs-btn-reset" id="branding-reset-btn">Reset to Default</button>';
  html += '</div>';
  html += '</div></details>';

  // ── Watchlist group (NEW) ──
  html += '<details class="ov-pref-group">';
  html += '<summary>Watchlist</summary>';
  html += '<div class="ov-pref-group-content">';
  html += '<div class="ai-flow-toggle-desc" style="margin-bottom:10px">';
  html += 'Track specific countries, people, stocks, or keywords. Watched items are highlighted across the platform.';
  html += '</div>';

  // Add item form
  html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  html += '<select class="unified-settings-select" id="wl-category" style="width:auto;font-size:11px;padding:4px 8px">';
  html += '<option value="country">Country</option>';
  html += '<option value="poi">Person</option>';
  html += '<option value="stock">Stock/Ticker</option>';
  html += '<option value="keyword">Keyword</option>';
  html += '</select>';
  html += '<input type="text" class="unified-settings-select" id="wl-value" placeholder="e.g. UA, AAPL, Putin, drone strike" style="flex:1;min-width:120px;font-size:11px;padding:4px 8px" />';
  html += '<button type="button" class="cs-btn-apply" id="wl-add-btn" style="padding:4px 12px;font-size:11px">+ Add</button>';
  html += '</div>';

  // Current watchlist
  html += '<div id="wl-items-list"></div>';
  html += '<div style="margin-top:8px"><button type="button" class="cs-btn-reset" id="wl-clear-btn" style="font-size:10px;padding:3px 10px">Clear All</button></div>';
  html += '</div></details>';

  // ── Telegram Reports group ──
  html += '<details class="ov-pref-group">';
  html += '<summary>Telegram Reports</summary>';
  html += '<div class="ov-pref-group-content">';
  const tgCfg = getTelegramConfig();
  html += `
    <div class="ai-flow-toggle-desc" style="margin-bottom:10px">
      Send aggregated intelligence reports to a Telegram bot on demand.
      <br><br>
      <b>Setup:</b> Message <code>@BotFather</code> on Telegram, use <code>/newbot</code>, then copy the token.
      Then message your bot and visit
      <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> to find your chat ID.
    </div>
    <div class="ai-flow-toggle-row">
      <div class="ai-flow-toggle-label-wrap">
        <div class="ai-flow-toggle-label">Bot Token</div>
      </div>
    </div>
    <input type="password" class="unified-settings-select" id="tg-bot-token" 
      placeholder="123456789:ABCdef..." value="${tgCfg?.botToken ?? ''}" 
      style="width:100%;font-family:var(--font-mono);font-size:11px;margin-bottom:8px" />
    <div class="ai-flow-toggle-row">
      <div class="ai-flow-toggle-label-wrap">
        <div class="ai-flow-toggle-label">Chat ID</div>
      </div>
    </div>
    <input type="text" class="unified-settings-select" id="tg-chat-id" 
      placeholder="-1001234567890" value="${tgCfg?.chatId ?? ''}"
      style="width:100%;font-family:var(--font-mono);font-size:11px;margin-bottom:10px" />
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="settings-btn settings-btn-secondary" id="tg-test-btn">Test</button>
      <button type="button" class="settings-btn settings-btn-secondary" id="tg-save-btn">Save</button>
      <button type="button" class="settings-btn settings-btn-secondary" id="tg-send-btn">Send Report</button>
      ${tgCfg ? '<button type="button" class="settings-btn settings-btn-secondary" id="tg-disconnect-btn" style="color:#ff4455">Disconnect</button>' : ''}
    </div>
    <div id="tg-status-msg" style="font-size:11px;margin-top:8px"></div>
  `;
  html += '</div></details>';

  // AI status footer (web-only)
  if (!host.isDesktopApp) {
    html += '<div class="ai-flow-popup-footer"><span class="ai-flow-status-dot" id="usStatusDot"></span><span class="ai-flow-status-text" id="usStatusText"></span></div>';
  }

  return {
    html,
    attach(container: HTMLElement): () => void {
      const ac = new AbortController();
      const { signal } = ac;

      container.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;

        if (target.id === 'usImportInput') {
          const file = target.files?.[0];
          if (!file) return;
          importSettings(file).then((result: ImportResult) => {
            showToast(container, t('components.settings.importSuccess', { count: String(result.keysImported) }), true);
          }).catch(() => {
            showToast(container, t('components.settings.importFailed'), false);
          });
          target.value = '';
          return;
        }

        if (target.id === 'us-stream-quality') {
          setStreamQuality(target.value as StreamQuality);
          return;
        }
        if (target.id === 'us-globe-visual-preset') {
          setGlobeVisualPreset(target.value as GlobeVisualPreset);
          return;
        }
        if (target.id === 'us-theme') {
          setThemePreference(target.value as ThemePreference);
          // Update color editor swatches to show current computed values
          updateColorEditorFromComputed(container);
          return;
        }
        if (target.id === 'us-font-family') {
          setFontFamily(target.value as FontFamily);
          return;
        }
        if (target.id === 'us-map-provider') {
          const provider = target.value as MapProvider;
          setMapProvider(provider);
          renderMapThemeDropdown(container, provider);
          host.onMapProviderChange?.(provider);
          window.dispatchEvent(new CustomEvent('map-theme-changed'));
          return;
        }
        if (target.id === 'us-map-theme') {
          const provider = getMapProvider();
          setMapTheme(provider, target.value);
          window.dispatchEvent(new CustomEvent('map-theme-changed'));
          return;
        }
        if (target.id === 'us-live-streams-always-on') {
          setLiveStreamsAlwaysOn(target.checked);
          return;
        }
        if (target.id === 'us-language') {
          trackLanguageChange(target.value);
          void changeLanguage(target.value);
          return;
        }
        if (target.id === 'us-cloud') {
          setAiFlowSetting('cloudLlm', target.checked);
          updateAiStatus(container);
        } else if (target.id === 'us-browser') {
          setAiFlowSetting('browserModel', target.checked);
          const warn = container.querySelector('.ai-flow-toggle-warn') as HTMLElement;
          if (warn) warn.style.display = target.checked ? 'block' : 'none';
          updateAiStatus(container);
        } else if (target.id === 'us-map-flash') {
          setAiFlowSetting('mapNewsFlash', target.checked);
        } else if (target.id === 'us-headline-memory') {
          setAiFlowSetting('headlineMemory', target.checked);
        } else if (target.id === 'us-badge-anim') {
          setAiFlowSetting('badgeAnimation', target.checked);
        }

        // Color editor swatch change — live preview
        if (target.classList.contains('color-editor-swatch')) {
          const varName = target.dataset.csVar;
          if (varName) {
            const valLabel = container.querySelector(`[data-cs-val="${varName}"]`);
            if (valLabel) valLabel.textContent = target.value;
            // Live-preview: set the CSS variable immediately
            document.documentElement.style.setProperty('--' + varName, target.value);
          }
        }
      }, { signal });

      container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('#usExportBtn')) {
          try {
            exportSettings();
            showToast(container, t('components.settings.exportSuccess'), true);
          } catch {
            showToast(container, t('components.settings.exportFailed'), false);
          }
          return;
        }
        if (target.closest('#usImportBtn')) {
          container.querySelector<HTMLInputElement>('#usImportInput')?.click();
          return;
        }

        // ── Color scheme preset click ──
        const presetBtn = target.closest<HTMLElement>('[data-cs-preset]');
        if (presetBtn) {
          const idx = parseInt(presetBtn.dataset.csPreset ?? '0', 10);
          const preset = CUSTOM_SCHEME_PRESETS[idx];
          if (preset) {
            // Apply the preset: switch to its base theme, then save the scheme
            setThemePreference(preset.base);
            saveCustomScheme(preset);

            // Update the theme dropdown to match
            const themeSelect = container.querySelector<HTMLSelectElement>('#us-theme');
            if (themeSelect) themeSelect.value = preset.base;

            // Highlight the active preset button
            container.querySelectorAll('.color-scheme-preset').forEach(b => b.classList.remove('active'));
            presetBtn.classList.add('active');

            // Update the color editor swatches
            updateColorEditorFromScheme(container, preset);
          }
          return;
        }

        // ── Apply custom colors button ──
        if (target.closest('#cs-apply-btn')) {
          const overrides: Record<string, string> = {};
          container.querySelectorAll<HTMLInputElement>('.color-editor-swatch[data-cs-var]').forEach(swatch => {
            const varName = swatch.dataset.csVar;
            if (varName) {
              const swatchVal = swatch.value;
              // Only save if the swatch has been changed from default
              // We include it if user has interacted (color input always has a value)
              if (swatchVal && swatchVal !== '#000000') {
                overrides[varName] = swatchVal;
              }
            }
          });

          const currentTheme = getCurrentTheme();
          const scheme: CustomColorScheme = {
            name: 'Custom',
            base: currentTheme,
            overrides,
          };
          saveCustomScheme(scheme);

          // Clear preset highlights
          container.querySelectorAll('.color-scheme-preset').forEach(b => b.classList.remove('active'));
          return;
        }

        // ── Reset button ──
        if (target.closest('#cs-reset-btn')) {
          clearCustomScheme();
          // Re-apply current theme cleanly
          const currentTheme = getCurrentTheme();
          setThemePreference(currentTheme);

          // Reset all swatch values to computed
          updateColorEditorFromComputed(container);

          // Clear preset highlights
          container.querySelectorAll('.color-scheme-preset').forEach(b => b.classList.remove('active'));
          return;
        }
      }, { signal });

      // Mount accent color picker
      const accentMount = container.querySelector('#accent-color-picker-mount');
      if (accentMount) {
        const picker = createAccentColorPicker();
        accentMount.appendChild(picker);
      }

      // Initialize color editor swatches with current computed values
      updateColorEditorFromComputed(container);

      // Highlight active preset if one is stored
      const storedScheme = getStoredCustomScheme();
      if (storedScheme) {
        const presetIndex = CUSTOM_SCHEME_PRESETS.findIndex(p => p.name === storedScheme.name);
        if (presetIndex >= 0) {
          const btn = container.querySelector(`[data-cs-preset="${presetIndex}"]`);
          if (btn) btn.classList.add('active');
        }
      }

      // Branding button handlers
      container.querySelector('#branding-save-btn')?.addEventListener('click', () => {
        const headerText = (container.querySelector('#branding-header-text') as HTMLInputElement)?.value?.trim() || '';
        const logoUrl = (container.querySelector('#branding-logo-url') as HTMLInputElement)?.value?.trim() || '';
        const faviconUrl = (container.querySelector('#branding-favicon-url') as HTMLInputElement)?.value?.trim() || '';
        saveBranding({ headerText: headerText || undefined, logoUrl: logoUrl || undefined, faviconUrl: faviconUrl || undefined });
      }, { signal });

      container.querySelector('#branding-reset-btn')?.addEventListener('click', () => {
        clearBranding();
        const headerInput = container.querySelector('#branding-header-text') as HTMLInputElement;
        const logoInput = container.querySelector('#branding-logo-url') as HTMLInputElement;
        const faviconInput = container.querySelector('#branding-favicon-url') as HTMLInputElement;
        if (headerInput) headerInput.value = '';
        if (logoInput) logoInput.value = '';
        if (faviconInput) faviconInput.value = '';
      }, { signal });

      // Watchlist handlers
      const renderWatchlistItems = () => {
        const listEl = container.querySelector('#wl-items-list');
        if (!listEl) return;
        const items = getWatchlist();
        if (items.length === 0) {
          listEl.innerHTML = '<div style="font-size:11px;color:var(--text-dim,#888);padding:4px 0">No items in watchlist</div>';
          return;
        }
        const categoryIcons: Record<string, string> = { country: '\uD83C\uDF0D', poi: '\uD83D\uDC64', stock: '\uD83D\uDCC8', keyword: '\uD83D\uDD0D' };
        listEl.innerHTML = items.map(item =>
          '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px">'
          + '<span style="width:16px;text-align:center">' + (categoryIcons[item.category] || '') + '</span>'
          + '<span style="color:var(--text-secondary,#ccc);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(item.label) + '</span>'
          + '<span style="color:var(--text-dim,#888);font-size:9px;text-transform:uppercase">' + escapeHtml(item.category) + '</span>'
          + '<button data-wl-remove="' + escapeHtml(item.id) + '" style="background:none;border:none;color:var(--text-muted,#666);cursor:pointer;font-size:14px;padding:0 4px" title="Remove">&times;</button>'
          + '</div>'
        ).join('');
      };
      renderWatchlistItems();

      container.querySelector('#wl-add-btn')?.addEventListener('click', () => {
        const catEl = container.querySelector('#wl-category') as HTMLSelectElement;
        const valEl = container.querySelector('#wl-value') as HTMLInputElement;
        const cat = (catEl?.value || 'keyword') as WatchlistCategory;
        const val = valEl?.value?.trim();
        if (!val) return;
        addToWatchlist(cat, val, val);
        if (valEl) valEl.value = '';
        renderWatchlistItems();
      }, { signal });

      container.addEventListener('click', (e) => {
        const removeBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-wl-remove]');
        if (removeBtn?.dataset.wlRemove) {
          removeFromWatchlist(removeBtn.dataset.wlRemove);
          renderWatchlistItems();
        }
      }, { signal });

      container.querySelector('#wl-clear-btn')?.addEventListener('click', () => {
        clearWatchlist();
        renderWatchlistItems();
      }, { signal });

      // Telegram button handlers
      const tgStatus = container.querySelector('#tg-status-msg') as HTMLElement | null;
      const showTgStatus = (msg: string, ok: boolean) => {
        if (tgStatus) {
          tgStatus.textContent = msg;
          tgStatus.style.color = ok ? '#1aff8a' : '#ff4455';
        }
      };

      container.querySelector('#tg-save-btn')?.addEventListener('click', () => {
        const token = (container.querySelector('#tg-bot-token') as HTMLInputElement)?.value?.trim();
        const chatId = (container.querySelector('#tg-chat-id') as HTMLInputElement)?.value?.trim();
        if (!token || !chatId) { showTgStatus('Fill in both fields', false); return; }
        saveTelegramConfig({ botToken: token, chatId });
        showTgStatus('Saved!', true);
      }, { signal });

      container.querySelector('#tg-test-btn')?.addEventListener('click', async () => {
        const token = (container.querySelector('#tg-bot-token') as HTMLInputElement)?.value?.trim();
        const chatId = (container.querySelector('#tg-chat-id') as HTMLInputElement)?.value?.trim();
        if (!token || !chatId) { showTgStatus('Fill in both fields first', false); return; }
        showTgStatus('Sending test...', true);
        const res = await testTelegramConnection(token, chatId);
        if (res.ok) {
          saveTelegramConfig({ botToken: token, chatId });
          showTgStatus('Test message sent! Check Telegram.', true);
        } else {
          showTgStatus(res.error ?? 'Failed', false);
        }
      }, { signal });

      container.querySelector('#tg-send-btn')?.addEventListener('click', async () => {
        const token = (container.querySelector('#tg-bot-token') as HTMLInputElement)?.value?.trim();
        const chatId = (container.querySelector('#tg-chat-id') as HTMLInputElement)?.value?.trim();
        if (!token || !chatId) { showTgStatus('Save your config first', false); return; }
        showTgStatus('Generating report...', true);
        const res = await sendReport({ botToken: token, chatId });
        showTgStatus(res.ok ? 'Report sent!' : (res.error ?? 'Failed'), res.ok);
      }, { signal });

      container.querySelector('#tg-disconnect-btn')?.addEventListener('click', () => {
        clearTelegramConfig();
        (container.querySelector('#tg-bot-token') as HTMLInputElement).value = '';
        (container.querySelector('#tg-chat-id') as HTMLInputElement).value = '';
        showTgStatus('Disconnected', true);
        const btn = container.querySelector('#tg-disconnect-btn') as HTMLElement;
        if (btn) btn.style.display = 'none';
      }, { signal });

      if (!host.isDesktopApp) updateAiStatus(container);

      return () => ac.abort();
    },
  };
}

// ────────────────────────────────────────────────────────────
// Color editor helpers
// ────────────────────────────────────────────────────────────

/**
 * Read current computed CSS variable values and populate the
 * color editor swatches with them.
 */
function updateColorEditorFromComputed(container: HTMLElement): void {
  const style = getComputedStyle(document.documentElement);
  container.querySelectorAll<HTMLInputElement>('.color-editor-swatch[data-cs-var]').forEach(swatch => {
    const varName = swatch.dataset.csVar;
    if (!varName) return;
    const raw = style.getPropertyValue('--' + varName).trim();
    const hex = cssColorToHex(raw);
    if (hex) {
      swatch.value = hex;
      const valLabel = container.querySelector(`[data-cs-val="${varName}"]`);
      if (valLabel) valLabel.textContent = hex;
    }
  });
}

/**
 * Populate color editor swatches from a CustomColorScheme's overrides.
 */
function updateColorEditorFromScheme(container: HTMLElement, scheme: CustomColorScheme): void {
  // First update from computed (which now includes the scheme)
  // Small delay to let CSS variables propagate
  requestAnimationFrame(() => {
    updateColorEditorFromComputed(container);
    // Then overwrite with the scheme's explicit overrides
    for (const [varName, value] of Object.entries(scheme.overrides)) {
      const swatch = container.querySelector<HTMLInputElement>(`.color-editor-swatch[data-cs-var="${varName}"]`);
      if (swatch) {
        const hex = cssColorToHex(value);
        if (hex) {
          swatch.value = hex;
          const valLabel = container.querySelector(`[data-cs-val="${varName}"]`);
          if (valLabel) valLabel.textContent = hex;
        }
      }
    }
  });
}

/**
 * Convert a CSS color string (hex, rgb, named) to a 6-digit hex string.
 * Returns null if parsing fails.
 */
function cssColorToHex(color: string): string | null {
  if (!color) return null;

  // Already hex
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const r = color[1]!, g = color[2]!, b = color[3]!;
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }

  // rgb/rgba
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  // Use a hidden element to resolve named colors
  try {
    const el = document.createElement('div');
    el.style.color = color;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    const m = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      return '#' + [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)]
        .map(c => c.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* noop */ }

  return null;
}

function showToast(container: HTMLElement, msg: string, success: boolean): void {
  const toast = container.querySelector('#usDataMgmtToast');
  if (!toast) return;
  toast.className = `us-data-mgmt-toast ${success ? 'ok' : 'error'}`;
  toast.innerHTML = success
    ? `${escapeHtml(msg)} <a href="#" class="us-toast-reload">${t('components.settings.reloadNow')}</a>`
    : escapeHtml(msg);
  toast.querySelector('.us-toast-reload')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });
}
