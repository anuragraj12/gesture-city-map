/*  Gesture engine for Gesture City Map
    ------------------------------------------------------------------
    Turns MediaPipe hand landmarks into a small, predictable set of map
    commands. It has no DOM code, so it runs in the browser and in Node
    (see test/gestures.test.js).

    Poses (one hand)                 Command
      open palm, moved fast          swipe left / right / up / down
      thumb + index, others folded   pinch out = zoom in, pinch in = zoom out
      index finger only              move the pointer
      thumbs up (hold)               click the place under the pointer
      fist (hold)                    close the open place
    Two hands
      both hands in view             rotate the map (turn the line between them)

    Robustness tricks used below
      - Finger shape uses MediaPipe *world* landmarks (metric, camera-facing),
        so poses read the same whether your hand is near, far or tilted.
      - A new pose must persist for a few frames (hysteresis) before it counts.
      - Click and close fire once per pose, after a short hold, with a cooldown.
      - The pointer is smoothed with a One Euro filter and rewinds to where it
        was *before* your hand started changing shape, so clicking can't
        knock it off target.
      - Swipes need speed, distance and a clear direction; the return stroke
        of a swipe is ignored.
      - Two-hand mode suppresses one-hand gestures, with a grace period after.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Gestures = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    extOn: 1.55,            // finger counts as straight above this tip/knuckle distance ratio
    curlOn: 1.35,           // ...and as folded below this one
    thumbOut: 0.72,         // thumb tip distance from index knuckle (palm sizes) for "thumb out"
    pinchClose: 0.32,       // thumb–index tip gap (palm sizes) that counts as pinched together
    pinchTight: 0.22,       // a very tight pinch still counts even if the index is bent a lot
    thumbFree: 0.68,        // thumb tip distance from the folded middle finger: pinch vs point
    thumbUpTop: -0.10,      // thumbs up: thumb tip at least about as high as every other point
    thumbUpRise: 0.45,      // ...and well above its own base knuckle
    poseFrames: 3,          // frames a new pose must persist before it takes over
    holdMs: 320,            // hold a thumbs up or fist this long to fire
    actionCooldownMs: 900,  // minimum gap between two clicks (or two closes)
    pointerRewindMs: 130,   // when leaving the pointer pose, rewind the pointer this far
    swipeWindowMs: 320,
    swipeDist: 0.15,        // fraction of the camera frame the palm must travel
    swipeAxisRatio: 1.7,    // main direction must dominate the other by this much
    swipeOpenShare: 0.6,    // share of recent frames that must read as an open palm
    swipeCooldownMs: 650,
    swipeReturnMs: 1000,    // within this window a swipe back the other way...
    swipeReturnDist: 0.30,  // ...must travel this far (ignores the return stroke)
    zoomGain: 1.0,          // one full pinch spread is roughly an 8x zoom
    zoomSettleMs: 150,      // a pinch must be held this long before it can zoom (hand-shape changes pass through pinch)
    pinchTrailMs: 300,      // ...and this long before the pointer trusts it for clicks
    zoomLatch: 0.09,        // thumb–index gap must change ~9% before zooming starts
    zoomDeadband: 0.012,
    zoomSmoothing: 0.5,
    rotateDeadband: 0.006,  // radians
    rotateSmoothing: 0.5,
    twoHandFrames: 3,
    twoHandGraceMs: 350,
    box: { x0: 0.18, x1: 0.82, y0: 0.14, y1: 0.76 }, // camera area that maps to the full screen
    pointerMinCutoff: 1.2,
    pointerBeta: 0.015,
  };

  const KNUCKLE = [5, 9, 13, 17];
  const TIP = [8, 12, 16, 20];
  const PALM = [0, 5, 9, 13, 17];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  /* ---------- measurements from one hand ---------- */
  function features(hand) {
    const L = hand.lm, W = hand.world || hand.lm;
    const scale = d3(W[0], W[9]) || 1e-6;
    const ext = TIP.map((t, i) => d3(W[0], W[t]) / (d3(W[0], W[KNUCKLE[i]]) || 1e-6));
    const thumbOut = d3(W[4], W[5]) / scale;
    const pinch = d3(W[4], W[8]) / scale;
    const thumbFree = d3(W[4], W[10]) / scale;
    const iscale = Math.hypot(L[0].x - L[9].x, L[0].y - L[9].y) || 1e-6;
    let minOther = Infinity;
    for (let i = 0; i < 21; i++) if (i < 1 || i > 4) minOther = Math.min(minOther, L[i].y);
    const thumbTop = (minOther - L[4].y) / iscale;
    const thumbRise = (L[2].y - L[4].y) / iscale;
    let px = 0, py = 0;
    for (const i of PALM) { px += L[i].x; py += L[i].y; }
    return { ext, thumbOut, thumbFree, pinch, thumbTop, thumbRise, iscale, palm: { x: 1 - px / 5, y: py / 5 }, tip: { x: 1 - L[8].x, y: L[8].y } };
  }

  /* ---------- pose from measurements (one frame, no memory) ---------- */
  function classify(f, C = DEFAULTS) {
    const ext = x => x > C.extOn, curled = x => x < C.curlOn;
    const [I, M, R, P] = f.ext;
    if (f.ext.every(curled)) {
      if (f.thumbTop > C.thumbUpTop && f.thumbRise > C.thumbUpRise) return 'thumbsup';
      if (f.pinch < C.pinchTight && I > 1.1) return 'pinch';
      return 'fist';
    }
    if (f.ext.filter(ext).length >= 3) return 'open';
    if (!ext(M) && !ext(R) && !ext(P) && !curled(I)) {
      if (f.pinch < C.pinchClose || f.thumbFree > C.thumbFree || f.thumbOut > C.thumbOut) return 'pinch';
      if (ext(I)) return 'point';
    }
    return 'none';
  }

  /* ---------- One Euro filter (smooth when still, responsive when moving) ---------- */
  class OneEuro {
    constructor(minCutoff, beta, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff }); this.reset(); }
    reset() { this.x = null; this.dx = 0; this.t = 0; }
    alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
    filter(v, tMs) {
      if (this.x === null) { this.x = v; this.t = tMs; return v; }
      const dt = Math.max(1e-3, (tMs - this.t) / 1000); this.t = tMs;
      const dv = (v - this.x) / dt;
      this.dx += this.alpha(this.dCutoff, dt) * (dv - this.dx);
      const cut = this.minCutoff + this.beta * Math.abs(this.dx);
      this.x += this.alpha(cut, dt) * (v - this.x);
      return this.x;
    }
  }

  /* ---------- the engine: frames in, commands out ---------- */
  class Engine {
    constructor(opts = {}) {
      this.C = { ...DEFAULTS, ...opts, box: { ...DEFAULTS.box, ...(opts.box || {}) } };
      this.w = 1280; this.h = 720; this.camAspect = 16 / 9;
      this.fx = new OneEuro(this.C.pointerMinCutoff, this.C.pointerBeta);
      this.fy = new OneEuro(this.C.pointerMinCutoff, this.C.pointerBeta);
      this.reset();
    }
    setScreen(w, h) { this.w = w; this.h = h; }
    /** Width / height of the camera frame, so two-hand angles match how your hands really sit. */
    setCameraAspect(a) { if (a > 0) this.camAspect = a; }
    reset() {
      this.pose = 'none'; this.cand = 'none'; this.candN = 0; this.candT = 0; this.poseT = 0;
      this.fired = false; this.lastClick = -1e9; this.lastClose = -1e9;
      this.samples = []; this.lastSwipe = { dir: null, t: -1e9 };
      this.pointer = this.pointer || { x: this.w / 2, y: this.h / 2, visible: false };
      this.trail = [];
      this.zoomLn = null; this.zoomAcc = 0; this.zoomBase = 0; this.zoomOn = false;
      this.two = { n: 0, active: false, prev: null, pts: null, ema: 0, acc: 0 };
      this.graceUntil = 0; this.raw = 'none'; this.f = null;
    }
    toScreen(p) {
      const b = this.C.box;
      return { x: clamp((p.x - b.x0) / (b.x1 - b.x0), 0, 1) * this.w, y: clamp((p.y - b.y0) / (b.y1 - b.y0), 0, 1) * this.h };
    }
    /** Map a screen point back to the camera point that would produce it (used by the demo). */
    fromScreen(x, y) {
      const b = this.C.box;
      return { x: b.x0 + (x / this.w) * (b.x1 - b.x0), y: b.y0 + (y / this.h) * (b.y1 - b.y0) };
    }

    /**
     * @param hands array of { lm: 21 normalised {x,y,z}, world?: 21 metric {x,y,z} } — MediaPipe's
     *              landmarks / worldLandmarks for each detected hand
     * @param t     timestamp in ms
     * @returns { events, pose, mode, pointer, hold, raw, features }
     */
    update(hands, t) {
      const ev = [];
      hands = hands || [];
      if (hands.length >= 2) this.twoHands(hands.slice(0, 2), t, ev);
      else {
        if (this.two.active || this.two.n) {
          if (this.two.active) { this.graceUntil = t + this.C.twoHandGraceMs; ev.push({ type: 'mode', mode: 'one' }); }
          this.two = { n: 0, active: false, prev: null, pts: null, ema: 0, acc: 0 };
        }
        if (hands.length === 1 && t >= this.graceUntil) this.oneHand(hands[0], t, ev);
        else this.idle(t, ev);
      }
      const holding = (this.pose === 'thumbsup' || this.pose === 'fist') && !this.fired;
      return {
        events: ev, pose: this.two.active ? 'two' : this.pose, raw: this.raw,
        mode: this.two.active ? 'two' : hands.length ? 'one' : 'none',
        pointer: this.pointer, features: this.f,
        hold: holding ? clamp((t - this.poseT) / this.C.holdMs, 0, 1) : 0,
      };
    }

    idle(t, ev) {
      if (this.pose !== 'none') { this.setPose('none', t, ev); }
      this.cand = 'none'; this.candN = 0; this.raw = 'none'; this.f = null; this.samples = [];
    }

    setPose(p, t, ev) {
      const prev = this.pose;
      const carries = q => q === 'point' || q === 'pinch';
      if (carries(prev) && !carries(p)) this.rewindPointer();
      this.pose = p; this.poseT = t; this.fired = false;
      if (p === 'pinch') { this.zoomLn = null; this.zoomAcc = 0; this.zoomOn = false; }
      if ((p === 'point' || p === 'pinch') && !carries(prev)) { this.fx.reset(); this.fy.reset(); }
      ev.push({ type: 'pose', pose: p, from: prev });
    }

    rewindPointer() {
      const target = this.candT - this.C.pointerRewindMs;
      let best = null;
      for (const s of this.trail) if (s.t <= target) best = s;
      if (best) { this.pointer.x = best.x; this.pointer.y = best.y; }
    }

    oneHand(hand, t, ev) {
      const C = this.C;
      const f = features(hand); this.f = f;
      const raw = classify(f, C); this.raw = raw;

      // hysteresis: a new pose must persist for poseFrames frames
      if (raw === this.pose) { this.cand = raw; this.candN = 0; }
      else {
        if (raw !== this.cand) { this.cand = raw; this.candN = 0; this.candT = t; }
        if (++this.candN >= C.poseFrames) this.setPose(raw, t, ev);
      }

      // palm track for swipes
      this.samples.push({ t, x: f.palm.x, y: f.palm.y, open: raw === 'open' });
      while (this.samples.length && t - this.samples[0].t > C.swipeWindowMs) this.samples.shift();

      switch (this.pose) {
        case 'point':
        case 'pinch': {
          // the index fingertip drives the pointer in both poses, so pointing with a
          // relaxed thumb still works; zoom only starts once the thumb–index gap really changes
          const s = this.toScreen(f.tip);
          this.pointer.x = this.fx.filter(s.x, t); this.pointer.y = this.fy.filter(s.y, t); this.pointer.visible = true;
          const trusted = this.raw === this.pose && (this.pose === 'point' || t - this.poseT > C.pinchTrailMs);
          if (trusted) {                         // skip frames where the hand is changing shape
            this.trail.push({ t, x: this.pointer.x, y: this.pointer.y });
            while (this.trail.length && t - this.trail[0].t > 600) this.trail.shift();
          }
          ev.push({ type: 'pointer', x: this.pointer.x, y: this.pointer.y });
          if (this.pose === 'pinch' && this.raw === 'pinch' && t - this.poseT >= C.zoomSettleMs) this.zoom(f, ev);
          break;
        }
        case 'thumbsup':
          if (!this.fired && t - this.poseT >= C.holdMs) {
            this.fired = true;
            if (t - this.lastClick >= C.actionCooldownMs) { this.lastClick = t; ev.push({ type: 'click', x: this.pointer.x, y: this.pointer.y }); }
          }
          break;
        case 'fist':
          if (!this.fired && t - this.poseT >= C.holdMs) {
            this.fired = true;
            if (t - this.lastClose >= C.actionCooldownMs) { this.lastClose = t; ev.push({ type: 'close' }); }
          }
          break;
        case 'open':
          this.detectSwipe(t, ev);
          break;
      }
    }

    zoom(f, ev) {
      const C = this.C, ln = Math.log(Math.max(f.pinch, 0.05));
      if (this.zoomLn === null) { this.zoomLn = ln; this.zoomBase = ln; this.zoomOn = false; return; }
      const sm = this.zoomLn + (ln - this.zoomLn) * (1 - C.zoomSmoothing);
      if (!this.zoomOn) {
        this.zoomLn = sm;
        if (Math.abs(sm - this.zoomBase) > C.zoomLatch) { this.zoomOn = true; this.zoomAcc = 0; }
        return;
      }
      this.zoomAcc += sm - this.zoomLn; this.zoomLn = sm;
      if (Math.abs(this.zoomAcc) > C.zoomDeadband) {
        ev.push({ type: 'zoom', factor: Math.exp(C.zoomGain * this.zoomAcc), x: this.pointer.x, y: this.pointer.y });
        this.zoomAcc = 0;
      }
    }

    detectSwipe(t, ev) {
      const C = this.C, S = this.samples;
      if (S.length < 4 || t - this.lastSwipe.t < C.swipeCooldownMs) return;
      if (S.filter(s => s.open).length / S.length < C.swipeOpenShare) return;
      const a = S[0], b = S[S.length - 1];
      const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy);
      const horiz = ax >= ay, dist = horiz ? ax : ay, other = horiz ? ay : ax;
      if (dist < C.swipeDist || dist < other * C.swipeAxisRatio) return;
      const dir = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' }[dir];
      if (this.lastSwipe.dir === opposite && t - this.lastSwipe.t < C.swipeReturnMs && dist < C.swipeReturnDist) return;
      this.lastSwipe = { dir, t }; this.samples = [];
      ev.push({ type: 'swipe', dir });
    }

    twoHands(hands, t, ev) {
      const C = this.C, T = this.two;
      if (this.pose !== 'none') { this.setPose('none', t, ev); }
      this.cand = 'none'; this.candN = 0; this.raw = 'two'; this.f = null; this.samples = [];
      const pts = hands.map(h => features(h).palm);
      if (T.pts) {   // keep each hand matched to itself so the angle never flips
        const keep = Math.hypot(pts[0].x - T.pts[0].x, pts[0].y - T.pts[0].y) + Math.hypot(pts[1].x - T.pts[1].x, pts[1].y - T.pts[1].y);
        const swap = Math.hypot(pts[1].x - T.pts[0].x, pts[1].y - T.pts[0].y) + Math.hypot(pts[0].x - T.pts[1].x, pts[0].y - T.pts[1].y);
        if (swap < keep) pts.reverse();
      } else pts.sort((p, q) => p.x - q.x);
      T.pts = pts;
      const asp = this.camAspect;
      const ang = Math.atan2(pts[1].y - pts[0].y, (pts[1].x - pts[0].x) * asp);
      T.n++;
      if (!T.active) {
        if (T.n >= C.twoHandFrames) { T.active = true; T.prev = ang; T.ema = 0; T.acc = 0; ev.push({ type: 'mode', mode: 'two' }); }
        return;
      }
      const d = wrap(ang - T.prev); T.prev = ang;
      T.ema = T.ema * C.rotateSmoothing + d * (1 - C.rotateSmoothing);
      T.acc += T.ema;
      if (Math.abs(T.acc) > C.rotateDeadband) { ev.push({ type: 'rotate', delta: T.acc }); T.acc = 0; }
    }
  }

  return { DEFAULTS, features, classify, Engine, OneEuro };
});
