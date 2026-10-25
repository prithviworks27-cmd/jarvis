const orb = document.getElementById('orb');
const bubble = document.getElementById('bubble');
const $ = (id) => document.getElementById(id);
const LABELS = { idle: '', listening: 'Listening…', thinking: 'Thinking…', speaking: '' };

let rec = null;
let hideTimer;

// Grow or shrink the window to fit the bubble, anchored to the screen corner by main.
function fit() {
  const w = bubble.hidden ? 100 : 340;
  window.jarvis.resize(w, bubble.hidden ? 100 : bubble.offsetHeight + 10 + 64 + 18 + 4);
}

function show(state, { you, jarvis, error } = {}) {
  clearTimeout(hideTimer);
  orb.className = state;
  if (you !== undefined) $('you').textContent = `“${you}”`;
  if (jarvis !== undefined) $('jarvis').textContent = jarvis;
  $('status').className = error ? 'error' : '';
  $('status').textContent = error || LABELS[state];
  bubble.hidden = state === 'idle' && !error && !$('jarvis').textContent;
  if (!bubble.hidden) fit();
  else window.jarvis.resize(100, 100);
  if (state === 'idle') hideTimer = setTimeout(() => { bubble.hidden = true; $('you').textContent = $('jarvis').textContent = ''; fit(); }, error ? 10000 : 12000);
}

async function toggle() {
  if (rec) return rec.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return show('idle', { error: 'Microphone blocked. Allow it in System Settings > Privacy & Security > Microphone.' });
  }
  window.jarvis.listenStarted();
  const chunks = [];
  rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); // release the mic (and the menu-bar dot)
    rec = null;
    window.jarvis.sendAudio(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
  };
  rec.start();
  $('you').textContent = $('jarvis').textContent = '';
  show('listening');
}

window.jarvis.onToggle(toggle);
window.jarvis.onState(({ state, ...rest }) => show(state, rest));
orb.addEventListener('click', toggle);
orb.addEventListener('contextmenu', (e) => { e.preventDefault(); window.jarvis.menu(); });
