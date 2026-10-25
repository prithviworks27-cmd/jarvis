const { spawn } = require('child_process');

let current;

function stop() {
  if (current) current.kill();
  current = null;
}

// Text goes over stdin so a reply starting with "-" is never read as a flag.
function speak(text) {
  stop();
  const clean = text.replace(/[*_`#>]/g, '');
  return new Promise((resolve) => {
    const p = spawn('say', ['-v', process.env.JARVIS_VOICE || 'Daniel', '-f', '-']);
    current = p;
    p.on('error', () => resolve()); // no `say` or bad voice: stay silent, the text is still on screen
    p.on('close', () => resolve());
    p.stdin.on('error', () => {});
    p.stdin.end(clean);
  });
}

module.exports = { speak, stop };
