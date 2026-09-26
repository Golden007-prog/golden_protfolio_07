#!/usr/bin/env node
/**
 * Self-hosts every project's media as small, optimised files:
 *   public/images/projects/<slug>/cover.webp   16:10 still, at most 80 KB
 *   public/videos/projects/<slug>/loop.mp4     muted H.264 loop (animated sources only)
 *   public/videos/projects/<slug>/poster.webp  the loop's first frame
 * and points projects.json's thumbnail/demoVideo at them.
 *
 * The sources are the original hotlinks (GitHub attachment GIFs behind short-lived
 * signed redirects, and repository Open Graph cards). They live here, not in
 * projects.json, so the site never requests them.
 *
 * Needs ffmpeg and ffprobe on PATH (made with 8.1.1).
 * Usage: node scripts/fetch-project-media.mjs [--force] [slug ...]
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_JSON = join(ROOT, 'src/data/projects.json');
const IMAGE_DIR = join(ROOT, 'public/images/projects');
const VIDEO_DIR = join(ROOT, 'public/videos/projects');
const TMP = join(tmpdir(), 'ob-project-media');

const STILL_MAX_BYTES = 80 * 1024;
const LOOP_MAX_BYTES = 800 * 1024;
// Both folders together; seventeen stills plus three loops must stay under this.
const TOTAL_MAX_BYTES = 3 * 1024 * 1024;
const LOOP_MAX_SECONDS = 8;

/**
 * fit 'cover' crops to 16:10 around the centre. 'contain' letterboxes on `pad`,
 * for the 2:1 Open Graph cards whose text runs edge to edge.
 */
const SOURCES = {
  'urbancare-ai': { url: 'https://github.com/user-attachments/assets/a9447147-00a8-48ef-980c-120880a48cf4', fit: 'cover' },
  'bruhworking-nexusflow': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/bruhworking', fit: 'contain', pad: 'white' },
  'vyapar-gyan': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/Vyapar-Gyan', fit: 'contain', pad: 'white' },
  'omni-lab': { url: 'https://github.com/user-attachments/assets/a5b59b91-12d6-464b-845a-742c0a814cbb', fit: 'cover' },
  'content-storyteller': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/Content-Storyteller', fit: 'contain', pad: 'white' },
  'tcs-stock-forecasting': { url: 'https://github.com/user-attachments/assets/b5ad89d3-25c2-4868-b7f1-cc5c0647e793', fit: 'cover' },
  'drugs-side-effects-analysis': { url: 'https://github.com/user-attachments/assets/32a10826-deee-49b1-945b-8e92370ae6f4', fit: 'cover' },
  'ibm-hr-attrition-prediction': { url: 'https://github.com/user-attachments/assets/de2fd646-4dfd-4a7f-b870-46213d42b2a3', fit: 'cover' },
  'netflix-content-analytics': {
    url: 'https://opengraph.githubassets.com/1/Golden007-prog/Netflix-Data-Cleaning-Analysis-and-Visualization',
    fit: 'contain',
    pad: 'white',
  },
  'mcq-tech-challenge': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/test-challenger-07', fit: 'contain', pad: 'white' },
  // A 2:1 console screenshot whose headline sits at the left edge; letterboxed on its own background.
  'pulse-stadium-ai': { url: 'https://github.com/user-attachments/assets/ac7473b6-51bc-48ae-9b14-45e4cb36f7f3', fit: 'contain', pad: '0x0A0D14' },
  sankalp: { url: 'https://opengraph.githubassets.com/1/Golden007-prog/Sankalp', fit: 'contain', pad: 'white' },
  'cred-domain-support-agent': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/cred-loan-support-agent', fit: 'contain', pad: 'white' },
  'ksp-dappa': { url: 'https://raw.githubusercontent.com/Golden007-prog/KSP-Dappa/main/.github/media/command-dashboard.jpg', fit: 'cover' },
  marketpulse: { url: 'https://opengraph.githubassets.com/1/Golden007-prog/MarketPulse', fit: 'contain', pad: 'white' },
  govprep: { url: 'https://opengraph.githubassets.com/1/Golden007-prog/Govt-Prep', fit: 'contain', pad: 'white' },
  'the-calcutta-classics': { url: 'https://opengraph.githubassets.com/1/Golden007-prog/calcutta_classic_demo', fit: 'contain', pad: 'white' },
};

// Largest first; a still that cannot meet the budget at q40 steps down a size.
const STILL_SIZES = [
  [1280, 800],
  [1120, 700],
  [960, 600],
];
const STILL_QUALITIES = [80, 72, 64, 56, 48, 40];
const LOOP_SIZE = [960, 600];
const LOOP_CRFS = [26, 28, 30, 32, 34, 36];

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

