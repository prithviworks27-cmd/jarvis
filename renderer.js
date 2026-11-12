const $ = (id) => document.getElementById(id);
const buddy = $('buddy');
const body = $('body');
const bubble = $('bubble');
const LABELS = { idle: '', listening: 'Listening…', dictating: 'Dictating… press again to finish', thinking: 'Thinking…', speaking: '' };
const SIZE = 76; // keep in sync with --size in style.css
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let rec = null;
let recMode = 'ask'; // 'ask' = talk to JARVIS, 'dictate' = type what I say
let starting = false; // true while waiting for mic permission
let hideTimer;
let state = 'idle';

function show(next, { you, jarvis, error } = {}) {
  clearTimeout(hideTimer);
  state = next;
  buddy.dataset.state = next;
  if (you !== undefined) $('you').textContent = `“${you}”`;
  if (jarvis !== undefined) $('jarvis').textContent = jarvis;
  $('status').className = error ? 'error' : '';
  $('status').textContent = error || LABELS[next];
  bubble.hidden = next === 'idle' && !error && !$('jarvis').textContent;
  if (next === 'idle') {
    hideTimer = setTimeout(() => { bubble.hidden = true; $('you').textContent = $('jarvis').textContent = ''; }, error ? 10000 : 12000);
  }
}

// With the wake word on, the microphone stays open anyway, so keep our own stream warm: recording then starts instantly.
let wakeOn = false;
let warm = null;
const mic = async () => {
  if (wakeOn && warm && warm.getAudioTracks().every((t) => t.readyState === 'live')) return warm;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  if (wakeOn) warm = stream;
  return stream;
};

// Watches the microphone level and calls done('stop' | 'none') when you have finished talking / said nothing. Returns a cleanup function.
function watchSilence(stream, done) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const vad = makeVad();
  const t0 = performance.now();
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const verdict = vad(rms, performance.now() - t0);
    if (verdict) done(verdict);
  }, 50);
  return () => { clearInterval(timer); ctx.close(); };
}

async function toggle(mode = 'ask') {
  if (rec) return rec.stop();
  if (starting) return; // a second press during the permission wait would orphan a recording and leave the mic on
  starting = true;
  let stream;
  try {
    stream = await mic();
  } catch {
    starting = false;
    return show('idle', { error: 'Microphone blocked. Allow it in System Settings > Privacy & Security > Microphone.' });
  }
  window.jarvis.listenStarted();
  recMode = mode;
  const chunks = [];
  let cancelled = false;
  rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 96000 }); // more bits than the default: clearer consonants
  rec.ondataavailable = (e) => chunks.push(e.data);
  // Talking to JARVIS ends by itself when you stop talking (you can still press the hotkey to end it sooner). Dictation waits for you.
  const stopWatching = mode === 'ask'
    ? watchSilence(stream, (why) => { cancelled = why === 'none'; rec?.stop(); })
    : () => {};
  rec.onstop = async () => {
    stopWatching();
    if (stream !== warm) stream.getTracks().forEach((t) => t.stop()); // release the mic (and the menu-bar dot), unless the wake word keeps it open
    rec = null;
    if (cancelled) { show('idle'); return window.jarvis.listenEnd(); } // nobody said anything: do nothing
    window.jarvis.sendAudio(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer(), recMode);
  };
  rec.start();
  starting = false;
  $('you').textContent = $('jarvis').textContent = '';
  show(recMode === 'dictate' ? 'dictating' : 'listening');
}

window.jarvis.onToggle(toggle);
window.jarvis.onDictate(toggle);
window.jarvis.onConfig((c) => { wakeOn = c.wake; if (wakeOn) mic().catch(() => {}); });
// Someone said "Jarvis": react and start listening, unless JARVIS is already busy.
window.jarvis.onWake(() => { if (state === 'idle' && !rec && !starting) { poke(); toggle('ask'); } });
window.jarvis.onState(({ state: s, ...rest }) => show(s, rest));
// Drag the character to move it.
let drag = null;
let justDragged = false;
body.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { dx: p.x - e.clientX, dy: p.y - e.clientY, moved: false };
  body.setPointerCapture(e.pointerId);
});
body.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const x = e.clientX + drag.dx, y = e.clientY + drag.dy;
  if (!drag.moved && Math.hypot(x - p.x, y - p.y) < 5) return;
  drag.moved = true;
  placedByUser = true;
  spot.x = Math.min(Math.max(x, SIZE / 2), W - SIZE / 2);
  spot.y = Math.min(Math.max(y, SIZE / 2), H - SIZE / 2);
  p.x = spot.x; p.y = spot.y; p.vx = p.vy = 0; // follow the cursor tightly while dragging
});
body.addEventListener('pointerup', () => {
  if (drag?.moved) { justDragged = true; try { localStorage.setItem('spot', JSON.stringify(spot)); } catch { /* private mode: it just won't be remembered */ } }
  drag = null;
});
// Clicking only makes it react: a hop, a stretch that jiggles back, wide eyes and a small 'o' mouth.
function poke() {
  buddy.classList.add('poked');
  p.vy -= 220;
  p.sv += 8;
  setTimeout(() => buddy.classList.remove('poked'), 450);
}
body.addEventListener('click', () => { if (justDragged) justDragged = false; else poke(); }); // a click is just a poke; listening starts only from the hotkeys
body.addEventListener('contextmenu', (e) => { e.preventDefault(); window.jarvis.menu(); });

