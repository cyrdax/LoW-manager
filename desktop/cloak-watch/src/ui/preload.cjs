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
    const handler = async (_event, requestId) => {
      try {
        await listener();
        ipcRenderer.send('cloak-watch:play-ping-result', requestId, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ipcRenderer.send('cloak-watch:play-ping-result', requestId, message);
      }
    };
    ipcRenderer.on('cloak-watch:play-ping', handler);
    return () => ipcRenderer.removeListener('cloak-watch:play-ping', handler);
  },
});
