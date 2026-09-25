#!/usr/bin/env node
/**
 * Downloads the LottieFiles animations assigned to the LOTTIE registry
 * (src/lib/lottie-registry.ts), validates each one and writes it minified to
 * public/lottie/. Colours come out as the author made them; run
 * scripts/recolor-lottie.mjs afterwards to map them onto the brand tokens.
 *
 *   node scripts/fetch-lottie.mjs            download all assigned files
 *   node scripts/fetch-lottie.mjs send wave  download only these (file stem)
 *   node scripts/fetch-lottie.mjs --check    validate what is on disk, no network
 *
 * Exits non-zero if any file fails to download or validate. A file that fails
 * is never written, so the previous copy (or LottieIcon's fallback) stays.
 * Licences and authors are recorded in LOTTIE_CREDITS.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOTTIE_DIR = join(ROOT, 'public', 'lottie');
export const MAX_BYTES = 30 * 1024;

export const ASSETS = [
  { file: 'error.json', url: 'https://assets-v2.lottiefiles.com/a/b60906b4-1152-11ee-addc-efed9b1c7636/dU2yCrev9M.json' },
  { file: 'send.json', url: 'https://assets-v2.lottiefiles.com/a/88a439f8-1177-11ee-843f-d323975bf88d/h0CsHTEGYA.json' },
  { file: 'wave.json', url: 'https://assets-v2.lottiefiles.com/a/2d3c818e-358f-4111-86da-84a54f39a288/sq8KP9uwNS.json' },
  { file: 'copy-check.json', url: 'https://assets-v2.lottiefiles.com/a/4a6c7336-1162-11ee-b3e3-07b736732286/PzBnbxomat.json' },
  { file: 'download.json', url: 'https://assets-v2.lottiefiles.com/a/1daeb03c-2d14-11f0-b9af-7bbab3f7e9ff/VcangolBm5.json' },
  {
    file: 'rocket.json',
    url: 'https://assets-v2.lottiefiles.com/a/b2278860-1173-11ee-ae8c-6fd401540174/vzTUnNyZd6.json',
    // Two 30px Gaussian blurs on the orbit rings of a 1080px comp: 1-2px at BackToTop sizes.
    allowIgnoredEffects: true,
  },
  { file: 'empty-search.json', url: 'https://assets-v2.lottiefiles.com/a/058bed40-1177-11ee-abfa-931a7119e310/1nw4l2MAwP.json' },
  { file: 'typing.json', url: 'https://assets-v2.lottiefiles.com/a/e33c251a-1172-11ee-a57e-53a0961c3e1d/qX9UJgB5wt.json' },
  { file: 'sparkle.json', url: 'https://assets-v2.lottiefiles.com/a/7b44137e-1e8a-11f0-8310-335d273cfe0f/YLIk6dVOHK.json' },
  { file: 'calendar.json', url: 'https://assets-v2.lottiefiles.com/a/ec55c8e2-1152-11ee-94ba-9bf6fbd18bd2/KEOa1d6OX1.json' },
];

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Effect types the full lottie-web SVG build renders. The light build that
// LottieIcon uses registers none of them; anything else (e.g. Puppet, 34) is
// ignored by every lottie-web build and is dead data.
const RENDERED_EFFECTS = new Set([20, 21, 22, 23, 24, 25, 28, 29, 35]);

export function* eachLayer(json) {
  for (const layer of json.layers ?? []) yield layer;
  for (const asset of json.assets ?? []) for (const layer of asset.layers ?? []) yield layer;
}

/** Deep walk that yields every plain object in the tree. */
export function* eachObject(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* eachObject(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* eachObject(value);
  }
}

