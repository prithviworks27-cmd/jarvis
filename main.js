const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile, execFileSync, spawn } = require('child_process');
const os = require('os');
const { ensure, ensureApp } = require('./helpers');
const { transcribe } = require('./stt');
const { ask, cancel } = require('./brain');
const speech = require('./speak');
const { cleanDictation, pasteText } = require('./dictate');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env yet; handled in handleAudio */ }

const HOTKEY = process.env.JARVIS_HOTKEY || 'Alt+Space';
const DICTATE_HOTKEY = process.env.JARVIS_DICTATE_HOTKEY || 'Alt+Shift+Space';
let win;
// One transparent, click-through window covers the screen so the character can roam anywhere in it.
const screenBounds = () => screen.getPrimaryDisplay().workArea;
// A second copy (e.g. autostart plus a manual `npm start`) would answer every question twice.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let helper;
// Double-tap Control: a tiny Swift helper watches the modifier key (Electron's globalShortcut can't do modifier-only keys).
function startDoubleTap() {
  ensure('doubletap').then((bin) => {
    helper = spawn(bin);
    helper.stdout.on('data', (d) => d.toString().includes('double') && win.webContents.send('toggle'));
    helper.stderr.on('data', (d) => { console.error(d.toString()); send({ state: 'idle', error: d.toString().trim() }); });
  }).catch((e) => console.error(`${e.message} Double-tap Control is off; Option+Space still works.`));
}

// The Mac's OCR needs a long first start (about a minute, once per restart of the Mac). Do it now, quietly, so it is ready when needed.
function warmOcr() {
  ensure('ocr').then((bin) => {
    const file = path.join(os.tmpdir(), `jarvis-warm-${process.pid}.png`);
    execFile('screencapture', ['-x', '-R', '0,0,200,60', '-t', 'png', file], (err) => {
      if (err) return;
      execFile(bin, [file], () => fs.unlink(file, () => {}));
    });
  }).catch(() => {});
}


// Wake word (the assistant's name, Alfred by default): a helper app listens on this Mac only (macOS on-device speech recognition, no network) and reports "wake".
// It is its own app so macOS asks for microphone/speech access in its name; we talk to it through two pipes.
let wakeDir, wakeCmd, wakeEvents, wakeOn = true;
const wakeEnabled = () => process.env.JARVIS_WAKE !== '0';
const assistantName = () => process.env.JARVIS_NAME || 'Alfred';
function wakeListening(on) {
  if (!wakeCmd || on === wakeOn) return;
  wakeOn = on;
  try { fs.writeSync(wakeCmd, on ? 'resume\n' : 'pause\n'); } catch { /* helper gone */ }
}
function startWake() {
  if (!wakeEnabled()) return;
  ensureApp('wake', 'JarvisWake').then((app) => {
    wakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wake-'));
    const [cmd, ev, err] = ['cmd', 'ev', 'err'].map((n) => path.join(wakeDir, n));
    execFileSync('mkfifo', [cmd, ev]);
    fs.writeFileSync(err, '');
    // Open both pipes ourselves (read+write) first so neither end can block. When this process dies the helper sees the pipe close and quits.
    wakeCmd = fs.openSync(cmd, 'r+');
    let pending = '';
    // A socket on the pipe is non-blocking; a plain file stream would park a thread in read() and keep JARVIS from quitting.
    wakeEvents = new net.Socket({ fd: fs.openSync(ev, 'r+'), readable: true, writable: false });
    wakeEvents.on('data', (d) => {
      pending += d.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (line === 'wake') { if (process.env.JARVIS_WAKE_DEBUG === '1') console.log('wake word detected'); win.webContents.send('wake'); }
        else if (line.startsWith('heard:')) { if (process.env.JARVIS_WAKE_DEBUG === '1') console.log(`wake word heard: ${line.slice(6).trim()}`); }
        else if (line.startsWith('error:')) { console.error(line); send({ state: 'idle', error: `${line.slice(6).trim()} Hotkeys still work.` }); }
      }
    });
    execFile('open', ['-n', '-g', app, '--stdin', cmd, '--stdout', ev, '--stderr', err, '--args', assistantName().toLowerCase()]);
  }).catch((e) => console.error(`${e.message} The wake word is off; hotkeys still work.`));
}

// Short sounds say "I am listening" / "got it" when you are not looking at the screen. JARVIS_SOUNDS=0 turns them off.
const cue = (name) => process.env.JARVIS_SOUNDS !== '0' && execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {});

const send = (msg) => {
  if (msg.state) wakeListening(msg.state === 'idle'); // not while JARVIS thinks or talks: it must not hear itself
  return win && !win.isDestroyed() && win.webContents.send('state', msg);
};

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

// Dictation: speech to text, pasted into the app in front. The brain and its tools are not involved.
async function handleDictation(buf) {
  try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing. Copy .env.example to .env and add your key.');
    if (buf.byteLength < 2000) return send({ state: 'idle' });
    send({ state: 'thinking' });
    const text = cleanDictation(await transcribe(Buffer.from(buf)));
    if (text) await pasteText(text);
    send({ state: 'idle' });
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
  win.webContents.on('did-finish-load', () => win.webContents.send('config', { wake: wakeEnabled() }));
  win.loadFile('index.html');
  app.dock?.hide(); // Siri-style: no Dock icon; right-click the character to quit

  if (!globalShortcut.register(HOTKEY, () => win.webContents.send('toggle'))) {
    console.error(`Could not register ${HOTKEY}; double-tap Control still works, or set JARVIS_HOTKEY.`);
  }
  if (!globalShortcut.register(DICTATE_HOTKEY, () => win.webContents.send('dictate'))) {
    console.error(`Could not register ${DICTATE_HOTKEY}; set JARVIS_DICTATE_HOTKEY to another shortcut.`);
  }
  startDoubleTap();
  startWake();
  warmOcr();
  speech.warm();
  ipcMain.on('listen-start', () => { speech.stop(); cancel(); wakeListening(false); cue('Tink'); }); // talking again also stops any action in progress
  ipcMain.on('listen-end', () => wakeListening(true)); // recording ended with nothing said
  ipcMain.on('audio', (_e, buf, mode) => { cue('Pop'); return mode === 'dictate' ? handleDictation(buf) : handleAudio(buf); });
  ipcMain.on('interactive', (_e, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('menu', () => Menu.buildFromTemplate([{ label: 'Quit JARVIS', click: () => app.quit() }]).popup({ window: win }));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll(); speech.stop(); speech.shutdown(); helper?.kill();
  try { fs.writeSync(wakeCmd, 'quit\n'); } catch { /* not running */ }
  wakeEvents?.destroy();
  if (wakeDir) fs.rmSync(wakeDir, { recursive: true, force: true });
});
app.on('window-all-closed', () => app.quit());
