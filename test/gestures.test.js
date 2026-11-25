// Run with:  npm test
// Drives the real gesture engine with synthetic hands at 30 fps and checks the commands it emits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, classify, features } = require('../src/gestures.js');
const Synth = require('../src/synth.js');

const FPS = 30, DT = 1000 / FPS;
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** Run a list of [durationMs, frameFn(progress 0..1, rand) -> hands[]] segments through a fresh engine. */
function run(segments, seed = 7, setup) {
  const E = new Engine(); E.setScreen(1280, 720);
  if (setup) setup(E);
  const rand = rng(seed), out = [];
  let t = 0;
  for (const [ms, fn] of segments) {
    const n = Math.max(1, Math.round(ms / DT));
    for (let i = 0; i < n; i++) {
      const r = E.update(fn(i / (n - 1 || 1), rand), t);
      for (const e of r.events) out.push({ ...e, t });
      t += DT;
    }
  }
  return { events: out, engine: E };
}
const of = (ev, type) => ev.filter(e => e.type === type);
const H = (o, rand) => [Synth.hand({ noise: 0.0015, rand, ...o })];
const POSES = ['open', 'flat', 'vee', 'point', 'thumbsup', 'fist'];
const panOf = ev => of(ev, 'pan').reduce((s, e) => ({ x: s.x + e.dx, y: s.y + e.dy }), { x: 0, y: 0 });
const zoomOf = ev => of(ev, 'zoom').reduce((z, e) => z * e.factor, 1);
/** index finger folding: 0 = pointing, 1 = folded */
const tapHand = (c, o, r) => H({ pose: 'point', curls: [c, 1, 1, 1], ...o }, r);

test('every pose is recognised from a clean synthetic hand', () => {
  for (const pose of POSES) assert.equal(classify(features(Synth.hand({ pose }))), pose);
});

test('poses survive tilt, distance and sensor noise (single frames)', () => {
  const rand = rng(11);
  for (const pose of POSES) {
    let ok = 0; const N = 400;
    for (let k = 0; k < N; k++) {
      const h = Synth.hand({ pose, roll: rand() * 40 - 20, yaw: rand() * 60 - 30, pitch: rand() * 30 - 15, size: 1.2 + rand() * 1.2, noise: 0.002, rand });
      if (classify(features(h)) === pose) ok++;
    }
    assert.ok(ok / N > 0.93, `${pose}: ${(100 * ok / N).toFixed(1)}%`);
  }
});

test('a fist never reads as a thumbs up (no accidental clicks)', () => {
  const rand = rng(5); let bad = 0;
  for (let k = 0; k < 1000; k++) {
    const h = Synth.hand({ pose: 'fist', roll: rand() * 60 - 30, yaw: rand() * 90 - 45, pitch: rand() * 40 - 20, noise: 0.003, rand });
    if (classify(features(h)) === 'thumbsup') bad++;
  }
  assert.equal(bad, 0);
});

test('spread fingers are a resting palm, fingers together are the pan pose', () => {
  assert.equal(classify(features(Synth.hand({ pose: 'open', together: 0 }))), 'open');
  assert.equal(classify(features(Synth.hand({ pose: 'open', together: 0.6 }))), 'flat');
});

test('four fingers together drag the map in every direction', () => {
  for (const [dir, dx, dy] of [['right', 0.25, 0], ['left', -0.25, 0], ['down', 0, 0.2], ['up', 0, -0.2]]) {
    const { events } = run([
      [400, (p, r) => H({ pose: 'flat', x: 0.5, y: 0.7 }, r)],
      [600, (p, r) => H({ pose: 'flat', x: 0.5 + dx * p, y: 0.7 + dy * p }, r)],
      [300, (p, r) => H({ pose: 'flat', x: 0.5 + dx, y: 0.7 + dy }, r)],
    ]);
    const m = panOf(events), want = { x: dx / 0.64 * 1280 * 1.6, y: dy / 0.62 * 720 * 1.6 };
    const main = dx ? m.x / want.x : m.y / want.y, cross = dx ? Math.abs(m.y) : Math.abs(m.x);
    assert.ok(main > 0.75 && main < 1.15, `${dir}: moved ${(main * 100).toFixed(0)}% of the hand movement`);
    assert.ok(cross < 25, `${dir}: drifted ${cross.toFixed(0)}px sideways`);
  }
});

test('a moving open palm (fingers spread) does not pan', () => {
  const { events } = run([[1500, (p, r) => H({ pose: 'open', x: 0.3 + 0.4 * p, y: 0.7 }, r)]]);
  assert.equal(of(events, 'pan').length, 0);
});

