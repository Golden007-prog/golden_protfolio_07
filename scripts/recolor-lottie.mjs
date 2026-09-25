#!/usr/bin/env node
/**
 * Maps the Lottie files in public/lottie onto the dark-theme brand tokens,
 * rounds every float to 3 decimals and strips authoring metadata (meta, nm,
 * mn), then re-validates each file and prints a colour report. Light-theme
 * colours are swapped at runtime through LottieIcon's `colors` prop.
 *
 *   node scripts/fetch-lottie.mjs && node scripts/recolor-lottie.mjs
 *   node scripts/recolor-lottie.mjs --report      palettes only, writes nothing
 *   node scripts/recolor-lottie.mjs --danger=#F87171
 *
 * Idempotent: brand colours map to themselves, so a second run writes the same bytes.
 * error.json takes the dark --app-danger from src/index.css when it is defined.
 * Exits non-zero if a recoloured file keeps an off-brand colour, grows, or
 * fails validation.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOTTIE_DIR, MAX_BYTES, eachLayer, eachObject, inspectLottie } from './fetch-lottie.mjs';

const DANGER_FALLBACK = '#FB7185';

// Per-file source hex -> role. Colours not listed fall back to classify().
// `recolor: false` files were brought on-brand in the Next.js migration and are
// only minified here, keeping their colours.
const FILES = {
  'error.json': { map: { '#FA3535': 'danger', '#FFFFFF': 'neutral' }, red: 'danger' },
  'send.json': { map: { '#F98F66': 'cyan' } },
  // Keeps the light-hand / darker-crease value structure of the original.
  'wave.json': { map: { '#ACAFFF': 'neutral', '#9295E1': 'violet' } },
  'copy-check.json': { map: { '#6DCC5B': 'violet', '#87F572': 'violet', '#FFFFFF': 'neutral' } },
  'download.json': { map: { '#F0564E': 'violet', '#3D82C1': 'cyan' } },
  'rocket.json': {
    map: {
      '#EBEEF0': 'neutral',
      '#CED7DB': 'neutral',
      '#8E56EC': 'violet',
      '#80DDE9': 'cyan',
      '#F3CA3E': 'amber',
      '#5AE4A8': 'cyan',
      '#262626': 'violet',
      '#525252': 'violet',
    },
  },
  'empty-search.json': { map: { '#85ADFF': 'violet' } },
  'typing.json': { map: { '#FFFFFF': 'neutral', '#C9C9C9': 'neutral', '#E0E0E0': 'neutral', '#F0F0F0': 'neutral' } },
  'sparkle.json': { map: { '#FFF9E2': 'amber', '#FFFFFF': 'neutral' } },
  'calendar.json': { map: { '#FFFFFF': 'cyan', '#FF0000': 'cyan' } },
  'dots.json': { recolor: false },
  'scroll.json': { recolor: false },
  'success.json': { recolor: false },
};

async function readDangerToken() {
  try {
    const css = await readFile(join(LOTTIE_DIR, '..', '..', 'src', 'index.css'), 'utf8');
    // The dark :root block comes first in index.css, so the first match is the dark value.
    const match = /--app-danger:\s*(#[0-9a-fA-F]{6})\b/.exec(css);
    return match ? { hex: match[1].toUpperCase(), source: 'src/index.css --app-danger' } : null;
  } catch {
    return null;
  }
}

const toHex = (rgb, scale) =>
  `#${rgb
    .slice(0, 3)
    .map((v) => Math.max(0, Math.min(255, Math.round((v / scale) * 255))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
// Very old exports store 0-255 channels; everything since uses 0-1.
const scaleOf = (rgb) => (Math.max(rgb[0], rgb[1], rgb[2]) > 1 ? 255 : 1);

function hsl(hex) {
  const [r, g, b] = fromHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Hue-based fallback for colours a file's map does not name. */
