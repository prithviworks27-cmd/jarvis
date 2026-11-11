const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { transcribe } = require('./stt');
const { ask, cancel } = require('./brain');
const speech = require('./speak');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env yet; handled in handleAudio */ }

const HOTKEY = process.env.JARVIS_HOTKEY || 'Alt+Space';
let win;
// One transparent, click-through window covers the screen so the character can roam anywhere in it.
const screenBounds = () => screen.getPrimaryDisplay().workArea;
// A second copy (e.g. autostart plus a manual `npm start`) would answer every question twice.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let helper;
// Double-tap Control: a tiny Swift helper watches the modifier key (Electron's globalShortcut can't do modifier-only keys).
function startDoubleTap() {
  const src = path.join(__dirname, 'helpers/doubletap.swift');
  const bin = path.join(__dirname, 'bin/doubletap');
  const launch = () => {
    helper = spawn(bin);
    helper.stdout.on('data', (d) => d.toString().includes('double') && win.webContents.send('toggle'));
    helper.stderr.on('data', (d) => { console.error(d.toString()); send({ state: 'idle', error: d.toString().trim() }); });
  };
  const fresh = fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs;
  if (fresh) return launch();
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  execFile('swiftc', ['-swift-version', '5', '-O', src, '-o', bin], (err) => {
    if (err) console.error('Double-tap Control disabled (needs Xcode command line tools: xcode-select --install). Option+Space still works.');
    else launch();
  });
}

const send = (msg) => win && !win.isDestroyed() && win.webContents.send('state', msg);

async function handleAudio(buf) {
  try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing. Copy .env.example to .env and add your key.');
    if (buf.byteLength < 2000) return send({ state: 'idle' }); // too short to be speech
    send({ state: 'thinking' });
    const t0 = Date.now();
    const you = (await transcribe(Buffer.from(buf))).trim();
    const t1 = Date.now();
    if (!you) return send({ state: 'idle' });
    send({ state: 'thinking', you });
    const jarvis = await ask(you);
    console.log(`timing: speech-to-text ${t1 - t0}ms, brain ${Date.now() - t1}ms`);
    if (!jarvis) return send({ state: 'idle', you }); // an action that needs no words
    send({ state: 'speaking', you, jarvis });
    await speech.speak(jarvis);
    send({ state: 'idle', you, jarvis });
  } catch (e) {
    console.error(e);
    send({ state: 'idle', error: e.message });
  }
}

if (gotLock) app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone');

  win = new BrowserWindow({
    ...screenBounds(), frame: false, transparent: true, alwaysOnTop: true, hasShadow: false,
    resizable: false, skipTaskbar: true, focusable: false, // never steals focus from the app you're working in
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true }); // the renderer turns this off while the cursor is over the character
  const fit = () => win.setBounds(screenBounds());
  screen.on('display-metrics-changed', fit);
  win.once('ready-to-show', fit); // macOS can nudge a screen-sized window off its spot; put it back
  win.on('moved', fit);
  win.loadFile('index.html');
  app.dock?.hide(); // Siri-style: no Dock icon; right-click the character to quit

  if (!globalShortcut.register(HOTKEY, () => win.webContents.send('toggle'))) {
    console.error(`Could not register ${HOTKEY}; double-tap Control still works, or set JARVIS_HOTKEY.`);
  }
  startDoubleTap();
  speech.warm();
  ipcMain.on('listen-start', () => { speech.stop(); cancel(); }); // talking again also stops any action in progress
  ipcMain.on('audio', (_e, buf) => handleAudio(buf));
  ipcMain.on('interactive', (_e, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('menu', () => Menu.buildFromTemplate([{ label: 'Quit JARVIS', click: () => app.quit() }]).popup({ window: win }));
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); speech.stop(); speech.shutdown(); helper?.kill(); });
app.on('window-all-closed', () => app.quit());
