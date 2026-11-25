/*  Gesture trainer for Gesture City Map
    ------------------------------------------------------------------
    Teach the map your own hand shapes: record a few seconds of a pose,
    pick what it should do, and it's live. No DOM code, so it runs in the
    browser and in Node (see test/trainer.test.js).

    How it recognises a pose
      1. Normalise: move the wrist to the origin, scale by palm size, and
         mirror left hands, so near/far and left/right hands look the same.
      2. Describe: the 21 points, plus how straight each finger is, where
         the thumb is, the gaps between fingertips and how spread the fingers
         are. The extra measurements are what keep look-alike poses apart.
      3. Compare: k-nearest neighbours against your recorded samples. A
         prediction only counts when most neighbours agree AND the closest
         one is about as close as your own samples are to each other.
         Anything else falls back to the built-in gestures.

    Model JSON (what Export writes and Import reads):
      { v: 1, enabled, gestures: [{ id, name, action }], samples: [{ g, p: [63 numbers] }] }
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GestureTrainer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** What a trained gesture can do. `pose` is what the gesture engine sees. */
  const ACTIONS = [
    { id: 'pan', pose: 'flat', name: 'Pan', hint: 'move your hand to drag the map' },
    { id: 'zoom', pose: 'vee', name: 'Zoom', hint: 'move your hand up to zoom in, down to zoom out' },
    { id: 'pointer', pose: 'point', name: 'Pointer', hint: 'follows your index fingertip' },
    { id: 'click', pose: 'thumbsup', name: 'Click', hint: 'hold to click under the pointer' },
    { id: 'close', pose: 'fist', name: 'Close', hint: 'hold to close the open place' },
    { id: 'home', pose: 'cmd:home', name: 'Reset view', hint: 'hold' },
    { id: 'zoomin', pose: 'cmd:zoomin', name: 'Zoom in a step', hint: 'hold' },
    { id: 'zoomout', pose: 'cmd:zoomout', name: 'Zoom out a step', hint: 'hold' },
    { id: 'rotl', pose: 'cmd:rotl', name: 'Rotate left', hint: 'hold' },
    { id: 'rotr', pose: 'cmd:rotr', name: 'Rotate right', hint: 'hold' },
    { id: 'explore', pose: 'cmd:explore', name: 'Open Explore', hint: 'hold' },
    { id: 'locate', pose: 'cmd:locate', name: 'Show my location', hint: 'hold' },
    { id: 'help', pose: 'cmd:help', name: 'Show help', hint: 'hold' },
    { id: 'rest', pose: 'open', name: 'Rest', hint: 'does nothing, like an open palm' },
    { id: 'ignore', pose: 'none', name: 'Ignore', hint: 'not a gesture: teach it what to leave alone' },
  ];
  const ACTION = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  const DEFAULTS = {
    k: 5,
    minSamples: 8,        // a gesture needs this many samples before it is used
    maxSamples: 240,      // per gesture; older samples are dropped first
    agree: 0.6,           // share of the k neighbours that must agree
    reach: 2.2,           // accept up to this many times the usual distance between your own samples...
    minReach: 0.35,       // ...but never tighter than this
  };

  const TIP = [8, 12, 16, 20], KNUCKLE = [5, 9, 13, 17];
  const W_EXT = 2.0, W_THUMB = 1.5, W_GAP = 1.2, W_SPREAD = 1.0;

  /** Wrist at the origin, palm size 1, left hands mirrored. Returns a flat array of 63 numbers. */
  function canon(hand) {
    const P = hand.world || hand.lm;
    const o = P[0], s = Math.hypot(P[9].x - o.x, P[9].y - o.y, (P[9].z || 0) - (o.z || 0)) || 1e-6;
    const flip = hand.handed === 'Left' ? -1 : 1;
    const out = new Array(63);
    for (let i = 0; i < 21; i++) {
      out[3 * i] = flip * (P[i].x - o.x) / s; out[3 * i + 1] = (P[i].y - o.y) / s; out[3 * i + 2] = ((P[i].z || 0) - (o.z || 0)) / s;
    }
    return out;
  }

  /** Feature vector from canonical points. */
  function vec(p) {
    const pt = i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const v = p.slice();
    const w = pt(0);
    for (let i = 0; i < 4; i++) v.push(W_EXT * d(w, pt(TIP[i])) / (d(w, pt(KNUCKLE[i])) || 1e-6));
    v.push(W_THUMB * d(pt(4), pt(5)), W_THUMB * d(pt(4), pt(8)), W_THUMB * d(pt(4), pt(12)), W_THUMB * d(pt(4), pt(17)));
    const tips = [4, ...TIP];
    for (let i = 0; i < tips.length; i++) for (let j = i + 1; j < tips.length; j++) v.push(W_GAP * d(pt(tips[i]), pt(tips[j])));
    // spread: angles between neighbouring fingers (radians)
    const dir = i => { const a = pt(KNUCKLE[i]), b = pt(TIP[i]), x = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(...x) || 1e-9; return x.map(c => c / n); };
    for (let i = 0; i < 3; i++) { const a = dir(i), b = dir(i + 1); v.push(W_SPREAD * Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))); }
    return Float32Array.from(v);
  }

  function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; s += x * x; } return Math.sqrt(s); }
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const uid = () => Math.random().toString(36).slice(2, 9);

  class Model {
    constructor(json, opts = {}) {
      this.C = { ...DEFAULTS, ...opts };
      this.gestures = []; this.samples = []; this.enabled = true; this.dirty = true;
      if (json) this.load(json);
    }

    /* ----- gestures ----- */
    addGesture(name, action = 'click') {
      const g = { id: uid(), name: String(name || 'Gesture').slice(0, 40), action: ACTION[action] ? action : 'click' };
      this.gestures.push(g); return g;
    }
    gesture(id) { return this.gestures.find(g => g.id === id) || null; }
    update(id, patch) {
      const g = this.gesture(id); if (!g) return null;
      if (patch.name != null) g.name = String(patch.name).slice(0, 40);
      if (patch.action && ACTION[patch.action]) g.action = patch.action;
      return g;
    }
    removeGesture(id) { this.gestures = this.gestures.filter(g => g.id !== id); this.clearSamples(id); }
    clearSamples(id) { this.samples = this.samples.filter(s => s.g !== id); this.dirty = true; }
    clearAll() { this.gestures = []; this.samples = []; this.dirty = true; }
    count(id) { let n = 0; for (const s of this.samples) if (s.g === id) n++; return n; }
    ready(id) { return this.count(id) >= this.C.minSamples; }

    /* ----- samples ----- */
    addSample(id, hand) {
      if (!this.gesture(id)) return false;
      const p = canon(hand);
      if (p.some(x => !Number.isFinite(x))) return false;
      this.samples.push({ g: id, p, v: vec(p) });
      if (this.count(id) > this.C.maxSamples) this.samples.splice(this.samples.findIndex(s => s.g === id), 1);
      this.dirty = true; return true;
    }

    /** Work out, per gesture, how far apart its own samples usually are. */
    prepare() {
      if (!this.dirty) return;
      const live = new Set(this.gestures.filter(g => this.ready(g.id)).map(g => g.id));
      this.pool = this.samples.filter(s => live.has(s.g));
      this.reach = {};
      for (const id of live) {
        const own = this.pool.filter(s => s.g === id), nn = [];
        for (const a of own) { let best = Infinity; for (const b of own) if (a !== b) best = Math.min(best, dist(a.v, b.v)); nn.push(best); }
        this.reach[id] = Math.max(this.C.minReach, this.C.reach * median(nn));
      }
      this.dirty = false;
    }

    /** Nearest-neighbour vote. `skip` leaves one sample out (used by evaluate). */
    vote(v, skip) {
      const k = this.C.k, near = [];
      for (const s of this.pool) {
        if (s === skip) continue;
        const d = dist(v, s.v);
        if (near.length < k || d < near[near.length - 1].d) {
          near.push({ g: s.g, d }); near.sort((a, b) => a.d - b.d); if (near.length > k) near.pop();
        }
      }
      if (!near.length) return null;
      const votes = {};
      for (const n of near) votes[n.g] = (votes[n.g] || 0) + 1;
      const ranking = Object.entries(votes).map(([id, n]) => ({ id, share: n / near.length })).sort((a, b) => b.share - a.share);
      const top = ranking[0], d = near.find(n => n.g === top.id).d;
      return { id: top.id, share: top.share, dist: d, reach: this.reach[top.id], ranking };
    }

    /**
     * Classify one hand. Returns null when nothing is trained, otherwise
     * { gesture, action, share, dist, reach, accepted, ranking }.
     */
    predict(hand) {
      this.prepare();
      if (!this.pool || !this.pool.length) return null;
      const r = this.vote(vec(canon(hand)));
      if (!r) return null;
      const g = this.gesture(r.id);
      return { ...r, gesture: g, action: ACTION[g.action], accepted: r.share >= this.C.agree && r.dist <= r.reach };
    }

    /** For the gesture engine: { pose, label } for a confident match, else null. */
    classifier() {
      return hand => {
        if (!this.enabled) return null;
        const r = this.predict(hand);
        return r && r.accepted ? { pose: r.action.pose, label: r.gesture.name } : null;
      };
    }

    /**
     * Leave-one-out check: for each gesture, how often its own samples are recognised,
     * and which other gesture they get mistaken for. This is how you spot look-alikes.
     */
    evaluate() {
      this.prepare();
      const out = {};
      for (const g of this.gestures) out[g.id] = { n: this.count(g.id), ready: this.ready(g.id), correct: 0, rejected: 0, confused: {} };
      for (const s of this.pool || []) {
        const r = this.vote(s.v, s), o = out[s.g];
        if (!r || r.share < this.C.agree || r.dist > r.reach) o.rejected++;
        else if (r.id === s.g) o.correct++;
        else o.confused[r.id] = (o.confused[r.id] || 0) + 1;
      }
      for (const o of Object.values(out)) {
        o.accuracy = o.ready && o.n ? o.correct / o.n : null;
        const worst = Object.entries(o.confused).sort((a, b) => b[1] - a[1])[0];
        o.lookalike = worst ? { id: worst[0], name: this.gesture(worst[0])?.name, share: worst[1] / o.n } : null;
      }
      return out;
    }

    /* ----- save / load ----- */
    toJSON() {
      const r = x => Math.round(x * 1e4) / 1e4;
      return { v: 1, enabled: this.enabled, gestures: this.gestures.map(g => ({ ...g })), samples: this.samples.map(s => ({ g: s.g, p: s.p.map(r) })) };
    }
    load(json) {
      const o = typeof json === 'string' ? JSON.parse(json) : json;
      if (!o || o.v !== 1 || !Array.isArray(o.gestures) || !Array.isArray(o.samples)) throw new Error('Not a gesture file');
      this.gestures = o.gestures.filter(g => g && g.id && g.name).map(g => ({ id: String(g.id), name: String(g.name).slice(0, 40), action: ACTION[g.action] ? g.action : 'ignore' }));
      const ids = new Set(this.gestures.map(g => g.id));
      this.samples = o.samples.filter(s => s && ids.has(s.g) && Array.isArray(s.p) && s.p.length === 63 && s.p.every(Number.isFinite)).map(s => ({ g: s.g, p: s.p, v: vec(s.p) }));
      this.enabled = o.enabled !== false; this.dirty = true;
      return this;
    }
  }

  return { ACTIONS, ACTION, DEFAULTS, Model, canon, vec };
});