// ---- The jelly: it stays where you put it (default bottom-right); a spring eases it there and a bouncier one drives the squash. ----
let W = innerWidth, H = innerHeight;
const corner = () => ({ x: W - 70, y: H - 70 });
let spot = corner();
let placedByUser = false;
try { const saved = JSON.parse(localStorage.getItem('spot')); if (saved && saved.x < W && saved.y < H) { spot = saved; placedByUser = true; } } catch { /* nothing saved yet */ }
// The window gets its final size just after load, so re-aim the default corner whenever it changes.
addEventListener('resize', () => { W = innerWidth; H = innerHeight; if (!placedByUser) spot = corner(); });
const p = { x: spot.x, y: spot.y, vx: 0, vy: 0, tx: spot.x, ty: spot.y, s: 0, sv: 0 };
const mouse = { x: -999, y: -999 };
addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

// Mouse events pass through the transparent window except over the character and its bubble.
let interactive = false;
function updateInteractive() {
  const hit = (el) => { const r = el.getBoundingClientRect(); return mouse.x >= r.left - 4 && mouse.x <= r.right + 4 && mouse.y >= r.top - 4 && mouse.y <= r.bottom + 4; };
  const over = hit(body) || (!bubble.hidden && hit(bubble));
  if (over !== interactive) { interactive = over; window.jarvis.interactive(over); }
}

function placeBubble() {
  if (bubble.hidden) return;
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  const above = p.y - SIZE / 2 - bh - 16 > 0;
  bubble.style.top = above ? `${-bh - 14}px` : `${SIZE + 14}px`;
  const centered = (SIZE - bw) / 2;
  const screenLeft = p.x - SIZE / 2 + centered;
  bubble.style.left = `${centered + Math.min(Math.max(screenLeft, 8), W - bw - 8) - screenLeft}px`;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  p.tx = spot.x; p.ty = spot.y; // it only moves when you drag it

  const ax = (p.tx - p.x) * 3 - p.vx * 2.2;
  const ay = (p.ty - p.y) * 3 - p.vy * 2.2;
  p.vx += ax * dt; p.vy += ay * dt;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 240) { p.vx *= 240 / speed; p.vy *= 240 / speed; }
  p.x += p.vx * dt; p.y += p.vy * dt;

  // Squash/stretch along the direction of travel, on an underdamped spring so it overshoots and jiggles.
  const buzz = state === 'listening' || state === 'dictating' ? 0.05 * Math.sin(t * 22) : state === 'speaking' ? 0.03 * Math.sin(t * 14) : 0;
  const target = Math.min(0.2, speed / 1200) + buzz;
  p.sv += (-(p.s - target) * 240 - p.sv * 9) * dt;
  p.s += p.sv * dt;
  const angle = Math.atan2(p.vy, p.vx);
  const bob = reduceMotion ? 0 : Math.sin(t * 1.6) * 4;
  const jx = reduceMotion ? 0 : 0.03 * Math.sin(t * 6), jy = reduceMotion ? 0 : 0.03 * Math.sin(t * 6 + 2);
  buddy.style.transform = `translate(${p.x - SIZE / 2}px, ${p.y - SIZE / 2 + bob}px)`;
  body.style.transform = `rotate(${angle}rad) scale(${1 + p.s + jx}, ${1 - p.s + jy}) rotate(${-angle + Math.max(-0.2, Math.min(0.2, p.vx * 0.0006))}rad)`;

  // Eyes follow where it's heading, or the cursor when it's resting; look up when thinking.
  let lx = 0, ly = 0;
  if (state === 'thinking') { lx = 2; ly = -3; }
  else {
    const dx = speed > 40 ? p.vx : mouse.x - p.x, dy = speed > 40 ? p.vy : mouse.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(3, d / 40);
    lx = (dx / d) * k; ly = (dy / d) * k;
  }
  body.style.setProperty('--lx', `${lx}px`);
  body.style.setProperty('--ly', `${ly}px`);

  placeBubble();
  updateInteractive();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(function blink() {
  const eyes = document.querySelectorAll('.eye');
  eyes.forEach((e) => e.classList.add('blink'));
  setTimeout(() => eyes.forEach((e) => e.classList.remove('blink')), 130);
  setTimeout(blink, 2000 + Math.random() * 3500);
})();
