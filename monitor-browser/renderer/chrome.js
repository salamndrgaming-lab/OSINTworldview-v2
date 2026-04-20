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

  const readerBtn = document.getElementById('action-reader');
  const pipBtn = document.getElementById('action-pip');
  readerBtn.addEventListener('click', () => openReaderMode());
  pipBtn.addEventListener('click', () => browser.pip());

  document.getElementById('action-bookmarks').addEventListener('click', () => togglePanel('bookmarks'));
  document.getElementById('action-history').addEventListener('click', () => togglePanel('history'));
  document.getElementById('action-downloads').addEventListener('click', () => togglePanel('downloads'));
  document.getElementById('action-extensions').addEventListener('click', () => togglePanel('extensions'));

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
    acDropdown.innerHTML = merged.map((item, i) =>
      '<div class="ac-item" data-idx="' + i + '">' +
      '<span class="ac-icon">' + (item.type === 'bookmark' ? '★' : '↻') + '</span>' +
      '<span class="ac-title">' + esc(item.title) + '</span>' +
      '<span class="ac-url">' + esc(shortUrl(item.url)) + '</span>' +
      '</div>'
    ).join('');

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
      case 'b':
        if (e.shiftKey) { e.preventDefault(); togglePanel('bookmarks'); }
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

  // Load initial settings.
  browser.getSettings().then((res) => {
    currentSettings = res.settings || {};
    settingsMeta = { searchEngines: res.searchEngines || {}, themes: res.themes || {} };
    applyThemeToChrome(currentSettings.theme);
    applyIncognitoMode(currentSettings.incognito);
  }).catch(() => {});

  browser.onSettingsChanged((s) => {
    currentSettings = s || currentSettings;
    applyThemeToChrome(currentSettings.theme);
    applyIncognitoMode(currentSettings.incognito);
    if (typeof refreshBookmarksBar === 'function') refreshBookmarksBar();
  });

  settingsBtn.addEventListener('click', () => openSettings());

  function openSettings() {
    browser.settingsExpand();
    settingsOverlay.classList.remove('hidden');

    const engines = Object.entries(settingsMeta.searchEngines);
    const themes = Object.entries(settingsMeta.themes);

    const zoomLabels = { '-3': '50%', '-2': '67%', '-1': '80%', '0': '100%', '1': '125%', '2': '150%', '3': '175%', '4': '200%' };
    const startupOpts = { homepage: 'Open Monitor Home', blank: 'Open blank tab', restore: 'Restore last session' };

    settingsOverlay.innerHTML =
      '<div class="settings-card">' +
      '  <header class="settings-head">' +
      '    <h2>Settings</h2>' +
      '    <button class="settings-close" id="settings-close" title="Close">&times;</button>' +
      '  </header>' +
      '  <div class="settings-body">' +

      '    <section class="settings-section">' +
      '      <h3>On startup</h3>' +
      '      <select id="set-startup">' +
             Object.entries(startupOpts).map(([k, label]) =>
               '<option value="' + k + '"' + ((currentSettings.startupBehavior || 'homepage') === k ? ' selected' : '') + '>' +
               label + '</option>'
             ).join('') +
      '      </select>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Homepage</h3>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-use-custom-home"' +
             (currentSettings.useCustomHomepage ? ' checked' : '') +
      '       /> Use custom homepage URL</label>' +
      '      <input type="text" class="settings-input" id="set-custom-home" placeholder="https://example.com"' +
      '        value="' + escapeAttr(currentSettings.customHomepage || '') + '"' +
             (!currentSettings.useCustomHomepage ? ' disabled' : '') + ' />' +
      '    </section>' +

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
      '      <h3>Default zoom</h3>' +
      '      <select id="set-zoom">' +
             Object.entries(zoomLabels).map(([val, label]) =>
               '<option value="' + val + '"' + (String(currentSettings.defaultZoom || 0) === val ? ' selected' : '') + '>' +
               label + '</option>'
             ).join('') +
      '      </select>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Privacy &amp; Security</h3>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-adblock"' +
             (currentSettings.adBlock !== false ? ' checked' : '') +
      '       /> Block ads &amp; trackers</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-https-only"' +
             (currentSettings.httpsOnly ? ' checked' : '') +
      '       /> HTTPS-only mode</label>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-branding"' +
             (currentSettings.showBranding !== false ? ' checked' : '') +
      '       /> Show MonitorBrowser/1.0 in user-agent</label>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Toolbar</h3>' +
      '      <label class="toggle-row"><input type="checkbox" id="set-bm-bar"' +
             (currentSettings.showBookmarksBar ? ' checked' : '') +
      '       /> Show bookmarks bar</label>' +
      '    </section>' +

      '    <section class="settings-section">' +
      '      <h3>Data</h3>' +
      '      <button class="settings-btn" id="clear-data">Clear browsing data</button>' +
      '      <button class="settings-btn" id="reset-settings">Reset all settings</button>' +
      '    </section>' +
      '    <section class="settings-section">' +
      '      <h3>Site permissions</h3>' +
      '      <button class="settings-btn" id="manage-perms">Manage site permissions</button>' +
      '    </section>' +
      '  </div>' +
      '</div>';

    document.getElementById('settings-close').addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) closeSettings();
    });

    document.getElementById('set-startup').addEventListener('change', (e) => {
      browser.setSettings({ startupBehavior: e.target.value });
    });

    const customHomeCheck = document.getElementById('set-use-custom-home');
    const customHomeInput = document.getElementById('set-custom-home');
    customHomeCheck.addEventListener('change', (e) => {
      customHomeInput.disabled = !e.target.checked;
      browser.setSettings({ useCustomHomepage: e.target.checked });
    });
    customHomeInput.addEventListener('change', (e) => {
      browser.setSettings({ customHomepage: e.target.value.trim() });
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

    document.getElementById('set-zoom').addEventListener('change', (e) => {
      browser.setSettings({ defaultZoom: parseFloat(e.target.value) });
    });

    document.getElementById('set-bm-bar').addEventListener('change', (e) => {
      browser.setSettings({ showBookmarksBar: e.target.checked });
    });

    document.getElementById('set-adblock').addEventListener('change', (e) => {
      browser.setSettings({ adBlock: e.target.checked });
    });

    document.getElementById('set-https-only').addEventListener('change', (e) => {
      browser.setSettings({ httpsOnly: e.target.checked });
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

    document.getElementById('manage-perms').addEventListener('click', () => {
      closeSettings();
      togglePanel('permissions');
    });
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
    settingsOverlay.innerHTML = '';
    browser.settingsCollapse();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
      { label: 'Close tab', action: () => browser.closeTab(tabId), danger: true },
      { label: 'Close other tabs', action: () => {
        tabs.filter((t) => t.id !== tabId && !t.pinned).forEach((t) => browser.closeTab(t.id));
      }, danger: true },
    ];

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

  function removeContextMenu() {
    const old = document.querySelector('.ctx-menu');
    if (old) old.remove();
  }

  // ------------------------------------------------------------------
  // Side panels (bookmarks, history, downloads)
  // ------------------------------------------------------------------

  let activePanelId = null;

  function togglePanel(id) {
    if (activePanelId === id) { closePanel(); return; }
    closePanel();
    activePanelId = id;
    browser.settingsExpand();
    const overlay = settingsOverlay;
    overlay.classList.remove('hidden');

    if (id === 'bookmarks') renderBookmarksPanel(overlay);
    else if (id === 'history') renderHistoryPanel(overlay);
    else if (id === 'downloads') renderDownloadsPanel(overlay);
    else if (id === 'permissions') renderPermissionsPanel(overlay);
    else if (id === 'extensions') renderExtensionsPanel(overlay);
  }

  function closePanel() {
    activePanelId = null;
    settingsOverlay.classList.add('hidden');
    settingsOverlay.innerHTML = '';
    browser.settingsCollapse();
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
