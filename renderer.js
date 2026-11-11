const $ = (id) => document.getElementById(id);
const buddy = $('buddy');
const body = $('body');
const bubble = $('bubble');
const LABELS = { idle: '', listening: 'Listening…', thinking: 'Thinking…', speaking: '' };
const SIZE = 60; // keep in sync with --k in style.css (SIZE / 88)
const K = SIZE / 88;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let rec = null;
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
window.jarvis.onState(({ state: s, ...rest }) => show(s, rest));
body.addEventListener('click', toggle);
body.addEventListener('contextmenu', (e) => { e.preventDefault(); window.jarvis.menu(); });

// ---- The wandering jelly: a spring chases a random target; a second, bouncier spring drives the squash. ----
let W = innerWidth, H = innerHeight;
addEventListener('resize', () => { W = innerWidth; H = innerHeight; });
const p = { x: W - 110, y: H - 110, vx: 0, vy: 0, tx: W - 110, ty: H - 110, next: 0, s: 0, sv: 0 };
const mouse = { x: -999, y: -999 };
addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

function pickTarget(now) {
  const m = SIZE;
  p.tx = m + Math.random() * (W - 2 * m);
  p.ty = m + Math.random() * (H - 2 * m);
  p.next = now + 2500 + Math.random() * 3500; // drift, linger, drift again
}

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
  const busy = state !== 'idle' || !bubble.hidden; // listening, thinking, speaking, or its answer is still on screen

  if (reduceMotion) { p.tx = W - 110; p.ty = H - 110; }
  else if (busy) { p.tx = W / 2; p.ty = H * 0.45; } // wake up: glide to the middle and stay while it listens, works or talks
  else if (now > p.next) pickTarget(now);

  const ax = (p.tx - p.x) * 3 - p.vx * 2.2;
  const ay = (p.ty - p.y) * 3 - p.vy * 2.2;
  p.vx += ax * dt; p.vy += ay * dt;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 240) { p.vx *= 240 / speed; p.vy *= 240 / speed; }
  p.x += p.vx * dt; p.y += p.vy * dt;

  // Squash/stretch along the direction of travel, on an underdamped spring so it overshoots and jiggles.
  const buzz = state === 'listening' ? 0.05 * Math.sin(t * 22) : state === 'speaking' ? 0.03 * Math.sin(t * 14) : 0;
  const target = Math.min(0.2, speed / 1200) + buzz;
  p.sv += (-(p.s - target) * 240 - p.sv * 9) * dt;
  p.s += p.sv * dt;
  const angle = Math.atan2(p.vy, p.vx);
  const bob = reduceMotion ? 0 : Math.sin(t * 1.6) * 4;
  const jx = reduceMotion ? 0 : 0.03 * Math.sin(t * 6), jy = reduceMotion ? 0 : 0.03 * Math.sin(t * 6 + 2);
  buddy.style.transform = `translate(${p.x - SIZE / 2}px, ${p.y - SIZE / 2 + bob}px)`;
  body.style.transform = `rotate(${angle}rad) scale(${1 + p.s + jx}, ${1 - p.s + jy}) rotate(${-angle + Math.max(-0.2, Math.min(0.2, p.vx * 0.0006))}rad)`;
  body.style.borderRadius = [0, 1, 2, 3].map((i) => `${(22 + 5 * Math.sin(t * 3 + i * 1.7)) * K}px`).join(' ');

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
