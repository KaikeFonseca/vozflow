const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vozflow', {
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onRecord: (fn) => ipcRenderer.on('record', (_e, cmd) => fn(cmd)),
  onHistory: (fn) => ipcRenderer.on('history', (_e, h) => fn(h)),
  sendAudio: (payload) => ipcRenderer.send('audio', payload),
  micError: (message) => ipcRenderer.send('mic-error', message),
  click: (action) => ipcRenderer.send('widget-click', action),
  copy: (text) => ipcRenderer.send('copy', text),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    download: (key) => ipcRenderer.invoke('whisper:download', key),
    onProgress: (fn) => ipcRenderer.on('whisper:progress', (_e, d) => fn(d))
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    paste: (id) => ipcRenderer.invoke('history:paste', id),
    retry: (id) => ipcRenderer.invoke('history:retry', id),
    clear: () => ipcRenderer.invoke('history:clear')
  }
});
