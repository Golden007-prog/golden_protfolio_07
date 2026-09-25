import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloomLevels } from './bloomLevels.ts';

// Stage sides in drawing-buffer pixels: the 1024px layout (~320 CSS px at DPR 1), a
// phone (344 CSS px at the canvas's 1.5 DPR cap), 1440 at DPR 1 and 1.5, and larger.
const CASES: [side: number, levels: number][] = [
  [300, 3],
  [340, 3],
  [474, 4],
  [516, 4],
  [711, 4],
  [900, 5],
  [1400, 5],
];

test('the level count follows the canvas so the glow stays inside its margin', () => {
  for (const [side, levels] of CASES) assert.equal(bloomLevels(side), levels, `side ${side}`);
});

test('never the full-canvas default of 8, and never fewer than 3', () => {
  for (let side = 1; side <= 4096; side += 7) {
    const levels = bloomLevels(side);
    assert.ok(levels >= 3 && levels <= 5, `side ${side}: ${levels}`);
  }
});

test('an unmeasured (hidden) canvas keeps a sane default', () => {
  assert.equal(bloomLevels(0), 4);
  assert.equal(bloomLevels(Number.NaN), 4);
});
