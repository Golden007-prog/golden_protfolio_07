// Light-mode background videos via Veo 3.1 FAST preview
// Outputs: public/videos/*-light.mp4
// Reads GOOGLE_AI_API_KEY from .env

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf-8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const API_KEY = env.GOOGLE_AI_API_KEY || env.VITE_GEMINI_API_KEY;
if (!API_KEY) throw new Error('GOOGLE_AI_API_KEY missing in .env');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'veo-3.1-fast-generate-preview';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
ensureDir(resolve(ROOT, 'public/videos'));

const VIDEO_TASKS = [
  {
    out: 'public/videos/hero-bg-light.mp4',
    prompt:
      'Soft pastel aurora drifting across a warm ivory cream background, gentle lavender and powder-blue ribbons, delicate pale-peach light bokeh, extreme slow motion, airy editorial feel, minimal, bright and clean, cinematic depth of field, seamless loop feel. No text, no people, no logos.',
  },
  {
    out: 'public/videos/skills-bg-light.mp4',
    prompt:
      'Minimal line-art neural network on a warm off-white paper background, thin ink-blue and dusty-violet lines connecting soft nodes, subtle graphite grain, slow parallax drift, editorial technical illustration aesthetic, airy and bright. No text, no people.',
  },
  {
    out: 'public/videos/contact-bg-light.mp4',
    prompt:
      'Floating origami-style paper envelopes and soft message bubbles drifting through a bright cream gallery space, warm natural light, pastel lavender and sage-teal accents, shallow depth of field, gentle slow motion, minimal Scandinavian editorial feel. No text, no people, no logos.',
  },
];

async function startVeo(task) {
  const url = `${BASE}/models/${MODEL}:predictLongRunning`;
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
  if (!res.ok) {
    log('veo start FAIL', task.out, res.status, text.slice(0, 500));
    return null;
  }
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
  const samples =
    op?.response?.generateVideoResponse?.generatedSamples ||
    op?.response?.generatedSamples ||
    op?.response?.videos;
  const uri = samples?.[0]?.video?.uri || samples?.[0]?.uri;
  if (!uri) {
    log('veo no uri', JSON.stringify(op.response).slice(0, 500));
    return false;
  }
  const dl = uri.includes('?') ? `${uri}&key=${API_KEY}` : `${uri}?key=${API_KEY}`;
  const r = await fetch(dl);
  if (!r.ok) {
    log('veo dl FAIL', r.status);
    return false;
  }
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
    await new Promise((r) => setTimeout(r, 15000));
    const op = await pollVeo(opName);
    if (op.done) {
      if (op.error) {
        log('veo error', task.out, JSON.stringify(op.error).slice(0, 400));
        return false;
      }
      return downloadVeoVideo(op, task.out);
    }
    log('veo polling', task.out, Math.round((Date.now() - started) / 1000) + 's');
  }
  log('veo TIMEOUT', task.out);
  return false;
}

(async () => {
  log('=== VEO 3.1 FAST — LIGHT-MODE VIDEOS (parallel, ~3-8min each) ===');
  const results = await Promise.all(VIDEO_TASKS.map(runVeo));
  log('=== DONE ===');
  log(JSON.stringify(VIDEO_TASKS.map((t, i) => ({ out: t.out, ok: results[i] })), null, 2));
})();
