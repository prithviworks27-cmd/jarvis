// Knows what the Mac's audio is doing, so Alfred can behave around music, videos and calls:
//  - echo cancellation for the wake word is switched on only while something plays out of speakers the microphone can hear;
//  - while another app is recording from the microphone (a call), Alfred does not speak into it and does not listen for unnamed
//    follow-ups;
//  - while something plays, the volume is lowered for a moment while Alfred listens to a command, then put back.
// The facts come from helpers/audioctx.swift (CoreAudio: which apps use the microphone or play sound, and where sound comes out).
// Nothing is recorded. Alfred's own parts and the Mac's own sounds are not counted as "someone else".
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { ensure } = require('./helpers');

const OWN = [/^com\.github\.Electron/i, /^local\.jarvis\./i, /^com\.apple\.(CoreSpeech|speech|siri|assistant|audio|coreaudio|accessibility|VoiceOver|systemsound|notificationcenterui|controlcenter|universalaccess|SpeechRecognitionCore)/i];
const isOther = (id) => id && !OWN.some((re) => re.test(id));

// The helper's "key=value" lines -> what matters.
function classify(out) {
  const kv = Object.fromEntries(String(out).split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  const list = (k) => (kv[k] ? kv[k].split(',').map((x) => x.trim()).filter(Boolean) : []);
  const callApps = list('input').filter(isOther);
  const mediaApps = list('playing').filter(isOther);
  return { output: kv.output || 'other', leaks: kv.leaks === 'yes', callApps, mediaApps, call: callApps.length > 0, media: mediaApps.length > 0 };
}

const run = (args) => ensure('audioctx').then((bin) => new Promise((resolve) => execFile(bin, args, { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out)))), () => '');

// Polls every few seconds. `aec` fires when echo cancellation should change: on after two polls in a row that want it (a click or a
// notification sound must not trigger it), off after four polls that do not (so a pause between songs does not make it flap).
function monitor({ exec = run, interval = 3000 } = {}) {
  const bus = new EventEmitter();
  bus.state = classify('');
  let want = 0, idle = 0, aec = false, timer = null;
  bus.aec = () => aec;
  bus.tick = async () => {
    const next = classify(await exec([]));
    const prev = bus.state;
    bus.state = next;
    const wanted = next.leaks && (next.media || next.call);
    want = wanted ? want + 1 : 0; idle = wanted ? 0 : idle + 1;
    if (!aec && want >= 2) { aec = true; bus.emit('aec', true); }
    else if (aec && idle >= 4) { aec = false; bus.emit('aec', false); }
    if (prev.call !== next.call || prev.media !== next.media || prev.output !== next.output) bus.emit('change', next, prev);
    return next;
  };
  bus.start = () => { if (!timer) { bus.tick().catch(() => {}); timer = setInterval(() => bus.tick().catch(() => {}), interval); timer.unref?.(); } };
  bus.stop = () => { clearInterval(timer); timer = null; };
  return bus;
}

// During a call over speakers, a spoken reply would go into the call (and the other side would hear Alfred).
// With headphones it cannot, so Alfred keeps talking. JARVIS_CALL_SPEAK=1 always speaks.
const speakNow = (state, env = process.env) => env.JARVIS_CALL_SPEAK === '1' || !(state.call && state.leaks);

// ---- Ducking: lower the volume while Alfred listens to a command that something is playing over, then put it back. ----
const duckFile = () => process.env.JARVIS_DUCK_FILE || path.join(os.homedir(), 'Library/Application Support/JARVIS/duck.json');
const FACTOR = 0.25;
const osa = (script) => new Promise((resolve, reject) => execFile('osascript', ['-e', script], { timeout: 5000 }, (e, out) => (e ? reject(e) : resolve(String(out).trim()))));

function ducker({ getVolume = () => osa('output volume of (get volume settings)').then(Number), setVolume = (n) => osa(`set volume output volume ${Math.round(n)}`), file = duckFile } = {}) {
  let ducked = null; // { from, to }
  const save = (d) => { try { fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 }); fs.writeFileSync(file(), JSON.stringify({ ...d, at: Date.now() }), { mode: 0o600 }); } catch { /* best effort */ } };
  const forget = () => { ducked = null; try { fs.rmSync(file(), { force: true }); } catch { /* nothing saved */ } };
  return {
    isDucked: () => !!ducked,
    async duck() {
      if (ducked) return false;
      const from = await getVolume().catch(() => NaN);
      if (!Number.isFinite(from) || from < 12) return false; // already quiet, or a device without a volume
      const to = Math.max(4, from * FACTOR);
      ducked = { from, to: Math.round(to) };
      save(ducked); // so a crash cannot leave the volume low
      await setVolume(to);
      return true;
    },
    // Restores only if the user has not touched the volume in the meantime.
    async restore() {
      if (!ducked) return false;
      const { from, to } = ducked;
      forget();
      const now = await getVolume().catch(() => NaN);
      if (Number.isFinite(now) && Math.abs(now - to) <= 2) { await setVolume(from); return true; }
      return false;
    },
    // At start-up: a saved duck means Alfred stopped while the volume was low.
    async recover() {
      let saved;
      try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return false; }
      try { fs.rmSync(file(), { force: true }); } catch { /* gone */ }
      const now = await getVolume().catch(() => NaN);
      if (Number.isFinite(now) && Number.isFinite(saved.from) && Math.abs(now - saved.to) <= 2) { await setVolume(saved.from); return true; }
      return false;
    },
  };
}

module.exports = { classify, monitor, speakNow, ducker, isOther };
