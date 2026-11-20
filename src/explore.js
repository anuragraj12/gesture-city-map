/*  Explore mode for Gesture City Map
    ------------------------------------------------------------------
    Turns the city's places into "top places" lists, one per category,
    and keeps score as you tick them off: points, levels and badges.
    No DOM code, so it runs in the browser and in Node
    (see test/explore.test.js). Progress is saved by the caller.

    Points   rank 3 = 30, rank 2 = 20, rank 1 = 10.
             A visit checked in on the spot (GPS) counts double.
    Badges   one per category, in three tiers (bronze, silver, gold),
             plus a few for the whole city.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Explore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVELS = [
    [0, 'Stargazer'], [100, 'Pathfinder'], [300, 'Navigator'],
    [600, 'Voyager'], [1000, 'Star Hopper'], [1600, 'City Legend'],
  ];
  const TIERS = ['bronze', 'silver', 'gold'];

  const keyOf = p => `${p.cat}:${String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const basePoints = p => (Math.max(1, Math.min(3, Math.round(p.rank || 1)))) * 10;

  /** Distance in metres between two lat/lng points. */
  function distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /**
   * @param {object} o
   * @param {Array}  o.places      [{ name, cat, lat, lng, rank, area, approx }]
   * @param {object} o.categories  { key: { label, icon, badge } }
   * @param {object} [o.options]   { top: 15, skip: [keys], radius: 400, approxRadius: 1500 }
   * @param {object} [o.visits]    saved progress: { key: { t, gps } }
   */
  function create({ places, categories, options = {}, visits = {} }) {
    const top = options.top || 15, skip = new Set(options.skip || []);
    const radius = options.radius || 400, approxRadius = options.approxRadius || 1500;

    // Top places per category: highest rank first, config order breaks ties.
    const lists = {};
    for (const k of Object.keys(categories)) {
      if (skip.has(k)) continue;
      const L = places.map((p, i) => [p, i]).filter(([p]) => p.cat === k)
        .sort((a, b) => (b[0].rank || 1) - (a[0].rank || 1) || a[1] - b[1]).slice(0, top).map(([p]) => p);
      if (L.length) lists[k] = L;
    }
    const listed = new Map();   // key -> { place, cat, pos }
    for (const [k, L] of Object.entries(lists)) L.forEach((p, i) => listed.set(keyOf(p), { place: p, cat: k, pos: i + 1 }));

    // Drop saved visits for places that are no longer on a list.
    const v = {};
    for (const [k, x] of Object.entries(visits || {})) if (listed.has(k) && x) v[k] = { t: +x.t || 0, gps: !!x.gps };

    function info(p) { const e = listed.get(keyOf(p)); return e ? { cat: e.cat, pos: e.pos, of: lists[e.cat].length, points: basePoints(p) } : null; }
    function visit(p) { return v[keyOf(p)] || null; }
    function pointsFor(p) { const x = visit(p); return x ? basePoints(p) * (x.gps ? 2 : 1) : 0; }

    /** Tick a place off. gps: true when checked in on the spot. Returns false if it isn't on a list. */
    function mark(p, { gps = false, t = Date.now() } = {}) {
      if (!listed.has(keyOf(p))) return false;
      const old = v[keyOf(p)];
      v[keyOf(p)] = { t: old ? old.t : t, gps: gps || !!(old && old.gps) };
      return true;
    }
    function unmark(p) { delete v[keyOf(p)]; }

    /** Is this lat/lng close enough to the place to count as a check-in? */
    function canCheckIn(p, pos) {
      const d = distance(pos, p), lim = (p.approx ? approxRadius : radius) + Math.min(pos.accuracy || 0, 300);
      return { ok: d <= lim, distance: d, limit: lim };
    }

    function badges() {
      const out = [];
      const counts = {};
      for (const k of Object.keys(lists)) counts[k] = lists[k].filter(p => v[keyOf(p)]).length;
      for (const [k, L] of Object.entries(lists)) {
        const c = categories[k], n = L.length, got = counts[k];
        const goals = [...new Set([Math.min(3, n), Math.ceil(n / 2), n])].sort((a, b) => a - b);
        const tierNames = goals.length === 3 ? TIERS : goals.length === 2 ? ['bronze', 'gold'] : ['gold'];
        const tier = goals.reduce((t, g, i) => (got >= g ? i : t), -1);
        const next = goals.find(g => got < g) || n;
        out.push({ id: 'cat:' + k, cat: k, icon: c.icon || '✦', name: c.badge || `${c.label || k} Explorer`,
          desc: `Visit the top ${n} ${c.label || k}`, have: got, goal: next, max: n, goals,
          tier: tier >= 0 ? tierNames[tier] : null, tierIndex: tier, tiers: tierNames.length });
      }
      const total = Object.keys(v).length, cats = Object.values(counts).filter(n => n > 0).length;
      const gps = Object.values(v).filter(x => x.gps).length, nCats = Object.keys(lists).length;
      const city = [
        ['first', '🌟', 'First Star', 'Tick off your first place', total, 1],
        ['ten', '✨', 'Constellation', 'Tick off 10 places', total, 10],
        ['wander', '🧭', 'Wanderer', 'Visit 5 different categories', cats, Math.min(5, nCats)],
        ['round', '🌈', 'All-Rounder', 'Visit at least one place in every category', cats, nCats],
        ['gps', '📍', 'Been There, Proved It', 'Check in on the spot 5 times', gps, 5],
        ['half', '🌗', 'Half the Sky', 'Tick off half of all the top places', total, Math.ceil(listed.size / 2)],
        ['legend', '👑', 'City Legend', 'Tick off every top place', total, listed.size],
      ];
      for (const [id, icon, name, desc, have, goal] of city) {
        out.push({ id: 'city:' + id, icon, name, desc, have: Math.min(have, goal), goal, max: goal, goals: [goal],
          tier: have >= goal ? 'gold' : null, tierIndex: have >= goal ? 0 : -1, tiers: 1, city: true });
      }
      return out;
    }

    function summary() {
      let points = 0, gps = 0;
      for (const [k, x] of Object.entries(v)) { points += basePoints(listed.get(k).place) * (x.gps ? 2 : 1); if (x.gps) gps++; }
      let li = 0; LEVELS.forEach(([min], i) => { if (points >= min) li = i; });
      const B = badges();
      return {
        points, visited: Object.keys(v).length, total: listed.size, gps,
        level: LEVELS[li][1], levelIndex: li, levelMin: LEVELS[li][0],
        nextLevel: LEVELS[li + 1] ? LEVELS[li + 1][1] : null, nextAt: LEVELS[li + 1] ? LEVELS[li + 1][0] : null,
        badges: B, earned: B.reduce((s, b) => s + (b.tierIndex + 1), 0), earnable: B.reduce((s, b) => s + b.tiers, 0),
      };
    }

    /** Badge tiers earned in `after` that weren't in `before`. */
    function unlocked(before, after) {
      const was = new Map(before.badges.map(b => [b.id, b.tierIndex]));
      return after.badges.filter(b => b.tierIndex > (was.has(b.id) ? was.get(b.id) : -1));
    }

    return { lists, info, visit, pointsFor, mark, unmark, canCheckIn, summary, unlocked, visits: () => ({ ...v }), keyOf };
  }

  return { create, distance, keyOf, LEVELS };
});
