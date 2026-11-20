/*  Synthetic hands
    ------------------------------------------------------------------
    Builds MediaPipe-shaped landmarks (21 image points + 21 world points)
    for a pose, without a camera. Used by the automated tests and by the
    "Watch demo" mode, which drives the real gesture engine with it.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SynthHand = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const rad = d => d * Math.PI / 180;

  // Mirrored (selfie) view, metres, x right, y down, palm facing the camera.
  const BASE = {
    index: { mcp: [-0.025, -0.085], seg: [0.040, 0.025, 0.022], fan: -8 },
    middle: { mcp: [0.000, -0.090], seg: [0.045, 0.028, 0.024], fan: 0 },
    ring: { mcp: [0.020, -0.085], seg: [0.042, 0.026, 0.022], fan: 7 },
    pinky: { mcp: [0.038, -0.075], seg: [0.032, 0.020, 0.020], fan: 15 },
  };
  const ORDER = ['index', 'middle', 'ring', 'pinky'];

  function finger(name, curl) {
    const b = BASE[name], a = rad(b.fan);
    const pts = [[b.mcp[0], b.mcp[1], 0]];
    let th = 0; const bends = [90, 100, 70].map(x => rad(x * curl));
    for (let i = 0; i < 3; i++) {
      th += bends[i];
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.sin(a) * Math.cos(th) * b.seg[i], p[1] - Math.cos(a) * Math.cos(th) * b.seg[i], p[2] - Math.sin(th) * b.seg[i]]);
    }
    return pts;
  }

  function thumbChain(tipTarget) {
    const cmc = [-0.030, -0.025, 0], mcp = [-0.050, -0.045, -0.005];
    const ip = [(mcp[0] * 0.45 + tipTarget[0] * 0.55), (mcp[1] * 0.45 + tipTarget[1] * 0.55), (mcp[2] * 0.45 + tipTarget[2] * 0.55)];
    return [cmc, mcp, ip, tipTarget];
  }

  const POSES = {
    open: { curls: [0, 0, 0, 0], thumb: 'side' },
    point: { curls: [0, 1, 1, 1], thumb: 'tucked' },
    pinch: { curls: [0.3, 1, 1, 1], thumb: 'pinch' },
    thumbsup: { curls: [1, 1, 1, 1], thumb: 'up' },
    fist: { curls: [1, 1, 1, 1], thumb: 'wrapped' },
    relaxed: { curls: [0.45, 0.5, 0.55, 0.6], thumb: 'side' },
  };

  /**
   * opts: pose, spread (0 = pinched shut … 1 = wide, pinch only), x/y (wrist position in the mirrored
   * camera frame, 0..1), size (frame fraction per metre), roll/yaw/pitch (degrees), noise (metres), rand
   */
  function hand(opts = {}) {
    const o = { pose: 'open', spread: 0.5, x: 0.5, y: 0.75, size: 1.7, roll: 0, yaw: 0, pitch: 0, noise: 0, rand: Math.random, ...opts };
    const P = POSES[o.pose] || POSES.open;
    const curls = o.curls || P.curls;
    const F = ORDER.map((n, i) => finger(n, curls[i]));
    let tip;
    if (P.thumb === 'side') tip = [-0.095, -0.075, -0.01];
    else if (P.thumb === 'tucked') tip = [0.002, -0.050, -0.032];
    else if (P.thumb === 'up') tip = [-0.058, -0.112, -0.012];
    else if (P.thumb === 'wrapped') tip = [-0.004, -0.062, -0.050];
    else {   // pinch: from touching the index tip out to an L shape
      const it = F[0][3], s = Math.max(0, Math.min(1, o.spread));
      const shut = [it[0] - 0.006, it[1] + 0.008, it[2] + 0.004], wide = [-0.115, -0.075, -0.012];
      tip = shut.map((v, i) => v + (wide[i] - v) * s);
    }
    const T = thumbChain(tip);
    const pts = [[0, 0, 0], ...T, ...F[0], ...F[1], ...F[2], ...F[3]];

    // rotate the whole hand: pitch (x), yaw (y), roll (z)
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(o.pitch)), Math.sin(rad(o.pitch)), Math.cos(rad(o.yaw)), Math.sin(rad(o.yaw)), Math.cos(rad(o.roll)), Math.sin(rad(o.roll))];
    const gauss = () => { let u = 0, v = 0; while (!u) u = o.rand(); v = o.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const world = [], lm = [];
    for (const p of pts) {
      let [x, y, z] = p;
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      if (o.noise) { x += gauss() * o.noise; y += gauss() * o.noise; z += gauss() * o.noise; }
      world.push({ x, y, z });
      lm.push({ x: 1 - (o.x + x * o.size), y: o.y + y * o.size, z: z * o.size });   // back to raw (unmirrored) camera coords
    }
    return { lm, world };
  }

  return { hand, POSES: Object.keys(POSES) };
});
