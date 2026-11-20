/*  Gesture City Map — app
    Reads window.CITY_CONFIG (see cities/_template.js), draws the city as
    constellations, and wires mouse, touch, keyboard, camera and demo input
    to the same handful of map actions.
*/
(() => {
'use strict';
const CFG = window.CITY_CONFIG;
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============ 1. Config → map data ============ */
const problems = [];
const EMBED = new URLSearchParams(location.search).has('embed');   // chrome-free, self-running version for iframes
if (!CFG) { document.body.insertAdjacentHTML('beforeend', '<div class="fatal glass"><b>No city config.</b> The city file must set <code>window.CITY_CONFIG</code>.</div>'); return; }
const CATS = CFG.categories || {};
const catKeys = Object.keys(CATS);
if (!catKeys.length) problems.push('categories is empty');
const PALETTE = ['#7cf3ff', '#ff5cf0', '#ffb020', '#3ddc84', '#b794ff', '#ff8a3d', '#5aa9ff', '#fff1a8', '#ff5c5c', '#a3ff7a'];
catKeys.forEach((k, i) => { CATS[k] = { label: k, icon: '✦', ...CATS[k] }; if (!/^#[0-9a-f]{6}$/i.test(CATS[k].color || '')) CATS[k].color = PALETTE[i % PALETTE.length]; });

const rawPlaces = (CFG.places || []).map(p => Array.isArray(p) ? { name: p[0], cat: p[1], lat: p[2], lng: p[3], rank: p[4], area: p[5], note: p[6], approx: p[7] } : p);
const valid = rawPlaces.filter((p, i) => {
  const bad = !p || typeof p.name !== 'string' || !isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180;
  if (bad) { problems.push(`place #${i + 1} needs a name, lat and lng`); return false; }
  if (!CATS[p.cat]) { problems.push(`"${p.name}" uses unknown category "${p.cat}"`); return false; }
  return true;
});
if (!valid.length) problems.push('places is empty');
const [LAT0, LNG0] = Array.isArray(CFG.center) ? CFG.center
  : [valid.reduce((s, p) => s + p.lat, 0) / (valid.length || 1), valid.reduce((s, p) => s + p.lng, 0) / (valid.length || 1)];
const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.57;
const proj = (lat, lng) => [(lng - LNG0) * KX, -(lat - LAT0) * KY];
const places = valid.map((p, i) => { const [x, y] = proj(p.lat, p.lng); return { ...p, id: i, rank: clamp(Math.round(p.rank || 1), 1, 3), x, y, ph: Math.random() * 6.283, sx: 0, sy: 0 }; });
const lines = (CFG.lines || []).map(L => {
  const pts = (L.stops || L.points || []).map(s => { const st = s.length === 3; const [x, y] = proj(st ? s[1] : s[0], st ? s[2] : s[1]); return { x, y, n: st ? s[0] : null }; });
  return { name: L.name || '', kind: L.kind || 'transit', color: L.color || (L.kind === 'water' ? '#3b82f6' : L.kind === 'road' ? '#c8d2ff' : '#9aa7ff'), loop: !!L.loop, pts };
}).filter(L => L.pts.length > 1);
if (problems.length) console.warn('[Gesture City Map] city config problems:\n- ' + problems.join('\n- '));

function mst(nodes) {   // minimum spanning tree: the constellation lines for one category
  const n = nodes.length; if (n < 2) return [];
  const inT = Array(n).fill(false), best = Array(n).fill(Infinity), par = Array(n).fill(-1), E = []; best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1; for (let v = 0; v < n; v++) if (!inT[v] && (u < 0 || best[v] < best[u])) u = v;
    inT[u] = true; if (par[u] >= 0) E.push([nodes[par[u]], nodes[u]]);
    for (let v = 0; v < n; v++) if (!inT[v]) { const d = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y); if (d < best[v]) { best[v] = d; par[v] = u; } }
  }
  return E;
}
const EDGES = {}; for (const k of catKeys) EDGES[k] = mst(places.filter(p => p.cat === k));

/* ============ 2. Page text from config ============ */
const title = CFG.title || `${CFG.name || 'City'} Constellation`;
document.title = `${title} · a gesture-controlled city map`;
$('#title').innerHTML = esc(title.toUpperCase()).replace(' ', ' <span>✦</span> ');
$('#subtitle').textContent = [CFG.subtitle, CFG.credit].filter(Boolean).join(' · ') || 'a gesture-controlled city map';
if (CFG.theme?.accent) document.documentElement.style.setProperty('--acc', CFG.theme.accent);
if (CFG.theme?.accent2) document.documentElement.style.setProperty('--acc2', CFG.theme.accent2);
$('#introTitle').innerHTML = `Fly ${esc(CFG.name || 'the city')} with your <span>hands</span>.`;

/* ============ 3. Canvas, view and camera maths ============ */
const cv = $('#sky'), ctx = cv.getContext('2d'), fx = $('#fx'), fc = fx.getContext('2d');
let W = 0, H = 0, DPR = 1, bg = null, HOME = null, ZMIN = 1, ZMAX = 1000;
const view = { cx: 0, cy: 0, z: 10, r: 0 };
let anim = null;   // { from, to, t0, ms }
const S = { hidden: new Set(), sel: null, hover: null, mouse: null, query: '', hits: new Set() };

function pct(arr, q) { const s = [...arr].sort((a, b) => a - b); return s[clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1)] || 0; }
function computeHome() {
  const xs = places.map(p => p.x), ys = places.map(p => p.y);
  const x0 = pct(xs, 0.08), x1 = pct(xs, 0.92), y0 = pct(ys, 0.08), y1 = pct(ys, 0.92);
  const bw = Math.max(x1 - x0, 0.5), bh = Math.max(y1 - y0, 0.5);
  const z = Math.min((W - 80) / bw, (H - 160) / bh) * (CFG.homeZoom || 1);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z, r: 0 };
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  for (const [c, x] of [[cv, ctx], [fx, fc]]) { c.width = W * DPR; c.height = H * DPR; x.setTransform(DPR, 0, 0, DPR, 0, 0); }
  bg = document.createElement('canvas'); bg.width = W; bg.height = H; const g = bg.getContext('2d');
  const gr = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.8);
  gr.addColorStop(0, '#0b1030'); gr.addColorStop(0.55, '#050820'); gr.addColorStop(1, '#010208');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  [['#3b1d78', 0.2, 0.25], ['#0b4a6f', 0.8, 0.3], ['#5b1650', 0.65, 0.8], ['#123d5a', 0.15, 0.85]].forEach(([c, x, y]) => {
    const n = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * 0.42);
    n.addColorStop(0, hexA(c, 0.3)); n.addColorStop(1, hexA(c, 0)); g.fillStyle = n; g.fillRect(0, 0, W, H);
  });
  for (let i = 0; i < 320; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 + 0.1})`; g.fillRect(Math.random() * W, Math.random() * H, Math.random() < 0.1 ? 1.6 : 0.9, Math.random() < 0.1 ? 1.6 : 0.9); }
  const first = !HOME; HOME = computeHome(); ZMIN = HOME.z * 0.2; ZMAX = HOME.z * 60;
  if (first) Object.assign(view, HOME);
  engine.setScreen(W, H);
}
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function w2s(x, y) { const dx = (x - view.cx) * view.z, dy = (y - view.cy) * view.z, c = Math.cos(view.r), s = Math.sin(view.r); return [W / 2 + dx * c - dy * s, H / 2 + dx * s + dy * c]; }
function s2w(sx, sy) { const dx = sx - W / 2, dy = sy - H / 2, c = Math.cos(-view.r), s = Math.sin(-view.r); return [view.cx + (dx * c - dy * s) / view.z, view.cy + (dx * s + dy * c) / view.z]; }
function panBy(dx, dy) { const c = Math.cos(-view.r), s = Math.sin(-view.r); view.cx -= (dx * c - dy * s) / view.z; view.cy -= (dx * s + dy * c) / view.z; }
function zoomAt(sx, sy, f) {
  const [wx, wy] = s2w(sx, sy); view.z = clamp(view.z * f, ZMIN, ZMAX);
  const [nx, ny] = s2w(sx, sy); view.cx += wx - nx; view.cy += wy - ny;
}
function rotateBy(d) { view.r += d; }
function animateTo(to, ms = 650) { anim = { from: { ...view }, to: { ...view, ...to, z: clamp(to.z ?? view.z, ZMIN, ZMAX) }, t0: performance.now(), ms }; }
function stopAnim() { anim = null; }
function panAnimated(dxPx, dyPx) {   // move the map content by this many screen pixels
  const c = Math.cos(-view.r), s = Math.sin(-view.r);
  animateTo({ cx: view.cx - (dxPx * c - dyPx * s) / view.z, cy: view.cy - (dxPx * s + dyPx * c) / view.z }, 520);
}
function home() { animateTo(HOME, 800); }
function focusPlace(p, zoom) { animateTo({ cx: p.x, cy: p.y, z: Math.max(view.z, zoom || HOME.z * 3) }, 750); }

/* ============ 4. Gesture engine + actions ============ */
const engine = new Gestures.Engine();
let handOn = false, paused = false, demo = null, lastFrame = null;
const flash = { swipe: null, t: 0 };

function act(e) {
  switch (e.type) {
    case 'swipe': {
      const step = Math.min(W, H) * 0.45;
      const d = { left: [-step, 0], right: [step, 0], up: [0, -step], down: [0, step] }[e.dir];
      panAnimated(d[0], d[1]); flash.swipe = e.dir; flash.t = performance.now();
      toast(`Swipe ${e.dir}`); break;
    }
    case 'zoom': stopAnim(); zoomAt(e.x, e.y, clamp(e.factor, 0.7, 1.4)); break;
    case 'rotate': stopAnim(); rotateBy(e.delta); break;
    case 'click': {
      const p = pickPlace(e.x, e.y);
      if (p) { select(p); toast(`Opened ${p.name}`); break; }
      const el = gxElementAt(e.x, e.y);
      if (el) { el.click(); toast(`Pressed ${el.textContent.trim().slice(0, 28)}`); break; }
      toast('Point at a place first, then 👍'); break;
    }
    case 'close':
      if (S.sel) { toast(`Closed ${S.sel.name}`); select(null); }
      else if ($('#results').style.display === 'block') { closeResults(); toast('Closed search'); }
      else if ($('#help').classList.contains('show')) { $('#help').classList.remove('show'); }
      else toast('Nothing open to close');
      break;
  }
}

function gxElementAt(x, y) {
  fx.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  fx.style.display = '';
  return el && el.closest('[data-gx]');
}
let gxHover = null;
function updateGxHover(x, y, show) {
  const el = show ? gxElementAt(x, y) : null;
  if (el === gxHover) return;
  gxHover?.classList.remove('gx-hover'); gxHover = el; el?.classList.add('gx-hover');
}

const POSE_UI = {
  none: ['✋', 'Show your hand', 'hold it 40–70 cm from the camera'],
  open: ['🖐️', 'Open palm', 'swipe quickly to move the map'],
  point: ['☝️', 'Pointer', 'move your finger · 👍 to open'],
  pinch: ['🤏', 'Pinch zoom', 'spread to zoom in · close to zoom out'],
  thumbsup: ['👍', 'Thumbs up', 'hold to open'],
  fist: ['✊', 'Fist', 'hold to close'],
  two: ['🙌', 'Two hands', 'turn them like a wheel to rotate'],
};
let lastPose = '';
function showPose(pose) {
  if (pose === lastPose) return; lastPose = pose;
  const [i, n, h] = POSE_UI[pose] || POSE_UI.none;
  $('#poseIcon').textContent = i; $('#poseName').textContent = n; $('#poseHint').textContent = h;
  const g = pose === 'thumbsup' || pose === 'fist' || pose === 'point' || pose === 'pinch' || pose === 'two' || pose === 'open' ? pose : '';
  document.querySelectorAll('#glist li').forEach(li => li.classList.toggle('on', li.dataset.g === g));
}

/** Every input source (camera or demo) ends up here, once per video frame. */
function onHands(hands, t, source) {
  if (paused && source === 'camera') hands = [];
  const r = engine.update(hands, t);
  r.events.forEach(act);
  lastFrame = { ...r, hands, t: performance.now(), source };
  showPose(hands.length ? r.pose : 'none');
  const pv = r.pointer.visible && (r.pose === 'point' || r.pose === 'pinch' || r.pose === 'thumbsup' || r.pose === 'fist');
  updateGxHover(r.pointer.x, r.pointer.y, pv);
  if (pv) S.hover = pickPlace(r.pointer.x, r.pointer.y); else if (hands.length) S.hover = null;
  drawCam(hands, source);
}

/* ============ 5. Camera (MediaPipe Hand Landmarker) ============ */
const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const vid = $('#vid');
let landmarker = null, lastVT = -1, camStream = null;

async function startHands() {
  if (handOn) return;
  stopDemo(); closeOverlays();
  $('#btnHands').textContent = '⏳ Loading…';
  try {
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import(MP_URL);
      const files = await FilesetResolver.forVisionTasks(MP_WASM);
      const opts = d => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate: d }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 });
      try { landmarker = await HandLandmarker.createFromOptions(files, opts('GPU')); }
      catch { landmarker = await HandLandmarker.createFromOptions(files, opts('CPU')); }
    }
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' }, audio: false });
    vid.srcObject = camStream; await vid.play();
    engine.setCameraAspect(vid.videoWidth / vid.videoHeight);
    handOn = true; paused = false; engine.reset();
    $('#btnHands').innerHTML = '■<span class="bl"> Hands off</span>'; $('#btnHands').classList.add('on'); $('#btnPause').hidden = false; $('#camOff').style.display = 'none';
    toast('Hand control on. Show one hand to begin.');
  } catch (err) {
    console.error(err);
    $('#btnHands').innerHTML = '✋<span class="bl"> Hands</span>';
    toast(err && err.name === 'NotAllowedError' ? 'Camera blocked. Allow it in the address bar, or try ▶ Demo.' : 'Hand tracking could not start here. Try Chrome or Edge, or ▶ Demo.', 5200);
  }
}
function stopHands() {
  handOn = false; camStream?.getTracks().forEach(t => t.stop()); camStream = null; vid.srcObject = null;
  engine.reset(); onHands([], performance.now(), 'camera');
  $('#btnHands').innerHTML = '✋<span class="bl"> Hands</span>'; $('#btnHands').classList.remove('on'); $('#btnPause').hidden = true; $('#camOff').style.display = '';
  showPose('none'); $('#poseName').textContent = 'Hand control off'; $('#poseHint').textContent = 'press ✋ Hands or ▶ Demo';
}
function pollCamera() {
  if (!handOn || !landmarker || vid.readyState < 2 || vid.currentTime === lastVT) return;
  lastVT = vid.currentTime;
  const t = performance.now();
  const res = landmarker.detectForVideo(vid, t);
  const hands = (res.landmarks || []).map((lm, i) => ({ lm, world: res.worldLandmarks?.[i] }));
  onHands(hands, t, 'camera');
}

/* camera preview with the hand skeleton drawn on top */
const cam = $('#cam'), cc = cam.getContext('2d');
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
function drawCam(hands, source) {
  const w = cam.width, h = cam.height;
  cc.save(); cc.fillStyle = '#050816'; cc.fillRect(0, 0, w, h);
  if (source === 'camera' && vid.readyState >= 2) { cc.globalAlpha = 0.55; cc.translate(w, 0); cc.scale(-1, 1); cc.drawImage(vid, 0, 0, w, h); cc.setTransform(1, 0, 0, 1, 0, 0); cc.globalAlpha = 1; }
  const b = engine.C.box;
  cc.strokeStyle = 'rgba(124,243,255,.25)'; cc.setLineDash([4, 4]); cc.strokeRect(b.x0 * w, b.y0 * h, (b.x1 - b.x0) * w, (b.y1 - b.y0) * h); cc.setLineDash([]);
  hands.forEach((hd, k) => {
    const P = hd.lm.map(p => [(1 - p.x) * w, p.y * h]);
    cc.strokeStyle = k ? '#ff5cf0' : '#7cf3ff'; cc.lineWidth = 2;
    cc.beginPath(); for (const [a, c] of BONES) { cc.moveTo(...P[a]); cc.lineTo(...P[c]); } cc.stroke();
    cc.fillStyle = '#fff'; for (const p of P) { cc.beginPath(); cc.arc(p[0], p[1], 2.2, 0, 6.283); cc.fill(); }
  });
  if (source === 'demo') { cc.fillStyle = 'rgba(255,92,240,.85)'; cc.font = '600 10px JetBrains Mono, monospace'; cc.fillText('SIMULATED HAND', 8, 16); }
  cc.restore();
}

/* ============ 6. Demo: a simulated hand drives the real engine ============ */
function startDemo() {
  if (handOn) stopHands();
  closeOverlays(); select(null); engine.reset(); Object.assign(view, HOME); stopAnim();
  demo = { steps: buildDemo(), i: -1, t0: 0, tw: 0, wrist: { x: 0.5, y: 0.78 } };
  $('#demoBar').hidden = false; $('#btnDemo').classList.add('on'); $('#camOff').style.display = 'none';
  nextStep(performance.now());
}
function stopDemo() {
  if (!demo) return; demo = null; engine.reset(); onHands([], performance.now(), 'demo');
  $('#demoBar').hidden = true; $('#btnDemo').classList.remove('on'); if (!handOn) $('#camOff').style.display = '';
  showPose('none'); $('#poseName').textContent = 'Hand control off'; $('#poseHint').textContent = 'press ✋ Hands or ▶ Demo';
}
function nextStep(now) {
  demo.i = (demo.i + 1) % demo.steps.length;
  const st = demo.steps[demo.i]; demo.t0 = now;
  st.start && st.start(demo);
  $('#demoCap').textContent = st.cap || '';
}
function tickDemo(now) {
  const st = demo.steps[demo.i], p = clamp((now - demo.t0) / st.ms, 0, 1);
  const hands = st.hands ? st.hands(p, demo) : [];
  onHands(hands, now, 'demo');
  if (p >= 1) nextStep(now);
}
function buildDemo() {
  const ease = p => p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const H1 = o => [SynthHand.hand({ noise: 0.0008, ...o })];
  const tipOff = (() => { const h = SynthHand.hand({ pose: 'point', x: 0.5, y: 0.5 }); return { x: (1 - h.lm[8].x) - 0.5, y: h.lm[8].y - 0.5 }; })();
  const gap = { ms: 280 };
  let from = { x: 0.5, y: 0.78 }, to = { x: 0.5, y: 0.78 }, target = null;
  const pickTarget = () => {   // a prominent visible place near the middle of the screen
    let best = null, bd = Infinity;
    const wide = W > 820, L = wide && !EMBED ? 260 : 30, R = wide ? 300 : 30, T = EMBED ? 70 : 120, B = wide ? 140 : H * 0.5;
    for (const p of places) {
      if (S.hidden.has(p.cat) || p.rank < 2) continue;
      const [sx, sy] = w2s(p.x, p.y); const d = Math.hypot(sx - (L + W - R) / 2, sy - (T + H - B) / 2);
      if (sx > L && sx < W - R && sy > T && sy < H - B && d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const pair = (deg) => {   // two open hands on a line turned by deg degrees (in real camera proportions)
    const a = deg * Math.PI / 180, R = 0.34, A = engine.camAspect;
    const dx = R * Math.cos(a) / A, dy = R * Math.sin(a);
    return [SynthHand.hand({ pose: 'open', x: 0.5 - dx, y: 0.6 - dy, size: 1.3, noise: 0.0008 }),
            SynthHand.hand({ pose: 'open', x: 0.5 + dx, y: 0.6 + dy, size: 1.3, noise: 0.0008 })];
  };
  return [
    { ms: 1200, cap: 'Open palm: the rest pose', start: () => { Object.assign(view, HOME); select(null); }, hands: () => H1({ pose: 'open', x: 0.55, y: 0.78 }) },
    { ms: 1100, cap: 'Swipe left: the map moves left', hands: p => H1({ pose: 'open', x: p < 0.25 ? 0.62 - 0.32 * ease(p / 0.25) : 0.30, y: 0.78 }) },
    gap,
    { ms: 1100, cap: 'Swipe up: the map moves up', hands: p => H1({ pose: 'open', x: 0.5, y: p < 0.25 ? 0.9 - 0.28 * ease(p / 0.25) : 0.62 }) },
    gap,
    { ms: 1100, cap: 'Swipe right and down to come back', hands: p => H1({ pose: 'open', x: p < 0.25 ? 0.32 + 0.32 * ease(p / 0.25) : 0.64, y: 0.78 }) },
    gap,
    { ms: 1100, cap: 'Swipe right and down to come back', hands: p => H1({ pose: 'open', x: 0.5, y: p < 0.25 ? 0.6 + 0.28 * ease(p / 0.25) : 0.88 }) },
    gap,
    { ms: 1900, cap: 'One finger: move the pointer onto a place',
      start: () => {
        target = pickTarget();
        const cam = target ? engine.fromScreen(...w2s(target.x, target.y)) : { x: 0.5, y: 0.45 };
        from = { x: 0.42, y: 0.84 }; to = { x: cam.x - tipOff.x, y: cam.y - tipOff.y };
      },
      hands: p => { const q = ease(clamp(p / 0.7, 0, 1)); return H1({ pose: 'point', x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q }); } },
    { ms: 1100, cap: 'Thumbs up: open it', hands: p => H1({ pose: p < 0.08 ? 'relaxed' : 'thumbsup', x: to.x, y: to.y + 0.03 }) },
    { ms: 1700, cap: 'Thumbs up: open it', hands: () => H1({ pose: 'open', x: to.x, y: to.y + 0.03 }) },
    { ms: 1100, cap: 'Fist: close it', hands: () => H1({ pose: 'fist', x: to.x, y: to.y + 0.03 }) },
    gap,
    { ms: 1700, cap: 'Pinch out: zoom in', hands: p => H1({ pose: 'pinch', spread: 0.12 + 0.85 * ease(clamp((p - 0.15) / 0.75, 0, 1)), x: to.x, y: to.y }) },
    { ms: 1700, cap: 'Pinch in: zoom out', hands: p => H1({ pose: 'pinch', spread: 0.97 - 0.85 * ease(clamp((p - 0.1) / 0.75, 0, 1)), x: to.x, y: to.y }) },
    gap,
    { ms: 2600, cap: 'Two hands: turn them to rotate', hands: p => pair(p < 0.2 ? 0 : p < 0.6 ? 28 * ease((p - 0.2) / 0.4) : 28 - 28 * ease(clamp((p - 0.65) / 0.3, 0, 1))) },
    { ms: 900, cap: 'That’s every gesture. Turn on ✋ Hands to try it.', start: () => home() },
  ];
}

/* ============ 7. Picking, selection, card ============ */
function visible(p) { return !S.hidden.has(p.cat); }
function pickPlace(sx, sy, radius = 44) {
  let best = null, bd = radius;
  for (const p of places) {
    if (!visible(p)) continue;
    const d = Math.hypot(p.sx - sx, p.sy - sy) - p.rank * 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function select(p) {
  S.sel = p;
  const card = $('#card');
  if (!p) { card.classList.remove('show'); return; }
  const c = CATS[p.cat];
  card.innerHTML = `<button class="x" data-gx aria-label="Close">✕</button>
    <div class="cat" style="color:${c.color}"><span class="dot"></span>${esc(c.icon)} ${esc(c.label)}</div>
    <h3>${esc(p.name)}</h3><div class="area">${esc(p.area || '')}</div>
    ${p.note ? `<p>${esc(p.note)}</p>` : ''}
    <div class="acts"><a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>
    ${cardExplore(p)}
    ${p.approx ? '<div class="approx">Approximate pin: area-level location.</div>' : ''}
    <div class="hint">✊ fist or Esc to close</div>`;
  card.querySelector('.x').onclick = () => select(null);
  card.querySelectorAll('[data-x]').forEach(b => b.onclick = () => b.dataset.x === 'gps' ? checkIn(p) : setVisit(p, b.dataset.x));
  card.classList.add('show');
}

/* ============ 8. Legend and search ============ */
function buildLegend() {
  const lg = $('#legend');
  lg.innerHTML = `<div class="lh">Constellations <button id="allOn" data-gx>all</button></div>` + catKeys.map(k => {
    const c = CATS[k], n = places.filter(p => p.cat === k).length;
    return `<div class="row" data-k="${esc(k)}" data-gx role="button" tabindex="0" style="color:${c.color}"><span class="dot"></span><span class="ln" style="color:var(--ink)">${esc(c.icon)} ${esc(c.label)}</span><span class="cnt">${n}</span></div>`;
  }).join('');
  lg.querySelectorAll('.row').forEach(r => r.onclick = () => { const k = r.dataset.k; S.hidden.has(k) ? S.hidden.delete(k) : S.hidden.add(k); r.classList.toggle('off', S.hidden.has(k)); if (S.sel && S.hidden.has(S.sel.cat)) select(null); });
  $('#allOn').onclick = () => { S.hidden.clear(); lg.querySelectorAll('.row').forEach(r => r.classList.remove('off')); };
}
const search = $('#search'), results = $('#results');
function runSearch() {
  const q = search.value.trim().toLowerCase(); S.query = q; S.hits = new Set();
  if (!q) { closeResults(); return; }
  const hits = places.filter(p => (p.name + ' ' + (p.area || '') + ' ' + CATS[p.cat].label).toLowerCase().includes(q)).sort((a, b) => b.rank - a.rank).slice(0, 12);
  hits.forEach(p => S.hits.add(p.id));
  results.innerHTML = hits.length ? hits.map((p, i) => `<div class="r${i ? '' : ' on'}" data-id="${p.id}" data-gx style="color:${CATS[p.cat].color}"><span class="dot"></span><span style="color:var(--ink)">${esc(p.name)}</span><small>${esc(p.area || CATS[p.cat].label)}</small></div>`).join('') : '<div class="r" style="color:var(--dim)">No matches</div>';
  results.style.display = 'block';
  results.querySelectorAll('[data-id]').forEach(r => r.onclick = () => { const p = places[+r.dataset.id]; S.hidden.delete(p.cat); buildLegendState(); focusPlace(p); select(p); closeResults(); search.blur(); });
}
function buildLegendState() { document.querySelectorAll('#legend .row').forEach(r => r.classList.toggle('off', S.hidden.has(r.dataset.k))); }
function closeResults() { results.style.display = 'none'; }
search.addEventListener('input', runSearch);
search.addEventListener('keydown', e => { if (e.key === 'Enter') results.querySelector('.r.on')?.click(); if (e.key === 'Escape') { search.value = ''; runSearch(); search.blur(); } e.stopPropagation(); });

/* ============ 9. Drawing ============ */
const CALM = new URLSearchParams(location.search).has('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;   // no twinkle
const SPR = {};
function sprite(col) {
  if (SPR[col]) return SPR[col];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, col); gr.addColorStop(0.45, hexA(col, 0.35)); gr.addColorStop(1, hexA(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (SPR[col] = c);
}
function draw(now) {
  ctx.drawImage(bg, 0, 0, W, H);
  const zr = view.z / HOME.z;
  // lines: water, roads, transit
  for (const L of lines) {
    ctx.beginPath();
    L.pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (L.loop) ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (L.kind === 'water') { ctx.strokeStyle = hexA(L.color, 0.28); ctx.lineWidth = clamp(view.z * 0.06, 2, 7); ctx.setLineDash([]); }
    else if (L.kind === 'road') { ctx.strokeStyle = hexA(L.color, 0.13); ctx.lineWidth = 1.2; ctx.setLineDash([6, 6]); }
    else { ctx.strokeStyle = hexA(L.color, 0.5); ctx.lineWidth = 2; ctx.setLineDash([]); }
    ctx.stroke(); ctx.setLineDash([]);
    if (L.kind === 'transit') for (const p of L.pts) {
      const [x, y] = w2s(p.x, p.y); ctx.fillStyle = hexA(L.color, 0.9); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.283); ctx.fill();
      if (p.n && zr > 2.6) { ctx.fillStyle = hexA(L.color, 0.75); ctx.font = '10px JetBrains Mono, monospace'; ctx.fillText(p.n, x + 5, y - 4); }
    }
  }
  // constellation lines
  ctx.lineWidth = 1;
  for (const k of catKeys) {
    if (S.hidden.has(k)) continue;
    ctx.strokeStyle = hexA(CATS[k].color, 0.2); ctx.beginPath();
    for (const [a, b] of EDGES[k]) { const [x1, y1] = w2s(a.x, a.y), [x2, y2] = w2s(b.x, b.y); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
  }
  // stars
  const t = now / 1000, occ = [];
  const labels = [];
  for (const p of places) {
    const [x, y] = w2s(p.x, p.y); p.sx = x; p.sy = y;
    if (!visible(p) || x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    const hot = p === S.sel || p === S.hover || S.hits.has(p.id);
    const tw = CALM ? 1 : 0.82 + 0.18 * Math.sin(t * 1.6 + p.ph);
    const r = (4 + p.rank * 3.2) * clamp(Math.sqrt(zr), 0.75, 1.8) * tw * (hot ? 1.5 : 1);
    ctx.drawImage(sprite(CATS[p.cat].color), x - r * 2, y - r * 2, r * 4, r * 4);
    if (hot) { ctx.strokeStyle = CATS[p.cat].color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r * 1.4 + (CALM ? 0 : 3 * Math.sin(t * 4)), 0, 6.283); ctx.stroke(); }
    const vis = XP && !EMBED && XP.visit(p);
    if (vis) { ctx.strokeStyle = vis.gps ? '#ffd34d' : 'rgba(74,222,128,.85)'; ctx.lineWidth = vis.gps ? 2 : 1.4; ctx.setLineDash(vis.gps ? [] : [3, 3]); ctx.beginPath(); ctx.arc(x, y, Math.max(7, r * 0.95), 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
    const show = hot || p.rank === 3 || (p.rank === 2 && zr > 1.7) || zr > 3.8;
    if (show) labels.push([hot ? 9 : p.rank, p, x, y, r]);
  }
  labels.sort((a, b) => b[0] - a[0]);
  ctx.textBaseline = 'middle';
  for (const [pri, p, x, y, r] of labels) {
    ctx.font = `${pri >= 9 ? 600 : 500} ${pri >= 9 ? 13 : 11.5}px Space Grotesk, sans-serif`;
    const w = ctx.measureText(p.name).width, bx = x + r + 4, by = y - 8;
    if (pri < 9 && occ.some(o => bx < o[0] + o[2] && bx + w > o[0] && by < o[1] + 16 && by + 16 > o[1])) continue;
    occ.push([bx, by, w, 16]);
    ctx.fillStyle = pri >= 9 ? '#ffffff' : 'rgba(232,236,255,.78)'; ctx.fillText(p.name, bx, y);
  }
  drawFx(now);
}
function drawFx(now) {
  fc.clearRect(0, 0, W, H);
  for (let i = bursts.length - 1; i >= 0; i--) {   // little star burst when a place is ticked off
    const b = bursts[i], a = (now - b.t) / 900;
    if (a >= 1) { bursts.splice(i, 1); continue; }
    const [bx, by] = w2s(b.p.x, b.p.y), e = 1 - (1 - a) ** 3;
    fc.globalAlpha = 1 - a; fc.fillStyle = b.col;
    for (let k = 0; k < 16; k++) { const an = k / 16 * 6.283 + b.p.ph, d = 10 + e * 46 * (k % 2 ? 0.7 : 1); fc.beginPath(); fc.arc(bx + Math.cos(an) * d, by + Math.sin(an) * d, 2.4 * (1 - a) + 0.6, 0, 6.283); fc.fill(); }
    fc.strokeStyle = b.col; fc.lineWidth = 2; fc.beginPath(); fc.arc(bx, by, 8 + e * 30, 0, 6.283); fc.stroke(); fc.globalAlpha = 1;
  }
  // swipe flash
  if (flash.swipe && now - flash.t < 600) {
    const a = 1 - (now - flash.t) / 600, d = flash.swipe, ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[d];
    fc.save(); fc.translate(W / 2, H / 2); fc.rotate(ang); fc.globalAlpha = a * 0.8;
    fc.strokeStyle = '#7cf3ff'; fc.lineWidth = 6; fc.lineCap = 'round';
    const off = (1 - a) * 60;
    fc.beginPath(); fc.moveTo(-50 + off, 0); fc.lineTo(50 + off, 0); fc.moveTo(22 + off, -28); fc.lineTo(50 + off, 0); fc.lineTo(22 + off, 28); fc.stroke();
    fc.restore();
  }
  const F = lastFrame;
  if (!F || now - F.t > 400 || !F.hands.length) return;
  if (F.mode === 'two' && engine.two.pts) {
    const [a, b] = engine.two.pts.map(p => engine.toScreen(p));
    fc.strokeStyle = 'rgba(255,92,240,.7)'; fc.lineWidth = 2; fc.setLineDash([8, 6]);
    fc.beginPath(); fc.moveTo(a.x, a.y); fc.lineTo(b.x, b.y); fc.stroke(); fc.setLineDash([]);
    for (const p of [a, b]) { fc.fillStyle = '#ff5cf0'; fc.beginPath(); fc.arc(p.x, p.y, 9, 0, 6.283); fc.fill(); }
    return;
  }
  const P = F.pointer, pose = F.pose;
  if (!P.visible) return;
  const col = { point: '#7cf3ff', pinch: '#ff5cf0', thumbsup: '#4ade80', fist: '#ffb020' }[pose] || 'rgba(232,236,255,.45)';
  fc.strokeStyle = col; fc.fillStyle = col; fc.lineWidth = 2;
  fc.beginPath(); fc.arc(P.x, P.y, pose === 'pinch' ? 10 : 14, 0, 6.283); fc.stroke();
  fc.beginPath(); fc.arc(P.x, P.y, 3, 0, 6.283); fc.fill();
  if (F.hold > 0) { fc.lineWidth = 4; fc.beginPath(); fc.arc(P.x, P.y, 22, -Math.PI / 2, -Math.PI / 2 + F.hold * 6.283); fc.stroke(); }
  if (S.hover && (pose === 'point' || pose === 'pinch')) {
    fc.strokeStyle = hexA(CATS[S.hover.cat].color, 0.7); fc.lineWidth = 1; fc.setLineDash([3, 4]);
    fc.beginPath(); fc.moveTo(P.x, P.y); fc.lineTo(S.hover.sx, S.hover.sy); fc.stroke(); fc.setLineDash([]);
  }
}


/* ============ 9b. Explore: top places, points, badges, sharing ============ */
const CITY_ID = (() => { const id = new URLSearchParams(location.search).get('city') || document.documentElement.dataset.city || 'bengaluru'; return /^[a-z0-9_-]+$/i.test(id) ? id : 'bengaluru'; })();
const XKEY = 'gcm:explore:' + CITY_ID;
const xstore = {
  get() { try { return JSON.parse(localStorage.getItem(XKEY) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(XKEY, JSON.stringify(v)); } catch { /* private mode: progress lasts this visit only */ } },
};
const XP = window.Explore ? Explore.create({ places, categories: CATS, options: CFG.explore || {}, visits: xstore.get() }) : null;
const xcats = XP ? Object.keys(XP.lists) : [];
const byKey = new Map(places.map(p => [Explore.keyOf(p), p]));
const bursts = [];
const TIER = { bronze: '#e0995e', silver: '#cfd8ea', gold: '#ffd34d' };
let xTab = 'lists', xCat = xcats[0], centerChip = true;

function cardExplore(p) {
  const i = XP && !EMBED && XP.info(p); if (!i) return '';
  const v = XP.visit(p);
  return `<div class="xcard"><div class="xrank">🏆 #${i.pos} of the top ${i.of} ${esc(CATS[i.cat].label)} · <b>${i.points} pts</b>${v ? '' : ', 2× if you check in here'}</div><div class="xbtns">${v
    ? `<span class="xdone">${v.gps ? '📍 Checked in' : '✓ Visited'} · +${XP.pointsFor(p)}</span>${v.gps ? '' : '<button data-x="gps" data-gx>📍 Check in for 2×</button>'}<button data-x="undo" data-gx class="ghost">Undo</button>`
    : `<button data-x="tick" data-gx class="pri">✓ I've been here</button><button data-x="gps" data-gx>📍 I'm here now (2×)</button>`}</div></div>`;
}
function setVisit(p, how) {   // how: 'tick' | 'gps' | 'undo'
  if (!XP) return;
  const before = XP.summary();
  if (how === 'undo') XP.unmark(p); else XP.mark(p, { gps: how === 'gps' });
  xstore.set(XP.visits());
  const after = XP.summary(), gained = after.points - before.points;
  updateXpButton(after);
  if (gained > 0) { bursts.push({ p, t: performance.now(), col: how === 'gps' ? '#ffd34d' : CATS[p.cat].color }); toast(`+${gained} points · ${p.name}`); }
  const fresh = XP.unlocked(before, after); if (fresh.length) setTimeout(() => showUnlock(fresh), 500);
  if (S.sel === p) select(p);
  if ($('#explore').classList.contains('show')) renderExplore();
}
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
function checkIn(p) {
  if (!navigator.geolocation) { toast('Location isn’t available in this browser. Tick it as visited instead.', 4000); return; }
  toast('Finding where you are…', 10000);
  navigator.geolocation.getCurrentPosition(pos => {
    const r = XP.canCheckIn(p, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    if (r.ok) setVisit(p, 'gps');
    else toast(`You’re ${fmtDist(r.distance)} away. Get within ${fmtDist(r.limit)} to check in, or tick it as visited.`, 5000);
  }, err => toast(err.code === 1 ? 'Location is blocked. Allow it in your browser to check in.' : 'Couldn’t find your location. Try again in the open.', 4500),
  { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function updateXpButton(s = XP && XP.summary()) {
  if (!XP) { $('#btnExplore').hidden = true; return; }
  $('#btnExplore').innerHTML = s.points ? `🏆 <b class="xbp">${s.points}</b>` : '🏆<span class="bl"> Explore</span>';
}
function badgeHtml(b, big) {
  const col = b.tier ? TIER[b.tier] : 'var(--line)';
  return `<div class="bdg${b.tier ? '' : ' locked'}${big ? ' big' : ''}" style="--tc:${col}"><span>${esc(b.icon)}</span></div>`;
}
function openExplore(tab) { if (!XP) return; if (tab) xTab = tab; closeOverlays(); $('#explore').classList.add('show'); $('#explore .panel').scrollTop = 0; centerChip = true; renderExplore(); }
function renderExplore() {
  const s = XP.summary(), prog = s.nextAt ? (s.points - s.levelMin) / (s.nextAt - s.levelMin) : 1;
  let h = `<div class="xhead"><div class="xlv"><small>Explore ${esc(CFG.name || 'the city')}</small><h2>${esc(s.level)}</h2>
    <div class="xbar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>
    <small>${s.nextAt ? `${s.nextAt - s.points} points to ${esc(s.nextLevel)}` : 'Top level reached'}</small></div>
    <div class="xpts"><b>${s.points}</b><span>points</span></div></div>
    <div class="xstats"><span><b>${s.visited}</b> / ${s.total} places</span><span><b>${s.earned}</b> / ${s.earnable} badges</span><span><b>${s.gps}</b> check-ins</span></div>
    <div class="xtabs"><button data-tab="lists" data-gx class="${xTab === 'lists' ? 'on' : ''}">Top places</button><button data-tab="badges" data-gx class="${xTab === 'badges' ? 'on' : ''}">Badges</button><button id="xpShare" data-gx class="pri">↗ Share</button></div>`;
  if (xTab === 'lists') {
    h += `<div class="xchips">${xcats.map(k => { const L = XP.lists[k], d = L.filter(p => XP.visit(p)).length;
      return `<button data-cat="${esc(k)}" data-gx class="${k === xCat ? 'on' : ''}" style="--cc:${CATS[k].color}">${esc(CATS[k].icon)} ${esc(CATS[k].label)} <small>${d}/${L.length}</small></button>`; }).join('')}</div>
      <p class="xtip">Tick what you’ve been to. Tap a name to fly there. Check in on the spot from the place card for double points.</p>
      <ol class="xlist">${XP.lists[xCat].map((p, i) => { const v = XP.visit(p), k = Explore.keyOf(p);
      return `<li class="${v ? 'done' : ''}"><button class="tick${v && v.gps ? ' gps' : ''}" data-tick="${esc(k)}" data-gx aria-label="${v ? 'Untick' : 'Tick'} ${esc(p.name)}">${v ? (v.gps ? '📍' : '✓') : ''}</button>
        <span class="xn" data-go="${esc(k)}" data-gx><b>${i + 1}. ${esc(p.name)}</b><small>${esc(p.area || '')}</small></span><span class="xpp">${v ? '+' + XP.pointsFor(p) : (p.rank || 1) * 10}</span></li>`; }).join('')}</ol>`;
  } else {
    h += `<div class="xbadges">${s.badges.map(b => `<div class="xb${b.tier ? '' : ' locked'}">${badgeHtml(b)}<div class="xbt"><b>${esc(b.name)}</b>
      <small>${b.tier ? `<span class="tier" style="color:${TIER[b.tier]}">${b.tier}</span> · ` : ''}${esc(b.desc)}</small>
      <div class="xbar sm"><i style="width:${(Math.min(1, b.have / b.goal) * 100).toFixed(1)}%"></i></div><small>${b.tierIndex + 1 >= b.tiers ? 'Complete' : `${b.have} / ${b.goal}${b.tier ? ' for the next tier' : ''}`}</small></div>
      ${b.tier ? `<button data-sb="${esc(b.id)}" data-gx class="ghost" title="Share this badge">↗</button>` : ''}</div>`).join('')}</div>`;
  }
  const el = $('#xpBody'), panel = el.parentElement, keep = panel.scrollTop, chipX = el.querySelector('.xchips')?.scrollLeft || 0;
  el.innerHTML = h; panel.scrollTop = keep;
  const chips = el.querySelector('.xchips'), on = chips?.querySelector('.on');
  if (chips) chips.scrollLeft = centerChip && on ? on.offsetLeft - chips.clientWidth / 2 + on.offsetWidth / 2 : chipX;
  centerChip = false;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { xTab = b.dataset.tab; centerChip = true; renderExplore(); });
  el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { xCat = b.dataset.cat; renderExplore(); });
  el.querySelectorAll('[data-tick]').forEach(b => b.onclick = () => { const p = byKey.get(b.dataset.tick); setVisit(p, XP.visit(p) ? 'undo' : 'tick'); });
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const p = byKey.get(b.dataset.go); closeOverlays(); S.hidden.delete(p.cat); buildLegendState(); focusPlace(p); select(p); });
  el.querySelectorAll('[data-sb]').forEach(b => b.onclick = () => openShare(s.badges.find(x => x.id === b.dataset.sb)));
  $('#xpShare').onclick = () => openShare();
}
let unlockT = 0;
function showUnlock(list) {
  if (EMBED) return;
  const b = list[list.length - 1], more = list.length - 1, el = $('#unlock');
  el.innerHTML = `${badgeHtml(b, true)}<div class="ut"><small>Badge unlocked${b.tiers > 1 ? ` · <span style="color:${TIER[b.tier]}">${b.tier}</span>` : ''}</small><b>${esc(b.name)}</b><span>${esc(b.desc)}${more ? ` · and ${more} more` : ''}</span>
    <div class="ub"><button data-gx class="pri" id="uShare">↗ Share</button><button data-gx id="uOk">Nice</button></div></div>`;
  el.classList.add('show'); clearTimeout(unlockT); unlockT = setTimeout(() => el.classList.remove('show'), 8000);
  $('#uShare').onclick = () => { el.classList.remove('show'); openShare(b); };
  $('#uOk').onclick = () => el.classList.remove('show');
}

/* --- sharing: a picture of your constellation + links to the usual apps --- */
function shareUrl() {
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/index\.html$/, '');
  if (CITY_ID !== (document.documentElement.dataset.city || 'bengaluru')) u.searchParams.set('city', CITY_ID);
  return u.toString();
}
function drawShareCard(badge) {
  const s = XP.summary(), Wc = 1080, Hc = 1350, c = document.createElement('canvas'); c.width = Wc; c.height = Hc;
  const g = c.getContext('2d'), F = 'Space Grotesk, system-ui, sans-serif';
  const gr = g.createLinearGradient(0, 0, 0, Hc); gr.addColorStop(0, '#0b1030'); gr.addColorStop(0.6, '#050820'); gr.addColorStop(1, '#010208');
  g.fillStyle = gr; g.fillRect(0, 0, Wc, Hc);
  [['#3b1d78', 0.15, 0.2], ['#0b4a6f', 0.85, 0.35], ['#5b1650', 0.6, 0.85]].forEach(([col, x, y]) => {
    const n = g.createRadialGradient(Wc * x, Hc * y, 0, Wc * x, Hc * y, 620); n.addColorStop(0, hexA(col, 0.45)); n.addColorStop(1, hexA(col, 0)); g.fillStyle = n; g.fillRect(0, 0, Wc, Hc);
  });
  let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.5 + 0.1})`; g.fillRect(rnd() * Wc, rnd() * Hc, 1.6, 1.6); }
  // the city, with the places you've visited lit up and joined
  const box = { x0: 90, y0: 330, x1: 990, y1: 980 };
  const seen = places.filter(p => XP.visit(p));
  // frame your own places (with some room around them); before you've been anywhere, frame the city centre
  const fit = seen.length >= 2 ? seen : places, lo = seen.length >= 2 ? 0 : 0.15;
  const xs = fit.map(p => p.x), ys = fit.map(p => p.y);
  let wx0 = pct(xs, lo), wx1 = pct(xs, 1 - lo), wy0 = pct(ys, lo), wy1 = pct(ys, 1 - lo);
  const span = Math.max(wx1 - wx0, wy1 - wy0, 6) * 1.35, mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
  wx0 = mx - span / 2; wx1 = mx + span / 2; wy0 = my - span / 2; wy1 = my + span / 2;
  const k = Math.min((box.x1 - box.x0) / (wx1 - wx0), (box.y1 - box.y0) / (wy1 - wy0));
  const ox = (box.x0 + box.x1) / 2 - (wx0 + wx1) / 2 * k, oy = (box.y0 + box.y1) / 2 - (wy0 + wy1) / 2 * k;
  const P = p => [ox + p.x * k, oy + p.y * k];
  const dim = badge ? 0.45 : 1;
  g.globalAlpha = dim;
  for (const p of places) { const [x, y] = P(p); if (x < 40 || x > Wc - 40 || y < 280 || y > 1040) continue; g.fillStyle = hexA(CATS[p.cat].color, 0.28); g.beginPath(); g.arc(x, y, 3, 0, 6.283); g.fill(); }
  for (const kk of catKeys) {
    g.strokeStyle = hexA(CATS[kk].color, 0.55); g.lineWidth = 2.5; g.beginPath();
    for (const [a, b] of mst(seen.filter(p => p.cat === kk))) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); }
    g.stroke();
  }
  for (const p of seen) { const [x, y] = P(p), r = 13 + (p.rank || 1) * 4; g.drawImage(sprite(CATS[p.cat].color), x - r * 2, y - r * 2, r * 4, r * 4); }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const city = (CFG.name || 'the city');
  g.fillStyle = '#7cf3ff'; g.font = `600 30px ${F}`; g.fillText((badge ? 'BADGE UNLOCKED' : `MY ${city.toUpperCase()} CONSTELLATION`).split('').join(String.fromCharCode(8202)), Wc / 2, 120);
  if (badge) {
    const col = TIER[badge.tier] || '#ffd34d';
    const halo = g.createRadialGradient(Wc / 2, 640, 0, Wc / 2, 640, 300); halo.addColorStop(0, hexA(col.length === 7 ? col : '#ffd34d', 0.35)); halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(0, 300, Wc, 700);
    g.fillStyle = 'rgba(8,12,32,.85)'; g.beginPath(); g.arc(Wc / 2, 640, 190, 0, 6.283); g.fill();
    g.strokeStyle = col; g.lineWidth = 14; g.stroke();
    g.font = `170px ${F}`; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(badge.icon, Wc / 2, 650); g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff'; g.font = `700 76px ${F}`; g.fillText(badge.name, Wc / 2, 245, Wc - 120);
    g.fillStyle = col; g.font = `600 34px ${F}`; g.fillText(badge.tiers > 1 ? `${badge.tier.toUpperCase()} TIER` : 'EARNED', Wc / 2, 900);
    g.fillStyle = '#c3cbea'; g.font = `400 32px ${F}`; g.fillText(badge.desc + ` in ${city}`, Wc / 2, 955, Wc - 120);
  } else {
    g.fillStyle = '#fff'; g.font = `700 92px ${F}`; g.fillText(`${s.visited} place${s.visited === 1 ? '' : 's'} explored`, Wc / 2, 225, Wc - 100);
    g.fillStyle = '#c3cbea'; g.font = `500 36px ${F}`; g.fillText(`${s.level} · ${s.points} points · ${s.visited} of the top ${s.total}`, Wc / 2, 285, Wc - 100);
  }
  // earned badges strip
  const got = s.badges.filter(b => b.tier).slice(-7);
  if (got.length) {
    const gap = 118, x0 = Wc / 2 - (got.length - 1) * gap / 2;
    got.forEach((b, i) => { const x = x0 + i * gap; g.fillStyle = 'rgba(8,12,32,.8)'; g.beginPath(); g.arc(x, 1110, 46, 0, 6.283); g.fill(); g.strokeStyle = TIER[b.tier]; g.lineWidth = 5; g.stroke(); g.font = `46px ${F}`; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(b.icon, x, 1114); g.textBaseline = 'alphabetic'; });
    g.fillStyle = '#8a93b8'; g.font = `500 26px ${F}`; g.fillText(`${s.earned} badge${s.earned === 1 ? '' : 's'} earned`, Wc / 2, 1192);
  }
  g.fillStyle = 'rgba(140,160,255,.25)'; g.fillRect(90, 1232, Wc - 180, 2);
  g.fillStyle = '#e8ecff'; g.font = `600 32px ${F}`; g.fillText('Explore it with your hands  →  ' + shareUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), Wc / 2, 1290, Wc - 120);
  return c;
}
function openShare(badge) {
  if (!XP) return;
  const s = XP.summary(), url = shareUrl(), city = CFG.name || 'the city';
  const text = badge ? `I just earned the ${badge.name} badge${badge.tiers > 1 ? ` (${badge.tier})` : ''} exploring ${city} on a map I fly with my hands ✋✨`
    : s.visited ? `I've explored ${s.visited} of the top ${s.total} places in ${city}: ${s.points} points, level ${s.level}. Here's my constellation ✨`
    : `Fly ${city} with your hands, tick off the top places and earn badges ✨`;
  const canvas = drawShareCard(badge), dataUrl = canvas.toDataURL('image/png');
  const bin = atob(dataUrl.split(',')[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const fname = `${CITY_ID}-${badge ? 'badge' : 'constellation'}.png`, file = new File([u8], fname, { type: 'image/png' });
  const canFile = !!(navigator.canShare && navigator.canShare({ files: [file] })), E = encodeURIComponent;
  $('#shareBody').innerHTML = `<h2>Share your <span>${badge ? 'badge' : 'constellation'}</span></h2>
    <img class="simg" src="${dataUrl}" alt="Share image">
    <div class="sbtns">
      ${canFile ? '<button id="sNative" data-gx class="pri wide">📤 Share image to Instagram, WhatsApp…</button>' : navigator.share ? '<button id="sNative" data-gx class="pri wide">📤 Share…</button>' : ''}
      <a class="sbtn" data-gx target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${E(url)}">in&nbsp; LinkedIn</a>
      <a class="sbtn" data-gx target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${E(url)}">f&nbsp; Facebook</a>
      <a class="sbtn" data-gx target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${E(text)}&url=${E(url)}">𝕏&nbsp; Post</a>
      <a class="sbtn" data-gx target="_blank" rel="noopener" href="https://wa.me/?text=${E(text + ' ' + url)}">💬&nbsp; WhatsApp</a>
      <a class="sbtn" data-gx download="${fname}" href="${dataUrl}">⬇&nbsp; Save image</a>
      <button id="sCopy" data-gx class="sbtn">🔗&nbsp; Copy text + link</button>
    </div>
    <p class="fine">${canFile ? 'On Instagram, pick Stories or Feed from the share sheet.' : 'Instagram has no web share link: save the image, then post it as a Story or in your feed.'} LinkedIn and Facebook share the link; attach the saved image to your post to show it off.</p>`;
  const nat = $('#sNative');
  if (nat) nat.onclick = () => navigator.share(canFile ? { files: [file], title: document.title, text: text + ' ' + url } : { title: document.title, text, url }).catch(() => {});
  $('#sCopy').onclick = () => navigator.clipboard?.writeText(text + ' ' + url).then(() => toast('Copied. Paste it anywhere.'), () => toast('Couldn’t copy here.'));
  closeOverlays(); $('#share').classList.add('show');
}

/* ============ 10. Main loop ============ */
function loop(now) {
  if (anim) {
    const p = clamp((now - anim.t0) / anim.ms, 0, 1), e = 1 - (1 - p) ** 3;
    for (const k of ['cx', 'cy', 'r']) view[k] = anim.from[k] + (anim.to[k] - anim.from[k]) * e;
    view.z = Math.exp(Math.log(anim.from.z) + (Math.log(anim.to.z) - Math.log(anim.from.z)) * e);
    if (p >= 1) anim = null;
  }
  if (demo) tickDemo(now); else pollCamera();
  draw(now);
  requestAnimationFrame(loop);
}

/* ============ 11. Mouse, touch, keyboard ============ */
let drag = null; const touches = new Map(); let pinchRef = null;
// ?embed: the demo restarts after you stop touching it.
let idleT = 0;
function demoLater() { if (!EMBED) return; clearTimeout(idleT); idleT = setTimeout(() => { if (!demo && !handOn) startDemo(); }, 9000); }
cv.addEventListener('pointerdown', e => {
  if (demo) stopDemo(); stopAnim();
  cv.setPointerCapture(e.pointerId); touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchRef = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; drag = null; }
});
cv.addEventListener('pointermove', e => {
  S.mouse = { x: e.clientX, y: e.clientY };
  if (!touches.has(e.pointerId)) { if (!lastFrame?.hands?.length) S.hover = pickPlace(e.clientX, e.clientY, 24); return; }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && pinchRef) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), an = Math.atan2(b.y - a.y, b.x - a.x);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchRef.d); rotateBy(an - pinchRef.a); pinchRef = { d, a: an };
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
    panBy(dx, dy); drag.x = e.clientX; drag.y = e.clientY; if (drag.moved > 4) cv.classList.add('dragging');
  }
});
const endPtr = e => {
  touches.delete(e.pointerId); cv.classList.remove('dragging');
  if (drag && drag.moved < 6 && e.type === 'pointerup') { const p = pickPlace(e.clientX, e.clientY, 26); select(p); }
  if (touches.size < 2) pinchRef = null;
  if (!touches.size) drag = null;
  demoLater();
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); stopAnim(); if (demo) stopDemo(); demoLater(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

addEventListener('keydown', e => {
  if (e.target === search) return;
  const k = e.key, step = Math.min(W, H) * 0.3;
  if (k === '/') { e.preventDefault(); search.focus(); }
  else if (k === 'Escape') { select(null); closeOverlays(); stopDemo(); }
  else if (k === 'ArrowLeft') panAnimated(-step, 0); else if (k === 'ArrowRight') panAnimated(step, 0);
  else if (k === 'ArrowUp') panAnimated(0, -step); else if (k === 'ArrowDown') panAnimated(0, step);
  else if (k === '+' || k === '=') animateTo({ z: view.z * 1.6 }, 300); else if (k === '-') animateTo({ z: view.z / 1.6 }, 300);
  else if (k === 'q' || k === 'Q') animateTo({ r: view.r - 0.3 }, 300); else if (k === 'e' || k === 'E') animateTo({ r: view.r + 0.3 }, 300);
  else if (k === 'r' || k === 'R') home();
  else if (k === 'h' || k === 'H') handOn ? stopHands() : startHands();
  else if (k === '?') $('#help').classList.toggle('show');
  else if (k === 'x' || k === 'X') $('#explore').classList.contains('show') ? closeOverlays() : openExplore();
  else if (k === ' ' && handOn) { e.preventDefault(); togglePause(); }
});

/* ============ 12. Buttons, overlays, toast ============ */
function closeOverlays() { document.querySelectorAll('.ov').forEach(o => o.classList.remove('show')); }
function togglePause() { paused = !paused; $('#btnPause').textContent = paused ? '▶ Resume' : '⏸ Pause'; toast(paused ? 'Hand control paused' : 'Hand control resumed'); }
let toastT = 0;
function toast(msg, ms = 1800) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }

