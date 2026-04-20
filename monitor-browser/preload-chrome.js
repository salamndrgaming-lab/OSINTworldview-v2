// Preload for the browser-chrome renderer (the tab bar / URL bar UI).
// Exposes a narrow, typed API so the renderer never touches Electron
// modules directly.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  // Tab lifecycle
  newTab: (url) => ipcRenderer.invoke('tab:new', url),
  closeTab: (id) => ipcRenderer.invoke('tab:close', id),
  switchTab: (id) => ipcRenderer.invoke('tab:switch', id),
  navigate: (id, url) => ipcRenderer.invoke('tab:navigate', id, url),
  back: (id) => ipcRenderer.invoke('tab:back', id),
  forward: (id) => ipcRenderer.invoke('tab:forward', id),
  reload: (id) => ipcRenderer.invoke('tab:reload', id),
  stop: (id) => ipcRenderer.invoke('tab:stop', id),
  home: (id) => ipcRenderer.invoke('tab:home', id),
  devtools: (id) => ipcRenderer.invoke('tab:devtools', id),
  duplicateTab: (id) => ipcRenderer.invoke('tab:duplicate', id),
  pinTab: (id) => ipcRenderer.invoke('tab:pin', id),
  muteTab: (id) => ipcRenderer.invoke('tab:mute', id),
  reorderTab: (fromId, toId) => ipcRenderer.invoke('tab:reorder', fromId, toId),
  reopenTab: () => ipcRenderer.invoke('tab:reopen'),

  // Find in page
  findStart: (text, opts) => ipcRenderer.invoke('find:start', text, opts),
  findNext: (text, forward) => ipcRenderer.invoke('find:next', text, forward),
  findStop: () => ipcRenderer.invoke('find:stop'),

  // Zoom
  zoomIn: () => ipcRenderer.invoke('zoom:in'),
  zoomOut: () => ipcRenderer.invoke('zoom:out'),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),

  // Print / fullscreen / PDF / PiP / Reader / Intel
  print: () => ipcRenderer.invoke('page:print'),
  savePdf: () => ipcRenderer.invoke('page:save-pdf'),
  pip: () => ipcRenderer.invoke('page:pip'),
  reader: () => ipcRenderer.invoke('page:reader'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  extractEntities: () => ipcRenderer.invoke('page:extract-entities'),
  getCredibility: (url) => ipcRenderer.invoke('page:credibility', url),
  getCounterfactual: () => ipcRenderer.invoke('page:counterfactual'),

  // Window controls (custom titlebar)
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  incognito: () => ipcRenderer.invoke('window:incognito'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Bookmarks
  bookmarksList: () => ipcRenderer.invoke('bookmarks:list'),
  bookmarksAdd: (entry) => ipcRenderer.invoke('bookmarks:add', entry),
  bookmarksRemove: (url) => ipcRenderer.invoke('bookmarks:remove', url),
  bookmarksMove: (url, folder) => ipcRenderer.invoke('bookmarks:move', url, folder),

  // History
  historyList: (query, limit) => ipcRenderer.invoke('history:list', query, limit),
  historyClear: (since) => ipcRenderer.invoke('history:clear', since),

  // Downloads
  downloadsList: () => ipcRenderer.invoke('downloads:list'),
  downloadsCancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
  downloadsReveal: (id) => ipcRenderer.invoke('downloads:reveal', id),
  onDownloadsUpdated: (handler) => {
    const listener = (_e, payload) => { try { handler(payload); } catch (err) { console.error('[chrome] downloads handler threw', err); } };
    ipcRenderer.on('downloads:updated', listener);
    return () => ipcRenderer.off('downloads:updated', listener);
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  clearBrowsingData: () => ipcRenderer.invoke('settings:clear-data'),
  settingsExpand: () => ipcRenderer.invoke('window:settings-expand'),
  settingsCollapse: () => ipcRenderer.invoke('window:settings-collapse'),
  onSettingsChanged: (handler) => {
    const listener = (_e, payload) => { try { handler(payload); } catch (err) { console.error('[chrome] settings handler threw', err); } };
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.off('settings:changed', listener);
  },

  // Operations (investigations)
  opsList: () => ipcRenderer.invoke('ops:list'),
  opsGet: (id) => ipcRenderer.invoke('ops:get', id),
  opsCreate: (name, color) => ipcRenderer.invoke('ops:create', name, color),
  opsDelete: (id) => ipcRenderer.invoke('ops:delete', id),
  opsRename: (id, name) => ipcRenderer.invoke('ops:rename', id, name),
  opsSetColor: (id, color) => ipcRenderer.invoke('ops:set-color', id, color),
  opsAssignTab: (tabId, opId) => ipcRenderer.invoke('ops:assign-tab', tabId, opId),
  opsSetActive: (opId) => ipcRenderer.invoke('ops:set-active', opId),
  opsAnnotate: (opId, text, url) => ipcRenderer.invoke('ops:annotate', opId, text, url),
  muteAll: () => ipcRenderer.invoke('tabs:mute-all'),
  getDwellTime: (id) => ipcRenderer.invoke('tab:dwell-time', id),
  getReadingTime: () => ipcRenderer.invoke('page:reading-time'),

  // Chrome extensions
  extensionsList: () => ipcRenderer.invoke('extensions:list'),
  extensionsInstall: (path) => ipcRenderer.invoke('extensions:install', path),
  extensionsRemove: (id) => ipcRenderer.invoke('extensions:remove', id),
  extensionsOpenDir: () => ipcRenderer.invoke('extensions:open-dir'),
  extensionsPickFolder: () => ipcRenderer.invoke('extensions:pick-folder'),

  // Security / certificates
  securityInfo: () => ipcRenderer.invoke('page:security-info'),

  // Per-site permissions
  permissionsGet: (origin) => ipcRenderer.invoke('permissions:get', origin),
  permissionsSet: (origin, perm, value) => ipcRenderer.invoke('permissions:set', origin, perm, value),
  permissionsList: () => ipcRenderer.invoke('permissions:list'),
  permissionsRemoveSite: (origin) => ipcRenderer.invoke('permissions:remove-site', origin),

  // Subscribe to tab list updates from the main process.
  onTabsUpdated: (handler) => {
    const listener = (_event, payload) => {
      try {
        handler(payload);
      } catch (err) {
        console.error('[chrome] tabs handler threw', err);
      }
    };
    ipcRenderer.on('tabs:updated', listener);
    return () => ipcRenderer.off('tabs:updated', listener);
  },
});
