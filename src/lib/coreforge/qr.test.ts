import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VERSION,
  alignmentPositions,
  dataCodewords,
  eccBlocks,
  encodeQr,
  formatBits,
  gfMultiply,
  maskBit,
  numDataCodewords,
  numRawDataModules,
  qrSvgPath,
  versionBits,
  type Ecc,
} from './qr.ts';

// Data codewords per version and level, from the capacity table in ISO/IEC 18004
// (Table 7). An independent check on the block tables and the module arithmetic.
const DATA_CODEWORDS: Record<Ecc, number[]> = {
  L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274],
  M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216],
  Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154],
  H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122],
};

test('data capacity matches the standard table for versions 1-10 at every level', () => {
  for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
    for (let v = 1; v <= MAX_VERSION; v++) assert.equal(numDataCodewords(v, ecc), DATA_CODEWORDS[ecc][v - 1], `v${v}-${ecc}`);
  }
  // Total codewords: 26 at version 1, 346 at version 10.
  assert.equal(numRawDataModules(1) / 8, 26);
  assert.equal(Math.floor(numRawDataModules(10) / 8), 346);
});

test('format information matches the published codes', () => {
  // Annex C: level + mask 0.
  assert.equal(formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(formatBits('M', 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(formatBits('Q', 0).toString(2).padStart(15, '0'), '011010101011111');
  assert.equal(formatBits('H', 0).toString(2).padStart(15, '0'), '001011010001001');
});

test('version information matches the published codes', () => {
  // Annex D: version 7 is 000111110010010100, version 10 is 001010010011010011.
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  assert.equal(versionBits(10).toString(2).padStart(18, '0'), '001010010011010011');
});

test('alignment pattern centres match the standard table', () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(6), [6, 34]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(10), [6, 28, 50]);
});

/** Evaluates a codeword polynomial (highest degree first) at x in GF(256). */
function evalPoly(poly: readonly number[], x: number): number {
  let y = 0;
  for (const c of poly) y = gfMultiply(y, x) ^ c;
  return y;
}

test('every Reed-Solomon block is a valid codeword: all syndromes are zero', () => {
  const bytes = new TextEncoder().encode('https://goldensdmat.in/welcome?utm_source=basuoikantik.in&utm_medium=portfolio&utm_campaign=qr');
  for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const cap = numDataCodewords(v, ecc);
      const slice = bytes.slice(0, Math.max(0, Math.min(bytes.length, cap - 3)));
      const blocks = eccBlocks(dataCodewords(slice, v, ecc), v, ecc);
      for (const b of blocks) {
        const word = [...b.data, ...b.ecc];
        let alpha = 1;
        for (let i = 0; i < b.ecc.length; i++) {
          assert.equal(evalPoly(word, alpha), 0, `v${v}-${ecc} syndrome ${i}`);
          alpha = gfMultiply(alpha, 2);
        }
      }
    }
  }
});

test('the data stream starts with byte mode and the length, and pads with EC/11', () => {
  const cw = dataCodewords(new TextEncoder().encode('AB'), 1, 'M');
  assert.equal(cw.length, 16);
  // 0100 | 00000010 | 01000001 01000010 | 0000 then pad.
  assert.deepEqual(cw.slice(0, 4), [0x40, 0x24, 0x14, 0x20]);
  assert.deepEqual(cw.slice(4, 8), [0xec, 0x11, 0xec, 0x11]);
});

function assertFinder(m: readonly (readonly boolean[])[], x0: number, y0: number) {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      assert.equal(m[y0 + dy][x0 + dx], ring !== 2, `finder at ${x0},${y0} (${dx},${dy})`);
    }
  }
}

test('the matrix has finders, timing, the dark module and format bits that decode to its mask', () => {
  const url = 'https://goldensdmat.in/welcome?utm_source=basuoikantik.in&utm_medium=portfolio&utm_campaign=qr';
  const qr = encodeQr(url, 'M');
  assert.equal(qr.size, qr.version * 4 + 17);
  assertFinder(qr.modules, 0, 0);
  assertFinder(qr.modules, qr.size - 7, 0);
  assertFinder(qr.modules, 0, qr.size - 7);
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }
  assert.equal(qr.modules[qr.size - 8][8], true);
  // Read the first format copy back out of the matrix.
  let bits = 0;
  const read = (x: number, y: number, i: number) => {
    if (qr.modules[y][x]) bits |= 1 << i;
  };
  for (let i = 0; i <= 5; i++) read(8, i, i);
  read(8, 7, 6);
  read(8, 8, 7);
  read(7, 8, 8);
  for (let i = 9; i < 15; i++) read(14 - i, 8, i);
  assert.equal(bits, formatBits(qr.ecc, qr.mask));
});

test('the portfolio URL fits comfortably and picks the smallest version', () => {
  const url = 'https://goldensdmat.in/welcome?utm_source=basuoikantik.in&utm_medium=portfolio&utm_campaign=qr';
  const qr = encodeQr(url, 'M');
  // 94 bytes: version 5-M holds 84, version 6-M holds 106.
  assert.equal(new TextEncoder().encode(url).length, 94);
  assert.equal(qr.version, 6);
  assert.ok(qr.mask >= 0 && qr.mask < 8);
});

test('ECC is raised when the version has room, and oversize input throws', () => {
  assert.equal(encodeQr('hi', 'L').ecc, 'H');
  assert.throws(() => encodeQr('x'.repeat(400), 'L'), RangeError);
});

test('masks follow the standard formulas', () => {
  assert.equal(maskBit(0, 0, 0), true);
  assert.equal(maskBit(0, 1, 0), false);
  assert.equal(maskBit(1, 5, 2), true);
  assert.equal(maskBit(2, 3, 1), true);
  assert.equal(maskBit(5, 0, 7), true);
  assert.throws(() => maskBit(8, 0, 0), RangeError);
});

test('the SVG path covers exactly the dark modules', () => {
  const qr = encodeQr('CoreForge', 'M');
  const path = qrSvgPath(qr, 4);
  let area = 0;
  for (const m of path.matchAll(/h(\d+)v1/g)) area += Number(m[1]);
  const dark = qr.modules.flat().filter(Boolean).length;
  assert.equal(area, dark);
});
