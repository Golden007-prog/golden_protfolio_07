// Generates rich skill documentation JSON + hero images.
// Uses Gemini 2.5 Flash with google_search grounding for fresh content,
// Imagen 4 Fast for batch images, Ultra for featured skills.
//
// Run:  node scripts/generate-skill-data.mjs

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
if (!API_KEY) throw new Error('GOOGLE_AI_API_KEY missing from .env');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROUND_MODEL = 'gemini-2.5-flash';
const IMG_ULTRA = 'imagen-4.0-ultra-generate-001';
const IMG_FAST = 'imagen-4.0-fast-generate-001';

const FEATURED = new Set([
  'LangChain', 'RAG', 'PyTorch', 'FAISS', 'Gemini',
  'Python', 'AWS Lambda', 'GCP', 'Scikit-learn', 'TensorFlow',
]);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
ensureDir(resolve(ROOT, 'public/skills'));
ensureDir(resolve(ROOT, 'src/data'));

const profile = JSON.parse(readFileSync(resolve(ROOT, 'src/data/profile.json'), 'utf-8'));
const ALL_SKILLS = profile.skills; // { category: [names] }

async function generateContent(name, category) {
  const prompt = `Generate comprehensive technical documentation for "${name}" in the context of ${category}.

Return ONLY a valid JSON object (no markdown fences) with EXACTLY these fields:
{
  "shortDef": "One sentence under 25 words. Begin with '<b>${name}</b> is...'",
  "purpose": "2-3 sentences explaining what problem it solves and why it matters",
  "coreComponents": ["component 1", "component 2", "component 3", "component 4"],
  "keyCapabilities": ["capability 1", "capability 2", "capability 3", "capability 4", "capability 5"],
  "integrations": ["integration 1", "integration 2", "integration 3", "integration 4"],
  "useCases": ["real world use case 1", "use case 2", "use case 3"],
  "officialDocs": "https://...",
  "researchPapers": [{"title": "Paper title exactly as published", "url": "https://arxiv.org/abs/<id> or https://doi.org/<doi>"}]
}

Use Google Search to find CURRENT official documentation URLs and recent research papers from arxiv.org or major conferences. Cite each paper by its arXiv abstract URL or its DOI URL, with the title exactly as that page shows it, and no authors. Only include real URLs. No commentary, JSON only.`;

  const res = await fetch(`${BASE}/models/${GROUND_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  const text = await res.text();
  if (!res.ok) { log('content FAIL', name, res.status, text.slice(0, 200)); return {}; }
  const data = JSON.parse(text);
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const sources = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web?.uri).filter(Boolean);

  // Extract JSON from possibly fenced response
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1];
  // Find first { to last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(cleaned);
    return { ...parsed, sources };
  } catch {
    log('content PARSE FAIL', name, cleaned.slice(0, 150));
    return { sources };
  }
}

async function generateImage(name, category) {
  const filename = `${slug(name)}.webp`;
  const outPath = resolve(ROOT, 'public/skills', filename);
  if (existsSync(outPath)) { log('skip img (exists)', filename); return `/skills/${filename}`; }

  const model = FEATURED.has(name) ? IMG_ULTRA : IMG_FAST;
  const prompt = `Abstract futuristic visualization representing "${name}" in ${category}, dark theme with violet and cyan neon accents, glowing holographic elements, depth of field, cinematic lighting, 16:9 composition, 4K quality, no text, no people`;

  const res = await fetch(`${BASE}/models/${model}:predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'dont_allow' },
    }),
  });
  const text = await res.text();
  if (!res.ok) { log('img FAIL', name, res.status, text.slice(0, 160)); return ''; }
  const b64 = JSON.parse(text)?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) { log('img no data', name); return ''; }
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
  log('img ✓', filename, FEATURED.has(name) ? '(ultra)' : '(fast)');
  return `/skills/${filename}`;
}

async function processSkill(name, category) {
  log('→', category, '·', name);
  const [content, heroImage] = await Promise.all([
    generateContent(name, category),
    generateImage(name, category),
  ]);
  return {
    name,
    category,
    shortDef: content.shortDef || '',
    purpose: content.purpose || '',
    coreComponents: content.coreComponents || [],
    keyCapabilities: content.keyCapabilities || [],
    integrations: content.integrations || [],
    useCases: content.useCases || [],
    officialDocs: content.officialDocs || '',
    // Titles and links only: the model's author lines were invented. verify-skill-papers.mjs
    // fills authors from the registry and drops links that open a different paper.
    researchPapers: (content.researchPapers || []).map(({ title, url }) => ({ title, url })),
    relatedRepos: [],
    heroImage,
    sources: content.sources || [],
  };
}

(async () => {
  const outPath = resolve(ROOT, 'src/data/skills-detailed.json');
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : [];
  const done = new Set(existing.map((s) => s.name));
  const results = [...existing];

  // Build flat work list
  const work = [];
  for (const [cat, items] of Object.entries(ALL_SKILLS)) {
    for (const name of items) {
      if (!done.has(name)) work.push({ name, category: cat });
    }
  }
  log(`=== ${work.length} skills to process (${done.size} cached) ===`);

  // Process in batches of 3 to respect rate limits
  const BATCH = 3;
  for (let i = 0; i < work.length; i += BATCH) {
    const batch = work.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map((s) => processSkill(s.name, s.category)));
    results.push(...batchResults);
    // Persist incrementally
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    log(`saved ${results.length}/${results.length + work.length - i - batch.length} so far`);
    if (i + BATCH < work.length) await new Promise((r) => setTimeout(r, 2500));
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  log(`=== DONE: ${results.length} skills in src/data/skills-detailed.json ===`);
  log('next: node scripts/verify-skill-papers.mjs --write && npm run skills:index');
})();
