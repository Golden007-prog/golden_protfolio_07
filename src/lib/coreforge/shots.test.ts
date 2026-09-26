import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  COREFORGE_SHOT_LIST,
  COREFORGE_SHOT_MAX_BYTES,
  COREFORGE_SHOT_WIDTHS,
  COREFORGE_SHOTS,
  shotSrc,
  shotSrcSet,
  type CoreforgeShot,
} from './shots.ts';

const PUBLIC = new URL('../../../public', import.meta.url);

function readPublic(url: string): Buffer {
  return readFileSync(new URL(`${PUBLIC.href}${url}`));
}

/** Canvas size from the RIFF header of a lossy, lossless or extended WebP. */
function webpSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk '${chunk}'`);
}

function renditions(shot: CoreforgeShot): [number, string][] {
  return Object.entries(shot.src).map(([w, src]) => [Number(w), src]);
}

test('every key matches its id and every id is unique', () => {
  for (const [key, shot] of Object.entries(COREFORGE_SHOTS)) assert.equal(shot.id, key);
  assert.equal(new Set(COREFORGE_SHOT_LIST.map((s) => s.id)).size, COREFORGE_SHOT_LIST.length);
});

test('the requested set is present', () => {
  const byDevice = (d: string) => COREFORGE_SHOT_LIST.filter((s) => s.device === d).map((s) => s.id).sort();
  assert.deepEqual(byDevice('desktop'), ['brain-gym-desktop', 'demo-desktop', 'modules-desktop', 'pricing-desktop', 'welcome-desktop']);
  assert.deepEqual(byDevice('mobile'), ['demo-mobile', 'welcome-mobile']);
});

test('each rendition exists, is a WebP of the stated size, and fits the budget', () => {
  for (const shot of COREFORGE_SHOT_LIST) {
    const widths = renditions(shot).map(([w]) => w);
    assert.deepEqual(widths, [...COREFORGE_SHOT_WIDTHS[shot.device]], shot.id);
    for (const [w, src] of renditions(shot)) {
      assert.match(src, new RegExp(`^/images/coreforge/${shot.id}-${w}\\.webp$`));
      const buf = readPublic(src);
      assert.ok(buf.length <= COREFORGE_SHOT_MAX_BYTES, `${src} is ${buf.length} bytes`);
      const expected = { width: w, height: Math.round((shot.height * w) / shot.width) };
      assert.deepEqual(webpSize(buf), expected, src);
    }
    assert.equal(shot.width, Math.max(...widths), `${shot.id}: width is the largest rendition`);
  }
});

test('blur placeholders are tiny inline WebPs with the same aspect', () => {
  for (const shot of COREFORGE_SHOT_LIST) {
    const prefix = 'data:image/webp;base64,';
    assert.ok(shot.blurDataURL.startsWith(prefix), shot.id);
    const buf = Buffer.from(shot.blurDataURL.slice(prefix.length), 'base64');
    assert.ok(buf.length < 512, `${shot.id} blur is ${buf.length} bytes`);
    const { width, height } = webpSize(buf);
    assert.ok(width <= 16 && height <= 20, `${shot.id} blur is ${width}x${height}`);
    assert.ok(Math.abs(width / height - shot.width / shot.height) < 0.35, `${shot.id} blur aspect`);
  }
});

test('alt text is descriptive and carries no prices or dated wording', () => {
  for (const shot of COREFORGE_SHOT_LIST) {
    assert.ok(shot.alt.length >= 60, `${shot.id} alt is too thin`);
    assert.doesNotMatch(shot.alt, /₹|\bINR\b|\bRs\.?\s?\d|launch sale|ends in|tomorrow|September|\b20\d\d\b/i, shot.id);
  }
});

test('path points at a goldensdmat.in page', () => {
  for (const shot of COREFORGE_SHOT_LIST) assert.match(shot.path, /^\/[a-z-]+$/, shot.id);
});

test('shotSrc and shotSrcSet', () => {
  const desk = COREFORGE_SHOTS['welcome-desktop'];
  const phone = COREFORGE_SHOTS['demo-mobile'];
  assert.equal(shotSrc(desk), '/images/coreforge/welcome-desktop-1280.webp');
  assert.equal(shotSrc(phone), '/images/coreforge/demo-mobile-780.webp');
  assert.equal(
    shotSrcSet(desk),
    '/images/coreforge/welcome-desktop-640.webp 640w, /images/coreforge/welcome-desktop-1280.webp 1280w',
  );
  assert.equal(shotSrcSet(phone), '/images/coreforge/demo-mobile-390.webp 390w, /images/coreforge/demo-mobile-780.webp 780w');
});
