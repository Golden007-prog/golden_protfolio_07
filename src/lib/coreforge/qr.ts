// A small QR Code encoder (ISO/IEC 18004, model 2) for the CoreForge QR card, written
// so the portfolio needs no QR dependency. Byte mode only, versions 1-10 (up to 271
// bytes at level L: plenty for a URL), all four error-correction levels, automatic
// mask selection by the standard penalty rules. The structure follows Project Nayuki's
// public-domain reference design. Pure, erasable TypeScript: node --test imports it.

export type Ecc = 'L' | 'M' | 'Q' | 'H';

export type QrCode = {
  readonly version: number;
  readonly size: number;
  readonly ecc: Ecc;
  readonly mask: number;
  /** modules[y][x], true = dark. */
  readonly modules: readonly (readonly boolean[])[];
};

export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

/** The two format bits for each level (L=01, M=00, Q=11, H=10). */
const ECC_FORMAT_BITS: Readonly<Record<Ecc, number>> = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_ORDER: readonly Ecc[] = ['L', 'M', 'Q', 'H'];

// Index 0 is unused so the tables read by version number.
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<Ecc, readonly number[]>> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const NUM_ERROR_CORRECTION_BLOCKS: Readonly<Record<Ecc, readonly number[]>> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

// ---------- capacity ----------

/** Modules left for data and ECC codewords once every function pattern is placed. */
export function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function numDataCodewords(ver: number, ecc: Ecc): number {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
}

/** Bits needed to encode `byteLength` bytes in byte mode at `ver`. */
function segmentBits(ver: number, byteLength: number): number {
  const countBits = ver <= 9 ? 8 : 16;
  return 4 + countBits + byteLength * 8;
}

// ---------- Reed-Solomon over GF(2^8) with polynomial 0x11D ----------

export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Splits data codewords into blocks, appends each block's ECC and interleaves them. */
export function addEccAndInterleave(data: readonly number[], ver: number, ecc: Ecc): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    // A placeholder keeps short and long blocks the same length; it is skipped below.
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/** The ECC blocks as (data, ecc) pairs before interleaving, for tests. */
export function eccBlocks(data: readonly number[], ver: number, ecc: Ecc): { data: number[]; ecc: number[] }[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const out: { data: number[]; ecc: number[] }[] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    out.push({ data: dat, ecc: rsRemainder(dat, divisor) });
  }
  return out;
}

// ---------- BCH codes for the format and version information ----------

/** The 15 format bits (ECC level and mask, BCH-protected and XOR-masked). */
export function formatBits(ecc: Ecc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---------- matrix ----------

class Matrix {
  readonly version: number;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns(ecc: Ecc) {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const align = alignmentPositions(this.version);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // The three corners already hold finder patterns.
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(align[i], align[j]);
      }
    }
    this.drawFormat(ecc, 0);
    this.drawVersion();
  }

  drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormat(ecc: Ecc, mask: number) {
    const bits = formatBits(ecc, mask);
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, getBit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && maskBit(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    const size = this.size;
    const m = this.modules;
    let result = 0;
    const scanLine = (get: (i: number) => boolean) => {
      let runColor = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < size; i++) {
        if (get(i) === runColor) {
          run++;
          if (run === 5) result += PENALTY_N1;
          else if (run > 5) result++;
        } else {
          addHistory(run, history, size);
          if (!runColor) result += countFinderLike(history) * PENALTY_N3;
          runColor = get(i);
          run = 1;
        }
      }
      result += terminateAndCount(runColor, run, history, size) * PENALTY_N3;
    };
    for (let y = 0; y < size; y++) scanLine((x) => m[y][x]);
    for (let x = 0; x < size; x++) scanLine((y) => m[y][x]);
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += PENALTY_N2;
      }
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }
}

export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new RangeError(`mask ${mask}`);
  }
}

function addHistory(run: number, history: number[], size: number) {
  // The quiet zone counts as light, so a row's first run gets the border added.
  if (history[0] === 0) run += size;
  history.pop();
  history.unshift(run);
}

function countFinderLike(h: readonly number[]): number {
  const n = h[1];
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
}

function terminateAndCount(runColor: boolean, run: number, history: number[], size: number): number {
  if (runColor) {
    addHistory(run, history, size);
    run = 0;
  }
  run += size;
  addHistory(run, history, size);
  return countFinderLike(history);
}

// ---------- encoding ----------

/** The padded data codewords for `bytes` at `ver`/`ecc` (before ECC). */
export function dataCodewords(bytes: Uint8Array, ver: number, ecc: Ecc): number[] {
  const capacityBits = numDataCodewords(ver, ecc) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  return out;
}

/**
 * Encodes `text` (UTF-8, byte mode) at the smallest version that fits, then raises the
 * ECC level as far as that version allows. Throws if it needs more than version 10.
 */
export function encodeQr(text: string, minEcc: Ecc = 'M', forceMask?: number): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = -1;
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (segmentBits(v, bytes.length) <= numDataCodewords(v, minEcc) * 8) {
      version = v;
      break;
    }
  }
  if (version < 0) throw new RangeError(`QR: ${bytes.length} bytes do not fit in version ${MAX_VERSION} at level ${minEcc}`);

  let ecc = minEcc;
  for (const e of ECC_ORDER.slice(ECC_ORDER.indexOf(minEcc) + 1)) {
    if (segmentBits(version, bytes.length) <= numDataCodewords(version, e) * 8) ecc = e;
  }

  const codewords = addEccAndInterleave(dataCodewords(bytes, version, ecc), version, ecc);
  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns(ecc);
  matrix.drawCodewords(codewords);

  let mask = forceMask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      matrix.applyMask(m);
      matrix.drawFormat(ecc, m);
      const score = matrix.penalty();
      if (score < best) {
        best = score;
        mask = m;
      }
      matrix.applyMask(m);
    }
  }
  matrix.applyMask(mask);
  matrix.drawFormat(ecc, mask);

  return { version, size: matrix.size, ecc, mask, modules: matrix.modules };
}

/**
 * One SVG path covering every dark module, runs merged per row, in module units with
 * a `border`-module quiet zone. Render it in a viewBox of 0 0 size+2*border.
 */
export function qrSvgPath(qr: QrCode, border = 4): string {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => {
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < qr.size && row[x]) x++;
      parts.push(`M${start + border} ${y + border}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join('');
}