test('a still four-finger hand barely moves the map', () => {
  const { events } = run([[2500, (p, r) => [Synth.hand({ pose: 'flat', x: 0.5, y: 0.7, noise: 0.0025, rand: r })]]]);
  const m = panOf(events);
  assert.ok(Math.hypot(m.x, m.y) < 12, `drifted ${Math.hypot(m.x, m.y).toFixed(1)}px`);
});

test('two fingers moved up zoom in, moved down zoom out', () => {
  const up = run([[400, (p, r) => H({ pose: 'vee', y: 0.8 }, r)], [800, (p, r) => H({ pose: 'vee', y: 0.8 - 0.3 * p }, r)], [200, (p, r) => H({ pose: 'vee', y: 0.5 }, r)]]);
  const down = run([[400, (p, r) => H({ pose: 'vee', y: 0.5 }, r)], [800, (p, r) => H({ pose: 'vee', y: 0.5 + 0.3 * p }, r)], [200, (p, r) => H({ pose: 'vee', y: 0.8 }, r)]]);
  assert.ok(zoomOf(up.events) > 2, `zoom in ${zoomOf(up.events).toFixed(2)}`);
  assert.ok(zoomOf(down.events) < 0.5, `zoom out ${zoomOf(down.events).toFixed(2)}`);
  assert.equal(of(up.events, 'pan').length, 0);
});

test('holding two fingers still does not drift the zoom', () => {
  const { events } = run([[2500, (p, r) => [Synth.hand({ pose: 'vee', noise: 0.002, rand: r })]]]);
  const z = zoomOf(events);
  assert.ok(Math.abs(Math.log(z)) < 0.05, `drifted to ${z.toFixed(3)}`);
});

test('index finger moves the pointer; a quick fold clicks where it pointed', () => {
  const { events } = run([
    [300, (p, r) => tapHand(0, { x: 0.4, y: 0.75 }, r)],
    [700, (p, r) => tapHand(0, { x: 0.4 + 0.2 * p, y: 0.75 - 0.1 * p }, r)],
    [500, (p, r) => tapHand(0, { x: 0.6, y: 0.65 }, r)],
    [250, (p, r) => tapHand(Math.sin(Math.PI * p) * 0.8, { x: 0.6, y: 0.65 + 0.02 * Math.sin(Math.PI * p) }, r)],   // fold and lift
    [500, (p, r) => tapHand(0, { x: 0.6, y: 0.65 }, r)],
  ]);
  const ptr = of(events, 'pointer'), clicks = of(events, 'click');
  assert.ok(ptr.length > 30);
  assert.equal(clicks.length, 1, `clicks: ${clicks.length}`);
  assert.equal(clicks[0].via, 'tap');
  assert.equal(of(events, 'close').length, 0);
  const settled = ptr.filter(e => e.t > 1100 && e.t < 1450);
  const ax = settled.reduce((s, e) => s + e.x, 0) / settled.length, ay = settled.reduce((s, e) => s + e.y, 0) / settled.length;
  assert.ok(Math.hypot(clicks[0].x - ax, clicks[0].y - ay) < 25, `click drifted ${Math.hypot(clicks[0].x - ax, clicks[0].y - ay).toFixed(1)}px`);
});

test('two quick folds click twice', () => {
  const fold = [220, (p, r) => tapHand(Math.sin(Math.PI * p) * 0.8, {}, r)], rest = [450, (p, r) => tapHand(0, {}, r)];
  const { events } = run([[500, (p, r) => tapHand(0, {}, r)], fold, rest, fold, rest]);
  assert.equal(of(events, 'click').length, 2);
});

test('a small finger wobble is not a click', () => {
  const { events } = run([[500, (p, r) => tapHand(0, {}, r)], [250, (p, r) => tapHand(Math.sin(Math.PI * p) * 0.35, {}, r)], [400, (p, r) => tapHand(0, {}, r)]]);
  assert.equal(of(events, 'click').length, 0);
});

test('folding the index and holding it is a fist (close), not a click', () => {
  const { events } = run([[500, (p, r) => tapHand(0, {}, r)], [150, (p, r) => tapHand(p, {}, r)], [1300, (p, r) => H({ pose: 'fist' }, r)]]);
  assert.equal(of(events, 'click').length, 0);
  assert.equal(of(events, 'close').length, 1);
});

test('switching from pointer to two fingers or four fingers never clicks', () => {
  const { events } = run([
    [500, (p, r) => tapHand(0, {}, r)], [600, (p, r) => H({ pose: 'vee' }, r)],
    [400, (p, r) => tapHand(0, {}, r)], [600, (p, r) => H({ pose: 'flat' }, r)], [400, (p, r) => tapHand(0, {}, r)],
  ]);
  assert.equal(of(events, 'click').length, 0);
});

