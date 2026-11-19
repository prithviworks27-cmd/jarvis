// Offline speech-to-text for English: a recording is converted to WAV (ffmpeg) and transcribed by Apple's on-device recogniser,
// which lives inside the wake helper (it already has the Speech Recognition permission). Nothing leaves this Mac.
// Limit: Apple's recogniser works offline only for English (en-IN, en-US...); Hindi and Hinglish need the cloud (or a downloaded model).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => fs.existsSync(p)) || null;
const b64 = (s) => Buffer.from(String(s)).toString('base64');
const unb64 = (s) => Buffer.from(s || '', 'base64').toString('utf8');

// send(line) writes one command line to the helper. Feed every line the helper prints to onLine().
function localStt({ send, ffmpeg = FFMPEG, locale = () => process.env.JARVIS_STT_LOCALE || 'en-IN', timeoutMs = 20000 }) {
  const waiting = new Map();
  const toWav = (src, dst) => new Promise((resolve, reject) => execFile(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', dst], { timeout: 10000 }, (e, _o, err) => (e ? reject(new Error(`Could not convert the recording: ${String(err || e.message).split('\n')[0]}`)) : resolve())));
  return {
    available: () => !!ffmpeg,
    // "stt:<id>:<base64>" or "stt-error:<id>:<base64>". Returns true when the line was one of these.
    onLine(line) {
      const m = String(line).match(/^(stt|stt-error):([\w-]+):(.*)$/);
      if (!m) return false;
      const w = waiting.get(m[2]);
      if (w) { waiting.delete(m[2]); clearTimeout(w.timer); m[1] === 'stt' ? w.resolve(unb64(m[3]).trim()) : w.reject(new Error(unb64(m[3]))); }
      return true;
    },
    setVocab(names) { const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].slice(0, 300); if (list.length) send(`vocab ${b64(list.join(','))}`); },
    async transcribe(buf) {
      if (!ffmpeg) throw new Error('Offline speech recognition needs ffmpeg (free: brew install ffmpeg).');
      const id = crypto.randomUUID().slice(0, 8);
      const src = path.join(os.tmpdir(), `jarvis-stt-${id}.webm`), wav = path.join(os.tmpdir(), `jarvis-stt-${id}.wav`);
      try {
        fs.writeFileSync(src, buf, { mode: 0o600 });
        await toWav(src, wav);
        const done = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { waiting.delete(id); reject(new Error('The offline recogniser did not answer.')); }, timeoutMs);
          waiting.set(id, { resolve, reject, timer });
        });
        send(`stt ${id} ${locale()} ${wav}`);
        return await done;
      } finally {
        fs.rm(src, { force: true }, () => {}); fs.rm(wav, { force: true }, () => {});
      }
    },
  };
}
module.exports = localStt;
