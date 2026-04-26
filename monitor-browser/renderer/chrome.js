// Monitor Browser chrome renderer.
// Renders tab strip + URL bar + nav controls, driven by tab snapshots
// pushed from the main process via preload (`window.browser.*`).

'use strict';

(function () {
  // Captured once when the chrome renderer loads, so the profile panel can
  // show how long the operator has been working in the current launch.
  const SESSION_STARTED_AT = Date.now();
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
      if (e.button === 1) browser.closeTab(tab.id);
    });

    // Drag-to-reorder
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      document.querySelectorAll('.tab.drag-over').forEach((t) => t.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== tab.id) {
        browser.reorderTab(fromId, tab.id);
      }
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

  let credBadgeEl = null;

  function renderUrlBar() {
    const active = tabs.find((t) => t.id === activeId);
    if (!active) {
      if (!urlBarDirty) urlInput.value = '';
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '⌕';
      removeCredBadge();
      return;
    }

    if (!urlBarDirty && document.activeElement !== urlInput) {
      urlInput.value = formatUrlForDisplay(active.url, active.isHomepage);
    }

    if (active.isHomepage) {
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '◉';
      removeCredBadge();
    } else if (active.url.startsWith('https://')) {
      urlWrap.setAttribute('data-secure', 'true');
      urlScheme.textContent = '⬢';
      updateCredBadge(active.url);
    } else if (active.url.startsWith('http://')) {
      urlWrap.setAttribute('data-secure', 'false');
      urlScheme.textContent = '!';
      updateCredBadge(active.url);
    } else {
      urlWrap.removeAttribute('data-secure');
      urlScheme.textContent = '⌕';
      removeCredBadge();
    }
  }

  function removeCredBadge() {
    if (credBadgeEl) { credBadgeEl.remove(); credBadgeEl = null; }
  }

  function updateCredBadge(url) {
    browser.getCredibility(url).then((data) => {
      if (!data || data.tier === 'unknown') { removeCredBadge(); return; }
      const colors = { high: '#2ecc71', medium: '#d4a843', low: '#ff4e4e', government: '#4a90e2' };
      const labels = { high: 'HIGH', medium: 'MED', low: 'LOW', government: 'GOV' };
      if (!credBadgeEl) {
        credBadgeEl = document.createElement('span');
        credBadgeEl.className = 'cred-badge';
        urlWrap.appendChild(credBadgeEl);
      }
      credBadgeEl.textContent = labels[data.tier] || '';
      credBadgeEl.style.setProperty('--cred-color', colors[data.tier] || '#606070');
      credBadgeEl.title = 'Source credibility: ' + (data.tier || 'unknown');
    }).catch(() => removeCredBadge());
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

  const readerBtn = document.getElementById('action-reader');
  const pipBtn = document.getElementById('action-pip');
  readerBtn.addEventListener('click', () => openReaderMode());
  pipBtn.addEventListener('click', () => browser.pip());

  document.getElementById('action-intel').addEventListener('click', () => toggleIntelSidebar());
  document.getElementById('action-bookmarks').addEventListener('click', () => togglePanel('bookmarks'));
  document.getElementById('action-history').addEventListener('click', () => togglePanel('history'));
  document.getElementById('action-downloads').addEventListener('click', () => togglePanel('downloads'));
  document.getElementById('action-extensions').addEventListener('click', () => togglePanel('extensions'));
  document.getElementById('action-profile').addEventListener('click', () => togglePanel('profile'));

  urlScheme.addEventListener('click', () => showSecurityPopup());
  urlScheme.style.cursor = 'pointer';

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
    showAutocompleteSuggestions(urlInput.value.trim());
  });

  urlInput.addEventListener('blur', () => {
    setTimeout(() => { hideAutocomplete(); }, 150);
    urlBarDirty = false;
    renderUrlBar();
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (acDropdown && !acDropdown.classList.contains('hidden')) {
        hideAutocomplete();
        return;
      }
      urlBarDirty = false;
      urlInput.blur();
      renderUrlBar();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
    if (e.key === 'Enter' && acSelectedIdx >= 0) {
      e.preventDefault();
      acCommit();
      return;
    }
  });

  // ------------------------------------------------------------------
  // URL autocomplete
  // ------------------------------------------------------------------

  let acDropdown = null;
  let acItems = [];
  let acSelectedIdx = -1;
  let acDebounce = null;

  function ensureAcDropdown() {
    if (acDropdown) return;
    acDropdown = document.createElement('div');
    acDropdown.className = 'ac-dropdown hidden';
    urlWrap.parentElement.appendChild(acDropdown);
  }

  function hideAutocomplete() {
    if (acDropdown) acDropdown.classList.add('hidden');
    acItems = [];
    acSelectedIdx = -1;
  }

  function showAutocompleteSuggestions(query) {
    if (!query || query.length < 2) { hideAutocomplete(); return; }
    clearTimeout(acDebounce);
    acDebounce = setTimeout(() => fetchSuggestions(query), 120);
  }

  async function fetchSuggestions(query) {
    const [bookmarks, history] = await Promise.all([
      browser.bookmarksList().catch(() => []),
      browser.historyList(query, 20).catch(() => []),
    ]);

    const q = query.toLowerCase();
    const bmMatches = bookmarks
      .filter((b) => ((b.title || '') + ' ' + b.url).toLowerCase().includes(q))
      .slice(0, 5)
      .map((b) => ({ title: b.title || b.url, url: b.url, type: 'bookmark' }));

    const histMatches = history
      .slice(0, 10)
      .map((h) => ({ title: h.title || h.url, url: h.url, type: 'history' }));

    const seen = new Set();
    const merged = [];
    for (const item of bmMatches.concat(histMatches)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= 8) break;
    }

    if (merged.length === 0) { hideAutocomplete(); return; }

    ensureAcDropdown();
    acItems = merged;
    acSelectedIdx = -1;
    acDropdown.classList.remove('hidden');
    const credChecks = merged.map((item) => browser.getCredibility(item.url).catch(() => ({ tier: 'unknown' })));
    const creds = await Promise.all(credChecks);
    const credColors = { high: '#2ecc71', medium: '#d4a843', low: '#ff4e4e', government: '#4a90e2' };
    const credLabels = { high: 'HIGH', medium: 'MED', low: 'LOW', government: 'GOV' };

    acDropdown.innerHTML = merged.map((item, i) => {
      const cred = creds[i]?.tier;
      const credHtml = cred && cred !== 'unknown'
        ? '<span class="ac-cred" style="color:' + (credColors[cred] || '') + '">' + (credLabels[cred] || '') + '</span>'
        : '';
      return '<div class="ac-item" data-idx="' + i + '">' +
        '<span class="ac-icon">' + (item.type === 'bookmark' ? '★' : '↻') + '</span>' +
        '<span class="ac-title">' + esc(item.title) + '</span>' +
        credHtml +
        '<span class="ac-url">' + esc(shortUrl(item.url)) + '</span>' +
        '</div>';
    }).join('');

    acDropdown.querySelectorAll('.ac-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        acSelectedIdx = parseInt(el.dataset.idx, 10);
        acCommit();
      });
    });
  }

  function acMove(dir) {
    if (!acDropdown || acItems.length === 0) return;
    acSelectedIdx = (acSelectedIdx + dir + acItems.length) % acItems.length;
    acDropdown.querySelectorAll('.ac-item').forEach((el, i) => {
      el.classList.toggle('is-selected', i === acSelectedIdx);
    });
    urlInput.value = acItems[acSelectedIdx].url;
  }

  function acCommit() {
    if (acSelectedIdx < 0 || acSelectedIdx >= acItems.length) return;
    const url = acItems[acSelectedIdx].url;
    hideAutocomplete();
    urlBarDirty = false;
    urlInput.value = url;
    urlInput.blur();
    browser.navigate(null, url);
  }

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
    if (e.key === 'F11') {
      e.preventDefault();
      browser.fullscreen();
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
        if (e.shiftKey) browser.reopenTab();
        else browser.newTab();
        break;
      case 'n':
        if (e.shiftKey) { e.preventDefault(); browser.incognito(); }
        break;
      case 'w':
        e.preventDefault();
        if (activeId) browser.closeTab(activeId);
        break;
      case 'a':
        if (e.shiftKey) { e.preventDefault(); openTabSearch(); }
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
      case 'f':
        e.preventDefault();
        openFindBar();
        break;
      case 'p':
        e.preventDefault();
        if (e.shiftKey) browser.savePdf();
        else browser.print();
        break;
      case 'd':
        e.preventDefault();
        bookmarkCurrentPage();
        break;
      case 'i':
        e.preventDefault();
        toggleIntelSidebar();
        break;
      case 'o':
        if (e.shiftKey) { e.preventDefault(); openQuickOsintLookup(); }
        break;
      case 'e':
        if (e.shiftKey) { e.preventDefault(); openReaderMode(); }
        break;
      case 'h':
        if (e.shiftKey) { e.preventDefault(); togglePanel('history'); }
        break;
      case 'j':
        e.preventDefault();
        togglePanel('downloads');
        break;
      case 'm':
        if (e.shiftKey) { e.preventDefault(); browser.muteAll(); }
        break;
      case 'y':
        if (e.shiftKey) { e.preventDefault(); openOperationSwitcher(); }
        break;
      case 'b':
        if (e.shiftKey) { e.preventDefault(); togglePanel('bookmarks'); }
        else { e.preventDefault(); toggleIntelSidebar(); }
        break;
      case '=':
      case '+':
        e.preventDefault();
        browser.zoomIn();
        break;
      case '-':
        e.preventDefault();
        browser.zoomOut();
        break;
      case '0':
        e.preventDefault();
        browser.zoomReset();
        break;
      case 'tab':
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        break;
      default:
        // Ctrl+1..9 — switch to tab N
        if (key >= '1' && key <= '9') {
          e.preventDefault();
          const idx = key === '9' ? tabs.length - 1 : parseInt(key, 10) - 1;
          if (idx >= 0 && idx < tabs.length) browser.switchTab(tabs[idx].id);
        }
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
  // Receive main-process tab snapshots (single listener, uses enhanced render)
  // ------------------------------------------------------------------

  browser.onTabsUpdated((payload) => {
    tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    activeId = payload.activeId ?? null;
    renderEnhanced();
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

  const wordmarkEl = document.querySelector('.wordmark');

  function applyIncognitoMode(isIncognito) {
    if (isIncognito) {
      document.body.classList.add('is-incognito');
      if (wordmarkEl) wordmarkEl.textContent = 'PRIVATE';
    }
  }

  function applyVpnBadge(vpnStatus) {
    const badge = document.getElementById('vpn-badge');
    const label = document.getElementById('vpn-label');
    const dot = badge ? badge.querySelector('.vpn-dot') : null;
    if (!badge || !label) return;

    badge.classList.remove('off', 'connecting', 'error');

    const status = vpnStatus.status || 'disconnected';
    const loc = vpnStatus.location || 'Auto';

    if (status === 'connected') {
      label.textContent = loc === 'Auto' ? 'Secure' : loc;
      let tooltip = 'VPN Connected';
      if (vpnStatus.proxyRule) tooltip += ' — ' + vpnStatus.proxyRule;
      if (vpnStatus.exitIp) tooltip += ' (exit: ' + vpnStatus.exitIp + ')';
      badge.title = tooltip;
    } else if (status === 'connecting') {
      badge.classList.add('connecting');
      label.textContent = 'Connecting…';
      badge.title = 'Connecting to VPN…';
    } else if (status === 'error') {
      badge.classList.add('error');
      label.textContent = 'VPN Error';
      badge.title = vpnStatus.error || 'Connection failed';
    } else {
      badge.classList.add('off');
      label.textContent = 'VPN Off';
      badge.title = 'VPN Disconnected';
    }
  }

  function applyVpnBadgeFromSettings(s) {
    const enabled = s.vpnEnabled !== false;
    const loc = s.vpnLocation || 'Auto';
    applyVpnBadge({
      status: enabled ? 'connected' : 'disconnected',
      location: loc,
    });
  }

  // Load initial settings + real VPN status.
  browser.getSettings().then((res) => {
    currentSettings = res.settings || {};
    settingsMeta = { searchEngines: res.searchEngines || {}, themes: res.themes || {} };
    applyThemeToChrome(currentSettings.theme);
    applyIncognitoMode(currentSettings.incognito);
    // Fetch real VPN status from main process
    if (typeof browser.vpnStatus === 'function') {
      browser.vpnStatus().then((st) => applyVpnBadge(st)).catch(() => applyVpnBadgeFromSettings(currentSettings));
    } else {
      applyVpnBadgeFromSettings(currentSettings);
    }
  }).catch(() => {});

  // Listen for real-time VPN status changes from main process
  if (typeof browser.onVpnStatusChanged === 'function') {
    browser.onVpnStatusChanged((st) => applyVpnBadge(st));
  }

  browser.onSettingsChanged((s) => {
    currentSettings = s || currentSettings;
    applyThemeToChrome(currentSettings.theme);
    applyIncognitoMode(currentSettings.incognito);
    applyProfileBadge(currentSettings);
    if (typeof refreshBookmarksBar === 'function') refreshBookmarksBar();
  });

  // Apply the operator's initials + color to the chrome's profile button.
  function applyProfileBadge(s) {
    const btn = document.getElementById('action-profile');
    if (!btn) return;
    const name = (s && s.profileName) || 'Analyst';
    const initials = name.trim().split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase() || 'A';
    btn.textContent = initials;
    const color = (s && s.profileAvatarColor) || '#00d4ff';
    btn.style.background = 'linear-gradient(135deg,' + color + '99,' + color + ')';
    btn.title = 'Profile — ' + name;
  }
  // Run once on first load too.
  browser.getSettings().then((r) => applyProfileBadge(r && r.settings)).catch(() => {});

  settingsBtn.addEventListener('click', () => openSettings());

  // Quick-toggle VPN by clicking badge
  const vpnBadgeEl = document.getElementById('vpn-badge');
  if (vpnBadgeEl) {
    vpnBadgeEl.style.cursor = 'pointer';
    vpnBadgeEl.addEventListener('click', async () => {
      if (typeof browser.vpnStatus !== 'function') return;
      try {
        const st = await browser.vpnStatus();
        if (st.status === 'connected') {
          await browser.vpnDisconnect();
        } else if (st.status === 'disconnected' || st.status === 'error') {
          await browser.vpnConnect(currentSettings.vpnLocation || 'Auto');
        }
      } catch (err) {
        console.warn('[chrome] vpn toggle error', err);
      }
    });
  }

  const bgPresets = [
    { id: 'midnight', label: 'Midnight', gradient: 'linear-gradient(135deg, #0a0c10 0%, #0d1117 50%, #0a0c10 100%)' },
    { id: 'aurora',   label: 'Aurora',   gradient: 'linear-gradient(135deg, #0a0c10 0%, #0a1628 40%, #0c2233 70%, #0a0c10 100%)' },
    { id: 'ember',    label: 'Ember',    gradient: 'linear-gradient(135deg, #0a0c10 0%, #1a0a0a 40%, #2a0f0f 70%, #0a0c10 100%)' },
    { id: 'void',     label: 'Void',     gradient: 'linear-gradient(135deg, #050608 0%, #0a0c10 50%, #050608 100%)' },
    { id: 'nebula',   label: 'Nebula',   gradient: 'linear-gradient(135deg, #0a0c10 0%, #0f0a1e 40%, #160a28 70%, #0a0c10 100%)' },
    { id: 'deep',     label: 'Deep Sea', gradient: 'linear-gradient(135deg, #0a0c10 0%, #041418 40%, #051a20 70%, #0a0c10 100%)' },
  ];

  const searchEngineList = [
    { id: 'brave',  label: 'Brave Search' },
    { id: 'ddg',    label: 'DuckDuckGo' },
    { id: 'google', label: 'Google' },
    { id: 'bing',   label: 'Bing' },
    { id: 'kagi',   label: 'Kagi' },
    { id: 'searxng', label: 'SearXNG' },
  ];

  const vpnLocations = [
    'Auto', 'Tor', 'United States', 'United Kingdom', 'Germany', 'Netherlands',
    'Switzerland', 'Japan', 'Singapore', 'Canada', 'Australia',
  ];

  const homePanels = [
    { id: 'news',    label: 'News Feed' },
    { id: 'map',     label: 'World Map' },
    { id: 'sports',  label: 'Sports' },
    { id: 'geo',     label: 'Geopolitics' },
    { id: 'markets', label: 'Markets Sidebar' },
    { id: 'osint',   label: 'OSINT Tools' },
    { id: 'streams', label: 'News Livestreams' },
    { id: 'threats', label: 'Global Threat Monitor' },
    { id: 'predict', label: 'Prediction Markets' },
    { id: 'diplo',   label: 'Diplomatic Tracker' },
  ];

  function openSettings() {
    browser.settingsExpand();
    settingsOverlay.classList.remove('hidden');

    const themes = Object.entries(settingsMeta.themes);
    const curEngine = currentSettings.searchEngine || 'brave';
    const savedBg = currentSettings.bgPreset || 'midnight';

    settingsOverlay.innerHTML =
      '<div class="settings-card">' +
      '  <header class="settings-head">' +
      '    <h2>Settings</h2>' +
      '    <button class="settings-close" id="settings-close" title="Close">&times;</button>' +
      '  </header>' +
      '  <div class="settings-body">' +

      '    <section class="settings-section">' +
      '      <h3>Appearance</h3>' +
      '      <div class="theme-grid" id="theme-grid">' +
             themes.map(([k, v]) =>
               '<button class="theme-swatch' + (currentSettings.theme === k ? ' is-active' : '') +
               '" data-theme="' + k + '" style="--swatch:' + v.accent + '">' +
               '<span class="swatch-dot"></span>' + v.label + '</button>'
             ).join('') +
      '      </div>' +
      '      <h3 style="margin-top:14px">Background</h3>' +
      '      <div class="bg-preset-grid" id="bg-preset-grid">' +
             bgPresets.map((p) =>
               '<div class="bg-preset' + (savedBg === p.id ? ' is-active' : '') +
               '" data-bg="' + p.id + '" style="background:' + p.gradient + '" title="' + p.label + '"></div>'
             ).join('') +
      '      </div>' +
      '      <label class="toggle-row" style="margin-top:10px"><input type="checkbox" id="set-clock"' +
             (currentSettings.showClock !== false ? ' checked' : '') +
      '       /> Show hero clock</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-compact"' +
             (currentSettings.compactMode ? ' checked' : '') +
      '       /> Compact mode</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-bm-bar"' +
             (currentSettings.showBookmarksBar ? ' checked' : '') +
      '       /> Show bookmarks bar</label>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Search Engine</h3>' +
      '      <ul class="radio-list" id="engine-list">' +
             searchEngineList.map((eng) =>
               '<li class="' + (curEngine === eng.id ? 'is-active' : '') +
               '" data-engine="' + eng.id + '"><span class="radio-dot"></span>' + eng.label + '</li>'
             ).join('') +
      '      </ul>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Privacy &amp; Security</h3>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-vpn"' +
             (currentSettings.vpnEnabled ? ' checked' : '') +
      '       /> VPN / Proxy Routing</label>' +
      '      <select id="set-vpn-location" style="margin-top:4px;margin-bottom:4px"' +
             (!currentSettings.vpnEnabled ? ' disabled' : '') + '>' +
             vpnLocations.map((loc) =>
               '<option value="' + loc + '"' +
               ((currentSettings.vpnLocation || 'Auto') === loc ? ' selected' : '') + '>' +
               loc + '</option>'
             ).join('') +
      '      </select>' +
      '      <div class="vpn-status-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
      '        <span id="vpn-settings-status" style="font-size:11px;color:var(--text-secondary);flex:1">' +
               (currentSettings.vpnEnabled ? 'Connected' : 'Disconnected') + '</span>' +
      '        <button class="settings-btn-sm" id="vpn-test-btn" style="font-size:10px;padding:3px 10px">Test Connection</button>' +
      '      </div>' +
      '      <div style="margin-bottom:8px">' +
      '        <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px">Custom proxy (SOCKS5/HTTPS)</label>' +
      '        <div style="display:flex;gap:4px">' +
      '          <input type="text" id="vpn-custom-proxy" placeholder="socks5://host:port" ' +
      '                 style="flex:1;background:var(--surface-1);border:1px solid var(--border);border-radius:6px;' +
      '                 padding:4px 8px;font-size:11px;color:var(--text-primary);font-family:var(--font-data)" />' +
      '          <button class="settings-btn-sm" id="vpn-custom-apply" style="font-size:10px;padding:3px 8px">Apply</button>' +
      '        </div>' +
      '      </div>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-adblock"' +
             (currentSettings.adBlock !== false ? ' checked' : '') +
      '       /> Block ads &amp; trackers</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-fingerprint"' +
             (currentSettings.fingerprintProtection ? ' checked' : '') +
      '       /> Fingerprint protection</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-https-only"' +
             (currentSettings.httpsOnly ? ' checked' : '') +
      '       /> HTTPS-only mode</label>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Extensions</h3>' +
      '      <ul class="ext-list" id="ext-list">' +
      '        <li class="ext-item"><span class="ext-info"><span class="ext-icon">&#x1F6E1;</span> uBlock Origin</span>' +
      '          <label class="toggle-row"><input type="checkbox" checked /></label></li>' +
      '        <li class="ext-item"><span class="ext-info"><span class="ext-icon">&#x1F50D;</span> OSINT Framework</span>' +
      '          <label class="toggle-row"><input type="checkbox" checked /></label></li>' +
      '        <li class="ext-item"><span class="ext-info"><span class="ext-icon">&#x1F310;</span> User-Agent Switcher</span>' +
      '          <label class="toggle-row"><input type="checkbox" /></label></li>' +
      '      </ul>' +
      '      <button class="settings-btn" id="install-ext" style="margin-top:8px">' +
      '        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>' +
      '        Install from Chrome Web Store</button>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Browser Migration</h3>' +
      '      <div class="migrate-grid">' +
      '        <button class="migrate-btn" data-source="chrome">' +
      '          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M12 2a10 10 0 014.9 2.1L12 12"/></svg>' +
      '          Chrome</button>' +
      '        <button class="migrate-btn" data-source="firefox">' +
      '          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M6 8c1-3 4-4 6-4s4 2 4 4c0 3-3 4-4 4"/></svg>' +
      '          Firefox</button>' +
      '        <button class="migrate-btn" data-source="brave">' +
      '          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l4 4-1 5 5 3-4 4-4 4-4-4-4-4 5-3-1-5z"/></svg>' +
      '          Brave</button>' +
      '        <button class="migrate-btn" data-source="edge">' +
      '          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14c0-3 2-6 6-6 2 0 3 1 3 3-1 3-5 3-7 3"/></svg>' +
      '          Edge</button>' +
      '      </div>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Homepage Panels</h3>' +
      '      <ul class="panel-toggle-list" id="panel-toggles">' +
             homePanels.map((p) =>
               '<li class="panel-toggle-item"><span>' + p.label + '</span>' +
               '<label class="toggle-row"><input type="checkbox" data-panel="' + p.id + '"' +
               (currentSettings['panel_' + p.id] !== false ? ' checked' : '') +
               ' /></label></li>'
             ).join('') +
      '      </ul>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Data</h3>' +
      '      <button class="settings-btn" id="clear-data">Clear browsing data</button>' +
      '      <button class="settings-btn" id="reset-settings">Reset all settings</button>' +
      '      <button class="settings-btn" id="export-session">Export session report</button>' +
      '      <button class="settings-btn" id="archive-page">Archive current page</button>' +
      '    </section>' +

      '  </div>' +
      '</div>';

    requestAnimationFrame(() => settingsOverlay.classList.add('visible'));

    document.getElementById('settings-close').addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) closeSettings();
    });

    document.querySelectorAll('#theme-grid .theme-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#theme-grid .theme-swatch').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        browser.setSettings({ theme: btn.dataset.theme });
      });
    });

    document.querySelectorAll('#bg-preset-grid .bg-preset').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#bg-preset-grid .bg-preset').forEach((b) => b.classList.remove('is-active'));
        el.classList.add('is-active');
        browser.setSettings({ bgPreset: el.dataset.bg });
      });
    });

    document.getElementById('set-clock').addEventListener('change', (e) => {
      browser.setSettings({ showClock: e.target.checked });
    });

    document.getElementById('set-compact').addEventListener('change', (e) => {
      browser.setSettings({ compactMode: e.target.checked });
    });

    document.getElementById('set-bm-bar').addEventListener('change', (e) => {
      browser.setSettings({ showBookmarksBar: e.target.checked });
    });

    document.querySelectorAll('#engine-list li').forEach((li) => {
      li.addEventListener('click', () => {
        document.querySelectorAll('#engine-list li').forEach((l) => l.classList.remove('is-active'));
        li.classList.add('is-active');
        browser.setSettings({ searchEngine: li.dataset.engine });
      });
    });

    const vpnToggle = document.getElementById('set-vpn');
    const vpnLocSel = document.getElementById('set-vpn-location');
    const vpnStatusEl = document.getElementById('vpn-settings-status');
    const vpnTestBtn = document.getElementById('vpn-test-btn');
    const vpnCustomInput = document.getElementById('vpn-custom-proxy');
    const vpnCustomBtn = document.getElementById('vpn-custom-apply');

    vpnToggle.addEventListener('change', async (e) => {
      vpnLocSel.disabled = !e.target.checked;
      if (e.target.checked) {
        if (vpnStatusEl) vpnStatusEl.textContent = 'Connecting…';
        try {
          const result = await browser.vpnConnect(vpnLocSel.value);
          if (vpnStatusEl) {
            vpnStatusEl.textContent = result.status === 'connected' ? 'Connected' :
              result.status === 'error' ? ('Error: ' + (result.error || 'Failed')) : result.status;
          }
        } catch (err) {
          if (vpnStatusEl) vpnStatusEl.textContent = 'Error: ' + (err.message || 'Failed');
        }
      } else {
        if (vpnStatusEl) vpnStatusEl.textContent = 'Disconnecting…';
        try {
          await browser.vpnDisconnect();
          if (vpnStatusEl) vpnStatusEl.textContent = 'Disconnected';
        } catch {
          if (vpnStatusEl) vpnStatusEl.textContent = 'Disconnected';
        }
      }
    });
    vpnLocSel.addEventListener('change', async (e) => {
      if (!vpnToggle.checked) return;
      if (vpnStatusEl) vpnStatusEl.textContent = 'Reconnecting…';
      try {
        const result = await browser.vpnConnect(e.target.value);
        if (vpnStatusEl) {
          vpnStatusEl.textContent = result.status === 'connected' ? 'Connected' :
            result.status === 'error' ? ('Error: ' + (result.error || 'Failed')) : result.status;
        }
      } catch (err) {
        if (vpnStatusEl) vpnStatusEl.textContent = 'Error: ' + (err.message || 'Failed');
      }
    });
    if (vpnTestBtn) {
      vpnTestBtn.addEventListener('click', async () => {
        vpnTestBtn.disabled = true;
        vpnTestBtn.textContent = 'Testing…';
        try {
          const result = await browser.vpnTest();
          if (result.reachable) {
            vpnTestBtn.textContent = 'IP: ' + result.ip;
            if (vpnStatusEl) {
              vpnStatusEl.textContent = result.note
                ? (result.ip + ' — ' + result.note)
                : ('Routing IP: ' + result.ip);
            }
          } else {
            vpnTestBtn.textContent = 'Unreachable';
          }
        } catch {
          vpnTestBtn.textContent = 'Test failed';
        }
        setTimeout(() => {
          vpnTestBtn.textContent = 'Test Connection';
          vpnTestBtn.disabled = false;
        }, 6000);
      });
    }
    if (vpnCustomBtn && vpnCustomInput) {
      vpnCustomBtn.addEventListener('click', async () => {
        const url = vpnCustomInput.value.trim();
        if (!url) return;
        vpnCustomBtn.disabled = true;
        vpnCustomBtn.textContent = 'Connecting…';
        try {
          const result = await browser.vpnSetProxy(url);
          vpnCustomBtn.textContent = result.success ? 'Connected' : ('Error: ' + (result.error || 'Failed'));
          if (result.success) {
            vpnToggle.checked = true;
            vpnLocSel.disabled = false;
          }
        } catch (err) {
          vpnCustomBtn.textContent = 'Error';
        }
        setTimeout(() => {
          vpnCustomBtn.textContent = 'Apply';
          vpnCustomBtn.disabled = false;
        }, 3000);
      });
    }

    document.getElementById('set-adblock').addEventListener('change', (e) => {
      browser.setSettings({ adBlock: e.target.checked });
    });

    document.getElementById('set-fingerprint').addEventListener('change', (e) => {
      browser.setSettings({ fingerprintProtection: e.target.checked });
    });

    document.getElementById('set-https-only').addEventListener('change', (e) => {
      browser.setSettings({ httpsOnly: e.target.checked });
    });

    document.querySelectorAll('#panel-toggles input[data-panel]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const key = 'panel_' + e.target.dataset.panel;
        browser.setSettings({ [key]: e.target.checked });
      });
    });

    document.querySelectorAll('.migrate-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = btn.dataset.source;
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = src === 'firefox' ? 'Pick file…' : 'Importing…';
        browser.importBrowserData(src).then((res) => {
          if (res && res.success) {
            btn.textContent = 'Imported ' + res.count + ' new';
          } else {
            btn.textContent = (res && res.error) ? res.error.substring(0, 30) : 'Failed';
          }
          setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 5000);
        }).catch((err) => {
          btn.textContent = 'Error';
          setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 3000);
        });
      });
    });

    document.getElementById('clear-data').addEventListener('click', () => {
      browser.clearBrowsingData().then((ok) => {
        document.getElementById('clear-data').textContent = ok ? 'Done!' : 'Failed';
      });
    });

    document.getElementById('reset-settings').addEventListener('click', () => {
      browser.resetSettings().then(() => closeSettings());
    });

    document.getElementById('export-session').addEventListener('click', () => {
      browser.sessionExport().then((path) => {
        const el = document.getElementById('export-session');
        el.textContent = path ? 'Exported!' : 'Cancelled';
        setTimeout(() => { el.textContent = 'Export session report'; }, 2000);
      });
    });

    document.getElementById('archive-page').addEventListener('click', () => {
      browser.pageArchive().then((result) => {
        const el = document.getElementById('archive-page');
        el.textContent = result ? 'Archived!' : 'Failed';
        setTimeout(() => { el.textContent = 'Archive current page'; }, 2000);
      });
    });
  }

  function closeSettings() {
    settingsOverlay.classList.remove('visible');
    setTimeout(() => {
      settingsOverlay.classList.add('hidden');
      settingsOverlay.innerHTML = '';
      browser.settingsCollapse();
    }, 300);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (osintLookupEl) { closeQuickOsintLookup(); return; }
      if (intelVisible) { closeIntelSidebar(); return; }
      if (tabSearchEl) { closeTabSearch(); return; }
      if (readerOverlay && !readerOverlay.classList.contains('hidden')) { closeReaderMode(); return; }
      if (!settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
      if (findBarEl && !findBarEl.classList.contains('hidden')) { closeFindBar(); return; }
      if (activePanelId) { closePanel(); return; }
    }
  }, true);

  // ------------------------------------------------------------------
  // Find bar
  // ------------------------------------------------------------------

  let findBarEl = null;
  function ensureFindBar() {
    if (findBarEl) return;
    findBarEl = document.createElement('div');
    findBarEl.id = 'find-bar';
    findBarEl.className = 'find-bar hidden';
    findBarEl.innerHTML =
      '<input type="text" id="find-input" placeholder="Find in page…" spellcheck="false" />' +
      '<button id="find-prev" title="Previous (Shift+Enter)">&#9650;</button>' +
      '<button id="find-next" title="Next (Enter)">&#9660;</button>' +
      '<button id="find-close" title="Close (Esc)">&times;</button>';
    document.getElementById('chrome').appendChild(findBarEl);

    const inp = document.getElementById('find-input');
    inp.addEventListener('input', () => {
      if (inp.value) browser.findStart(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        browser.findNext(inp.value, !e.shiftKey);
      }
      if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
    });
    document.getElementById('find-prev').addEventListener('click', () => browser.findNext(inp.value, false));
    document.getElementById('find-next').addEventListener('click', () => browser.findNext(inp.value, true));
    document.getElementById('find-close').addEventListener('click', closeFindBar);
  }

  function openFindBar() {
    ensureFindBar();
    findBarEl.classList.remove('hidden');
    const inp = document.getElementById('find-input');
    inp.focus();
    inp.select();
  }

  function closeFindBar() {
    if (findBarEl) findBarEl.classList.add('hidden');
    browser.findStop();
  }

  // ------------------------------------------------------------------
  // Reader mode overlay
  // ------------------------------------------------------------------

  let readerOverlay = null;

  async function openReaderMode() {
    const data = await browser.reader();
    if (!data) return;

    if (!readerOverlay) {
      readerOverlay = document.createElement('div');
      readerOverlay.id = 'reader-overlay';
      readerOverlay.className = 'reader-overlay hidden';
      document.body.appendChild(readerOverlay);
    }

    readerOverlay.classList.remove('hidden');
    readerOverlay.innerHTML =
      '<div class="reader-card">' +
      '  <header class="reader-head">' +
      '    <h1 class="reader-title">' + esc(data.title) + '</h1>' +
      '    <div class="reader-meta">' + esc(shortUrl(data.url)) + '</div>' +
      '    <button class="settings-close reader-close" id="reader-close">&times;</button>' +
      '  </header>' +
      '  <article class="reader-body">' + data.content + '</article>' +
      '</div>';

    document.getElementById('reader-close').addEventListener('click', closeReaderMode);
    readerOverlay.addEventListener('click', (e) => {
      if (e.target === readerOverlay) closeReaderMode();
    });
  }

  function closeReaderMode() {
    if (readerOverlay) readerOverlay.classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // Security / certificate popup
  // ------------------------------------------------------------------

  async function showSecurityPopup() {
    removeSecurityPopup();
    const info = await browser.securityInfo();
    if (!info) return;

    const popup = document.createElement('div');
    popup.className = 'security-popup';

    let certHtml = '';
    if (info.cert) {
      const c = info.cert;
      const subj = c.subject ? (c.subject.CN || c.subject.O || '') : '';
      const issuer = c.issuer ? (c.issuer.O || c.issuer.CN || '') : '';
      certHtml =
        '<div class="sec-section">' +
        '<div class="sec-label">Certificate</div>' +
        '<div class="sec-value">' + esc(subj) + '</div>' +
        '<div class="sec-detail">Issued by: ' + esc(issuer) + '</div>' +
        '<div class="sec-detail">Valid: ' + esc(c.valid_from || '') + ' — ' + esc(c.valid_to || '') + '</div>' +
        '<div class="sec-detail sec-mono">SHA-256: ' + esc(c.fingerprint || '') + '</div>' +
        '</div>';
    }

    // Load per-site permissions
    let permsHtml = '';
    if (info.host) {
      const origin = info.protocol + '//' + info.host;
      const perms = await browser.permissionsGet(origin);
      const permLabels = { camera: 'Camera', microphone: 'Microphone', geolocation: 'Location', notifications: 'Notifications' };
      permsHtml = '<div class="sec-section">' +
        '<div class="sec-label">Site permissions</div>' +
        Object.entries(permLabels).map(([key, label]) => {
          const val = perms[key] || 'default';
          return '<div class="sec-perm-row">' +
            '<span>' + label + '</span>' +
            '<select data-perm="' + key + '" data-origin="' + escapeAttr(origin) + '">' +
            '<option value="default"' + (val === 'default' ? ' selected' : '') + '>Default</option>' +
            '<option value="allow"' + (val === 'allow' ? ' selected' : '') + '>Allow</option>' +
            '<option value="deny"' + (val === 'deny' ? ' selected' : '') + '>Deny</option>' +
            '</select></div>';
        }).join('') +
        '</div>';
    }

    popup.innerHTML =
      '<div class="sec-header">' +
      '<span class="sec-icon">' + (info.secure ? '⬢' : '!') + '</span>' +
      '<span class="sec-status">' + (info.secure ? 'Connection is secure' : 'Connection is not secure') + '</span>' +
      '</div>' +
      '<div class="sec-host">' + esc(info.host || info.url) + '</div>' +
      certHtml + permsHtml;

    document.body.appendChild(popup);

    popup.querySelectorAll('.sec-perm-row select').forEach((sel) => {
      sel.addEventListener('change', () => {
        browser.permissionsSet(sel.dataset.origin, sel.dataset.perm, sel.value);
      });
    });

    requestAnimationFrame(() => {
      document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== urlScheme) removeSecurityPopup();
      }, { once: true });
    });
  }

  function removeSecurityPopup() {
    const old = document.querySelector('.security-popup');
    if (old) old.remove();
  }

  // ------------------------------------------------------------------
  // Tab context menu (right-click)
  // ------------------------------------------------------------------

  tabsEl.addEventListener('contextmenu', (e) => {
    const tabEl = e.target.closest('.tab');
    if (!tabEl) return;
    e.preventDefault();
    const tabId = tabEl.dataset.tabId;
    showTabContextMenu(e.clientX, e.clientY, tabId);
  });

  function showTabContextMenu(x, y, tabId) {
    removeContextMenu();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const items = [
      { label: tab.pinned ? 'Unpin tab' : 'Pin tab', action: () => browser.pinTab(tabId) },
      { label: tab.muted ? 'Unmute tab' : 'Mute tab', action: () => browser.muteTab(tabId) },
      { label: 'Duplicate tab', action: () => browser.duplicateTab(tabId) },
      { sep: true },
      { label: 'Assign to Operation…', action: () => assignTabToOp(tabId) },
      { label: tab.operationId ? 'Remove from Operation' : null, action: () => browser.opsAssignTab(tabId, null) },
      { sep: true },
      { label: 'Close tab', action: () => browser.closeTab(tabId), danger: true },
      { label: 'Close other tabs', action: () => {
        tabs.filter((t) => t.id !== tabId && !t.pinned).forEach((t) => browser.closeTab(t.id));
      }, danger: true },
    ].filter((i) => i.label !== null);

    for (const item of items) {
      if (item.sep) {
        const hr = document.createElement('div');
        hr.className = 'ctx-sep';
        menu.appendChild(hr);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', () => { removeContextMenu(); item.action(); });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      document.addEventListener('click', removeContextMenu, { once: true });
    });
  }

  async function assignTabToOp(tabId) {
    removeContextMenu();
    const ops = await browser.opsList();
    if (ops.length === 0) {
      const name = prompt('No operations yet. Create one:');
      if (!name) return;
      const opId = await browser.opsCreate(name, '#d4a843');
      browser.opsAssignTab(tabId, opId);
      return;
    }
    const names = ops.map((o, i) => (i + 1) + '. ' + o.name).join('\n');
    const choice = prompt('Assign to operation:\n' + names + '\n\nEnter number:');
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < ops.length) {
      browser.opsAssignTab(tabId, ops[idx].id);
    }
  }

  function removeContextMenu() {
    const old = document.querySelector('.ctx-menu');
    if (old) old.remove();
  }

  // ------------------------------------------------------------------
  // Side panels (bookmarks, history, downloads)
  // ------------------------------------------------------------------

  let activePanelId = null;

  let _closeTimer = null;
  function togglePanel(id) {
    if (activePanelId === id) { closePanel(); return; }
    // Cancel any pending close timer so we don't wipe the just-opened panel.
    if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
    if (activePanelId !== null) closePanel();
    activePanelId = id;
    browser.settingsExpand();
    const overlay = settingsOverlay;
    overlay.classList.remove('hidden');

    if (id === 'bookmarks') renderBookmarksPanel(overlay);
    else if (id === 'history') renderHistoryPanel(overlay);
    else if (id === 'downloads') renderDownloadsPanel(overlay);
    else if (id === 'permissions') renderPermissionsPanel(overlay);
    else if (id === 'extensions') renderExtensionsPanel(overlay);
    else if (id === 'profile') renderProfilePanel(overlay);

    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  function closePanel() {
    if (activePanelId === null) return;
    activePanelId = null;
    settingsOverlay.classList.remove('visible');
    if (_closeTimer) clearTimeout(_closeTimer);
    _closeTimer = setTimeout(() => {
      settingsOverlay.classList.add('hidden');
      settingsOverlay.innerHTML = '';
      browser.settingsCollapse();
      _closeTimer = null;
    }, 300);
  }

  function bookmarkCurrentPage() {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || tab.isHomepage) return;
    browser.bookmarksAdd({ url: tab.url, title: tab.title, favicon: tab.favicon }).then(() => {
      refreshBookmarksBar();
    });
  }

  // --- Bookmarks bar ---
  const bmBar = document.getElementById('bookmarks-bar');

  function refreshBookmarksBar() {
    if (!currentSettings.showBookmarksBar) {
      bmBar.classList.add('hidden');
      return;
    }
    bmBar.classList.remove('hidden');
    browser.bookmarksList().then((bm) => {
      if (!bm || bm.length === 0) {
        bmBar.innerHTML = '<span class="bm-bar-empty">No bookmarks yet — press Ctrl+D to add one</span>';
        return;
      }
      bmBar.innerHTML = bm.slice(0, 20).map((b) =>
        '<button class="bm-bar-item" data-url="' + escapeAttr(b.url) + '" title="' + escapeAttr(b.url) + '">' +
        (b.favicon ? '<img class="bm-bar-icon" src="' + escapeAttr(b.favicon) + '" onerror="this.style.display=\'none\'" />' : '') +
        '<span>' + esc(b.title || shortUrl(b.url)) + '</span></button>'
      ).join('');
      bmBar.querySelectorAll('.bm-bar-item').forEach((btn) => {
        btn.addEventListener('click', () => browser.navigate(null, btn.dataset.url));
      });
    }).catch(() => {});
  }

  refreshBookmarksBar();

  // --- Profile panel ---
  const PROFILE_COLORS = ['#00d4ff','#2ed573','#ff4757','#ffa502','#9f7aea','#4299e1','#d4a843','#e8eaf0'];
  const PROFILE_BADGES = ['OSINT','RECON','SIGINT','HUMINT','GEOINT','CTI','RESEARCH','OFFLINE'];
  // Curated set of OSINT investigation tools that open in a new tab
  // when the operator clicks them. Kept small on purpose — analysts can
  // pin more from the bookmarks bar.
  const OSINT_TOOLBOX = [
    { name: 'Shodan',         url: 'https://www.shodan.io/',                color: '#ff4757' },
    { name: 'VirusTotal',     url: 'https://www.virustotal.com/',           color: '#3a86ff' },
    { name: 'Censys',         url: 'https://search.censys.io/',             color: '#2ed573' },
    { name: 'WhoisXML',       url: 'https://whois.whoisxmlapi.com/',        color: '#9f7aea' },
    { name: 'Wayback',        url: 'https://web.archive.org/',              color: '#ffa502' },
    { name: 'HIBP',           url: 'https://haveibeenpwned.com/',           color: '#ef4444' },
    { name: 'IntelX',         url: 'https://intelx.io/',                    color: '#06b6d4' },
    { name: 'crt.sh',         url: 'https://crt.sh/',                       color: '#84cc16' },
    { name: 'GreyNoise',      url: 'https://www.greynoise.io/viz/',         color: '#a78bfa' },
    { name: 'urlscan.io',     url: 'https://urlscan.io/',                   color: '#f97316' },
    { name: 'OSINT Framework',url: 'https://osintframework.com/',           color: '#d4a843' },
    { name: 'Maltego',        url: 'https://www.maltego.com/transform-hub/',color: '#22d3ee' },
  ];

  function renderProfilePanel(container) {
    const s = currentSettings || {};
    const name = s.profileName || 'Analyst';
    const handle = s.profileHandle || '';
    const email = s.profileEmail || '';
    const color = s.profileAvatarColor || '#00d4ff';
    const role = s.profileRole || '';
    const org = s.profileOrg || '';
    const loc = s.profileLocation || '';
    const bio = s.profileBio || '';
    const badge = s.profileBadge || 'OSINT';
    const initials = name.trim().split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase() || 'A';
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    const sessionStartMs = SESSION_STARTED_AT;

    const fieldStyle = 'width:100%;background:var(--surface-1);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;color:var(--text-primary);margin-bottom:10px';
    const labelStyle = 'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin:0 0 6px';
    const sectionLabelStyle = 'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin:14px 0 8px';
    const statBoxStyle = 'background:var(--surface-1);border:1px solid var(--border);border-radius:8px;padding:10px';

    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>Operator Profile</h2>' +
      '    <button class="settings-close panel-close-btn">&times;</button></header>' +
      '  <div style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 60px)">' +

      // --- Identity card ---
      '    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
      '      <div id="prof-avatar" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,' + color + '99,' + color + ');display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-size:26px;font-weight:700;color:#0a0c10;flex-shrink:0;box-shadow:0 0 0 3px rgba(255,255,255,0.04)">' + esc(initials) + '</div>' +
      '      <div style="flex:1;min-width:0">' +
      '        <div id="prof-display-name" style="font-size:16px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</div>' +
      '        <div id="prof-display-handle" style="font-size:12px;color:var(--text-secondary);font-family:var(--font-data)">' + esc(handle ? '@' + handle.replace(/^@/, '') : '@anon') + '</div>' +
      '        <div style="display:flex;align-items:center;gap:6px;margin-top:6px"><span id="prof-display-badge" style="display:inline-block;padding:2px 7px;font-size:9px;font-weight:700;letter-spacing:.08em;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;border-radius:3px">' + esc(badge) + '</span><span id="prof-display-role" style="font-size:10px;color:var(--text-secondary)">' + esc(role || 'No role set') + '</span></div>' +
      '      </div>' +
      '    </div>' +

      // --- Identity ---
      '    <h3 style="' + labelStyle + '">Display Name</h3>' +
      '    <input type="text" id="prof-name" value="' + escapeAttr(name) + '" placeholder="Analyst" maxlength="40" style="' + fieldStyle + '"/>' +

      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Handle</h3>' +
      '        <input type="text" id="prof-handle" value="' + escapeAttr(handle) + '" placeholder="op_analyst" maxlength="30" style="' + fieldStyle + ';font-family:var(--font-data)"/>' +
      '      </div>' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Badge</h3>' +
      '        <select id="prof-badge" style="' + fieldStyle + ';font-family:var(--font-data);cursor:pointer">' +
      PROFILE_BADGES.map((b) => '<option value="' + b + '"' + (b === badge ? ' selected' : '') + '>' + b + '</option>').join('') +
      '        </select>' +
      '      </div>' +
      '    </div>' +

      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Role</h3>' +
      '        <input type="text" id="prof-role" value="' + escapeAttr(role) + '" placeholder="OSINT Analyst" maxlength="40" style="' + fieldStyle + '"/>' +
      '      </div>' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Organization</h3>' +
      '        <input type="text" id="prof-org" value="' + escapeAttr(org) + '" placeholder="Independent" maxlength="60" style="' + fieldStyle + '"/>' +
      '      </div>' +
      '    </div>' +

      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Location</h3>' +
      '        <input type="text" id="prof-location" value="' + escapeAttr(loc) + '" placeholder="City / Region" maxlength="60" style="' + fieldStyle + '"/>' +
      '      </div>' +
      '      <div>' +
      '        <h3 style="' + labelStyle + '">Email</h3>' +
      '        <input type="email" id="prof-email" value="' + escapeAttr(email) + '" placeholder="analyst@example.com" maxlength="120" style="' + fieldStyle + '"/>' +
      '      </div>' +
      '    </div>' +

      '    <h3 style="' + labelStyle + '">Notes / Scratchpad</h3>' +
      '    <textarea id="prof-bio" maxlength="800" placeholder="Investigation notes, current focus, OPSEC reminders…" style="' + fieldStyle + ';min-height:70px;resize:vertical;font-family:var(--font);line-height:1.4">' + esc(bio) + '</textarea>' +

      // --- Avatar color ---
      '    <h3 style="' + labelStyle + '">Avatar Color</h3>' +
      '    <div id="prof-color-row" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
      PROFILE_COLORS.map((c) =>
        '<div class="prof-color-sw' + (c === color ? ' is-active' : '') + '" data-color="' + c + '" style="width:24px;height:24px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + (c === color ? 'var(--text-primary)' : 'transparent') + ';transition:border-color .15s"></div>'
      ).join('') +
      '    </div>' +

      // --- Stats ---
      '    <h3 style="' + sectionLabelStyle + '">Operator Stats</h3>' +
      '    <div id="prof-stats" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Operations</div><div id="stat-ops" style="font-family:var(--font-data);font-size:20px;font-weight:700;color:var(--text-primary)">—</div></div>' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Bookmarks</div><div id="stat-bookmarks" style="font-family:var(--font-data);font-size:20px;font-weight:700;color:var(--text-primary)">—</div></div>' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">History</div><div id="stat-history" style="font-family:var(--font-data);font-size:20px;font-weight:700;color:var(--text-primary)">—</div></div>' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Open Tabs</div><div id="stat-tabs" style="font-family:var(--font-data);font-size:20px;font-weight:700;color:var(--text-primary)">—</div></div>' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Session</div><div id="stat-uptime" style="font-family:var(--font-data);font-size:14px;font-weight:700;color:var(--text-primary);padding-top:3px">—</div></div>' +
      '      <div style="' + statBoxStyle + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Time Zone</div><div id="stat-tz" style="font-family:var(--font-data);font-size:11px;font-weight:600;color:var(--text-primary);padding-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(tz || 'Unknown') + '</div></div>' +
      '    </div>' +

      // --- OSINT toolbox ---
      '    <h3 style="' + sectionLabelStyle + '">OSINT Toolbox</h3>' +
      '    <div id="prof-toolbox" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' +
      OSINT_TOOLBOX.map((t) =>
        '<button class="prof-tool-btn" data-url="' + escapeAttr(t.url) + '" style="background:var(--surface-1);border:1px solid var(--border);border-left:3px solid ' + t.color + ';border-radius:6px;padding:7px 8px;font-size:11px;color:var(--text-primary);cursor:pointer;text-align:left;transition:border-color .15s,background .15s">' + esc(t.name) + '</button>'
      ).join('') +
      '    </div>' +

      // --- Actions ---
      '    <h3 style="' + sectionLabelStyle + '">Actions</h3>' +
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      '      <button class="settings-btn" id="prof-export">Export Session</button>' +
      '      <button class="settings-btn" id="prof-clear">Clear Browsing Data</button>' +
      '      <button class="settings-btn" id="prof-incognito">Incognito Window</button>' +
      '      <button class="settings-btn" id="prof-reset" style="color:var(--accent-red,#ff4757)">Reset Profile</button>' +
      '    </div>' +
      '    <div style="margin-top:10px;font-size:10px;color:var(--text-secondary);text-align:center">All profile data is stored locally on this machine.</div>' +
      '  </div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    function refreshHeader() {
      const n = document.getElementById('prof-name').value || 'Analyst';
      const h = document.getElementById('prof-handle').value;
      const r = document.getElementById('prof-role').value;
      const b = document.getElementById('prof-badge').value;
      const initialsNow = n.trim().split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase() || 'A';
      document.getElementById('prof-display-name').textContent = n;
      document.getElementById('prof-display-handle').textContent = h ? '@' + h.replace(/^@/, '') : '@anon';
      document.getElementById('prof-display-role').textContent = r || 'No role set';
      const badgeEl = document.getElementById('prof-display-badge');
      if (badgeEl) badgeEl.textContent = b;
      document.getElementById('prof-avatar').textContent = initialsNow;
    }

    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    const saveSoon = debounce(() => {
      browser.setSettings({
        profileName:    document.getElementById('prof-name').value.trim() || 'Analyst',
        profileHandle:  document.getElementById('prof-handle').value.trim().replace(/^@/, ''),
        profileEmail:   document.getElementById('prof-email').value.trim(),
        profileRole:    document.getElementById('prof-role').value.trim(),
        profileOrg:     document.getElementById('prof-org').value.trim(),
        profileLocation:document.getElementById('prof-location').value.trim(),
        profileBio:     document.getElementById('prof-bio').value,
        profileBadge:   document.getElementById('prof-badge').value,
      });
    }, 400);

    ['prof-name','prof-handle','prof-email','prof-role','prof-org','prof-location','prof-bio'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { refreshHeader(); saveSoon(); });
    });
    document.getElementById('prof-badge').addEventListener('change', () => { refreshHeader(); saveSoon(); });

    container.querySelectorAll('#prof-color-row .prof-color-sw').forEach((sw) => {
      sw.addEventListener('click', () => {
        container.querySelectorAll('#prof-color-row .prof-color-sw').forEach((x) => {
          x.classList.remove('is-active');
          x.style.borderColor = 'transparent';
        });
        sw.classList.add('is-active');
        sw.style.borderColor = 'var(--text-primary)';
        const c = sw.dataset.color;
        document.getElementById('prof-avatar').style.background = 'linear-gradient(135deg,' + c + '99,' + c + ')';
        const badgeEl = document.getElementById('prof-display-badge');
        if (badgeEl) {
          badgeEl.style.background = c + '22';
          badgeEl.style.color = c;
          badgeEl.style.borderColor = c + '55';
        }
        browser.setSettings({ profileAvatarColor: c });
      });
    });

    container.querySelectorAll('.prof-tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        browser.navigate(null, btn.dataset.url);
        closePanel();
      });
    });

    document.getElementById('prof-export').addEventListener('click', () => {
      if (typeof browser.sessionExport === 'function') {
        browser.sessionExport().catch(() => {});
      }
    });

    document.getElementById('prof-clear').addEventListener('click', () => {
      if (typeof browser.clearBrowsingData === 'function') {
        browser.clearBrowsingData().catch(() => {});
      }
    });

    document.getElementById('prof-incognito').addEventListener('click', () => {
      if (typeof browser.incognito === 'function') {
        browser.incognito();
        closePanel();
      }
    });

    document.getElementById('prof-reset').addEventListener('click', () => {
      browser.setSettings({
        profileName: 'Analyst',
        profileHandle: '',
        profileEmail: '',
        profileAvatarColor: '#00d4ff',
        profileRole: '',
        profileOrg: '',
        profileLocation: '',
        profileBio: '',
        profileBadge: 'OSINT',
      }).then(() => renderProfilePanel(container));
    });

    // Populate stats
    Promise.all([
      browser.opsList ? browser.opsList().catch(() => []) : Promise.resolve([]),
      browser.bookmarksList().catch(() => []),
      browser.historyList('', 9999).catch(() => []),
    ]).then(([ops, bm, hist]) => {
      document.getElementById('stat-ops').textContent = (ops || []).length.toLocaleString();
      document.getElementById('stat-bookmarks').textContent = (bm || []).length.toLocaleString();
      document.getElementById('stat-history').textContent = (hist || []).length.toLocaleString();
      document.getElementById('stat-tabs').textContent = (typeof tabs !== 'undefined' ? tabs.length : 0).toLocaleString();
    });

    // Live session uptime — ticks every second while the panel is open.
    const uptimeEl = document.getElementById('stat-uptime');
    function fmtUptime(ms) {
      const sec = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const ss = sec % 60;
      return (h > 0 ? h + 'h ' : '') + (h > 0 || m > 0 ? m + 'm ' : '') + ss + 's';
    }
    function tick() { if (uptimeEl && document.body.contains(uptimeEl)) uptimeEl.textContent = fmtUptime(Date.now() - sessionStartMs); }
    tick();
    const uptimeTimer = setInterval(() => {
      if (!document.body.contains(uptimeEl)) { clearInterval(uptimeTimer); return; }
      tick();
    }, 1000);
  }

  // --- Bookmarks panel ---
  function renderBookmarksPanel(container) {
    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>Bookmarks</h2>' +
      '    <button class="settings-close panel-close-btn">&times;</button></header>' +
      '  <div class="panel-search"><input type="text" id="bm-search" placeholder="Search bookmarks…" /></div>' +
      '  <div class="panel-list" id="bm-list"></div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    const listEl = document.getElementById('bm-list');
    const searchEl = document.getElementById('bm-search');

    function load(filter) {
      browser.bookmarksList().then((bm) => {
        let filtered = bm;
        if (filter) {
          const q = filter.toLowerCase();
          filtered = bm.filter((b) => ((b.title || '') + ' ' + b.url).toLowerCase().includes(q));
        }
        if (filtered.length === 0) {
          listEl.innerHTML = '<div class="panel-empty-msg">No bookmarks yet. Press Ctrl+D to add one.</div>';
          return;
        }
        listEl.innerHTML = filtered.map((b) =>
          '<div class="panel-row bm-row" data-url="' + escapeAttr(b.url) + '">' +
          '  <span class="row-title">' + esc(b.title || b.url) + '</span>' +
          '  <span class="row-meta">' + esc(shortUrl(b.url)) + '</span>' +
          '  <button class="row-del" title="Remove">&times;</button>' +
          '</div>'
        ).join('');

        listEl.querySelectorAll('.bm-row').forEach((row) => {
          row.addEventListener('click', (e) => {
            if (e.target.classList.contains('row-del')) {
              browser.bookmarksRemove(row.dataset.url).then(() => load(searchEl.value));
              return;
            }
            browser.navigate(null, row.dataset.url);
            closePanel();
          });
        });
      });
    }

    searchEl.addEventListener('input', () => load(searchEl.value));
    load();
    searchEl.focus();
  }

  // --- History panel ---
  function renderHistoryPanel(container) {
    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>History</h2>' +
      '    <div class="head-actions">' +
      '      <button class="settings-btn" id="hist-clear">Clear all</button>' +
      '      <button class="settings-close panel-close-btn">&times;</button>' +
      '    </div></header>' +
      '  <div class="panel-search"><input type="text" id="hist-search" placeholder="Search history…" /></div>' +
      '  <div class="panel-list" id="hist-list"></div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    const listEl = document.getElementById('hist-list');
    const searchEl = document.getElementById('hist-search');

    function load(filter) {
      browser.historyList(filter, 100).then((hist) => {
        if (hist.length === 0) {
          listEl.innerHTML = '<div class="panel-empty-msg">No history.</div>';
          return;
        }
        listEl.innerHTML = hist.map((h) =>
          '<div class="panel-row hist-row" data-url="' + escapeAttr(h.url) + '">' +
          '  <span class="row-title">' + esc(h.title || h.url) + '</span>' +
          '  <span class="row-meta">' + esc(shortUrl(h.url)) + ' · ' + esc(timeAgo(h.visitedAt)) + '</span>' +
          '</div>'
        ).join('');

        listEl.querySelectorAll('.hist-row').forEach((row) => {
          row.addEventListener('click', () => {
            browser.navigate(null, row.dataset.url);
            closePanel();
          });
        });
      });
    }

    document.getElementById('hist-clear').addEventListener('click', () => {
      browser.historyClear().then(() => load(searchEl.value));
    });
    searchEl.addEventListener('input', () => load(searchEl.value));
    load();
    searchEl.focus();
  }

  // --- Downloads panel ---
  function renderDownloadsPanel(container) {
    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>Downloads</h2>' +
      '    <button class="settings-close panel-close-btn">&times;</button></header>' +
      '  <div class="panel-list" id="dl-list"><div class="panel-empty-msg">No downloads.</div></div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    function renderList(items) {
      const listEl = document.getElementById('dl-list');
      if (!listEl) return;
      if (!items || items.length === 0) {
        listEl.innerHTML = '<div class="panel-empty-msg">No downloads.</div>';
        return;
      }
      listEl.innerHTML = items.map((d) => {
        const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;
        const isDone = d.state === 'completed';
        const isFail = d.state === 'cancelled' || d.state === 'interrupted';
        return '<div class="panel-row dl-row" data-id="' + esc(d.id) + '">' +
          '<span class="row-title">' + esc(d.filename) + '</span>' +
          '<span class="row-meta">' +
            (isDone ? 'Complete' : isFail ? 'Failed' : pct + '%') +
            ' · ' + formatBytes(d.receivedBytes) +
          '</span>' +
          (!isDone && !isFail ? '<div class="dl-progress"><div class="dl-bar" style="width:' + pct + '%"></div></div>' : '') +
          '<div class="row-actions">' +
            (isDone ? '<button class="row-btn" data-act="reveal">Show</button>' : '') +
            (!isDone && !isFail ? '<button class="row-btn danger" data-act="cancel">Cancel</button>' : '') +
          '</div></div>';
      }).join('');

      listEl.querySelectorAll('.row-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.dl-row');
          if (btn.dataset.act === 'reveal') browser.downloadsReveal(row.dataset.id);
          if (btn.dataset.act === 'cancel') browser.downloadsCancel(row.dataset.id);
        });
      });
    }

    browser.downloadsList().then(renderList);
    const unsub = browser.onDownloadsUpdated(renderList);
    const obs = new MutationObserver(() => {
      if (container.classList.contains('hidden')) { unsub(); obs.disconnect(); }
    });
    obs.observe(container, { attributes: true, attributeFilter: ['class'] });
  }

  // --- Permissions panel ---
  function renderPermissionsPanel(container) {
    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>Site Permissions</h2>' +
      '    <button class="settings-close panel-close-btn">&times;</button></header>' +
      '  <div class="panel-list" id="perms-list"></div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    const listEl = document.getElementById('perms-list');
    const permLabels = { camera: 'Cam', microphone: 'Mic', geolocation: 'Loc', notifications: 'Notif', media: 'Media' };

    browser.permissionsList().then((all) => {
      const sites = Object.entries(all);
      if (sites.length === 0) {
        listEl.innerHTML = '<div class="panel-empty-msg">No site permissions saved.</div>';
        return;
      }
      listEl.innerHTML = sites.map(([origin, perms]) =>
        '<div class="panel-row perm-site-row">' +
        '<span class="row-title">' + esc(origin) + '</span>' +
        '<div class="perm-badges">' +
          Object.entries(perms).map(([k, v]) =>
            '<span class="perm-badge perm-' + v + '" title="' + escapeAttr(k + ': ' + v) + '">' +
            esc(permLabels[k] || k) + '</span>'
          ).join('') +
        '</div>' +
        '<button class="row-del" data-origin="' + escapeAttr(origin) + '" title="Remove">&times;</button>' +
        '</div>'
      ).join('');

      listEl.querySelectorAll('.row-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          browser.permissionsRemoveSite(btn.dataset.origin).then(() => renderPermissionsPanel(container));
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // Intel Sidebar (Ctrl+B toggle) — core OSINT product identity
  // ------------------------------------------------------------------

  let intelSidebar = null;
  let intelVisible = false;

  function toggleIntelSidebar() {
    if (intelVisible) { closeIntelSidebar(); return; }
    openIntelSidebar();
  }

  async function openIntelSidebar() {
    if (intelSidebar) intelSidebar.remove();

    browser.settingsExpand();

    intelSidebar = document.createElement('div');
    intelSidebar.className = 'intel-sidebar';
    intelSidebar.innerHTML =
      '<div class="intel-sidebar-head">' +
      '  <span class="intel-sidebar-title">&#9673; Intel Sidebar</span>' +
      '  <button class="intel-sidebar-close">&times;</button>' +
      '</div>' +
      '<div class="intel-sidebar-body">' +
      '  <div class="intel-loading">Scanning page…</div>' +
      '</div>';
    document.body.appendChild(intelSidebar);
    intelVisible = true;

    intelSidebar.querySelector('.intel-sidebar-close').addEventListener('click', closeIntelSidebar);

    const active = tabs.find((t) => t.id === activeId);
    const body = intelSidebar.querySelector('.intel-sidebar-body');

    const [entityData, credData] = await Promise.all([
      browser.extractEntities().catch(() => null),
      browser.getCredibility(active?.url).catch(() => ({ tier: 'unknown' })),
    ]);

    if (!intelVisible) return;

    let html = '';

    // Credibility badge
    const tierLabels = { high: 'High Credibility', medium: 'Medium Credibility', low: 'Low Credibility', government: 'Government Source', unknown: 'Unrated' };
    const tierColors = { high: '#2ecc71', medium: '#d4a843', low: '#ff4e4e', government: '#4a90e2', unknown: '#606070' };
    const tier = credData?.tier || 'unknown';
    html += '<div class="intel-section">' +
      '<div class="intel-section-title">Source Credibility</div>' +
      '<div class="intel-cred-badge" style="--cred-color:' + (tierColors[tier] || '#606070') + '">' +
      '<span class="intel-cred-dot"></span>' +
      '<span>' + (tierLabels[tier] || 'Unrated') + '</span></div></div>';

    // Entities
    if (entityData && entityData.total > 0) {
      const e = entityData.entities;
      html += '<div class="intel-section"><div class="intel-section-title">Extracted Entities (' + entityData.total + ')</div>';
      if (e.ips.length) {
        html += '<div class="intel-entity-group"><span class="intel-entity-label">IP Addresses</span>';
        html += e.ips.map((ip) => '<button class="intel-entity" data-type="ip" data-val="' + escapeAttr(ip) + '">' + esc(ip) + '</button>').join('');
        html += '</div>';
      }
      if (e.domains.length) {
        html += '<div class="intel-entity-group"><span class="intel-entity-label">Domains</span>';
        html += e.domains.map((d) => '<button class="intel-entity" data-type="domain" data-val="' + escapeAttr(d) + '">' + esc(d) + '</button>').join('');
        html += '</div>';
      }
      if (e.emails.length) {
        html += '<div class="intel-entity-group"><span class="intel-entity-label">Emails</span>';
        html += e.emails.map((em) => '<button class="intel-entity" data-type="email" data-val="' + escapeAttr(em) + '">' + esc(em) + '</button>').join('');
        html += '</div>';
      }
      if (e.hashes.length) {
        html += '<div class="intel-entity-group"><span class="intel-entity-label">Hashes</span>';
        html += e.hashes.map((h) => '<button class="intel-entity" data-type="hash" data-val="' + escapeAttr(h) + '">' + esc(h.substring(0, 16) + '…') + '</button>').join('');
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="intel-section"><div class="intel-section-title">Extracted Entities</div>' +
        '<div class="intel-empty">No entities detected on this page.</div></div>';
    }

    // Quick OSINT lookup section
    html += '<div class="intel-section">' +
      '<div class="intel-section-title">Quick Lookup</div>' +
      '<div class="intel-lookup-form">' +
      '<input type="text" class="intel-lookup-input" placeholder="IP, domain, hash, email…" spellcheck="false" />' +
      '<button class="intel-lookup-btn">Lookup</button></div></div>';

    // Counterfactual triggers
    const cfData = await browser.getCounterfactual().catch(() => null);
    if (cfData && cfData.length > 0) {
      html += '<div class="intel-section"><div class="intel-section-title">Scenario Intelligence</div>';
      for (const cf of cfData) {
        html += '<div class="intel-scenario">' +
          '<span class="intel-scenario-region">' + esc(cf.region) + '</span>' +
          '<p class="intel-scenario-text">' + esc(cf.scenario) + '</p></div>';
      }
      html += '</div>';
    }

    // Reading time
    const readTime = await browser.getReadingTime().catch(() => null);
    if (readTime && readTime.words > 100) {
      html += '<div class="intel-section"><div class="intel-section-title">Reading Estimate</div>' +
        '<div class="intel-reading-time">' + readTime.minutes + ' min read · ' + readTime.words.toLocaleString() + ' words</div></div>';
    }

    // Annotation tool
    html += '<div class="intel-section"><div class="intel-section-title">Annotate</div>' +
      '<div class="intel-annotate-form">' +
      '<textarea class="intel-annotate-input" placeholder="Select text on page, then paste or type notes here…" rows="2"></textarea>' +
      '<button class="intel-annotate-btn" disabled>Add to Operation</button></div></div>';

    // Page URL info
    if (active && !active.isHomepage) {
      html += '<div class="intel-section"><div class="intel-section-title">Page Info</div>' +
        '<div class="intel-page-url">' + esc(active.url) + '</div>' +
        '<div class="intel-page-title">' + esc(active.title) + '</div></div>';
    }

    body.innerHTML = html;

    // Wire entity clicks -> OSINT lookup
    body.querySelectorAll('.intel-entity').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        const type = btn.dataset.type;
        performOsintLookup(val, type);
      });
    });

    // Wire annotation
    const annotateInput = body.querySelector('.intel-annotate-input');
    const annotateBtn = body.querySelector('.intel-annotate-btn');
    browser.opsList().then((ops) => {
      if (ops.length > 0) annotateBtn.disabled = false;
      annotateBtn.addEventListener('click', async () => {
        if (!annotateInput.value.trim()) return;
        if (ops.length === 0) return;
        const targetOp = ops.find((o) => o.id === (active?.operationId)) || ops[0];
        await browser.opsAnnotate(targetOp.id, annotateInput.value.trim(), active?.url || '');
        annotateInput.value = '';
        annotateBtn.textContent = 'Added!';
        setTimeout(() => { annotateBtn.textContent = 'Add to Operation'; }, 1500);
      });
    });

    // Wire quick lookup form
    const lookupInput = body.querySelector('.intel-lookup-input');
    const lookupBtn = body.querySelector('.intel-lookup-btn');
    if (lookupBtn) {
      lookupBtn.addEventListener('click', () => {
        if (lookupInput.value.trim()) performOsintLookup(lookupInput.value.trim());
      });
      lookupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && lookupInput.value.trim()) performOsintLookup(lookupInput.value.trim());
      });
    }
  }

  function performOsintLookup(value, type) {
    const v = encodeURIComponent(value);
    const detectedType = type || detectEntityType(value);
    let url;
    switch (detectedType) {
      case 'ip':
        url = 'https://www.shodan.io/host/' + v;
        break;
      case 'domain':
        url = 'https://www.virustotal.com/gui/domain/' + v;
        break;
      case 'email':
        url = 'https://haveibeenpwned.com/unifiedsearch/' + v;
        break;
      case 'hash':
        url = 'https://www.virustotal.com/gui/search/' + v;
        break;
      default:
        url = 'https://www.virustotal.com/gui/search/' + v;
    }
    browser.newTab(url);
  }

  function detectEntityType(val) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(val)) return 'ip';
    if (/^[a-fA-F0-9]{32,64}$/.test(val)) return 'hash';
    if (/@/.test(val)) return 'email';
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(val)) return 'domain';
    return 'unknown';
  }

  function closeIntelSidebar() {
    if (intelSidebar) { intelSidebar.remove(); intelSidebar = null; }
    intelVisible = false;
    browser.settingsCollapse();
  }

  // Quick OSINT lookup (Ctrl+Shift+O)
  let osintLookupEl = null;

  function openQuickOsintLookup() {
    if (osintLookupEl) { osintLookupEl.remove(); osintLookupEl = null; return; }
    browser.settingsExpand();
    osintLookupEl = document.createElement('div');
    osintLookupEl.className = 'tab-search-overlay';
    osintLookupEl.innerHTML =
      '<div class="tab-search-card">' +
      '  <input type="text" class="tab-search-input" placeholder="Enter IP, domain, hash, or email for OSINT lookup…" spellcheck="false" />' +
      '  <div class="tab-search-list osint-tools">' +
      '    <button class="tab-search-row" data-tool="shodan">Shodan — IP/host lookup</button>' +
      '    <button class="tab-search-row" data-tool="virustotal">VirusTotal — file/URL/domain scan</button>' +
      '    <button class="tab-search-row" data-tool="censys">Censys — internet scan data</button>' +
      '    <button class="tab-search-row" data-tool="hibp">Have I Been Pwned — breach check</button>' +
      '    <button class="tab-search-row" data-tool="urlscan">URLScan — website scanner</button>' +
      '    <button class="tab-search-row" data-tool="whois">WHOIS — domain registration</button>' +
      '    <button class="tab-search-row" data-tool="otx">AlienVault OTX — threat intel</button>' +
      '    <button class="tab-search-row" data-tool="greynoise">GreyNoise — IP noise context</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(osintLookupEl);

    const input = osintLookupEl.querySelector('.tab-search-input');
    input.focus();

    function doLookup(tool) {
      const val = input.value.trim();
      if (!val) return;
      const v = encodeURIComponent(val);
      const urls = {
        shodan: 'https://www.shodan.io/search?query=' + v,
        virustotal: 'https://www.virustotal.com/gui/search/' + v,
        censys: 'https://search.censys.io/search?q=' + v,
        hibp: 'https://haveibeenpwned.com/unifiedsearch/' + v,
        urlscan: 'https://urlscan.io/search/#' + v,
        whois: 'https://www.whois.com/whois/' + v,
        otx: 'https://otx.alienvault.com/indicator/search/' + v,
        greynoise: 'https://viz.greynoise.io/ip/' + v,
      };
      browser.newTab(urls[tool] || urls.virustotal);
      closeQuickOsintLookup();
    }

    osintLookupEl.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => doLookup(btn.dataset.tool));
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeQuickOsintLookup(); return; }
      if (e.key === 'Enter') doLookup('virustotal');
    });

    osintLookupEl.addEventListener('click', (e) => {
      if (e.target === osintLookupEl) closeQuickOsintLookup();
    });
  }

  function closeQuickOsintLookup() {
    if (osintLookupEl) { osintLookupEl.remove(); osintLookupEl = null; }
    browser.settingsCollapse();
  }

  // ------------------------------------------------------------------
  // Operation Switcher (Ctrl+Shift+O alias on main menu)
  // ------------------------------------------------------------------

  let opsSwitcherEl = null;

  async function openOperationSwitcher() {
    if (opsSwitcherEl) { closeOperationSwitcher(); return; }
    browser.settingsExpand();
    opsSwitcherEl = document.createElement('div');
    opsSwitcherEl.className = 'tab-search-overlay';
    document.body.appendChild(opsSwitcherEl);

    const ops = await browser.opsList();

    let html = '<div class="tab-search-card ops-card">' +
      '<div class="ops-head"><span class="ops-title">Operations</span>' +
      '<button class="ops-new-btn" id="ops-new">+ New Operation</button></div>';

    if (ops.length === 0) {
      html += '<div class="panel-empty-msg" style="padding:20px">No operations yet. Create one to start compartmentalizing your investigation.</div>';
    } else {
      html += '<div class="tab-search-list">';
      for (const op of ops) {
        html += '<div class="tab-search-row ops-row" data-id="' + op.id + '">' +
          '<span class="ops-color-dot" style="background:' + (op.color || '#d4a843') + '"></span>' +
          '<span class="tab-search-title">' + esc(op.name) + '</span>' +
          '<span class="tab-search-url">' + op.tabCount + ' tabs · ' + op.annotationCount + ' notes</span>' +
          '<button class="row-del ops-del" data-id="' + op.id + '">&times;</button>' +
          '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    opsSwitcherEl.innerHTML = html;

    opsSwitcherEl.addEventListener('click', (e) => {
      if (e.target === opsSwitcherEl) closeOperationSwitcher();
    });

    document.getElementById('ops-new').addEventListener('click', () => {
      const name = prompt('Operation name:');
      if (!name) return;
      const colors = ['#d4a843', '#4a90e2', '#2ecc71', '#ff4e4e', '#a78bfa', '#fb923c', '#22d3ee'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      browser.opsCreate(name, color).then(() => {
        closeOperationSwitcher();
        openOperationSwitcher();
      });
    });

    opsSwitcherEl.querySelectorAll('.ops-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('ops-del')) {
          browser.opsDelete(e.target.dataset.id).then(() => {
            closeOperationSwitcher();
            openOperationSwitcher();
          });
          return;
        }
        browser.opsSetActive(row.dataset.id);
        closeOperationSwitcher();
      });
    });
  }

  function closeOperationSwitcher() {
    if (opsSwitcherEl) { opsSwitcherEl.remove(); opsSwitcherEl = null; }
    browser.settingsCollapse();
  }

  // ------------------------------------------------------------------
  // Dwell time indicator + reading time in URL bar
  // ------------------------------------------------------------------

  let dwellEl = null;
  let dwellTimer = null;

  function startDwellTimer() {
    if (dwellTimer) clearInterval(dwellTimer);
    dwellTimer = setInterval(updateDwellDisplay, 5000);
    updateDwellDisplay();
  }

  async function updateDwellDisplay() {
    if (!activeId) return;
    const ms = await browser.getDwellTime(activeId).catch(() => 0);
    if (!dwellEl) {
      dwellEl = document.createElement('span');
      dwellEl.className = 'dwell-indicator';
      const toolbar = document.querySelector('.toolbar');
      if (toolbar) toolbar.appendChild(dwellEl);
    }
    const secs = Math.floor(ms / 1000);
    if (secs < 60) dwellEl.textContent = secs + 's';
    else if (secs < 3600) dwellEl.textContent = Math.floor(secs / 60) + 'm';
    else dwellEl.textContent = Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
  }

  startDwellTimer();

  // ------------------------------------------------------------------
  // Extensions panel
  // ------------------------------------------------------------------

  function renderExtensionsPanel(container) {
    container.innerHTML =
      '<div class="settings-card side-panel">' +
      '  <header class="settings-head"><h2>Extensions</h2>' +
      '    <div class="head-actions">' +
      '      <button class="settings-btn" id="ext-install">Load unpacked</button>' +
      '      <button class="settings-btn" id="ext-open-dir">Open folder</button>' +
      '      <button class="settings-close panel-close-btn">&times;</button>' +
      '    </div></header>' +
      '  <div class="panel-list" id="ext-list"></div>' +
      '</div>';

    container.querySelector('.panel-close-btn').addEventListener('click', closePanel);
    container.addEventListener('click', (e) => { if (e.target === container) closePanel(); });

    const listEl = document.getElementById('ext-list');

    function load() {
      browser.extensionsList().then((exts) => {
        if (!exts || exts.length === 0) {
          listEl.innerHTML = '<div class="panel-empty-msg">No extensions installed.<br>Click "Load unpacked" to add a Chrome extension.</div>';
          return;
        }
        listEl.innerHTML = exts.map((ext) =>
          '<div class="panel-row ext-row" data-id="' + escapeAttr(ext.id) + '">' +
          '  <span class="row-title">' + esc(ext.name) + '</span>' +
          '  <span class="row-meta">v' + esc(ext.version || '?') + '</span>' +
          '  <button class="row-del" title="Remove">&times;</button>' +
          '</div>'
        ).join('');

        listEl.querySelectorAll('.ext-row .row-del').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = btn.closest('.ext-row');
            browser.extensionsRemove(row.dataset.id).then(() => load());
          });
        });
      });
    }

    document.getElementById('ext-install').addEventListener('click', () => {
      browser.extensionsPickFolder().then((result) => {
        if (result && result.error) {
          listEl.innerHTML = '<div class="panel-empty-msg" style="color:var(--text-danger)">' + esc(result.error) + '</div>';
        } else {
          load();
        }
      });
    });

    document.getElementById('ext-open-dir').addEventListener('click', () => {
      browser.extensionsOpenDir();
    });

    load();
  }

  // ------------------------------------------------------------------
  // Tab search (Ctrl+Shift+A)
  // ------------------------------------------------------------------

  let tabSearchEl = null;

  function openTabSearch() {
    if (tabSearchEl) { closeTabSearch(); return; }
    browser.settingsExpand();
    tabSearchEl = document.createElement('div');
    tabSearchEl.className = 'tab-search-overlay';
    tabSearchEl.innerHTML =
      '<div class="tab-search-card">' +
      '  <input type="text" class="tab-search-input" placeholder="Search open tabs…" spellcheck="false" />' +
      '  <div class="tab-search-list"></div>' +
      '</div>';
    document.body.appendChild(tabSearchEl);

    const input = tabSearchEl.querySelector('.tab-search-input');
    const listEl = tabSearchEl.querySelector('.tab-search-list');

    function renderResults() {
      const q = (input.value || '').toLowerCase();
      const matches = tabs.filter((t) => {
        if (!q) return true;
        return (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q);
      });
      listEl.innerHTML = matches.map((t) =>
        '<button class="tab-search-row' + (t.id === activeId ? ' is-active' : '') + '" data-id="' + t.id + '">' +
        '<span class="tab-search-favicon">' +
          (t.favicon ? '<img src="' + escapeAttr(t.favicon) + '" onerror="this.parentElement.textContent=\'○\'" />' : (t.isHomepage ? '◉' : '○')) +
        '</span>' +
        '<span class="tab-search-title">' + esc(t.title || 'New Tab') + '</span>' +
        '<span class="tab-search-url">' + esc(shortUrl(t.url)) + '</span>' +
        '</button>'
      ).join('');

      listEl.querySelectorAll('.tab-search-row').forEach((row) => {
        row.addEventListener('click', () => {
          browser.switchTab(row.dataset.id);
          closeTabSearch();
        });
      });
    }

    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeTabSearch(); return; }
      if (e.key === 'Enter') {
        const first = listEl.querySelector('.tab-search-row');
        if (first) { browser.switchTab(first.dataset.id); closeTabSearch(); }
      }
    });

    tabSearchEl.addEventListener('click', (e) => {
      if (e.target === tabSearchEl) closeTabSearch();
    });

    renderResults();
    input.focus();
  }

  function closeTabSearch() {
    if (tabSearchEl) { tabSearchEl.remove(); tabSearchEl = null; }
    browser.settingsCollapse();
  }

  // ------------------------------------------------------------------
  // Enhanced render: pin/mute badges, pinned tabs first
  // ------------------------------------------------------------------

  function buildTabElEnhanced(tab) {
    const el = buildTabEl(tab);
    if (tab.pinned) el.classList.add('is-pinned');
    if (tab.operationColor) {
      el.style.setProperty('--op-color', tab.operationColor);
      el.classList.add('has-operation');
    }
    // Tab heat map: highlight frequently visited tabs
    if (tab.dwellTime > 0) {
      const heat = Math.min(tab.dwellTime / 300000, 1);
      if (heat > 0.3) {
        el.style.setProperty('--tab-heat', heat.toFixed(2));
        el.classList.add('has-heat');
      }
    }
    // Tab preview on hover
    let previewTimer = null;
    let previewEl = null;
    el.addEventListener('mouseenter', () => {
      if (tab.id === activeId) return;
      previewTimer = setTimeout(async () => {
        const src = await browser.tabPreview(tab.id).catch(() => null);
        if (!src) return;
        previewEl = document.createElement('div');
        previewEl.className = 'tab-preview';
        previewEl.innerHTML = '<img src="' + src + '" /><div class="tab-preview-title">' + esc(tab.title) + '</div>';
        const rect = el.getBoundingClientRect();
        previewEl.style.left = rect.left + 'px';
        previewEl.style.top = (rect.bottom + 4) + 'px';
        document.body.appendChild(previewEl);
      }, 600);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(previewTimer);
      if (previewEl) { previewEl.remove(); previewEl = null; }
    });
    if (tab.muted) {
      const badge = document.createElement('span');
      badge.className = 'tab-muted';
      badge.title = 'Muted';
      badge.textContent = '🔇';
      el.insertBefore(badge, el.querySelector('.tab-close'));
    }
    if (tab.audible && !tab.muted) {
      const badge = document.createElement('span');
      badge.className = 'tab-audible';
      badge.title = 'Playing audio';
      badge.textContent = '🔊';
      badge.addEventListener('click', (e) => { e.stopPropagation(); browser.muteTab(tab.id); });
      el.insertBefore(badge, el.querySelector('.tab-close'));
    }
    return el;
  }

  function renderEnhanced() {
    tabsEl.innerHTML = '';
    const pinned = tabs.filter((t) => t.pinned);
    const unpinned = tabs.filter((t) => !t.pinned);
    for (const tab of pinned.concat(unpinned)) {
      tabsEl.appendChild(buildTabElEnhanced(tab));
    }
    renderNavState();
    renderUrlBar();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function shortUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }
  function timeAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
})();
