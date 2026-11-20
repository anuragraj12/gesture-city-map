#!/usr/bin/env node
// Turn a CSV of places into a city config for Gesture City Map.
//
//   node tools/csv-to-city.mjs places.csv --name "Pune" > cities/pune.js
//
// CSV header (any order, extra columns ignored):
//   name, category, lat, lng, rank, area, note
// rank is optional (1–3, default 2). Categories are created automatically;
// edit their labels, colours and icons in the output afterwards.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('Usage: node tools/csv-to-city.mjs places.csv --name "City" > cities/city.js'); process.exit(1); }

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

const rows = parseCSV(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const head = rows.shift().map(h => h.trim().toLowerCase());
const col = n => head.indexOf(n);
for (const need of ['name', 'category', 'lat', 'lng']) if (col(need) < 0) { console.error(`Missing column: ${need}`); process.exit(1); }

const PALETTE = ['#7cf3ff', '#ff5cf0', '#ffb020', '#3ddc84', '#b794ff', '#ff8a3d', '#5aa9ff', '#fff1a8', '#ff5c5c', '#a3ff7a', '#c7d2fe', '#ffe066'];
const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
const cats = {}, places = [], skipped = [];
rows.forEach((r, i) => {
  const get = n => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');
  const lat = parseFloat(get('lat')), lng = parseFloat(get('lng'));
  if (!get('name') || !isFinite(lat) || !isFinite(lng)) { skipped.push(i + 2); return; }
  const label = get('category') || 'Other', key = slug(label);
  if (!cats[key]) cats[key] = { label, color: PALETTE[Object.keys(cats).length % PALETTE.length], icon: '✦' };
  const p = { name: get('name'), cat: key, lat, lng, rank: Math.min(3, Math.max(1, parseInt(get('rank')) || 2)) };
  if (get('area')) p.area = get('area');
  if (get('note')) p.note = get('note');
  places.push(p);
});
if (skipped.length) console.error(`Skipped rows without name/lat/lng: ${skipped.join(', ')}`);

const name = flag('name') || 'My City';
const J = JSON.stringify;
process.stdout.write(`/* ${name} — generated from ${file.split('/').pop()} by tools/csv-to-city.mjs. Edit freely. */
window.CITY_CONFIG = {
  name: ${J(name)},
  title: ${J(flag('title') || name + ' Constellation')},
  subtitle: ${J(flag('subtitle') || '')},
  categories: {
${Object.entries(cats).map(([k, c]) => `    ${J(k)}: { label: ${J(c.label)}, color: ${J(c.color)}, icon: ${J(c.icon)} },`).join('\n')}
  },
  places: [
${places.map(p => '    ' + J(p) + ',').join('\n')}
  ],
  lines: [],
};
`);
