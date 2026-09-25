import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../src/data/projects.json', import.meta.url);
const raw = readFileSync(path, 'utf8');
const data = JSON.parse(raw);

const MAP = [
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00e2\u20ac\u2014', '\u2014'],
  ['\u00e2\u2020\u2019', '\u2192'],
  ['\u00e2\u2030\u02c6', '\u2248'],
  ['\u00c3\u2014', '\u00d7'],
  ['\u00c2\u00b2', '\u00b2'],
  ['\u00c2\u00b0', '\u00b0'],
  ['\u00e2\u20ac\u02dc', '\u2018'],
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u0153', '\u201c'],
  ['\u00e2\u20ac\u009d', '\u201d'],
];

function fix(s) {
  let out = s;
  for (const [bad, good] of MAP) out = out.split(bad).join(good);
  return out;
}

function walk(v) {
  if (typeof v === 'string') return fix(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') {
    const r = {};
    for (const k of Object.keys(v)) r[k] = walk(v[k]);
    return r;
  }
  return v;
}

writeFileSync(path, JSON.stringify(walk(data), null, 2) + '\n');
console.log('ok');
