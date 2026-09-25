#!/usr/bin/env node
// WCAG 2.x contrast check for the theme tokens in src/index.css.
// Every text token must reach 4.5:1 and the focus ring 3:1 against each page
// surface, in both themes. Exits 1 on any failure so CI can gate on it.
//
//   node scripts/check-contrast.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.css');

const TEXT_TOKENS = [
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-dim',
  'cyan-text',
  'amber-text',
  'positive',
  'negative',
  'success',
  'danger',
];
const NON_TEXT_TOKENS = ['focus-ring'];
const SURFACES = ['bg-base', 'bg-surface', 'bg-elevated'];

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

/** Returns the declarations of the first rule whose selector matches exactly. */
function blockFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!match) throw new Error(`No "${selector}" block found in ${CSS_PATH}`);
  const tokens = {};
  for (const [, name, value] of match[2].matchAll(/--app-([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(CSS_PATH, 'utf8');
const dark = blockFor(css, ':root');
const themes = {
  dark,
  // Light only overrides what differs, so fall back to the dark value.
  light: { ...dark, ...blockFor(css, ':root[data-theme="light"]') },
};

let failures = 0;
const rows = [];

for (const [theme, tokens] of Object.entries(themes)) {
  for (const [list, min] of [
    [TEXT_TOKENS, TEXT_MIN],
    [NON_TEXT_TOKENS, NON_TEXT_MIN],
  ]) {
    for (const fg of list) {
      const fgRgb = parseHex(tokens[fg] ?? '');
      if (!fgRgb) {
        failures++;
        rows.push({ theme, fg, bg: '-', ratio: 'n/a', min, ok: false, note: `--app-${fg} missing or not #hex (${tokens[fg]})` });
        continue;
      }
      for (const bg of SURFACES) {
        const bgRgb = parseHex(tokens[bg] ?? '');
        if (!bgRgb) {
          failures++;
          rows.push({ theme, fg, bg, ratio: 'n/a', min, ok: false, note: `--app-${bg} missing or not #hex` });
          continue;
        }
        const ratio = contrastRatio(fgRgb, bgRgb);
        const ok = ratio >= min;
        if (!ok) failures++;
        rows.push({ theme, fg, bg, ratio: ratio.toFixed(2), min, ok, note: `${tokens[fg]} on ${tokens[bg]}` });
      }
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('theme', 6)} ${pad('token', 15)} ${pad('surface', 12)} ${pad('ratio', 6)} ${pad('min', 4)} result`);
for (const r of rows) {
  console.log(
    `${pad(r.theme, 6)} ${pad(r.fg, 15)} ${pad(r.bg, 12)} ${pad(r.ratio, 6)} ${pad(r.min, 4)} ${r.ok ? 'pass' : 'FAIL'}  ${r.note}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} contrast checks pass.`);
