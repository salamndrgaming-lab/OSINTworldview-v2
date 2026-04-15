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

  // Window controls (custom titlebar)
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Subscribe to tab list updates from the main process.
  onTabsUpdated: (handler) => {
    const listener = (_event, payload) => {
      try {
        handler(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[chrome] tabs handler threw', err);
      }
    };
    ipcRenderer.on('tabs:updated', listener);
    return () => ipcRenderer.off('tabs:updated', listener);
  },
});
