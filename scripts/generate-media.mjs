// Phase 4: Gemini media generation
// Imagen 4.0 (fast + std) + Veo 3.1 preview
// Reads GOOGLE_AI_API_KEY from .env

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env manually
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const API_KEY = env.GOOGLE_AI_API_KEY;
if (!API_KEY) throw new Error('GOOGLE_AI_API_KEY missing in .env');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
ensureDir(resolve(ROOT, 'public/images'));
ensureDir(resolve(ROOT, 'public/videos'));

// ====== IMAGEN ======
const IMAGE_TASKS = [
  {
    out: 'public/images/skills-bg.webp',
    model: 'imagen-4.0-generate-001',
    aspect: '16:9',
    prompt: 'Abstract neural network visualization, pitch-black background, glowing nodes connected by thin luminous threads in electric violet and cyan, volumetric depth, bokeh, cinematic dark ambient lighting, no text, no watermark, 16:9',
  },
  {
    out: 'public/images/timeline-decoration.webp',
    model: 'imagen-4.0-ultra-generate-001',
    aspect: '9:16',
    prompt: 'Futuristic vertical timeline, single glowing violet-to-cyan luminous line with holographic data nodes, dark cosmic background, abstract, particle dust, no text, 9:16',
  },
  {
    out: 'public/images/contact-bg.webp',
    model: 'imagen-4.0-generate-001',
    aspect: '16:9',
    prompt: 'Abstract communication concept, floating holographic message bubbles and luminous envelope silhouettes, deep black space, violet and teal gradients, subtle particles, minimal, no text, 16:9',
  },
  {
    out: 'public/images/project-thumb-1.webp',
    model: 'imagen-4.0-fast-generate-001',
    aspect: '16:9',
    prompt: 'Abstract AI healthcare tech thumbnail, glowing violet DNA helix and medical data streams, dark background, 16:9, no text',
  },
  {
    out: 'public/images/project-thumb-2.webp',
    model: 'imagen-4.0-fast-generate-001',
    aspect: '16:9',
    prompt: 'Abstract commerce AI thumbnail, floating holographic shopping tags and currency glyphs, cyan + amber accents, dark background, 16:9, no text',
  },
  {
    out: 'public/images/project-thumb-3.webp',
    model: 'imagen-4.0-fast-generate-001',
    aspect: '16:9',
    prompt: 'Abstract multimodal creative AI thumbnail, mixing photo frames, audio waves and text lines in luminous violet-cyan, dark background, 16:9, no text',
  },
  {
    out: 'public/images/project-thumb-4.webp',
    model: 'imagen-4.0-fast-generate-001',
    aspect: '16:9',
    prompt: 'Abstract education AI thumbnail, glowing books and geometric knowledge graph nodes, violet + teal accents, dark background, 16:9, no text',
  },
];

async function runImagen(task) {
  const url = `${BASE}/models/${task.model}:predict`;
  const body = {
    instances: [{ prompt: task.prompt }],
    parameters: { sampleCount: 1, aspectRatio: task.aspect, personGeneration: 'dont_allow' },
  };
  log('imagen →', task.out);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { log('imagen FAIL', task.out, res.status, text.slice(0, 300)); return false; }
  const json = JSON.parse(text);
  const b64 = json?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) { log('imagen no data', task.out, text.slice(0, 300)); return false; }
  writeFileSync(resolve(ROOT, task.out), Buffer.from(b64, 'base64'));
  log('imagen ✓', task.out);
  return true;
}

// ====== VEO 3.1 ======
const VIDEO_TASKS = [
  {
    out: 'public/videos/hero-bg.mp4',
    prompt: 'Abstract dark cosmic environment with slowly flowing aurora borealis in deep violet, cyan, and midnight blue. Floating geometric light particles and soft streaks drift through space. Subtle depth of field, cinematic and moody, seamless loop feel. No text, no people, no logos.',
  },
  {
    out: 'public/videos/about-bg.mp4',
    prompt: 'Extreme close-up of holographic source code scrolling on a transparent glass display, violet and cyan syntax highlighting, shallow depth of field, dark ambient futuristic developer workspace. No faces, no text overlay.',
  },
];

async function startVeo(task) {
  const url = `${BASE}/models/veo-3.1-generate-preview:predictLongRunning`;
  const body = {
    instances: [{ prompt: task.prompt }],
    parameters: { aspectRatio: '16:9', durationSeconds: 8 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { log('veo start FAIL', task.out, res.status, text.slice(0, 400)); return null; }
  const op = JSON.parse(text);
  log('veo started', task.out, op.name);
  return op.name;
}

async function pollVeo(opName) {
  const url = `${BASE}/${opName}`;
  const res = await fetch(url, { headers: { 'x-goog-api-key': API_KEY } });
  if (!res.ok) return { done: false, error: await res.text() };
  return res.json();
}

async function downloadVeoVideo(op, outPath) {
  const samples = op?.response?.generateVideoResponse?.generatedSamples
    || op?.response?.generatedSamples
    || op?.response?.videos;
  const uri = samples?.[0]?.video?.uri || samples?.[0]?.uri;
  if (!uri) { log('veo no uri', JSON.stringify(op.response).slice(0, 400)); return false; }
  const dl = uri.includes('?') ? `${uri}&key=${API_KEY}` : `${uri}?key=${API_KEY}`;
  const r = await fetch(dl);
  if (!r.ok) { log('veo dl FAIL', r.status); return false; }
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(resolve(ROOT, outPath), buf);
  log('veo ✓', outPath, (buf.length / 1024 / 1024).toFixed(1) + 'MB');
  return true;
}

async function runVeo(task) {
  const opName = await startVeo(task);
  if (!opName) return false;
  const started = Date.now();
  const TIMEOUT_MS = 15 * 60 * 1000;
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 15000));
    const op = await pollVeo(opName);
    if (op.done) {
      if (op.error) { log('veo error', task.out, JSON.stringify(op.error).slice(0, 300)); return false; }
      return downloadVeoVideo(op, task.out);
    }
    log('veo polling', task.out, Math.round((Date.now() - started) / 1000) + 's');
  }
  log('veo TIMEOUT', task.out);
  return false;
}

// ====== MAIN ======
(async () => {
  const mode = process.argv[2] || 'all'; // 'images' | 'videos' | 'all'
  const results = { images: [], videos: [] };

  if (mode === 'all' || mode === 'images') {
    log('=== IMAGEN START ===');
    const imgResults = await Promise.all(IMAGE_TASKS.map(runImagen));
    results.images = IMAGE_TASKS.map((t, i) => ({ out: t.out, ok: imgResults[i] }));
  }

  if (mode === 'all' || mode === 'videos') {
    log('=== VEO START (parallel, 8-15min) ===');
    const vidResults = await Promise.all(VIDEO_TASKS.map(runVeo));
    results.videos = VIDEO_TASKS.map((t, i) => ({ out: t.out, ok: vidResults[i] }));
  }

  log('=== DONE ===');
  log(JSON.stringify(results, null, 2));
})();
