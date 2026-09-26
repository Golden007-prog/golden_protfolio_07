#!/usr/bin/env node
/**
 * Turns the goldensdmat.in (CoreForge) screenshots into the responsive WebP set under
 * public/images/coreforge/ and regenerates the typed manifest src/lib/coreforge/shots.ts.
 *
 *   node scripts/coreforge/optimize-shots.mjs --src <dir with the capture PNGs>
 *   COREFORGE_SHOTS_DIR=<dir> node scripts/coreforge/optimize-shots.mjs
 *   node scripts/coreforge/optimize-shots.mjs --src <dir> --engine ffmpeg --out <dir>
 *
 * Engine: sharp when it resolves from node_modules (Next ships it), else ffmpeg with
 * libwebp. --out writes somewhere other than public/ and then skips the manifest.
 *
 * Crops. Every shot keeps its nav bar and drops the dated announcement banner under it
 * ("First India dMAT test date ... tomorrow"); /welcome also drops its dated LATEST news
 * ticker. Pricing stops above the plan toggle, so the launch-sale pill and the ₹ prices
 * never reach the output (prices change: the portfolio links to /pricing instead).
 * The row numbers were measured on the 2026-09-26 captures (desktop 1440x900, mobile
 * 390x844 @2x). Each cut must land on flat single-colour rows and the source size must
 * match, so a recapture with a moved layout fails here instead of slicing content.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = join(ROOT, 'public/images/coreforge');
const PUBLIC_URL = '/images/coreforge';
const MANIFEST = join(ROOT, 'src/lib/coreforge/shots.ts');
const CAPTURED_AT = '2026-09-26';
const MAX_BYTES = 120 * 1024;
const QUALITIES = [72, 66, 60, 54];
const BLUR = { quality: 50, width: { desktop: 16, mobile: 10 } };
/** Per-channel spread allowed for a row to count as flat. */
const FLAT_TOLERANCE = 6;

const DESKTOP = { device: 'desktop', sourceSize: [1440, 900], widths: [640, 1280] };
const MOBILE = { device: 'mobile', sourceSize: [780, 1688], widths: [390, 780] };

// keep: [start, end) source row bands, stacked top to bottom. padBottom repeats the last
// kept row (checked flat, so it is the page's own background) to balance a tight crop.
// Desktop: nav 0-55 + border 56, banner 57-92. Mobile: nav 0-111 + border 112-113, banner 114-273.
// Output heights are multiples of 9 (desktop) or 2 (mobile), so every rendition is integer-exact.
const SHOTS = [
  {
    ...DESKTOP,
    id: 'welcome-desktop',
    file: '_welcome-desktop.png',
    path: '/welcome',
    // Ticker at rows 168-180 sits inside flat white (93-167, 181-226): cut 133-186.
    keep: [[0, 57], [93, 133], [187, 900]],
    alt: 'CoreForge home page on desktop: the headline “The Core Module tests how you think. Your subject module tests how you apply it.”, Start for free and See pricing buttons, and a sample figure-pattern question asking where a marker moves next.',
  },
  {
    ...MOBILE,
    id: 'welcome-mobile',
    file: '_welcome-mobile.png',
    path: '/welcome',
    // Ticker at rows 372-397 sits inside flat white (274-371, 398-495): cut 322-445.
    keep: [[0, 114], [274, 322], [446, 1688]],
    alt: 'CoreForge home page on a phone: the same headline, a note that the Free plan is Core Module practice at easy difficulty in 3-question sets with no card and no expiry, and a Start for free button.',
  },
  {
    ...DESKTOP,
    id: 'demo-desktop',
    file: '_demo-desktop.png',
    path: '/demo',
    // Ends above the footer rule at row 644.
    keep: [[0, 57], [93, 639]],
    alt: 'CoreForge’s public daily demo drill on desktop, question 1 of 10: four 4×4 matrices trace a moving dot, and the answer picks the fifth and sixth matrices from three options each. A badge reads “10 free questions left today”.',
  },
  {
    ...MOBILE,
    id: 'demo-mobile',
    file: '_demo-mobile.png',
    path: '/demo',
    keep: [[0, 114], [274, 1688]],
    alt: 'The same daily demo drill on a phone: question 1 of 10, four matrices tracing a moving dot in a two-by-two grid, and the first answer option below.',
  },
  {
    ...DESKTOP,
    id: 'brain-gym-desktop',
    file: '_brain_gym-desktop.png',
    path: '/brain-gym',
    keep: [[0, 57], [93, 900]],
    alt: 'CoreForge Brain Gym page: forty short seeded rounds for speed, attention, memory and reasoning, a card for today’s round with a Play button, and Logic drills including Mini Latin, Sudoku Lite and Odd One Out.',
  },
  {
    ...DESKTOP,
    id: 'modules-desktop',
    file: '_modules-desktop.png',
    path: '/modules',
    // Content ends near row 704; rows 705-773 are flat white.
    keep: [[0, 57], [93, 756]],
    alt: 'CoreForge dMAT modules page: it explains that the dMAT is the Core Module plus exactly one subject module, lists facts such as 90 minutes per module, and offers a Find my module button for the “Which module do I need?” wizard.',
  },
  {
    ...DESKTOP,
    id: 'pricing-desktop',
    file: '_pricing-desktop.png',
    path: '/pricing',
    // Eyebrow starts at row 202; the Free plan line ends at 524; the toggle and the
    // launch-sale pill start at 539. Everything from 539 down is dropped.
    keep: [[0, 57], [152, 539]],
    padBottom: 33,
    alt: 'Top of the CoreForge Pro page: the headline “One upgrade. The complete dMAT.”, a summary of what Pro adds, and the line “Start on the Free plan — no card needed.”',
  },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const log = (msg) => console.log(`[coreforge-shots] ${msg}`);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

function ffmpeg(args, input) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw new Error(`ffmpeg is not available: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${res.stderr.toString()}`);
  return res.stdout;
}

