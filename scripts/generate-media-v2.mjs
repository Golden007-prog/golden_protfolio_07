// Phase: fill missing media gaps — all images use imagen-4.0-ultra-generate-001
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf-8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const API_KEY = env.GOOGLE_AI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ULTRA = 'imagen-4.0-ultra-generate-001';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
ensureDir(resolve(ROOT, 'public/images'));
ensureDir(resolve(ROOT, 'public/videos'));

const IMAGE_TASKS = [
  { out: 'public/images/about-workspace.webp', aspect: '16:9',
    prompt: 'Photorealistic wide shot of a futuristic data science workspace, multiple holographic displays showing neural network visualizations and code, dark ambient lighting with purple and cyan neon accents, volumetric fog, cinematic depth of field, ultrawide composition, 4K quality, no people, no text' },
  { out: 'public/images/skills-neural.webp', aspect: '16:9',
    prompt: 'Abstract visualization of artificial intelligence neural pathways, interconnected glowing nodes in electric violet and cyan on deep black background, digital synapses firing, macro photography style, hyper-detailed, 4K resolution, no text' },
  { out: 'public/images/footer-texture.webp', aspect: '16:9',
    prompt: 'Subtle dark abstract texture with barely visible geometric grid lines and faint violet glow points, extremely dark, almost black, minimal, seamless, no text' },
  { out: 'public/images/project-thumb-5.webp', aspect: '16:9',
    prompt: 'Futuristic machine learning dashboard visualization, abstract data flowing through neural network layers, dark background with glowing violet and cyan data streams, cinematic, no text' },
  { out: 'public/images/project-thumb-6.webp', aspect: '16:9',
    prompt: 'Modern web application interface floating in dark 3D space, glassmorphism UI with violet accents, holographic display, cinematic lighting, no text' },
  { out: 'public/images/project-thumb-7.webp', aspect: '16:9',
    prompt: 'Abstract data visualization dashboard, flowing data streams and charts in 3D space, dark theme with cyan and violet glowing elements, depth of field, no text' },
  { out: 'public/images/project-thumb-8.webp', aspect: '16:9',
    prompt: 'Futuristic cloud infrastructure visualization, interconnected server nodes and containers floating in dark space, blue and violet neon connections, cinematic, no text' },
  { out: 'public/images/project-thumb-9.webp', aspect: '16:9',
    prompt: 'Abstract LLM agent orchestration visualization, interconnected AI agents as glowing orbs with data links, dark cosmic background, violet-cyan palette, no text' },
  { out: 'public/images/project-thumb-10.webp', aspect: '16:9',
    prompt: 'Abstract retrieval augmented generation concept, floating documents feeding into a glowing vector space, deep black background, violet and teal accents, no text' },
];

const VIDEO_TASKS = [
  { out: 'public/videos/skills-bg.mp4',
    prompt: 'Abstract macro shot of neural network connections forming and dissolving, glowing violet and cyan nodes pulsing with energy, dark void background, organic flowing motion, bioluminescent deep sea aesthetic, extremely smooth motion. No text, no people.' },
  { out: 'public/videos/contact-bg.mp4',
    prompt: 'Gently floating holographic envelopes and message bubbles drifting through dark space, soft violet and teal rim lighting, bokeh particles, dreamlike slow motion, cinematic dark atmosphere. No text, no people.' },
];

async function runImagen(task) {
  if (existsSync(resolve(ROOT, task.out))) { log('skip (exists)', task.out); return true; }
  const res = await fetch(`${BASE}/models/${ULTRA}:predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ instances: [{ prompt: task.prompt }], parameters: { sampleCount: 1, aspectRatio: task.aspect, personGeneration: 'dont_allow' } }),
  });
  const text = await res.text();
  if (!res.ok) { log('imagen FAIL', task.out, res.status, text.slice(0, 200)); return false; }
  const b64 = JSON.parse(text)?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) { log('imagen no data', task.out, text.slice(0, 200)); return false; }
  writeFileSync(resolve(ROOT, task.out), Buffer.from(b64, 'base64'));
  log('imagen ✓', task.out);
  return true;
}

async function runVeo(task) {
  if (existsSync(resolve(ROOT, task.out))) { log('skip (exists)', task.out); return true; }
  const startRes = await fetch(`${BASE}/models/veo-3.1-generate-preview:predictLongRunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ instances: [{ prompt: task.prompt }], parameters: { aspectRatio: '16:9', durationSeconds: 8 } }),
  });
  const startText = await startRes.text();
  if (!startRes.ok) { log('veo start FAIL', task.out, startRes.status, startText.slice(0, 300)); return false; }
  const opName = JSON.parse(startText).name;
  log('veo started', task.out, opName);
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 15000));
    const r = await fetch(`${BASE}/${opName}`, { headers: { 'x-goog-api-key': API_KEY } });
    if (!r.ok) continue;
    const op = await r.json();
    if (op.done) {
      if (op.error) { log('veo error', task.out, JSON.stringify(op.error).slice(0, 200)); return false; }
      const samples = op?.response?.generateVideoResponse?.generatedSamples || op?.response?.generatedSamples || op?.response?.videos;
      const uri = samples?.[0]?.video?.uri || samples?.[0]?.uri;
      if (!uri) { log('veo no uri', task.out); return false; }
      const dl = uri.includes('?') ? `${uri}&key=${API_KEY}` : `${uri}?key=${API_KEY}`;
      const vr = await fetch(dl);
      if (!vr.ok) { log('veo dl FAIL', vr.status); return false; }
      writeFileSync(resolve(ROOT, task.out), Buffer.from(await vr.arrayBuffer()));
      log('veo ✓', task.out);
      return true;
    }
    log('veo polling', task.out, Math.round((Date.now() - started) / 1000) + 's');
  }
  log('veo TIMEOUT', task.out);
  return false;
}

(async () => {
  const mode = process.argv[2] || 'all';
  if (mode === 'all' || mode === 'images') {
    log('=== IMAGES (ultra) ===');
    // Serialize to avoid rate limits on ultra model
    const results = [];
    for (const t of IMAGE_TASKS) results.push(await runImagen(t));
    log('images done', results.filter(Boolean).length + '/' + results.length);
  }
  if (mode === 'all' || mode === 'videos') {
    log('=== VIDEOS ===');
    const r = await Promise.all(VIDEO_TASKS.map(runVeo));
    log('videos done', r.filter(Boolean).length + '/' + r.length);
  }
  log('=== DONE ===');
})();
