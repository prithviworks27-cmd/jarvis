const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onToggle: (cb) => ipcRenderer.on('toggle', () => cb('ask')),
  onWake: (cb) => ipcRenderer.on('wake', () => cb()),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  log: (msg) => ipcRenderer.send('log', msg),
  problem: (kind) => ipcRenderer.send('problem', kind),
  listenEnd: () => ipcRenderer.send('listen-end'),
  onDictate: (cb) => ipcRenderer.on('dictate', () => cb('dictate')),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onCaption: (cb) => ipcRenderer.on('caption', (_e, c) => cb(c)),
  listenStarted: () => ipcRenderer.send('listen-start'),
  sendAudio: (buf, mode) => ipcRenderer.send('audio', buf, mode),
  interactive: (on) => ipcRenderer.send('interactive', on),
  menu: () => ipcRenderer.send('menu'),
});
