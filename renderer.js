const $ = (id) => document.getElementById(id);
const buddy = $('buddy');
const body = $('body');
const bubble = $('bubble');
const LABELS = { idle: '', listening: 'Listening…', thinking: 'Thinking…', speaking: '' };
const SIZE = 76; // keep in sync with --size in style.css
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
// Drag the character to move it; a plain click (no drag) still talks to JARVIS.
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
  const buzz = state === 'listening' ? 0.05 * Math.sin(t * 22) : state === 'speaking' ? 0.03 * Math.sin(t * 14) : 0;
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
