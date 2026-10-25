const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let current; // the playing afplay/say process
let gen = 0; // bumped by stop() so an in-flight speak() knows to quit

function stop() {
  gen++;
  if (current) current.kill();
  current = null;
}

// Groq-hosted Orpheus voice (free tier, same key as the brain). One sentence per request keeps the first word fast.
async function fetchWav(text) {
  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: process.env.JARVIS_TTS_VOICE || 'troy', input: text, response_format: 'wav' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const run = (cmd, args, input) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args);
    current = p;
    p.on('error', () => resolve()); // missing binary: stay silent, the text is still on screen
    p.on('close', () => resolve());
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });

// Text goes over stdin so a reply starting with "-" is never read as a flag.
const say = (text) => run('say', ['-v', process.env.JARVIS_VOICE || 'Daniel', '-f', '-'], text);

async function speak(text) {
  stop();
  const mine = gen;
  const clean = text.replace(/[*_`#>]/g, '').trim();
  if (!clean) return;
  if (process.env.JARVIS_TTS === 'say') return say(clean);

  const parts = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  let i = 0;
  try {
    let next = fetchWav(parts[0]);
    next.catch(() => {}); // surfaced when awaited below
    for (; i < parts.length; i++) {
      const wav = await next;
      if (mine !== gen) return;
      if (i + 1 < parts.length) { next = fetchWav(parts[i + 1]); next.catch(() => {}); } // fetch the next sentence while this one plays
      const file = path.join(os.tmpdir(), `jarvis-${process.pid}-${i}.wav`);
      fs.writeFileSync(file, wav);
      await run('afplay', [file]);
      fs.unlink(file, () => {});
      if (mine !== gen) return;
    }
  } catch (e) {
    console.error('Orpheus voice failed, falling back to the macOS voice:', e.message);
    if (mine === gen) await say(parts.slice(i).join(''));
  }
}

module.exports = { speak, stop };
