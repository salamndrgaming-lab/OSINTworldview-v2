// Monitor Browser chrome renderer.
// Renders tab strip + URL bar + nav controls, driven by tab snapshots
// pushed from the main process via preload (`window.browser.*`).

'use strict';

(function () {
  const browser = window.browser;
  if (!browser) {
    // Preload didn't attach — dev surface the error so it's obvious.
    document.body.innerHTML =
      '<pre style="padding:24px;color:#ff4e4e;font-family:monospace">' +
      'window.browser is not defined — preload failed to attach.' +
      '</pre>';
    return;
  }

  // ------------------------------------------------------------------
  // Element refs
  // ------------------------------------------------------------------

  const tabsEl = /** @type {HTMLElement} */ (document.getElementById('tabs'));
  const newTabBtn = /** @type {HTMLButtonElement} */ (document.getElementById('new-tab'));
  const backBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nav-back'));
  const fwdBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nav-forward'));
  const reloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nav-reload'));
  const homeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nav-home'));
  const devtoolsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('action-devtools'));
  const urlForm = /** @type {HTMLFormElement} */ (document.getElementById('url-form'));
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('url-input'));
  const urlWrap = /** @type {HTMLElement} */ (urlInput.parentElement);
  const urlScheme = /** @type {HTMLElement} */ (document.getElementById('url-scheme'));
  const wbMin = /** @type {HTMLButtonElement} */ (document.getElementById('wb-min'));
  const wbMax = /** @type {HTMLButtonElement} */ (document.getElementById('wb-max'));
  const wbClose = /** @type {HTMLButtonElement} */ (document.getElementById('wb-close'));

  // ------------------------------------------------------------------
  // State (mirror of main-process truth)
  // ------------------------------------------------------------------

  /** @type {Array<{id:string,url:string,title:string,favicon:string|null,isLoading:boolean,canGoBack:boolean,canGoForward:boolean,isHomepage:boolean}>} */
  let tabs = [];
  /** @type {string | null} */
  let activeId = null;
  let urlBarDirty = false; // true when user is typing; don't clobber their input

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function render() {
    renderTabs();
    renderNavState();
    renderUrlBar();
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const tab of tabs) {
      tabsEl.appendChild(buildTabEl(tab));
    }
  }

  function buildTabEl(tab) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.tabId = tab.id;
    if (tab.id === activeId) el.classList.add('is-active');

    const favicon = document.createElement('span');
    favicon.className = 'tab-favicon';
    if (tab.isLoading) {
      favicon.classList.add('is-loading');
    } else if (tab.favicon) {
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.alt = '';
      img.onerror = () => {
        favicon.textContent = tab.isHomepage ? '◉' : '○';
      };
      favicon.appendChild(img);
    } else {
      favicon.textContent = tab.isHomepage ? '◉' : '○';
    }
    el.appendChild(favicon);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.isHomepage && tab.title === 'New Tab'
      ? 'Monitor Home'
      : tab.title || prettyUrl(tab.url);
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.title = 'Close tab';
    close.setAttribute('aria-label', 'Close tab');
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      browser.closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => {
      if (tab.id !== activeId) browser.switchTab(tab.id);
    });

    el.addEventListener('auxclick', (e) => {
      // Middle-click closes tab.
      if (e.button === 1) browser.closeTab(tab.id);
    });

    return el;
  }

  function renderNavState() {
    const active = tabs.find((t) => t.id === activeId);
    backBtn.disabled = !active || !active.canGoBack;
    fwdBtn.disabled = !active || !active.canGoForward;
    reloadBtn.disabled = !active;
    homeBtn.disabled = !active;
    devtoolsBtn.disabled = !active;
  }

  function renderUrlBar() {
    const active = tabs.find((t) => t.id === activeId);
    if (!active) {
      if (!urlBarDirty) urlInput.value = '';
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '⌕';
      return;
    }

    if (!urlBarDirty && document.activeElement !== urlInput) {
      urlInput.value = formatUrlForDisplay(active.url, active.isHomepage);
    }

    if (active.isHomepage) {
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '◉';
    } else if (active.url.startsWith('https://')) {
      urlWrap.setAttribute('data-secure', 'true');
      urlScheme.textContent = '⬢';
    } else if (active.url.startsWith('http://')) {
      urlWrap.setAttribute('data-secure', 'false');
      urlScheme.textContent = '!';
    } else {
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '⌕';
    }
  }

  function formatUrlForDisplay(url, isHomepage) {
    if (isHomepage) return '';
    return url;
  }

  function prettyUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '') || 'New Tab';
    } catch {
      return 'New Tab';
    }
  }

  // ------------------------------------------------------------------
  // User input handlers
  // ------------------------------------------------------------------

  newTabBtn.addEventListener('click', () => browser.newTab());

  backBtn.addEventListener('click', () => browser.back());
  fwdBtn.addEventListener('click', () => browser.forward());
  reloadBtn.addEventListener('click', () => browser.reload());
  homeBtn.addEventListener('click', () => browser.home());
  devtoolsBtn.addEventListener('click', () => browser.devtools());

  wbMin.addEventListener('click', () => browser.minimize());
  wbMax.addEventListener('click', () => browser.maximizeToggle());
  wbClose.addEventListener('click', () => browser.closeWindow());

  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = urlInput.value.trim();
    if (!value) return;
    browser.navigate(null, value);
    urlBarDirty = false;
    urlInput.blur();
  });

  urlInput.addEventListener('focus', () => {
    urlInput.select();
  });

  urlInput.addEventListener('input', () => {
    urlBarDirty = true;
  });

  urlInput.addEventListener('blur', () => {
    urlBarDirty = false;
    // Restore displayed URL to canonical form.
    renderUrlBar();
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      urlBarDirty = false;
      urlInput.blur();
      renderUrlBar();
    }
  });

  // ------------------------------------------------------------------
  // Global keyboard shortcuts
  // ------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F5') {
      e.preventDefault();
      browser.reload();
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      browser.back();
      return;
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      browser.forward();
      return;
    }
    if (!mod) return;
    const key = e.key.toLowerCase();
    switch (key) {
      case 't':
        e.preventDefault();
        browser.newTab();
        break;
      case 'w':
        e.preventDefault();
        if (activeId) browser.closeTab(activeId);
        break;
      case 'l':
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
        break;
      case 'r':
        e.preventDefault();
        browser.reload();
        break;
      case 'tab':
        // Ctrl+Tab → next tab
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        break;
      default:
        break;
    }
  });

  function cycleTab(dir) {
    if (tabs.length === 0 || !activeId) return;
    const idx = tabs.findIndex((t) => t.id === activeId);
    if (idx < 0) return;
    const next = (idx + dir + tabs.length) % tabs.length;
    browser.switchTab(tabs[next].id);
  }

  // ------------------------------------------------------------------
  // Receive main-process tab snapshots
  // ------------------------------------------------------------------

  browser.onTabsUpdated((payload) => {
    tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    activeId = payload.activeId ?? null;
    render();
  });

  // ------------------------------------------------------------------
  // Settings + Theme
  // ------------------------------------------------------------------

  const settingsBtn = document.getElementById('action-settings');
  const settingsOverlay = document.getElementById('settings-overlay');

  let currentSettings = {};
  let settingsMeta = { searchEngines: {}, themes: {} };

  function applyThemeToChrome(name) {
    document.documentElement.dataset.theme = name || 'amber';
  }

  // Load initial settings.
  browser.getSettings().then((res) => {
    currentSettings = res.settings || {};
    settingsMeta = { searchEngines: res.searchEngines || {}, themes: res.themes || {} };
    applyThemeToChrome(currentSettings.theme);
  }).catch(() => {});

  browser.onSettingsChanged((s) => {
    currentSettings = s || currentSettings;
    applyThemeToChrome(currentSettings.theme);
  });

  settingsBtn.addEventListener('click', () => openSettings());

  function openSettings() {
    settingsOverlay.classList.remove('hidden');

    const engines = Object.entries(settingsMeta.searchEngines);
    const themes = Object.entries(settingsMeta.themes);

    settingsOverlay.innerHTML =
      '<div class="settings-card">' +
      '  <header class="settings-head">' +
      '    <h2>Settings</h2>' +
      '    <button class="settings-close" id="settings-close" title="Close">&times;</button>' +
      '  </header>' +
      '  <div class="settings-body">' +
      '    <section class="settings-section">' +
      '      <h3>Search engine</h3>' +
      '      <select id="set-engine">' +
             engines.map(([k, v]) =>
               '<option value="' + k + '"' + (currentSettings.searchEngine === k ? ' selected' : '') + '>' +
               v.label + '</option>'
             ).join('') +
      '      </select>' +
      '    </section>' +
      '    <section class="settings-section">' +
      '      <h3>Theme</h3>' +
      '      <div class="theme-grid" id="theme-grid">' +
             themes.map(([k, v]) =>
               '<button class="theme-swatch' + (currentSettings.theme === k ? ' is-active' : '') +
               '" data-theme="' + k + '" style="--swatch:' + v.accent + '">' +
               '<span class="swatch-dot"></span>' + v.label + '</button>'
             ).join('') +
      '      </div>' +
      '    </section>' +
      '    <section class="settings-section">' +
      '      <h3>Browser branding</h3>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-branding"' +
             (currentSettings.showBranding !== false ? ' checked' : '') +
      '       /> Show MonitorBrowser/1.0 in user-agent</label>' +
      '    </section>' +
      '    <section class="settings-section">' +
      '      <h3>Data</h3>' +
      '      <button class="settings-btn" id="clear-data">Clear browsing data</button>' +
      '      <button class="settings-btn" id="reset-settings">Reset all settings</button>' +
      '    </section>' +
      '  </div>' +
      '</div>';

    document.getElementById('settings-close').addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) closeSettings();
    });

    document.getElementById('set-engine').addEventListener('change', (e) => {
      browser.setSettings({ searchEngine: e.target.value });
    });

    document.querySelectorAll('#theme-grid .theme-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#theme-grid .theme-swatch').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        browser.setSettings({ theme: btn.dataset.theme });
      });
    });

    document.getElementById('set-branding').addEventListener('change', (e) => {
      browser.setSettings({ showBranding: e.target.checked });
    });

    document.getElementById('clear-data').addEventListener('click', () => {
      browser.clearBrowsingData().then((ok) => {
        document.getElementById('clear-data').textContent = ok ? 'Done!' : 'Failed';
      });
    });

    document.getElementById('reset-settings').addEventListener('click', () => {
      browser.resetSettings().then(() => closeSettings());
    });
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
    settingsOverlay.innerHTML = '';
  }
})();