$('#btnHands').onclick = () => handOn ? stopHands() : startHands();
$('#btnPause').onclick = togglePause;
$('#btnDemo').onclick = () => demo ? stopDemo() : startDemo();
$('#btnReset').onclick = () => { select(null); home(); };
$('#btnHelp').onclick = () => $('#help').classList.add('show');
$('#introHands').onclick = startHands;
$('#introDemo').onclick = startDemo;
$('#introMouse').onclick = closeOverlays;
$('#btnExplore').onclick = () => openExplore();
$('#introExplore').onclick = () => openExplore('lists');
document.querySelectorAll('.closeX').forEach(b => b.onclick = closeOverlays);
$('#demoStop').onclick = () => { stopDemo(); demoLater(); };
document.querySelectorAll('.closeHelp').forEach(b => b.onclick = closeOverlays);
document.querySelectorAll('.ov').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeOverlays(); }));

/* ============ boot ============ */
addEventListener('resize', resize);
resize(); buildLegend(); drawCam([], 'none'); updateXpButton();
if (problems.length) toast(`City config: ${problems.length} problem${problems.length > 1 ? 's' : ''}. See the browser console.`, 5000);
const qs = new URLSearchParams(location.search);
if (EMBED) { document.body.classList.add('embed'); closeOverlays(); startDemo(); }
else if (qs.has('demo')) startDemo();
requestAnimationFrame(loop);
window.GestureCityMap = { view, places, engine, onHands, startDemo, stopDemo, select, home, w2s, explore: XP, openExplore, openShare, setVisit };
})();