const LOOP_EXPRESSION = /^(?:var \$bm_rt;\s*\$bm_rt = )?loopOut\(\s*['"](cycle|pingpong)['"]\s*(?:,\s*0\s*)?\)\s*;?\s*$/;

const flipEase = (v) => (Array.isArray(v) ? v.map((n) => 1 - n) : 1 - v);

/**
 * Replaces a whole-range loopOut('cycle'|'pingpong') expression with explicit
 * keyframes up to `end` (layer time), so the light player, which cannot run
 * expressions, shows the same motion. Returns false if the property is not a
 * shape it can bake exactly (old s/e keyframes, hold keys, a cycle whose ends
 * differ), leaving the expression for the validator to reject.
 */
function bakeLoop(prop, mode, end) {
  const keys = prop.k;
  if (!Array.isArray(keys) || keys.length < 2) return false;
  if (keys.some((k) => !('s' in k) || 'e' in k || k.h)) return false;
  const segments = keys.slice(0, -1);
  if (segments.some((k) => !k.i || !k.o)) return false;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const span = last.t - first.t;
  if (!(span > 0)) return false;
  if (mode === 'cycle' && JSON.stringify(first.s) !== JSON.stringify(last.s)) return false;
  const spatial = segments.some((k) => k.to || k.ti);

  // One pass = the segments in playback order: { start value, duration, easing, spatial tangents }.
  const forward = segments.map((k, n) => ({
    s: k.s,
    d: keys[n + 1].t - k.t,
    i: k.i,
    o: k.o,
    ...(spatial ? { to: k.to, ti: k.ti } : {}),
  }));
  const backward = forward
    .map((seg, n) => ({
      s: keys[n + 1].s,
      d: seg.d,
      // Mirroring a segment in time mirrors its easing curve and swaps its tangents.
      o: { x: flipEase(seg.i.x), y: flipEase(seg.i.y) },
      i: { x: flipEase(seg.o.x), y: flipEase(seg.o.y) },
      ...(spatial ? { to: seg.ti, ti: seg.to } : {}),
    }))
    .reverse();

  const baked = [];
  let t = first.t;
  let endValue = first.s;
  for (let pass = 0; t < end; pass += 1) {
    const segs = mode === 'pingpong' && pass % 2 === 1 ? backward : forward;
    for (const { d, ...seg } of segs) {
      baked.push({ ...seg, t });
      t += d;
    }
    endValue = mode === 'pingpong' && pass % 2 === 1 ? first.s : last.s;
  }
  baked.push({ t, s: endValue });
  prop.k = baked;
  delete prop.x;
  return true;
}

/**
 * Lossless clean-up for the light player: bakes simple loopOut expressions,
 * drops effect types no lottie-web build renders, and drops top-level layers
 * that can never be on screen. Mutates and returns `json`.
 */
export function normalizeLottie(json) {
  const parents = new Set();
  for (const layer of eachLayer(json)) {
    if (layer.parent != null) parents.add(layer.parent);
    if (layer.tp != null) parents.add(layer.tp);
  }
  json.layers = (json.layers ?? []).filter((layer) => {
    const neverVisible = layer.ip >= layer.op || layer.ip >= json.op || layer.op <= json.ip;
    return !(neverVisible && !layer.td && !parents.has(layer.ind));
  });

  const topLevel = new Set(json.layers);
  for (const layer of eachLayer(json)) {
    const stretch = layer.sr || 1;
    const until = topLevel.has(layer) ? Math.min(layer.op, json.op) : layer.op;
    const end = (until - (layer.st ?? 0)) / stretch;
    for (const obj of eachObject(layer)) {
      if (typeof obj.x !== 'string' || obj.a !== 1) continue;
      const match = LOOP_EXPRESSION.exec(obj.x.trim());
      if (match) bakeLoop(obj, match[1], end);
    }
  }

  let expressions = false;
  for (const obj of eachObject(json)) if (typeof obj.x === 'string' && ('k' in obj || 'a' in obj)) expressions = true;
  // Effect controls can feed expressions, so dead effects go only once none remain.
  if (!expressions) {
    for (const layer of eachLayer(json)) {
      if (!Array.isArray(layer.ef)) continue;
      layer.ef = layer.ef.filter((effect) => RENDERED_EFFECTS.has(effect.ty));
      if (!layer.ef.length) delete layer.ef;
    }
  }
  return json;
}

/** The top-level fields every Lottie document needs (v, fr, ip, op, w, h, layers). */
export function checkStructure(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['not a JSON object'];
  if (typeof json.v !== 'string') errors.push('missing "v" (bodymovin version)');
  for (const key of ['fr', 'ip', 'op', 'w', 'h']) {
    if (!isNum(json[key])) errors.push(`"${key}" is not a finite number`);
  }
  if (isNum(json.fr) && json.fr <= 0) errors.push('"fr" must be > 0');
  if (isNum(json.ip) && isNum(json.op) && json.op <= json.ip) errors.push('"op" must be > "ip"');
  if ((isNum(json.w) && json.w <= 0) || (isNum(json.h) && json.h <= 0)) errors.push('"w" and "h" must be > 0');
  if (!Array.isArray(json.layers) || json.layers.length === 0) errors.push('"layers" is missing or empty');
  return errors;
}

/**
 * Checks a Lottie document as LottieIcon plays it: the lottie-web "light" SVG
 * build, which has no expression engine and registers no layer effects, so
 * either would silently render wrong. Rasters are rejected outright.
 */
export function inspectLottie(json, { allowIgnoredEffects = false } = {}) {
  const errors = checkStructure(json);
  const warnings = [];
  if (errors.length) return { errors, warnings };

  for (const asset of json.assets ?? []) {
    if (Array.isArray(asset.layers) || typeof asset.p !== 'string') continue;
    if (asset.e === 1 || asset.p.startsWith('data:')) errors.push(`embedded raster asset "${asset.id}"`);
    else errors.push(`external image asset "${asset.id}" (${asset.u ?? ''}${asset.p})`);
  }
  for (const layer of eachLayer(json)) {
    if (layer.ty === 2) errors.push(`image layer "${layer.nm ?? layer.ind}"`);
    if (layer.ty === 5) warnings.push(`text layer "${layer.nm ?? layer.ind}" needs its font at runtime`);
    const liveEffects = (layer.ef ?? []).filter((effect) => effect.en !== 0);
    const rendered = liveEffects.filter((effect) => RENDERED_EFFECTS.has(effect.ty));
    if (rendered.length) {
      const message = `layer "${layer.nm ?? layer.ind}" has effect type ${rendered.map((e) => e.ty).join(',')}, which the light player skips`;
      (allowIgnoredEffects ? warnings : errors).push(message);
    }
    if (liveEffects.length > rendered.length) warnings.push(`layer "${layer.nm ?? layer.ind}" has effects no lottie-web build renders`);
  }
  let expressions = 0;
  let mergePaths = 0;
  for (const obj of eachObject(json)) {
    if (typeof obj.x === 'string' && ('k' in obj || 'a' in obj)) expressions += 1;
    if (obj.ty === 'mm') mergePaths += 1;
  }
  if (expressions) errors.push(`${expressions} expression(s), which the light player cannot evaluate`);
  if (mergePaths) warnings.push(`${mergePaths} merge path(s), which lottie-web does not render`);
  if (JSON.stringify(json).includes('"data:')) errors.push('embedded data: URI');
  return { errors, warnings };
}

export function describe(json, bytes) {
  const frames = json.op - json.ip;
  return {
    frames: `${json.ip}-${json.op}`,
    fr: Math.round(json.fr * 1000) / 1000,
    seconds: Math.round((frames / json.fr) * 100) / 100,
    size: `${json.w}x${json.h}`,
    layers: json.layers.length,
    kb: Math.round((bytes / 1024) * 10) / 10,
  };
}

async function download(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError;
}

async function main(argv) {
  const check = argv.includes('--check');
  const only = argv.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\.json$/, ''));
  const unknown = only.filter((stem) => !ASSETS.some((a) => a.file === `${stem}.json`));
  if (unknown.length) {
    console.error(`Unknown file(s): ${unknown.join(', ')}`);
    return 1;
  }
  const targets = only.length ? ASSETS.filter((a) => only.includes(a.file.replace(/\.json$/, ''))) : ASSETS;
  await mkdir(LOTTIE_DIR, { recursive: true });

  const rows = [];
  let failures = 0;
  for (const asset of targets) {
    const dest = join(LOTTIE_DIR, asset.file);
    try {
      const text = check ? await readFile(dest, 'utf8') : await download(asset.url);
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('response is not JSON');
      }
      const structural = checkStructure(json);
      if (structural.length) throw new Error(structural.join('; '));
      normalizeLottie(json);
      const { errors, warnings } = inspectLottie(json, asset);
      const min = JSON.stringify(json);
      const bytes = Buffer.byteLength(min);
      if (bytes > MAX_BYTES) errors.push(`${(bytes / 1024).toFixed(1)}KB minified exceeds the ${MAX_BYTES / 1024}KB budget`);
      if (errors.length) throw new Error(errors.join('; '));
      if (!check) await writeFile(dest, min);
      rows.push({ file: asset.file, ...describe(json, bytes), warnings: warnings.join('; ') || '-' });
    } catch (err) {
      failures += 1;
      rows.push({ file: asset.file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.table(rows);
  if (failures) {
    console.error(`${failures} of ${targets.length} file(s) failed; nothing was written for them.`);
    return 1;
  }
  console.log(
    check
      ? `${targets.length} file(s) in public/lottie are valid.`
      : `${targets.length} file(s) written to public/lottie. Next: node scripts/recolor-lottie.mjs`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