function classify(hex, redRole = 'violet') {
  const { h, s, l } = hsl(hex);
  if (s < 0.2 || l > 0.92 || l < 0.12) return 'neutral';
  if (h >= 340 || h < 15) return redRole;
  if (h < 70) return 'amber';
  if (h < 250) return 'cyan';
  return 'violet';
}

/**
 * Calls visit(rgbArray, kind) for every colour a renderer can paint; visit
 * mutates in place. kind 'paint' is a shape fill or stroke.
 */
function forEachColor(json, visit) {
  const visitProp = (prop, kind) => {
    if (!prop || !Array.isArray(prop.k)) return;
    if (typeof prop.k[0] === 'number') {
      visit(prop.k, kind);
      return;
    }
    for (const key of prop.k) {
      if (Array.isArray(key.s)) visit(key.s, kind);
      if (Array.isArray(key.e)) visit(key.e, kind);
    }
  };
  const visitGradient = (g) => {
    const stops = g?.p ?? 0;
    const each = (arr) => {
      for (let n = 0; n < stops; n += 1) {
        const rgb = arr.slice(4 * n + 1, 4 * n + 4);
        visit(rgb, 'gradient');
        arr.splice(4 * n + 1, 3, ...rgb);
      }
    };
    if (!g?.k || !Array.isArray(g.k.k)) return;
    if (typeof g.k.k[0] === 'number') each(g.k.k);
    else for (const key of g.k.k) {
      if (Array.isArray(key.s)) each(key.s);
      if (Array.isArray(key.e)) each(key.e);
    }
  };

  for (const obj of eachObject(json)) {
    if (obj.ty === 'fl' || obj.ty === 'st') visitProp(obj.c, 'paint');
    else if (obj.ty === 'gf' || obj.ty === 'gs') visitGradient(obj.g);
  }
  for (const layer of eachLayer(json)) {
    if (layer.ty === 1 && typeof layer.sc === 'string' && /^#[0-9a-f]{6}$/i.test(layer.sc)) {
      const rgb = fromHex(layer.sc);
      visit(rgb, 'solid');
      layer.sc = toHex(rgb, 1).toLowerCase();
    }
    if (layer.ty === 5) {
      for (const key of layer.t?.d?.k ?? []) {
        if (Array.isArray(key.s?.fc)) visit(key.s.fc, 'text');
        if (Array.isArray(key.s?.sc)) visit(key.s.sc, 'text');
      }
    }
    for (const effect of layer.ef ?? []) {
      for (const control of effect.ef ?? []) if (control.ty === 2) visitProp(control.v, 'effect');
    }
  }
}

/**
 * lottie-web paints fills and strokes as rgb(floor(c * 255)), so a plainly
 * rounded 0.333 renders #A855F7 as #A854F7. Rounding each channel up to 3
 * decimals keeps floor() on the intended 8-bit value (0.001 * 255 < 1).
 */
function snapPaint(rgb, kind) {
  if (kind !== 'paint' || scaleOf(rgb) !== 1) return;
  for (let n = 0; n < 3; n += 1) {
    const channel = Math.round(rgb[n] * 255);
    rgb[n] = Math.min(1, Math.ceil((channel / 255) * 1000 - 1e-6) / 1000);
    if (Math.floor(rgb[n] * 255) < channel) rgb[n] = Math.min(1, rgb[n] + 0.001);
  }
}

function palette(json) {
  const counts = new Map();
  forEachColor(json, (rgb) => {
    const hex = toHex(rgb, scaleOf(rgb));
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  });
  return counts;
}

function roundFloats(node) {
  if (Array.isArray(node)) {
    for (let n = 0; n < node.length; n += 1) {
      if (typeof node[n] === 'number') node[n] = round(node[n]);
      else roundFloats(node[n]);
    }
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'number') node[key] = round(value);
      else roundFloats(value);
    }
  }
}
const round = (n) => (Number.isInteger(n) ? n : Math.round(n * 1000) / 1000 || 0);

