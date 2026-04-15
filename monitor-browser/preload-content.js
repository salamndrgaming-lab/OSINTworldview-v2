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
});
