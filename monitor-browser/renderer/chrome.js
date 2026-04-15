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
})();
