const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ready = new Map();

// Compiles helpers/<name>.swift into bin/<name> the first time (or when the source is newer). Resolves with the binary's path.
function ensure(name) {
  if (!ready.has(name)) {
    ready.set(name, new Promise((resolve, reject) => {
      const src = path.join(__dirname, 'helpers', `${name}.swift`);
      const bin = path.join(__dirname, 'bin', name);
      if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs) return resolve(bin);
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      execFile('swiftc', ['-swift-version', '5', '-O', src, '-o', bin], (err) => {
        if (err) { ready.delete(name); reject(new Error(`Could not build the ${name} helper (needs Xcode command line tools: xcode-select --install).`)); } else resolve(bin);
      });
    }));
  }
  return ready.get(name);
}

// A helper that needs microphone or speech permission has to be its own app: macOS asks in the name of the app that is
// "responsible", and a program started by Electron would count as Electron (which has no such usage text, so it crashes).
// Builds bin/<App>.app from helpers/<name>.swift + helpers/<name>.plist and signs it ad hoc. Resolves with the .app path.
function ensureApp(name, appName) {
  const key = `app:${name}`;
  if (!ready.has(key)) {
    ready.set(key, new Promise((resolve, reject) => {
      const src = path.join(__dirname, 'helpers', `${name}.swift`);
      const plist = path.join(__dirname, 'helpers', `${name}.plist`);
      const app = path.join(__dirname, 'bin', `${appName}.app`);
      const exe = path.join(app, 'Contents', 'MacOS', name);
      const newest = Math.max(fs.statSync(src).mtimeMs, fs.statSync(plist).mtimeMs);
      if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= newest) return resolve(app);
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.copyFileSync(plist, path.join(app, 'Contents', 'Info.plist'));
      const fail = () => { ready.delete(key); reject(new Error(`Could not build the ${name} helper (needs Xcode command line tools: xcode-select --install).`)); };
      execFile('swiftc', ['-swift-version', '5', '-O', src, '-o', exe], (err) => {
        if (err) return fail();
        execFile('codesign', ['--force', '--sign', '-', app], (err2) => (err2 ? fail() : resolve(app)));
      });
    }));
  }
  return ready.get(key);
}

module.exports = { ensure, ensureApp };
