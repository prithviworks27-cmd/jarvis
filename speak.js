const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

let current; // the playing afplay/say process
let gen = 0; // bumped by stop() so an in-flight speak() knows to quit

function stop() {
  gen++;
  if (current) current.kill();
  current = null;
}

// Engine 1: Groq-hosted Orpheus (free tier, same key as the brain). Free tier allows ~100 requests a day, so short replies go in one request.
async function orpheus(text) {
  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: process.env.JARVIS_TTS_VOICE || 'troy', input: text, response_format: 'wav' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  // Unique name: an interrupted reply's late download must never overwrite the next reply's file.
  const file = path.join(os.tmpdir(), `jarvis-orpheus-${crypto.randomUUID()}.wav`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// Engine 2: offline Kokoro in a worker process, started on first use (or warm()).
let worker;
const pending = new Map();
let kokoroId = 0;

function startWorker() {
  // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so no system `node` is needed.
  const w = spawn(process.execPath, [path.join(__dirname, 'kokoro-worker.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  w.stderr.on('data', () => {}); // model download progress and warnings
  w.stdin.on('error', () => {}); // worker died; the exit handler rejects pending requests
  readline.createInterface({ input: w.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.file);
  });
  w.on('exit', () => {
    worker = null;
    for (const p of pending.values()) p.reject(new Error('Kokoro worker stopped'));
    pending.clear();
  });
  return w;
}

function kokoro(text) {
  worker ||= startWorker();
  return new Promise((resolve, reject) => {
    const id = ++kokoroId;
    pending.set(id, { resolve, reject });
    worker.stdin.write(JSON.stringify({ id, text, voice: process.env.JARVIS_KOKORO_VOICE || 'bm_george' }) + '\n');
  });
}

const warm = () => { if (process.env.JARVIS_TTS !== 'say') worker ||= startWorker(); };
const shutdown = () => worker?.kill();

// Engine 3: macOS `say`.
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
const say = (text, voice = process.env.JARVIS_VOICE || 'Daniel') => run('say', ['-v', voice, '-f', '-'], text);

const drop = (p) => p.then((f) => fs.unlink(f, () => {}), () => {}); // delete a file we ended up not playing

// Plays parts[from..] with one engine, synthesizing the next sentence while the current one plays.
// Returns the index it reached: parts.length when finished or interrupted, lower when the engine failed.
async function playWith(synth, parts, from, mine) {
  let i = from;
  let next;
  try {
    next = synth(parts[i], i);
    next.catch(() => {}); // surfaced when awaited below
    for (; i < parts.length; i++) {
      const file = await next;
      next = undefined;
      try {
        if (mine !== gen) return parts.length;
        if (i + 1 < parts.length) { next = synth(parts[i + 1], i + 1); next.catch(() => {}); }
        await run('afplay', [file]);
      } finally {
        fs.unlink(file, () => {});
      }
      if (mine !== gen) { if (next) drop(next); return parts.length; }
    }
    return parts.length;
  } catch (e) {
    if (next) drop(next);
    console.error(`${synth.name} voice failed, trying the next one:`, e.message);
    return i;
  }
}

// JARVIS_TTS: unset = Orpheus, then Kokoro, then macOS; "kokoro" = Kokoro first; "say" = macOS only.
async function speak(text) {
  stop();
  const mine = gen;
  const clean = text.replace(/[*_`#>]/g, '').trim();
  if (!clean) return;
  // Short replies: one request. Long ones: sentence by sentence (split after sentence ends only, so "25.8 degrees" stays whole).
  // Hindi (Devanagari) replies: Orpheus and Kokoro only speak English, so use the Mac's built-in Hindi voice.
  if (/[\u0900-\u097F]/.test(clean)) return say(clean, process.env.JARVIS_HINDI_VOICE || 'Lekha');
  const parts = clean.length <= 400 ? [clean] : clean.split(/(?<=[.!?])\s+/);
  const mode = process.env.JARVIS_TTS;
  const chain = mode === 'say' ? [] : mode === 'kokoro' ? [kokoro] : [orpheus, kokoro];

  let done = 0;
  for (const synth of chain) {
    done = await playWith(synth, parts, done, mine);
    if (done >= parts.length || mine !== gen) return;
  }
  if (mine === gen) await say(parts.slice(done).join(''));
}

// ---- Fillers: "One moment, sir." while a slow request is still working. Each phrase is made once with the normal voice and
// kept on disk, so a filler is instant and costs no daily voice quota after the first time.
const CACHE = path.join(os.homedir(), 'Library/Application Support/JARVIS/voice-cache');
const fillers = () => { const who = process.env.JARVIS_USER_NAME || 'sir'; return [`One moment, ${who}.`, `Just a moment, ${who}.`, `Working on it, ${who}.`]; };
const making = new Map();

function clip(text) {
  const mode = process.env.JARVIS_TTS;
  const voice = mode === 'say' ? `say:${process.env.JARVIS_VOICE || 'Daniel'}` : mode === 'kokoro' ? `kokoro:${process.env.JARVIS_KOKORO_VOICE || 'bm_george'}` : `orpheus:${process.env.JARVIS_TTS_VOICE || 'troy'}`;
  const file = path.join(CACHE, crypto.createHash('sha1').update(`${voice}|${text}`).digest('hex').slice(0, 16));
  for (const ext of ['.wav', '.aiff']) if (fs.existsSync(file + ext)) return Promise.resolve(file + ext);
  if (!making.has(file)) {
    making.set(file, (async () => {
      fs.mkdirSync(CACHE, { recursive: true });
      const chain = mode === 'say' ? [] : mode === 'kokoro' ? [kokoro] : [orpheus, kokoro];
      for (const synth of chain) {
        try { const tmp = await synth(text); fs.copyFileSync(tmp, file + '.wav'); fs.unlink(tmp, () => {}); return file + '.wav'; } catch { /* next engine */ }
      }
      await new Promise((resolve, reject) => spawn('say', ['-v', process.env.JARVIS_VOICE || 'Daniel', '-o', file + '.aiff', text]).on('close', (c) => (c ? reject(new Error('say failed')) : resolve())).on('error', reject));
      return file + '.aiff';
    })().finally(() => making.delete(file)));
  }
  return making.get(file);
}

// Plays a filler unless something else started speaking meanwhile. Resolves when it has finished (or was cut off).
async function filler() {
  const mine = gen;
  const list = fillers();
  const file = await clip(list[Math.floor(Math.random() * list.length)]).catch(() => null);
  if (!file || mine !== gen) return;
  await run('afplay', [file]);
}
// Makes the filler clips in the background a little after start-up (three voice requests, once ever).
const warmFillers = () => setTimeout(async () => { for (const t of fillers()) await clip(t).catch(() => {}); }, 15000).unref?.();

module.exports = { speak, stop, warm, shutdown, filler, warmFillers };