function frameFilter(fit, pad, [w, h]) {
  if (fit === 'contain') {
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${pad}`;
  }
  return `crop='min(iw,ih*16/10)':'min(ih,iw*10/16)',scale=${w}:${h}:flags=lanczos`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function size(path) {
  return (await stat(path)).size;
}

async function download(slug, url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${slug}: ${url} answered ${res.status}`);
  const file = join(TMP, `${slug}.src`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_packets',
    '-show_entries', 'stream=width,height,nb_read_packets:format=duration',
    '-of', 'json',
    file,
  ]);
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0] ?? {};
  const frames = Number(stream.nb_read_packets ?? 1);
  const duration = Number(info.format?.duration);
  return { frames, duration: Number.isFinite(duration) ? duration : 0 };
}

async function encodeStill(src, out, { fit, pad }, seek) {
  for (const dims of STILL_SIZES) {
    for (const q of STILL_QUALITIES) {
      await run('ffmpeg', [
        '-v', 'error', '-y',
        ...(seek > 0 ? ['-ss', seek.toFixed(2)] : []),
        '-i', src,
        '-frames:v', '1',
        '-vf', frameFilter(fit, pad, dims),
        '-c:v', 'libwebp', '-preset', 'picture', '-compression_level', '6', '-quality', String(q),
        out,
      ]);
      const bytes = await size(out);
      if (bytes <= STILL_MAX_BYTES) return { bytes, q, dims };
    }
  }
  throw new Error(`${out}: no still under ${STILL_MAX_BYTES} bytes`);
}

async function encodeLoop(src, out, { fit, pad }) {
  for (const crf of LOOP_CRFS) {
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-i', src,
      '-t', String(LOOP_MAX_SECONDS),
      '-an',
      '-vf', `${frameFilter(fit, pad, LOOP_SIZE)},fps=24,format=yuv420p`,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf),
      '-movflags', '+faststart',
      out,
    ]);
    const bytes = await size(out);
    if (bytes <= LOOP_MAX_BYTES) return { bytes, crf };
  }
  throw new Error(`${out}: no loop under ${LOOP_MAX_BYTES} bytes`);
}

async function encodePoster(loop, out) {
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', loop,
    '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', '60',
    out,
  ]);
  return size(out);
}

async function folderBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += await size(join(entry.parentPath ?? entry.path, entry.name));
  }
  return total;
}

async function main() {
  await run('ffmpeg', ['-version']).catch(() => {
    throw new Error('ffmpeg is not on PATH');
  });
  await mkdir(TMP, { recursive: true });

  const projects = JSON.parse(await readFile(PROJECTS_JSON, 'utf8'));
  const results = {};

  for (const [slug, source] of Object.entries(SOURCES)) {
    if (only.length && !only.includes(slug)) continue;
    const imageDir = join(IMAGE_DIR, slug);
    const videoDir = join(VIDEO_DIR, slug);
    const still = join(imageDir, 'cover.webp');
    const loop = join(videoDir, 'loop.mp4');
    const poster = join(videoDir, 'poster.webp');

    if (!force && (await exists(still))) {
      results[slug] = { still, loop: (await exists(loop)) ? loop : null, skipped: true };
      continue;
    }

    await mkdir(imageDir, { recursive: true });
    const src = await download(slug, source.url);
    const { frames, duration } = await probe(src);
    const animated = frames > 1 && duration > 0;

    // A frame late in the clip: title cards that type themselves in are complete by then.
    const s = await encodeStill(src, still, source, animated ? duration * 0.85 : 0);
    let madeLoop = null;
    if (animated) {
      await mkdir(videoDir, { recursive: true });
      const l = await encodeLoop(src, loop, source);
      const p = await encodePoster(loop, poster);
      madeLoop = loop;
      console.log(`${slug}: loop ${(l.bytes / 1024).toFixed(0)} KB (crf ${l.crf}), poster ${(p / 1024).toFixed(0)} KB`);
    } else {
      await rm(videoDir, { recursive: true, force: true });
    }
    console.log(`${slug}: still ${(s.bytes / 1024).toFixed(0)} KB (${s.dims.join('x')} q${s.q})`);
    results[slug] = { still, loop: madeLoop, skipped: false };
  }

  let changed = false;
  for (const project of projects) {
    const r = results[project.slug];
    if (!r) continue;
    const thumbnail = `/images/projects/${project.slug}/cover.webp`;
    const demoVideo = r.loop ? `/videos/projects/${project.slug}/loop.mp4` : undefined;
    if (project.thumbnail !== thumbnail) {
      project.thumbnail = thumbnail;
      changed = true;
    }
    if (project.demoVideo !== demoVideo) {
      if (demoVideo) project.demoVideo = demoVideo;
      else delete project.demoVideo;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(PROJECTS_JSON, `${JSON.stringify(projects, null, 2)}\n`);
    console.log('projects.json: thumbnail/demoVideo updated');
  }

  const total = (await folderBytes(IMAGE_DIR)) + ((await exists(VIDEO_DIR)) ? await folderBytes(VIDEO_DIR) : 0);
  console.log(`total: ${(total / 1024).toFixed(0)} KB of ${(TOTAL_MAX_BYTES / 1024).toFixed(0)} KB`);
  if (total > TOTAL_MAX_BYTES) {
    console.error('Project media is over budget.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
