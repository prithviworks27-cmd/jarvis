const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, session, systemPreferences } = require('electron');
const path = require('path');
const { transcribe } = require('./stt');
const { ask } = require('./brain');
const speech = require('./speak');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env yet; handled in handleAudio */ }

const HOTKEY = process.env.JARVIS_HOTKEY || 'Alt+Space';
const ORB = 100; // orb-only window size; grows (left/up) to fit the reply bubble
let win;
const cornerBounds = (w, h) => {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - w - 12, y: a.y + a.height - h - 12, width: w, height: h };
};
const send = (msg) => win && !win.isDestroyed() && win.webContents.send('state', msg);

async function handleAudio(buf) {
  try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing. Copy .env.example to .env and add your key.');
    if (buf.byteLength < 2000) return send({ state: 'idle' }); // too short to be speech
    send({ state: 'thinking' });
    const you = (await transcribe(Buffer.from(buf))).trim();
    if (!you) return send({ state: 'idle' });
    send({ state: 'thinking', you });
    const jarvis = await ask(you);
    send({ state: 'speaking', you, jarvis });
    await speech.speak(jarvis);
    send({ state: 'idle', you, jarvis });
  } catch (e) {
    console.error(e);
    send({ state: 'idle', error: e.message });
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone');

  win = new BrowserWindow({
    ...cornerBounds(ORB, ORB), frame: false, transparent: true, alwaysOnTop: true, hasShadow: false,
    resizable: false, skipTaskbar: true, focusable: false, // never steals focus from the app you're working in
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');
  app.dock?.hide(); // Siri-style: no Dock icon; right-click the orb to quit

  if (!globalShortcut.register(HOTKEY, () => win.webContents.send('toggle'))) {
    console.error(`Could not register ${HOTKEY}; click the orb instead or set JARVIS_HOTKEY.`);
  }
  ipcMain.on('listen-start', () => speech.stop());
  ipcMain.on('audio', (_e, buf) => handleAudio(buf));
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('resize', (_e, w, h) => win.setBounds(cornerBounds(Math.max(ORB, Math.ceil(w)), Math.max(ORB, Math.ceil(h)))));
  ipcMain.on('menu', () => Menu.buildFromTemplate([{ label: 'Quit JARVIS', click: () => app.quit() }]).popup({ window: win }));
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); speech.stop(); });
app.on('window-all-closed', () => app.quit());
