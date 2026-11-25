/*  Gesture engine for Gesture City Map
    ------------------------------------------------------------------
    Turns MediaPipe hand landmarks into a small, predictable set of map
    commands. It has no DOM code, so it runs in the browser and in Node
    (see test/gestures.test.js).

    Poses (one hand)                         Command
      four fingers straight and together     drag: the map follows your hand (pan)
      index + middle straight (✌️)           move up = zoom in, move down = zoom out
      index finger only                      move the pointer
      ...then fold the index and lift it     click the place under the pointer
      thumbs up (hold)                       click (still works)
      fist (hold)                            close the open place
      open palm, fingers spread              rest: nothing happens
    Two hands
      both hands in view                     rotate the map (turn the line between them)

    Trained gestures (src/trainer.js) plug in through engine.setClassifier().
    A confident custom prediction replaces the built-in pose for that frame,
    so a trained gesture can drive any built-in action or a one-off command.

    Robustness tricks used below
      - Finger shape uses MediaPipe *world* landmarks (metric, camera-facing),
        so poses read the same whether your hand is near, far or tilted.
      - "Fingers together" is measured as the angle between neighbouring
        fingers in the plane of the palm, so bending a finger doesn't count.
      - A new pose must persist for a few frames (hysteresis) before it counts.
      - Pan and zoom only use frames where the hand clearly holds the pose, and
        they re-anchor whenever it doesn't, so changing shape never jerks the map.
      - The click freezes the pointer the moment the index starts to fold, and
        rewinds it a little, so folding can't drag it off target. A fold held too
        long is not a click: it becomes a fist.
      - Hold gestures fire once per pose, after a short hold, with a cooldown.
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
    flatSpread: 20,         // degrees: four straight fingers fanned less than this (in total) are "together"
    thumbUpTop: -0.10,      // thumbs up: thumb tip at least about as high as every other point
    thumbUpRise: 0.45,      // ...and well above its own base knuckle
    poseFrames: 3,          // frames a new pose must persist before it takes over
    holdMs: 320,            // hold a thumbs up, fist or trained command this long to fire
    actionCooldownMs: 900,  // minimum gap between two firings of the same hold gesture
    pointerRewindMs: 130,   // when the pointer stops (fold or shape change), rewind it this far
    tapDepth: 1.30,         // click: the index must fold below this ratio...
    tapUp: 1.62,            // ...and straighten above this one again...
    tapMinMs: 50,           // ...within this window
    tapMaxMs: 450,          // (held longer than this, a fold is a fist, not a click)
    clickCooldownMs: 450,
    tapThumbFrames: 6,      // a fold that settles into a thumbs up for this many frames is a thumbs up
    panGain: 1.6,           // screen pixels the map moves per pixel of hand movement
    panSettleMs: 120,       // the four-finger pose must be held this long before it pans
    panDeadband: 1.0,       // px
    panStart: 9,            // px of hand movement before a still hand starts dragging
    panStill: 1.2,          // px per frame below which the hand counts as still...
    panStillMs: 350,        // ...and after this long still, the dead zone comes back
    zoomGain: 2.2,          // moving one screen height zooms by e^2.2 ≈ 9x
    zoomSettleMs: 150,
    zoomLatch: 0.025,       // fraction of screen height to move before zooming starts
    zoomDeadband: 0.004,
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
  const sub = (a, b) => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1e-9; return [v[0] / n, v[1] / n, v[2] / n]; };
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  /** Total angle (degrees) between neighbouring fingers, measured in the plane of the palm. */
  function spreadOf(W) {
    const n = unit(cross(sub(W[5], W[0]), sub(W[17], W[0])));
    const dirs = TIP.map((t, i) => { const v = sub(W[t], W[KNUCKLE[i]]), k = dot(v, n); return unit([v[0] - n[0] * k, v[1] - n[1] * k, v[2] - n[2] * k]); });
    let s = 0;
    for (let i = 0; i < 3; i++) s += Math.acos(clamp(dot(dirs[i], dirs[i + 1]), -1, 1));
    return s * 180 / Math.PI;
  }

  /* ---------- measurements from one hand ---------- */
  function features(hand) {
    const L = hand.lm, W = hand.world || hand.lm;
    const ext = TIP.map((t, i) => d3(W[0], W[t]) / (d3(W[0], W[KNUCKLE[i]]) || 1e-6));
    const iscale = Math.hypot(L[0].x - L[9].x, L[0].y - L[9].y) || 1e-6;
    let minOther = Infinity;
    for (let i = 0; i < 21; i++) if (i < 1 || i > 4) minOther = Math.min(minOther, L[i].y);
    const thumbTop = (minOther - L[4].y) / iscale;
    const thumbRise = (L[2].y - L[4].y) / iscale;
    const mirror = i => ({ x: 1 - L[i].x, y: L[i].y });   // selfie view: x grows to the user's right
    const avg = ids => { let x = 0, y = 0; for (const i of ids) { x += 1 - L[i].x; y += L[i].y; } return { x: x / ids.length, y: y / ids.length }; };
    return {
      ext, spread: spreadOf(W), thumbTop, thumbRise, iscale,
      palm: avg(PALM), tip: mirror(8), tips: avg(TIP), vee: avg([8, 12]),
    };
  }

  /* ---------- pose from measurements (one frame, no memory) ---------- */
  function classify(f, C = DEFAULTS) {
    const ext = x => x > C.extOn, curled = x => x < C.curlOn;
    const [I, M, R, P] = f.ext;
    if (f.ext.every(curled)) {
      if (f.thumbTop > C.thumbUpTop && f.thumbRise > C.thumbUpRise) return 'thumbsup';
      return 'fist';
    }
    const n = f.ext.filter(ext).length;
    if (n === 4) return f.spread < C.flatSpread ? 'flat' : 'open';
    if (n === 3) return 'open';
    if (ext(I) && ext(M) && !ext(R) && !ext(P)) return 'vee';
    if (ext(I) && !ext(M) && !ext(R) && !ext(P)) return 'point';
    return 'none';
  }

  /** Which event a hold gesture fires, if any. */
  function holdEvent(pose) {
    if (pose === 'thumbsup') return 'click';
    if (pose === 'fist') return 'close';
    if (typeof pose === 'string' && pose.startsWith('cmd:')) return 'command';
    return null;
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
      const mk = () => new OneEuro(this.C.pointerMinCutoff, this.C.pointerBeta);
      this.fx = mk(); this.fy = mk();     // pointer
      this.px = mk(); this.py = mk();     // pan
      this.zy = mk();                     // zoom
      this.custom = null;
      this.reset();
    }
    setScreen(w, h) { this.w = w; this.h = h; }
    /** Width / height of the camera frame, so two-hand angles match how your hands really sit. */
    setCameraAspect(a) { if (a > 0) this.camAspect = a; }
    /**
     * Plug in a trained classifier: fn(hand, features) -> { pose, label } or null.
     * `pose` is a built-in pose name ('point', 'flat', 'vee', 'fist', 'thumbsup', 'open', 'none')
     * or 'cmd:<name>' for a hold-to-fire command. Return null to fall back to the built-in rules.
     */
    setClassifier(fn) { this.custom = typeof fn === 'function' ? fn : null; }
    reset() {
      this.pose = 'none'; this.cand = 'none'; this.candN = 0; this.candT = 0; this.poseT = 0;
      this.label = null; this.rawLabel = null; this.candLabel = null;
      this.fired = false; this.lastFire = {};
      this.pointer = this.pointer || { x: this.w / 2, y: this.h / 2, visible: false };
      this.trail = []; this.tap = null; this.tapArmed = false; this.marker = null;
      this.pan = { last: null, anchor: null, moving: false, stillT: 0, ax: 0, ay: 0 };
      this.zm = null;
      this.two = { n: 0, active: false, prev: null, pts: null, ema: 0, acc: 0 };
      this.graceUntil = 0; this.raw = 'none'; this.f = null;
    }
    toScreen(p) {
      const b = this.C.box;
      return { x: clamp((p.x - b.x0) / (b.x1 - b.x0), 0, 1) * this.w, y: clamp((p.y - b.y0) / (b.y1 - b.y0), 0, 1) * this.h };
    }
    /** Like toScreen but not clamped to the screen, for measuring movement. */
    toScreenFree(p) {
      const b = this.C.box;
      return { x: (p.x - b.x0) / (b.x1 - b.x0) * this.w, y: (p.y - b.y0) / (b.y1 - b.y0) * this.h };
    }
    /** Map a screen point back to the camera point that would produce it (used by the demo). */
    fromScreen(x, y) {
      const b = this.C.box;
      return { x: b.x0 + (x / this.w) * (b.x1 - b.x0), y: b.y0 + (y / this.h) * (b.y1 - b.y0) };
    }

    /**
     * @param hands array of { lm: 21 normalised {x,y,z}, world?: 21 metric {x,y,z}, handed?: 'Left'|'Right' }
     *              — MediaPipe's landmarks / worldLandmarks / handedness for each detected hand
     * @param t     timestamp in ms
     * @returns { events, pose, label, mode, pointer, marker, tapping, hold, raw, rawLabel, features }
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
      const holding = holdEvent(this.pose) && !this.fired;
      return {
        events: ev, pose: this.two.active ? 'two' : this.pose, label: this.label,
        raw: this.raw, rawLabel: this.rawLabel,
        mode: this.two.active ? 'two' : hands.length ? 'one' : 'none',
        pointer: this.pointer, marker: this.marker, tapping: !!this.tap, features: this.f,
        hold: holding ? clamp((t - this.poseT) / this.C.holdMs, 0, 1) : 0,
      };
    }

    idle(t, ev) {
      if (this.pose !== 'none') this.setPose('none', t, ev);
      this.cand = 'none'; this.candN = 0; this.raw = 'none'; this.rawLabel = null; this.f = null; this.tap = null; this.marker = null;
    }

    setPose(p, t, ev, label = null) {
      const prev = this.pose;
      if (prev === 'point' && p !== 'point') this.rewindPointer(this.candT);
      this.pose = p; this.poseT = t; this.fired = false; this.label = label; this.tap = null; this.marker = null;
      if (p === 'point' && prev !== 'point') { this.fx.reset(); this.fy.reset(); }
      if (p === 'flat') this.pan = { last: null, anchor: null, moving: false, stillT: 0, ax: 0, ay: 0 };
      this.zm = null;
      ev.push({ type: 'pose', pose: p, from: prev, label });
    }

    /** Put the pointer back where it was rewindMs before `t` (before the hand started changing). */
    rewindPointer(t) {
      const target = t - this.C.pointerRewindMs;
      let best = null;
      for (const s of this.trail) if (s.t <= target) best = s;
      if (best) { this.pointer.x = best.x; this.pointer.y = best.y; }
    }

    oneHand(hand, t, ev) {
      const C = this.C;
      const f = features(hand); this.f = f;
      let raw = classify(f, C), label = null;
      if (this.custom) {
        const c = this.custom(hand, f);
        if (c && c.pose) { raw = c.pose; label = c.label || null; }
      }
      this.raw = raw; this.rawLabel = label;

      // a click in progress keeps the pointer pose until the finger comes back up (or the fold is held too long)
      const tapping = this.pose === 'point' && !label && this.trackTap(f, t, ev, raw);

      // hysteresis: a new pose must persist for poseFrames frames
      if (tapping) { this.cand = this.pose; this.candN = 0; }
      else if (raw === this.pose && label === this.label) { this.cand = raw; this.candN = 0; }
      else {
        if (raw !== this.cand || label !== this.candLabel) { this.cand = raw; this.candLabel = label; this.candN = 0; this.candT = t; }
        if (++this.candN >= C.poseFrames) this.setPose(raw, t, ev, label);
      }

      const steady = this.raw === this.pose && !tapping;   // this frame clearly shows the committed pose
      switch (this.pose) {
        case 'point': {
          if (!tapping) {
            const s = this.toScreen(f.tip);
            this.pointer.x = this.fx.filter(s.x, t); this.pointer.y = this.fy.filter(s.y, t);
            if (steady) {                                    // skip frames where the hand is changing shape
              this.trail.push({ t, x: this.pointer.x, y: this.pointer.y });
              while (this.trail.length && t - this.trail[0].t > 600) this.trail.shift();
            }
          }
          this.pointer.visible = true;
          ev.push({ type: 'pointer', x: this.pointer.x, y: this.pointer.y });
          break;
        }
        case 'flat': this.doPan(f, t, ev, steady); break;
        case 'vee': this.doZoom(f, t, ev, steady); break;
        default: {
          const type = holdEvent(this.pose);
          if (type && !this.fired && t - this.poseT >= C.holdMs) {
            this.fired = true;
            const key = type === 'command' ? this.pose : type;
            if (t - (this.lastFire[key] ?? -1e9) >= C.actionCooldownMs) {
              this.lastFire[key] = t;
              if (type === 'command') ev.push({ type, name: this.pose.slice(4), label: this.label, x: this.pointer.x, y: this.pointer.y });
              else if (type === 'click') ev.push({ type, x: this.pointer.x, y: this.pointer.y });
              else ev.push({ type });
            }
          }
        }
      }
    }

    /** Finger-fold click. Returns true while a fold is in progress. */
    trackTap(f, t, ev, raw) {
      const C = this.C, I = f.ext[0];
      const othersUp = f.ext[1] > C.extOn || f.ext[2] > C.extOn || f.ext[3] > C.extOn;
      if (I > C.tapUp) this.tapArmed = true;
      if (!this.tap) {
        if (!this.tapArmed || I >= C.extOn || othersUp) return false;
        this.tapArmed = false;
        this.tap = { t0: t, min: I };
        this.rewindPointer(t);                 // freeze where the finger was pointing just before it moved
      }
      const T = this.tap;
      T.min = Math.min(T.min, I);
      T.thumbN = raw === 'thumbsup' ? (T.thumbN || 0) + 1 : 0;
      if (othersUp || T.thumbN >= C.tapThumbFrames) { this.tap = null; return false; }   // turning into another pose
      const dur = t - T.t0;
      if (I > C.tapUp) {                                         // finger is back up
        this.tap = null;
        if (T.min < C.tapDepth && dur >= C.tapMinMs && dur <= C.tapMaxMs && t - (this.lastFire.click ?? -1e9) >= C.clickCooldownMs) {
          this.lastFire.click = t;
          ev.push({ type: 'click', x: this.pointer.x, y: this.pointer.y, via: 'tap' });
        }
        return true;
      }
      if (dur > C.tapMaxMs) { this.tap = null; return false; }  // held: let it become a fist
      return true;
    }

    doPan(f, t, ev, steady) {
      const C = this.C, P = this.pan;
      this.marker = this.toScreen(f.tips);
      if (!steady || t - this.poseT < C.panSettleMs) { P.last = null; return; }
      const s = this.toScreenFree(f.tips);
      if (!P.last) {
        this.px.reset(); this.py.reset(); P.last = { x: this.px.filter(s.x, t), y: this.py.filter(s.y, t) };
        if (!P.anchor) P.anchor = { ...P.last };
        return;
      }
      const x = this.px.filter(s.x, t), y = this.py.filter(s.y, t);
      const step = Math.hypot(x - P.last.x, y - P.last.y);
      // a still hand never moves the map: movement starts only once the hand leaves a small dead zone,
      // and stops again after the hand has been still for a moment
      if (!P.moving) {
        if (Math.hypot(x - P.anchor.x, y - P.anchor.y) < C.panStart) { P.last = { x, y }; return; }
        P.moving = true; P.stillT = t;
      } else if (step > C.panStill) P.stillT = t;
      else if (t - P.stillT > C.panStillMs) { P.moving = false; P.anchor = { x, y }; P.last = { x, y }; P.ax = P.ay = 0; return; }
      P.ax += (x - P.last.x) * C.panGain; P.ay += (y - P.last.y) * C.panGain; P.last = { x, y };
      if (Math.hypot(P.ax, P.ay) > C.panDeadband) { ev.push({ type: 'pan', dx: P.ax, dy: P.ay }); P.ax = 0; P.ay = 0; }
    }

    doZoom(f, t, ev, steady) {
      const C = this.C;
      if (!this.zm) this.zm = { anchor: this.toScreen(f.vee), base: null, last: null, on: false, acc: 0 };
      const Z = this.zm;
      this.marker = Z.anchor;
      if (!steady || t - this.poseT < C.zoomSettleMs) { Z.last = null; return; }
      const sy = this.toScreenFree(f.vee).y;
      if (Z.last === null) { this.zy.reset(); Z.last = this.zy.filter(sy, t); if (Z.base === null) Z.base = Z.last; return; }
      const y = this.zy.filter(sy, t);
      if (!Z.on) {
        Z.last = y;
        if (Math.abs(y - Z.base) > C.zoomLatch * this.h) { Z.on = true; Z.acc = 0; }
        return;
      }
      Z.acc += (Z.last - y) / this.h; Z.last = y;            // hand up (y smaller) = zoom in
      if (Math.abs(Z.acc) > C.zoomDeadband) {
        ev.push({ type: 'zoom', factor: Math.exp(C.zoomGain * Z.acc), x: Z.anchor.x, y: Z.anchor.y });
        Z.acc = 0;
      }
    }

    twoHands(hands, t, ev) {
      const C = this.C, T = this.two;
      if (this.pose !== 'none') this.setPose('none', t, ev);
      this.cand = 'none'; this.candN = 0; this.raw = 'two'; this.rawLabel = null; this.f = null; this.tap = null;
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

  return { DEFAULTS, features, classify, spreadOf, holdEvent, Engine, OneEuro };
});
