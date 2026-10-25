const orb = document.getElementById('orb');
const status = document.getElementById('status');
const LABELS = { idle: 'Press ⌥Space or click the orb', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };

let rec = null;

function setState(state, error) {
  orb.className = state;
  status.className = error ? 'error' : '';
  status.textContent = error || LABELS[state];
}

async function toggle() {
  if (rec) return rec.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return setState('idle', 'Microphone blocked. Allow it in System Settings > Privacy & Security > Microphone.');
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
  setState('listening');
}

window.jarvis.onToggle(toggle);
window.jarvis.onState(({ state, you, jarvis, error }) => {
  setState(state, error);
  if (you !== undefined) document.getElementById('you').textContent = `“${you}”`;
  if (jarvis !== undefined) document.getElementById('jarvis').textContent = jarvis;
});
orb.addEventListener('click', toggle);
document.getElementById('quit').addEventListener('click', () => window.jarvis.quit());
