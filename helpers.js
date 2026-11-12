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

module.exports = { ensure };
