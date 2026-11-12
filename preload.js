const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onToggle: (cb) => ipcRenderer.on('toggle', () => cb('ask')),
  onWake: (cb) => ipcRenderer.on('wake', () => cb()),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  listenEnd: () => ipcRenderer.send('listen-end'),
  onDictate: (cb) => ipcRenderer.on('dictate', () => cb('dictate')),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  listenStarted: () => ipcRenderer.send('listen-start'),
  sendAudio: (buf, mode) => ipcRenderer.send('audio', buf, mode),
  interactive: (on) => ipcRenderer.send('interactive', on),
  menu: () => ipcRenderer.send('menu'),
});
