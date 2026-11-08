'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
  version: process.env.CARNAGE_APP_VERSION || '',
  electronVersion: process.versions.electron,
  openExternal: (url) => ipcRenderer.invoke('carnage:open-external', url),
  notify: (title, body) => ipcRenderer.invoke('carnage:notify', { title, body }),
  getVersion: () => ipcRenderer.invoke('carnage:version'),
  getBuildInfo: () => ipcRenderer.invoke('carnage:build-info'),
  downloadUpdate: (payload) => ipcRenderer.invoke('carnage:update-download', payload),
  installUpdate: (payload) => ipcRenderer.invoke('carnage:update-install', payload),
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('carnage:update-progress', listener);
    return () => ipcRenderer.removeListener('carnage:update-progress', listener);
  },
  getDataPath: () => ipcRenderer.invoke('carnage:data-path'),
  getServerConfig: () => ipcRenderer.invoke('carnage:server-config'),
  setServer: (payload) => ipcRenderer.invoke('carnage:set-server', payload),
  retryServer: () => ipcRenderer.invoke('carnage:retry-server'),
  focus: () => ipcRenderer.invoke('carnage:focus'),
  listScreenSources: () => ipcRenderer.invoke('carnage:screen-sources'),
  selectScreenSource: (sourceId) => ipcRenderer.invoke('carnage:screen-select', sourceId),
  setPtt: (key) => ipcRenderer.invoke('carnage:ptt-set', { key }),
  onPtt: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('carnage:ptt', listener);
    return () => ipcRenderer.removeListener('carnage:ptt', listener);
  },
});
