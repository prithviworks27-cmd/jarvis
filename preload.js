const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onToggle: (cb) => ipcRenderer.on('toggle', cb),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  listenStarted: () => ipcRenderer.send('listen-start'),
  sendAudio: (buf) => ipcRenderer.send('audio', buf),
  resize: (w, h) => ipcRenderer.send('resize', w, h),
  menu: () => ipcRenderer.send('menu'),
  quit: () => ipcRenderer.send('quit'),
});
