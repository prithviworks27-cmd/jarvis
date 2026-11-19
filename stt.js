// A short style hint, nothing that reads like a command or a name: Whisper repeats its prompt when the audio is weak, and an
// example command or a list of contacts there got "heard" as if you had said it (it opened chats you never asked for).
const PRIMER = 'Hinglish: Hindi and English mixed, in Roman letters. Namaste, aap kaise hain? Main theek hoon, dhanyavaad.';

// What Whisper makes up from silence or room noise.
const NOISE = /^(thank you\.?|thanks for watching\.?|you\.?|bye\.?|\.+)$/i;
const words = (t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const PRIMER_WORDS = new Set(words(PRIMER));
// Four or more words, all of them from the hint: that is the hint coming back (Whisper often drops a few of its words).
const isEcho = (t) => { const w = words(t); return w.length >= 4 && w.every((x) => PRIMER_WORDS.has(x)); };

// Offline engine, set by main.js (localstt.js): English only. Returns the text ('' = nothing heard), or throws when unavailable.
let local = null;
const setLocal = (fn) => { local = fn; };
const MODE = () => process.env.JARVIS_STT || 'auto'; // auto: cloud first, offline when the cloud fails | cloud | local

// Groq-hosted Whisper. Takes a webm/opus Buffer, returns the transcript text ('' when nothing was really said).
async function cloud(buf) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/webm' }), 'speech.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json'); // per-segment confidence, used below to drop invented text
  form.append('temperature', '0');
  // No forced language: Whisper hears English, Hindi and Hinglish. The Roman-script hint makes Hindi come back as Hinglish
  // ("Rishabh ka WhatsApp chat kholo") instead of Devanagari, so names can still be matched.
  if (process.env.JARVIS_STT_LANGUAGE) form.append('language', process.env.JARVIS_STT_LANGUAGE);
  form.append('prompt', PRIMER);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(10000), // a dead connection must not hang the whole command
  });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}): ${await res.text()}`);
  return clean(await res.json());
}

// The offline text goes through the same filter for made-up phrases.
const viaLocal = async (buf) => clean({ text: await local(buf) });

// Cloud first. Rate limited, unreachable or failing: the offline recogniser, if there is one. JARVIS_STT=local always uses it (also
// when there is no GROQ_API_KEY), =cloud never does.
async function transcribe(buf) {
  const mode = MODE();
  if (mode === 'local' || (mode === 'auto' && !process.env.GROQ_API_KEY)) {
    if (!local) throw new Error('Offline speech recognition is not available.');
    return viaLocal(buf);
  }
  try {
    return await cloud(buf);
  } catch (e) {
    if (mode === 'cloud' || !local || !/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network|timed out|aborted|TimeoutError|\((429|5\d\d)\)/i.test(`${e.name} ${e.message}`)) throw e;
    try {
      const text = await viaLocal(buf);
      console.log('[stt] the cloud was unavailable: heard offline');
      return text;
    } catch (offline) {
      console.error(`[stt] ${offline.message}`);
      throw e;
    }
  }
}

// Drops segments Whisper itself doubts (probably no speech, low confidence), and anything that is just its own prompt coming back.
function clean({ segments = [], text = '' }) {
  const kept = segments.length ? segments.filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -1)).map((s) => s.text).join('') : text;
  const t = kept.trim();
  if (!t || NOISE.test(t) || isEcho(t)) {
    if (process.env.JARVIS_WAKE_DEBUG === '1') console.log(`[stt] dropped: heard ${JSON.stringify(text.trim())}; segments ${JSON.stringify(segments.map((s) => [s.text.trim(), +s.no_speech_prob.toFixed(2), +s.avg_logprob.toFixed(2)]))}`);
    return '';
  }
  return t;
}

module.exports = { transcribe, clean, setLocal };
