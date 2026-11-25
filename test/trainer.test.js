// Run with:  npm test
// Trains the gesture trainer on synthetic hands and checks what it recognises, rejects and reports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Model, ACTIONS } = require('../src/trainer.js');
const { Engine } = require('../src/gestures.js');
const Synth = require('../src/synth.js');

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const THREE = { pose: 'open', curls: [0, 0, 0, 1] };
function varied(rand) {
  return o => Synth.hand({ roll: rand() * 30 - 15, yaw: rand() * 40 - 20, pitch: rand() * 20 - 10, size: 1.3 + rand() * 0.8, noise: 0.002, rand, ...o });
}
function trained(seed = 9) {
  const h = varied(rng(seed)), m = new Model();
  const rock = m.addGesture('Rock', 'home'), call = m.addGesture('Call', 'explore'), three = m.addGesture('Three', 'zoomin');
  for (let i = 0; i < 40; i++) { m.addSample(rock.id, h({ pose: 'rock' })); m.addSample(call.id, h({ pose: 'call' })); m.addSample(three.id, h(THREE)); }
  return { m, rock, call, three };
}
function rate(m, make, name, n = 150) {
  let hit = 0;
  for (let i = 0; i < n; i++) { const r = m.predict(make()); if ((r && r.accepted ? r.gesture.name : null) === name) hit++; }
  return hit / n;
}

test('every action maps to a pose the engine understands', () => {
  const known = new Set(['flat', 'vee', 'point', 'thumbsup', 'fist', 'open', 'none']);
  for (const a of ACTIONS) assert.ok(known.has(a.pose) || a.pose.startsWith('cmd:'), a.id);
});

test('trained poses are recognised from new, differently tilted samples', () => {
  const { m } = trained(), h = varied(rng(21));
  assert.ok(rate(m, () => h({ pose: 'rock' }), 'Rock') > 0.95);
  assert.ok(rate(m, () => h({ pose: 'call' }), 'Call') > 0.95);
  assert.ok(rate(m, () => h(THREE), 'Three') > 0.95);
});

test('poses that were never trained fall back to the built-in gestures', () => {
  const { m } = trained(), h = varied(rng(33));
  for (const pose of ['open', 'flat', 'vee', 'point', 'fist', 'thumbsup', 'relaxed']) assert.equal(rate(m, () => h({ pose }), null), 1, pose);
});

test('a gesture needs a minimum number of samples before it is used', () => {
  const m = new Model(), g = m.addGesture('Rock', 'home'), h = varied(rng(4));
  for (let i = 0; i < 5; i++) m.addSample(g.id, h({ pose: 'rock' }));
  assert.equal(m.predict(h({ pose: 'rock' })), null);
  for (let i = 0; i < 5; i++) m.addSample(g.id, h({ pose: 'rock' }));
  assert.ok(m.predict(h({ pose: 'rock' })).accepted);
});

test('left hands match gestures trained with the right hand', () => {
  const { m } = trained(), h = varied(rng(8));
  const mirrored = () => {
    const x = h({ pose: 'rock' });
    return { lm: x.lm.map(p => ({ x: 1 - p.x, y: p.y, z: p.z })), world: x.world.map(p => ({ x: -p.x, y: p.y, z: p.z })), handed: 'Left' };
  };
  assert.ok(rate(m, mirrored, 'Rock') > 0.95);
});

test('the look-alike check reports which gesture gets mixed up', () => {
  const m = new Model(), h = varied(rng(12));
  const a = m.addGesture('Rock', 'home'), b = m.addGesture('Same rock', 'explore');
  for (let i = 0; i < 30; i++) { m.addSample(a.id, h({ pose: 'rock' })); m.addSample(b.id, h({ pose: 'rock' })); }
  const ev = m.evaluate();
  assert.ok(ev[a.id].accuracy < 0.8, `accuracy ${ev[a.id].accuracy}`);
  assert.equal(ev[a.id].lookalike.name, 'Same rock');
  const { m: good, rock } = trained();
  assert.ok(good.evaluate()[rock.id].accuracy > 0.95);
});

test('"Ignore" samples stop a look-alike from firing', () => {
  const m = new Model(), h = varied(rng(14));
  const rock = m.addGesture('Rock', 'home'), no = m.addGesture('Not this', 'ignore');
  for (let i = 0; i < 40; i++) { m.addSample(rock.id, h({ pose: 'rock' })); m.addSample(no.id, h({ pose: 'rock', curls: [0, 1, 1, 0.5] })); }
  const cls = m.classifier(), r = cls(h({ pose: 'rock', curls: [0, 1, 1, 0.5] }));
  assert.equal(r && r.pose, 'none');
  assert.equal(cls(h({ pose: 'rock' })).pose, 'cmd:home');
});

test('export and import round-trip, and junk files are refused', () => {
  const { m, rock } = trained();
  const copy = new Model(JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(copy.gestures.length, 3);
  assert.equal(copy.count(rock.id), 40);
  assert.ok(rate(copy, () => varied(rng(5))({ pose: 'rock' }), 'Rock', 50) > 0.95);
  assert.throws(() => new Model({ hello: 1 }));
});

test('a trained gesture drives the real engine', () => {
  const { m } = trained();
  const E = new Engine(); E.setScreen(1280, 720); E.setClassifier(m.classifier());
  const rand = rng(2), ev = [];
  for (let t = 0; t < 1200; t += 33) ev.push(...E.update([Synth.hand({ pose: 'rock', noise: 0.0015, rand })], t).events);
  const cmds = ev.filter(e => e.type === 'command');
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].name, 'home');
  m.enabled = false;
  const E2 = new Engine(); E2.setClassifier(m.classifier());
  const ev2 = [];
  for (let t = 0; t < 1200; t += 33) ev2.push(...E2.update([Synth.hand({ pose: 'rock', noise: 0.0015, rand })], t).events);
  assert.equal(ev2.filter(e => e.type === 'command').length, 0);
});
