// Regenerate just skills-bg-light.mp4 with a tighter no-spheres prompt.
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

const TASK = {
  out: 'public/videos/skills-bg-light.mp4',
  prompt:
    'Flat 2D vector line-art illustration of a neural network on a plain warm off-white paper background. Extremely thin hairline strokes in dusty ink-blue and muted lavender connecting tiny dot nodes in a wide sparse grid. Slow gentle parallax drift only. Editorial minimal technical illustration, completely flat, no depth, no shading, no rendering. ABSOLUTELY NO 3D spheres, NO balls, NO orbs, NO marbles, NO shiny objects, NO chrome, NO glass, NO bokeh, NO blur, NO people, NO text, NO logos.',
};

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
  log('veo OK', outPath, (buf.length / 1024 / 1024).toFixed(1) + 'MB');
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
  log('=== VEO 3.1 FAST — SKILLS LIGHT REGEN (no spheres) ===');
  const ok = await runVeo(TASK);
  log('=== DONE ===', ok);
})();