function stripMetadata(json) {
  delete json.meta;
  // Names only matter to expressions, which inspectLottie already rejects.
  for (const obj of eachObject(json)) {
    delete obj.nm;
    delete obj.mn;
  }
}

async function main(argv) {
  const reportOnly = argv.includes('--report');
  const flag = argv.find((a) => a.startsWith('--danger='));
  const token = flag ? { hex: flag.slice(9).toUpperCase(), source: '--danger' } : await readDangerToken();
  const danger = token?.hex ?? DANGER_FALLBACK;
  if (!/^#[0-9A-F]{6}$/.test(danger)) {
    console.error(`Invalid danger colour ${danger}`);
    return 1;
  }
  const BRAND = { violet: '#A855F7', cyan: '#22D3EE', amber: '#F59E0B', neutral: '#E2E8F0', danger };
  const roleOf = Object.fromEntries(Object.entries(BRAND).map(([role, hex]) => [hex, role]));
  console.log(`danger = ${danger} (${token?.source ?? 'fallback: --app-danger is not in src/index.css yet'})`);

  const rows = [];
  const problems = [];
  for (const [file, config] of Object.entries(FILES)) {
    const path = join(LOTTIE_DIR, file);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      problems.push(`${file}: missing (run scripts/fetch-lottie.mjs)`);
      continue;
    }
    const json = JSON.parse(text);
    const before = Buffer.byteLength(text);
    const source = [...palette(json).keys()].join(' ');
    const auto = [];
    const usesDanger = config.red === 'danger' || Object.values(config.map ?? {}).includes('danger');
    const isBrand = (hex) => Boolean(roleOf[hex]) && (usesDanger || roleOf[hex] !== 'danger');

    if (config.recolor !== false) {
      forEachColor(json, (rgb) => {
        const scale = scaleOf(rgb);
        const hex = toHex(rgb, scale);
        if (isBrand(hex)) return;
        let role = config.map?.[hex];
        if (!role) {
          role = classify(hex, config.red);
          auto.push(`${hex}->${role}`);
        }
        const target = fromHex(BRAND[role]);
        for (let n = 0; n < 3; n += 1) rgb[n] = target[n] * scale;
      });
    }
    forEachColor(json, snapPaint);
    roundFloats(json);
    stripMetadata(json);

    const out = JSON.stringify(json);
    const after = Buffer.byteLength(out);
    const result = palette(json);
    const colours = [...result].map(([hex, n]) => `${isBrand(hex) ? `${roleOf[hex]}` : `${hex}(off-brand)`}x${n}`);
    const { errors } = inspectLottie(json, { allowIgnoredEffects: file === 'rocket.json' });
    if (errors.length) problems.push(`${file}: ${errors.join('; ')}`);
    if (after > before) problems.push(`${file}: grew from ${before} to ${after} bytes`);
    if (after > MAX_BYTES) problems.push(`${file}: ${after} bytes exceeds ${MAX_BYTES}`);
    const offBrand = [...result.keys()].filter((hex) => !isBrand(hex));
    if (config.recolor !== false && offBrand.length) problems.push(`${file}: off-brand ${offBrand.join(', ')}`);
    if (auto.length) problems.push(`${file}: unmapped colours classified by hue: ${[...new Set(auto)].join(', ')}`);

    rows.push({
      file,
      mode: config.recolor === false ? 'minify only' : 'recolour',
      bytes: `${before} -> ${after}`,
      source,
      result: colours.join(' '),
    });
    if (!reportOnly && !errors.length && after <= before) await writeFile(path, out);
  }
  console.table(rows);
  const fatal = problems.filter((p) => !p.includes('classified by hue'));
  for (const p of problems) console[fatal.includes(p) ? 'error' : 'warn'](p);
  if (reportOnly) console.log('Report only: nothing written.');
  return fatal.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
