// Run with:  npm test
// Checks the top-place lists, points, levels, badges and check-in distance.
const test = require('node:test');
const assert = require('node:assert/strict');
const Explore = require('../src/explore.js');

const categories = {
  pubs: { label: 'Pubs', icon: '🍺', badge: 'Brewery Hopper' },
  parks: { label: 'Parks', icon: '🌳' },
  rail: { label: 'Stations', icon: '🚆' },
};
const places = [
  ...Array.from({ length: 20 }, (_, i) => ({ name: `Pub ${i}`, cat: 'pubs', lat: 12.97 + i * 0.001, lng: 77.6, rank: i < 5 ? 3 : i < 12 ? 2 : 1 })),
  { name: 'Cubbon Park', cat: 'parks', lat: 12.9763, lng: 77.5929, rank: 3 },
  { name: 'Lalbagh', cat: 'parks', lat: 12.9507, lng: 77.5848, rank: 3, approx: true },
  { name: 'Majestic', cat: 'rail', lat: 12.978, lng: 77.57, rank: 3 },
];
const make = (visits) => Explore.create({ places, categories, options: { top: 15, skip: ['rail'] }, visits });

test('lists keep the top places by rank and skip excluded categories', () => {
  const E = make();
  assert.deepEqual(Object.keys(E.lists), ['pubs', 'parks']);
  assert.equal(E.lists.pubs.length, 15);
  assert.equal(E.lists.pubs[0].name, 'Pub 0');
  assert.ok(E.lists.pubs.every(p => p.rank >= 1));
  assert.equal(E.lists.pubs.filter(p => p.rank === 1).length, 3);   // 5 rank-3 + 7 rank-2 + 3 rank-1
  assert.equal(E.info(places[22]), null);                           // a skipped category is not on a list
  assert.equal(E.info(places[19]), null);                           // ranked too low for the top 15
  assert.equal(E.info(places[0]).pos, 1);
});

test('points: rank x 10, doubled for an on-the-spot check-in', () => {
  const E = make();
  E.mark(places[0]); assert.equal(E.summary().points, 30);
  E.mark(places[6]); assert.equal(E.summary().points, 50);
  E.mark(places[0], { gps: true }); assert.equal(E.summary().points, 80);
  E.mark(places[0]); assert.equal(E.pointsFor(places[0]), 60, 'ticking again never loses the GPS bonus');
  E.unmark(places[6]); assert.equal(E.summary().points, 60);
  assert.equal(E.mark(places[22]), false);
});

test('levels follow points', () => {
  const E = make();
  assert.equal(E.summary().level, 'Stargazer');
  for (const p of E.lists.pubs.slice(0, 5)) E.mark(p);   // 5 x 30 = 150
  const s = E.summary();
  assert.equal(s.level, 'Pathfinder'); assert.equal(s.nextLevel, 'Navigator'); assert.equal(s.nextAt, 300);
});

test('category badges unlock in bronze, silver and gold tiers', () => {
  const E = make();
  const tierOf = () => E.summary().badges.find(b => b.id === 'cat:pubs');
  assert.equal(tierOf().tier, null);
  assert.equal(tierOf().name, 'Brewery Hopper');
  E.lists.pubs.slice(0, 3).forEach(p => E.mark(p)); assert.equal(tierOf().tier, 'bronze');
  E.lists.pubs.slice(0, 8).forEach(p => E.mark(p)); assert.equal(tierOf().tier, 'silver');
  E.lists.pubs.forEach(p => E.mark(p)); assert.equal(tierOf().tier, 'gold');
  const parks = E.summary().badges.find(b => b.id === 'cat:parks');
  assert.deepEqual(parks.goals, [1, 2], 'a two-place list has two tiers');
});

test('unlocked() reports only new badge tiers', () => {
  const E = make();
  const a = E.summary(); E.mark(places[0]); const b = E.summary();
  assert.deepEqual(E.unlocked(a, b).map(x => x.id), ['city:first']);
  E.mark(places[1]); E.mark(places[2]); const c = E.summary();
  assert.deepEqual(E.unlocked(b, c).map(x => x.id), ['cat:pubs']);
  assert.deepEqual(E.unlocked(c, c), []);
});

test('saved progress loads, and unknown places are dropped', () => {
  const k = Explore.keyOf(places[0]);
  const E = make({ [k]: { t: 1, gps: true }, 'pubs:gone': { t: 1 } });
  assert.equal(E.summary().visited, 1); assert.equal(E.summary().points, 60);
  assert.deepEqual(Object.keys(E.visits()), [k]);
});

test('check-in works within the radius, wider for approximate pins', () => {
  const E = make();
  const park = places[20], lal = places[21];
  assert.ok(E.canCheckIn(park, { lat: park.lat + 0.002, lng: park.lng }).ok);        // ~220 m
  assert.ok(!E.canCheckIn(park, { lat: park.lat + 0.01, lng: park.lng }).ok);        // ~1.1 km
  assert.ok(E.canCheckIn(lal, { lat: lal.lat + 0.01, lng: lal.lng }).ok);            // approx pin: 1.5 km allowed
  assert.ok(Math.abs(Explore.distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 50);
});
