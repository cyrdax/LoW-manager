const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloakWatch', {
  getState: () => ipcRenderer.invoke('cloak-watch:get-state'),
  chooseLogDirectory: () => ipcRenderer.invoke('cloak-watch:choose-log-directory'),
  setSoundEnabled: (enabled) => ipcRenderer.invoke('cloak-watch:set-sound', Boolean(enabled)),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('cloak-watch:set-notifications', Boolean(enabled)),
  setStartAtLogin: (enabled) => ipcRenderer.invoke('cloak-watch:set-start-at-login', Boolean(enabled)),
  testAlert: () => ipcRenderer.invoke('cloak-watch:test-alert'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('cloak-watch:state', handler);
    return () => ipcRenderer.removeListener('cloak-watch:state', handler);
  },
  onPlayPing: (listener) => {
    ipcRenderer.on('cloak-watch:play-ping', listener);
    return () => ipcRenderer.removeListener('cloak-watch:play-ping', listener);
  },
});