/** Decode and encode through one engine; both work on packed 8-bit RGB. */
function makeEngine(name, sharp) {
  if (name === 'sharp') {
    return {
      name,
      async decode(file) {
        const { data, info } = await sharp(file).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
        if (info.channels !== 3) throw new Error(`${file}: expected 3 channels, got ${info.channels}`);
        return { data, width: info.width, height: info.height };
      },
      encode(img, width, height, quality) {
        return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
          .resize(width, height, { kernel: 'lanczos3' })
          .webp({ quality, effort: 6, preset: 'text', smartSubsample: true })
          .toBuffer();
      },
    };
  }
  return {
    name,
    async decode(file, [width, height]) {
      const data = ffmpeg(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      if (data.length !== width * height * 3) throw new Error(`${file}: decoded ${data.length} bytes, expected ${width}x${height} RGB`);
      return { data, width, height };
    },
    async encode(img, width, height, quality) {
      return ffmpeg(
        [
          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${img.width}x${img.height}`, '-i', '-',
          '-vf', `scale=${width}:${height}:flags=lanczos`,
          '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', '-preset', 'text',
          '-frames:v', '1', '-f', 'webp', '-',
        ],
        img.data,
      );
    },
  };
}

function isFlatRow(img, y) {
  const { data, width } = img;
  const start = y * width * 3;
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (let i = start; i < start + width * 3; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return max.every((v, c) => v - min[c] <= FLAT_TOLERANCE);
}

function stitch(shot, img) {
  const [sw, sh] = shot.sourceSize;
  if (img.width !== sw || img.height !== sh) {
    throw new Error(`${shot.file}: expected ${sw}x${sh}, got ${img.width}x${img.height}; re-measure the crop rows`);
  }
  shot.keep.forEach(([a, b], i) => {
    if (!(a >= 0 && a < b && b <= sh)) throw new Error(`${shot.id}: bad band [${a}, ${b})`);
    const next = shot.keep[i + 1];
    if (next && next[0] < b) throw new Error(`${shot.id}: bands overlap or run backwards`);
    // Every seam, and the row a pad repeats, must be flat so the join cannot show.
    const seamRows = next ? [b - 1, next[0]] : shot.padBottom ? [b - 1] : [];
    for (const y of seamRows) {
      if (!isFlatRow(img, y)) throw new Error(`${shot.id}: row ${y} is not flat; the layout moved, re-measure the crop rows`);
    }
  });

  const rowBytes = img.width * 3;
  const pad = shot.padBottom ?? 0;
  const height = shot.keep.reduce((n, [a, b]) => n + (b - a), 0) + pad;
  const data = Buffer.alloc(height * rowBytes);
  let y = 0;
  for (const [a, b] of shot.keep) {
    img.data.copy(data, y * rowBytes, a * rowBytes, b * rowBytes);
    y += b - a;
  }
  const lastRow = data.subarray((y - 1) * rowBytes, y * rowBytes);
  for (; y < height; y++) lastRow.copy(data, y * rowBytes);
  return { data, width: img.width, height };
}

async function encodeWithinBudget(engine, img, width, height) {
  for (const quality of QUALITIES) {
    const buf = await engine.encode(img, width, height, quality);
    if (buf.length <= MAX_BYTES) return { buf, quality };
  }
  throw new Error(`cannot fit ${width}w under ${kb(MAX_BYTES)} even at quality ${QUALITIES.at(-1)}`);
}

function tsString(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderManifest(results) {
  const entries = results
    .map((r) =>
      [
        `  ${tsString(r.id)}: {`,
        `    id: ${tsString(r.id)},`,
        `    device: ${tsString(r.device)},`,
        `    path: ${tsString(r.path)},`,
        `    alt: ${tsString(r.alt)},`,
        `    width: ${r.width},`,
        `    height: ${r.height},`,
        `    src: {`,
        ...r.renditions.map((x) => `      ${x.width}: ${tsString(x.url)},`),
        `    },`,
        `    blurDataURL: ${tsString(r.blurDataURL)},`,
        `  },`,
      ].join('\n'),
    )
    .join('\n');

  return `// Generated by scripts/coreforge/optimize-shots.mjs. Do not edit by hand: change the
// SHOTS table there and rerun it. Captured from goldensdmat.in (the owner's own product)
// in its light theme, with the dated announcement banner and news ticker cropped out and
// no prices in frame. Pure data, so node --test can import it.

export type CoreforgeShotDevice = 'desktop' | 'mobile';

type CoreforgeShotBase = {
  /** Stable key; also the file stem under ${PUBLIC_URL}/. */
  readonly id: string;
  /** Describes only what the capture shows. */
  readonly alt: string;
  /** The goldensdmat.in page the capture came from, for the outbound link. */
  readonly path: string;
  /** Intrinsic size of the largest rendition. */
  readonly width: number;
  readonly height: number;
  readonly blurDataURL: string;
};

export type CoreforgeDesktopShot = CoreforgeShotBase & {
  readonly device: 'desktop';
  readonly src: { readonly ${DESKTOP.widths[0]}: string; readonly ${DESKTOP.widths[1]}: string };
};

export type CoreforgeMobileShot = CoreforgeShotBase & {
  readonly device: 'mobile';
  readonly src: { readonly ${MOBILE.widths[0]}: string; readonly ${MOBILE.widths[1]}: string };
};

export type CoreforgeShot = CoreforgeDesktopShot | CoreforgeMobileShot;

export const COREFORGE_SHOTS_CAPTURED_AT = '${CAPTURED_AT}';

/** Per-file budget the generator enforces. */
export const COREFORGE_SHOT_MAX_BYTES = ${MAX_BYTES / 1024} * 1024;

export const COREFORGE_SHOT_WIDTHS = {
  desktop: [${DESKTOP.widths.join(', ')}],
  mobile: [${MOBILE.widths.join(', ')}],
} as const;

export const COREFORGE_SHOTS = {
${entries}
} as const satisfies Record<string, CoreforgeShot>;

export type CoreforgeShotId = keyof typeof COREFORGE_SHOTS;

export const COREFORGE_SHOT_LIST: readonly CoreforgeShot[] = Object.values(COREFORGE_SHOTS);

/** The largest rendition, for next/image (which builds its own srcset) or a plain src. */
export function shotSrc(shot: CoreforgeShot): string {
  return shot.device === 'desktop' ? shot.src[${DESKTOP.widths[1]}] : shot.src[${MOBILE.widths[1]}];
}

/** A w-descriptor srcset for a plain <img>; pair it with a sizes attribute. */
export function shotSrcSet(shot: CoreforgeShot): string {
  return shot.device === 'desktop'
    ? \`\${shot.src[${DESKTOP.widths[0]}]} ${DESKTOP.widths[0]}w, \${shot.src[${DESKTOP.widths[1]}]} ${DESKTOP.widths[1]}w\`
    : \`\${shot.src[${MOBILE.widths[0]}]} ${MOBILE.widths[0]}w, \${shot.src[${MOBILE.widths[1]}]} ${MOBILE.widths[1]}w\`;
}
`;
}

async function main() {
  const srcArg = arg('--src') ?? process.env.COREFORGE_SHOTS_DIR;
  if (!srcArg) {
    console.error('usage: node scripts/coreforge/optimize-shots.mjs --src <dir> [--engine sharp|ffmpeg] [--out <dir>]');
    process.exit(1);
  }
  const srcDir = resolve(srcArg);
  const outDir = arg('--out') ? resolve(arg('--out')) : PUBLIC_DIR;
  const writeManifest = outDir === PUBLIC_DIR;

  const sharp = await loadSharp();
  const engineName = arg('--engine') ?? (sharp ? 'sharp' : 'ffmpeg');
  if (engineName === 'sharp' && !sharp) throw new Error('sharp does not resolve from node_modules; use --engine ffmpeg');
  if (engineName !== 'sharp' && engineName !== 'ffmpeg') throw new Error(`unknown engine ${engineName}`);
  const engine = makeEngine(engineName, sharp);
  log(`engine ${engine.name}; ${relative(ROOT, srcDir) || srcDir} -> ${relative(ROOT, outDir) || outDir}`);

  mkdirSync(outDir, { recursive: true });
  const written = new Set();
  const results = [];

  for (const shot of SHOTS) {
    const file = join(srcDir, shot.file);
    if (!existsSync(file)) throw new Error(`missing capture ${file}`);
    const img = stitch(shot, await engine.decode(file, shot.sourceSize));
    const renditions = [];
    for (const width of shot.widths) {
      const height = Math.round((img.height * width) / img.width);
      const { buf, quality } = await encodeWithinBudget(engine, img, width, height);
      const name = `${shot.id}-${width}.webp`;
      writeFileSync(join(outDir, name), buf);
      written.add(name);
      renditions.push({ width, height, url: `${PUBLIC_URL}/${name}` });
      log(`${name.padEnd(28)} ${`${width}x${height}`.padEnd(10)} q${quality}  ${kb(buf.length)}`);
    }
    const blurWidth = BLUR.width[shot.device];
    const blurHeight = Math.max(1, Math.round((img.height * blurWidth) / img.width));
    const blur = await engine.encode(img, blurWidth, blurHeight, BLUR.quality);
    const largest = renditions.at(-1);
    results.push({
      id: shot.id,
      device: shot.device,
      path: shot.path,
      alt: shot.alt,
      width: largest.width,
      height: largest.height,
      renditions,
      blurDataURL: `data:image/webp;base64,${blur.toString('base64')}`,
    });
  }

  // Drop renditions this table no longer produces (a renamed or removed shot).
  for (const name of readdirSync(outDir)) {
    if (/^[a-z0-9-]+-\d+\.webp$/.test(name) && !written.has(name) && statSync(join(outDir, name)).isFile()) {
      rmSync(join(outDir, name));
      log(`removed stale ${name}`);
    }
  }

  if (writeManifest) {
    const tmp = `${MANIFEST}.tmp`;
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(tmp, renderManifest(results));
    renameSync(tmp, MANIFEST);
    log(`wrote ${relative(ROOT, MANIFEST)} (${results.length} shots)`);
  } else {
    log('custom --out: manifest not written');
  }
}

main().catch((err) => {
  console.error(`[coreforge-shots] ${err.message}`);
  process.exit(1);
});
