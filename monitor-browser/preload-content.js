// Preload for every tab's content view. Exposes a narrow API that
// lets the homepage (loaded from file://) pull live OSINT data through
// a main-process proxy, which bypasses browser CORS restrictions.
//
// The `intel:fetch` IPC is origin-gated in main.js so arbitrary web
// pages cannot call it.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitorApi', {
  fetchIntel: (url) => ipcRenderer.invoke('intel:fetch', url),
  getYtEmbedPort: () => ipcRenderer.invoke('yt:embed-port'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettingsChanged: (handler) => {
    const listener = (_e, payload) => { try { handler(payload); } catch (err) { console.error('[monitor] settings handler threw', err); } };
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.off('settings:changed', listener);
  },
});
