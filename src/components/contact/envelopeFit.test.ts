import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAMED_ASPECT, envelopeWidthShare, envelopeZoom } from './envelopeFit.ts';

// Canvas sizes the contact column produced at 1024, 1280, 1440 and 1920 wide,
// when it stretched to the form's height.
const STRETCHED = [
  [320, 959],
  [410, 915],
  [474, 915],
  [557, 915],
] as const;

test('a column stretched to the form cropped the envelope at a fixed zoom', () => {
  // The regression: every one of these cut the envelope's sides, except the widest.
  for (const [w, h] of STRETCHED.slice(0, 3)) {
    assert.ok(envelopeWidthShare(w / h, 1) > 1, `${w}x${h} should have cropped at zoom 1`);
  }
});

test('the fitted zoom keeps the level envelope inside every column width', () => {
  for (const [w, h] of [...STRETCHED, [474, 632], [320, 427], [557, 743]] as const) {
    const share = envelopeWidthShare(w / h);
    assert.ok(share <= 0.81, `${w}x${h} covers ${share.toFixed(3)} of the width`);
    assert.ok(share >= 0.79, `${w}x${h} shrank the envelope to ${share.toFixed(3)} of the width`);
  }
});

test('wide canvases keep the authored framing', () => {
  assert.equal(envelopeZoom(FRAMED_ASPECT), 1);
  assert.equal(envelopeZoom(1.6), 1);
  assert.ok(envelopeWidthShare(1.6) < 0.4);
});

test('a canvas that has not been measured yet does not break the camera', () => {
  assert.equal(envelopeZoom(0), 1);
  assert.equal(envelopeZoom(Number.NaN), 1);
  assert.equal(envelopeZoom(Number.POSITIVE_INFINITY), 1);
});
