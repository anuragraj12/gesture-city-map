// Run with:  node --test test/
// Drives the real gesture engine with synthetic hands at 30 fps and checks the commands it emits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, classify, features } = require('../src/gestures.js');
const Synth = require('../src/synth.js');

const FPS = 30, DT = 1000 / FPS;
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** Run a list of [durationMs, frameFn(progress 0..1, rand) -> hands[]] segments through a fresh engine. */
function run(segments, seed = 7) {
  const E = new Engine(); E.setScreen(1280, 720);
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

test('every pose is recognised from a clean synthetic hand', () => {
  for (const pose of ['open', 'point', 'thumbsup', 'fist']) assert.equal(classify(features(Synth.hand({ pose }))), pose);
  for (const spread of [0, 1]) assert.equal(classify(features(Synth.hand({ pose: 'pinch', spread }))), 'pinch');
});

test('poses survive tilt, distance and sensor noise (single frames)', () => {
  const rand = rng(11);
  for (const pose of ['open', 'point', 'thumbsup', 'fist']) {
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

test('fast open-palm moves swipe in four directions; the return stroke is ignored', () => {
  for (const [dir, dx, dy] of [['right', 0.3, 0], ['left', -0.3, 0], ['down', 0, 0.25], ['up', 0, -0.25]]) {
    const { events } = run([
      [400, (p, r) => H({ pose: 'open', x: 0.5, y: 0.7 }, r)],
      [250, (p, r) => H({ pose: 'open', x: 0.5 + dx * p, y: 0.7 + dy * p }, r)],
      [150, (p, r) => H({ pose: 'open', x: 0.5 + dx, y: 0.7 + dy }, r)],
      [450, (p, r) => H({ pose: 'open', x: 0.5 + dx * (1 - p), y: 0.7 + dy * (1 - p) }, r)],  // hand comes back
      [400, (p, r) => H({ pose: 'open', x: 0.5, y: 0.7 }, r)],
    ]);
    const sw = of(events, 'swipe');
    assert.equal(sw.length, 1, `${dir}: got ${sw.map(s => s.dir)}`);
    assert.equal(sw[0].dir, dir);
  }
});

test('slow palm drift does not swipe', () => {
  const { events } = run([[2500, (p, r) => H({ pose: 'open', x: 0.3 + 0.4 * p, y: 0.7 }, r)]]);
  assert.equal(of(events, 'swipe').length, 0);
});

test('index finger moves the pointer; thumbs up clicks where it pointed', () => {
  const { events } = run([
    [300, (p, r) => H({ pose: 'point', x: 0.4, y: 0.75 }, r)],
    [700, (p, r) => H({ pose: 'point', x: 0.4 + 0.2 * p, y: 0.75 - 0.1 * p }, r)],
    [500, (p, r) => H({ pose: 'point', x: 0.6, y: 0.65 }, r)],
    [100, (p, r) => H({ pose: 'relaxed', x: 0.6, y: 0.66 }, r)],       // hand changing shape
    [700, (p, r) => H({ pose: 'thumbsup', x: 0.6, y: 0.7 }, r)],
  ]);
  const ptr = of(events, 'pointer'), clicks = of(events, 'click');
  assert.ok(ptr.length > 30);
  assert.equal(clicks.length, 1);
  const settled = ptr.filter(e => e.t > 1100 && e.t < 1450);
  const ax = settled.reduce((s, e) => s + e.x, 0) / settled.length, ay = settled.reduce((s, e) => s + e.y, 0) / settled.length;
  assert.ok(Math.hypot(clicks[0].x - ax, clicks[0].y - ay) < 25, `click drifted ${Math.hypot(clicks[0].x - ax, clicks[0].y - ay).toFixed(1)}px`);
});

test('changing shape from pointer to thumbs up neither zooms nor moves the click', () => {
  const { events } = run([
    [800, (p, r) => H({ pose: 'point', x: 0.5, y: 0.7 }, r)],
    [120, (p, r) => H({ pose: 'pinch', spread: 0.6 - 0.5 * p, x: 0.5, y: 0.72 }, r)],   // fingers curling on the way
    [700, (p, r) => H({ pose: 'thumbsup', x: 0.5, y: 0.74 }, r)],
  ]);
  assert.equal(of(events, 'zoom').length, 0);
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

test('pinch out zooms in, pinch in zooms out', () => {
  const zoomOf = ev => of(ev, 'zoom').reduce((z, e) => z * e.factor, 1);
  const out = run([[400, (p, r) => H({ pose: 'pinch', spread: 0.15 }, r)], [800, (p, r) => H({ pose: 'pinch', spread: 0.15 + 0.8 * p }, r)]]);
  const inn = run([[400, (p, r) => H({ pose: 'pinch', spread: 0.95 }, r)], [800, (p, r) => H({ pose: 'pinch', spread: 0.95 - 0.8 * p }, r)]]);
  assert.ok(zoomOf(out.events) > 2, `zoom in ${zoomOf(out.events).toFixed(2)}`);
  assert.ok(zoomOf(inn.events) < 0.5, `zoom out ${zoomOf(inn.events).toFixed(2)}`);
});

test('holding a pinch still does not drift the zoom', () => {
  const { events } = run([[2500, (p, r) => [Synth.hand({ pose: 'pinch', spread: 0.6, noise: 0.002, rand: r })]]]);
  const z = of(events, 'zoom').reduce((a, e) => a * e.factor, 1);
  assert.ok(Math.abs(Math.log(z)) < 0.05, `drifted to ${z.toFixed(3)}`);
});

test('two hands rotate the map and block one-hand gestures', () => {
  const pair = (deg, r) => {
    const a = deg * Math.PI / 180, R = 0.22;
    return [Synth.hand({ pose: 'fist', x: 0.5 - R * Math.cos(a), y: 0.65 - R * Math.sin(a) * 16 / 9 / (16 / 9), noise: 0.0015, rand: r }),
            Synth.hand({ pose: 'fist', x: 0.5 + R * Math.cos(a), y: 0.65 + R * Math.sin(a) * 16 / 9 / (16 / 9), noise: 0.0015, rand: r })];
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

test('no hands, no commands', () => {
  const { events } = run([[1000, () => []]]);
  assert.equal(events.filter(e => e.type !== 'pose').length, 0);
});