test('thumbs up still clicks where you pointed', () => {
  const { events } = run([
    [800, (p, r) => H({ pose: 'point', x: 0.5, y: 0.7 }, r)],
    [100, (p, r) => H({ pose: 'relaxed', x: 0.5, y: 0.71 }, r)],
    [700, (p, r) => H({ pose: 'thumbsup', x: 0.5, y: 0.74 }, r)],
  ]);
  const clicks = of(events, 'click'), ptr = of(events, 'pointer').filter(e => e.t > 400 && e.t < 780);
  assert.equal(clicks.length, 1);
  assert.ok(Math.hypot(clicks[0].x - ptr.at(-1).x, clicks[0].y - ptr.at(-1).y) < 20);
});

test('a still pointing hand gives a steady pointer despite sensor noise', () => {
  const { events } = run([[2000, (p, r) => [Synth.hand({ pose: 'point', x: 0.5, y: 0.7, noise: 0.0025, rand: r })]]]);
  const ptr = of(events, 'pointer').filter(e => e.t > 500);
  const mx = ptr.reduce((s, e) => s + e.x, 0) / ptr.length;
  const sd = Math.sqrt(ptr.reduce((s, e) => s + (e.x - mx) ** 2, 0) / ptr.length);
  assert.ok(sd < 6, `pointer jitter ${sd.toFixed(1)}px`);
  assert.equal(of(events, 'click').length, 0);
});

test('fist closes once per gesture, even when held', () => {
  const { events } = run([
    [300, (p, r) => H({ pose: 'open' }, r)],
    [1500, (p, r) => H({ pose: 'fist' }, r)],
    [400, (p, r) => H({ pose: 'open' }, r)],
    [800, (p, r) => H({ pose: 'fist' }, r)],
  ]);
  assert.equal(of(events, 'close').length, 2);
  assert.equal(of(events, 'click').length, 0);
});

test('two hands rotate the map and block one-hand gestures', () => {
  const pair = (deg, r) => {
    const a = deg * Math.PI / 180, R = 0.22;
    return [Synth.hand({ pose: 'fist', x: 0.5 - R * Math.cos(a), y: 0.65 - R * Math.sin(a), noise: 0.0015, rand: r }),
            Synth.hand({ pose: 'fist', x: 0.5 + R * Math.cos(a), y: 0.65 + R * Math.sin(a), noise: 0.0015, rand: r })];
  };
  const { events } = run([[300, (p, r) => pair(0, r)], [1000, (p, r) => pair(35 * p, r)], [300, (p, r) => pair(35, r)]]);
  const total = of(events, 'rotate').reduce((s, e) => s + e.delta, 0);
  assert.ok(total > 0.3, `rotated ${(total * 180 / Math.PI).toFixed(1)}°`);
  assert.equal(of(events, 'close').length, 0, 'two fists must not close');
});

test('dropping one hand after rotating does not fire a stray close', () => {
  const pair = r => [Synth.hand({ pose: 'fist', x: 0.3, rand: r }), Synth.hand({ pose: 'fist', x: 0.7, rand: r })];
  const { events } = run([[600, (p, r) => pair(r)], [500, (p, r) => H({ pose: 'fist', x: 0.3 }, r)]]);
  assert.equal(of(events, 'close').length, 0);
});

test('a custom classifier can add a hold-to-fire command', () => {
  const custom = (hand, f) => (f.ext[0] > 1.55 && f.ext[3] > 1.55 && f.ext[1] < 1.35 ? { pose: 'cmd:home', label: 'Rock' } : null);
  const { events } = run([[400, (p, r) => H({ pose: 'open' }, r)], [800, (p, r) => H({ pose: 'rock' }, r)]], 7, E => E.setClassifier(custom));
  const cmds = of(events, 'command');
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].name, 'home');
  assert.equal(cmds[0].label, 'Rock');
});

test('no hands, no commands', () => {
  const { events } = run([[1000, () => []]]);
  assert.equal(events.filter(e => e.type !== 'pose').length, 0);
});

test('folding clicks reliably at different hand angles and distances', () => {
  const rand = rng(3); let ok = 0; const N = 40;
  for (let k = 0; k < N; k++) {
    const o = { roll: rand() * 30 - 15, yaw: rand() * 50 - 25, pitch: rand() * 24 - 12, size: 1.3 + rand() * 0.9, noise: 0.002 };
    const depth = 0.65 + rand() * 0.35, ms = 180 + rand() * 180;
    const { events } = run([[500, (p, r) => tapHand(0, o, r)], [ms, (p, r) => tapHand(Math.sin(Math.PI * p) * depth, o, r)], [400, (p, r) => tapHand(0, o, r)]], 100 + k);
    if (of(events, 'click').length === 1) ok++;
  }
  assert.ok(ok / N >= 0.9, `${ok}/${N} clicks`);
});
