// Shared helpers for the AI build scripts (corpus, embeddings, generators, review).
// Run them with `node --env-file-if-exists=.env`; the key is read from
// GOOGLE_AI_API_KEY and never printed. Errors are reported by class and HTTP
// status only: never a URL (the SDK can put the key in one) or a raw error body.
//
// With no key, or on a 429, generators exit 0 with a notice (see exitSoft), so a
// keyless CI run or an exhausted free tier never fails a build.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_COPY } from '../../src/data/site-copy.ts';
import { parseAchievements } from '../../src/lib/achievements.ts';
import { buildCorpus, entities } from '../../src/lib/ai/corpus.ts';
import { parseCertifications } from '../../src/lib/certifications.ts';

export { BANNED_PHRASES, bannedPhrase, faithful } from '../../src/lib/ai/verify.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'src/data');
export const STORE_DIR = path.join(DATA_DIR, 'ai-generated');
export const CORPUS_PATH = path.join(DATA_DIR, 'ai-corpus.json');
export const VECTORS_PATH = path.join(DATA_DIR, 'ai-vectors.json');
export const EMBED_DIMS = 768;

export function readJson(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${path.relative(ROOT, file)}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/* ---------------------------------------------------------------------------
 * Models: parsed from src/lib/ai/config.server.ts, the one place model ids live.
 * (That module imports 'server-only', which throws outside Next, so it cannot be
 * imported here.) AI_MODEL_PRIMARY / AI_MODEL_FALLBACK override, as in the app.
 * ------------------------------------------------------------------------- */

function modelDefaults() {
  const src = readFileSync(path.join(ROOT, 'src/lib/ai/config.server.ts'), 'utf8');
  const pick = (name) => new RegExp(`const ${name} = '([a-z0-9.-]+)'`, 'i').exec(src)?.[1];
  const embed = /const EMBED_CANDIDATES = \[([^\]]*)\]/.exec(src)?.[1]?.match(/'([a-z0-9.-]+)'/gi)?.map((s) => s.slice(1, -1));
  const primary = pick('DEFAULT_PRIMARY');
  const fallback = pick('DEFAULT_FALLBACK');
  if (!primary || !fallback || !embed?.length) throw new Error('Could not read the model ids from src/lib/ai/config.server.ts');
  return { primary, fallback, embed };
}

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/i;
const defaults = modelDefaults();
// A pasted key would otherwise be sent as a model id and saved in store entries.
const pinned = (value, fallback) => (value && MODEL_ID.test(value) && !/^aiza/i.test(value) && !/-latest$/i.test(value) ? value : fallback);

export const MODELS = {
  primary: pinned(process.env.AI_MODEL_PRIMARY?.trim(), defaults.primary),
  fallback: pinned(process.env.AI_MODEL_FALLBACK?.trim(), defaults.fallback),
  embedCandidates: defaults.embed,
};

/** Mirrors modelPolicy.thinkingFor: MINIMAL only on Flash-Lite, where it is valid. */
export function thinkingFor(model) {
  return /flash-lite/i.test(model) ? 'MINIMAL' : 'LOW';
}

/* ---------------------------------------------------------------------------
 * Gemini client
 * ------------------------------------------------------------------------- */

export function apiKey() {
  return process.env.GOOGLE_AI_API_KEY?.trim() || undefined;
}

let client;
async function genai() {
  const key = apiKey();
  if (!key) return null;
  const sdk = await import('@google/genai');
  client ??= new sdk.GoogleGenAI({ apiKey: key });
  return { ai: client, sdk };
}

function statusOf(err) {
  return typeof err?.status === 'number' ? err.status : null;
}

function describe(err) {
  const status = statusOf(err);
  return `${err instanceof Error ? err.name : typeof err}${status ? ` ${status}` : ''}`;
}

function reasonFor(status) {
  return status === 429 ? 'quota' : 'upstream';
}

function safety(sdk) {
  return [
    sdk.HarmCategory.HARM_CATEGORY_HARASSMENT,
    sdk.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    sdk.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    sdk.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  ].map((category) => ({ category, threshold: sdk.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));
}

async function jsonSchemaOf(schema) {
  if (!schema) return undefined;
  if (typeof schema.safeParse === 'function') {
    const { z } = await import('zod');
    return z.toJSONSchema(schema);
  }
  return schema;
}

/**
 * One generateContent call. Without `model` it tries the cheap tier (the lite
 * model, then the primary on 429/503). Returns
 *   { ok: true, model, text, data?, usage } or
 *   { ok: false, reason: 'no-key' | 'quota' | 'upstream' | 'safety' | 'unverified', status? }.
 * A zod `schema` is sent as responseJsonSchema and the reply is safeParse'd; a
 * plain JSON Schema object is sent as-is and the reply only JSON-parsed.
 */
export async function callGemini({ model, system, prompt, parts, schema, maxOutputTokens = 2048 }) {
  const g = await genai();
  if (!g) return { ok: false, reason: 'no-key' };
  const { ai, sdk } = g;
  const order = model ? [model] : [MODELS.fallback, MODELS.primary];
  const responseJsonSchema = await jsonSchemaOf(schema);
  const contents = [{ role: 'user', parts: [{ text: prompt }, ...(parts ?? [])] }];
  let last = { ok: false, reason: 'upstream' };
  for (const m of order) {
    const config = {
      systemInstruction: system,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel: sdk.ThinkingLevel[thinkingFor(m)] },
      safetySettings: safety(sdk),
      automaticFunctionCalling: { disable: true },
    };
    if (responseJsonSchema !== undefined) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = responseJsonSchema;
    }
    try {
      const res = await ai.models.generateContent({ model: m, contents, config });
      const cand = res.candidates?.[0];
      if (res.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(cand?.finishReason ?? '')) {
        return { ok: false, reason: 'safety' };
      }
      const text = (cand?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
      const usage = res.usageMetadata
        ? { input: res.usageMetadata.promptTokenCount ?? 0, output: res.usageMetadata.candidatesTokenCount ?? 0, thoughts: res.usageMetadata.thoughtsTokenCount ?? 0 }
        : undefined;
      if (!schema) return { ok: true, model: m, text, usage };
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, reason: 'unverified' };
      }
      if (typeof schema.safeParse === 'function') {
        const parsed = schema.safeParse(json);
        if (!parsed.success) return { ok: false, reason: 'unverified' };
        json = parsed.data;
      }
      return { ok: true, model: m, text, data: json, usage };
    } catch (err) {
      const status = statusOf(err);
      console.warn(`[ai] ${m} failed: ${describe(err)}`);
      last = { ok: false, reason: reasonFor(status), ...(status ? { status } : {}) };
      if (status !== 429 && status !== 503) return last;
    }
  }
  return last;
}

/**
 * Document or query embeddings, one Content per text (a plain string list comes
 * back as one aggregated vector). The prefixes match aiEmbed in gemini.server.ts
 * exactly; taskType is never sent. Returns { ok: true, vectors: Float32Array[] }
 * or { ok: false, reason, status? }.
 */
export async function embedTexts(texts, { model, kind = 'document', titles } = {}) {
  const g = await genai();
  if (!g) return { ok: false, reason: 'no-key' };
  const contents = texts.map((text, i) => ({
    parts: [{ text: kind === 'query' ? `task: search result | query: ${text}` : `title: ${titles?.[i]?.trim() || 'none'} | text: ${text}` }],
  }));
  try {
    const res = await g.ai.models.embedContent({ model, contents, config: { outputDimensionality: EMBED_DIMS } });
    const vectors = (res.embeddings ?? []).map((e) => Float32Array.from(e.values ?? []));
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBED_DIMS)) {
      return { ok: false, reason: 'upstream' };
    }
    return { ok: true, vectors };
  } catch (err) {
    const status = statusOf(err);
    console.warn(`[ai] embed ${model} failed: ${describe(err)}`);
    return { ok: false, reason: status === 404 ? 'not-found' : reasonFor(status), ...(status ? { status } : {}) };
  }
}

/** Prints the notice and exits 0: used for a missing key or an exhausted quota. */
export function exitSoft(message) {
  console.log(message);
  process.exit(0);
}

/* ---------------------------------------------------------------------------
 * Corpus
 * ------------------------------------------------------------------------- */

export function loadSources() {
  const read = (name) => readJson(path.join(DATA_DIR, name));
  return {
    profile: read('profile.json'),
    projects: read('projects.json'),
    githubFacts: read('github-facts.json'),
    reading: read('reading.json'),
    tools: read('tools.json'),
    skillsIndex: read('skills-index.json'),
    liveSnapshot: readJson(path.join(DATA_DIR, 'live-snapshot.json'), null),
    siteCopy: SITE_COPY,
    // Parsed, so a malformed credential or result fails the corpus build instead of reaching a prompt.
    certifications: parseCertifications(read('certifications.json')),
    achievements: parseAchievements(read('achievements.json')),
  };
}

/** The corpus built fresh from src/data, exactly as the server builds it. */
export function loadCorpus() {
  const sources = loadSources();
  const chunks = buildCorpus(sources);
  return {
    sources,
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    entities: entities({
      profile: sources.profile,
      projects: sources.projects,
      skills: sources.skillsIndex,
      reading: sources.reading,
      certifications: sources.certifications,
      achievements: sources.achievements,
    }),
  };
}

/* ---------------------------------------------------------------------------
 * Precomputed stores: src/data/ai-generated/<name>.json = { version: 1, entries }
 * ------------------------------------------------------------------------- */

const STORE_NAME = /^[a-z][a-z0-9-]*$/;

function storePath(name, dir = STORE_DIR) {
  if (!STORE_NAME.test(name)) throw new Error(`Bad store name: ${name}`);
  return path.join(dir, `${name}.json`);
}

export function loadStore(name, dir = STORE_DIR) {
  const store = readJson(storePath(name, dir), { version: 1, entries: {} });
  return store && typeof store.entries === 'object' && store.entries ? store : { version: 1, entries: {} };
}

/** Writes the store with its keys sorted, so regenerating produces a stable diff. */
export function saveStore(name, entries, dir = STORE_DIR) {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
  writeJson(storePath(name, dir), { version: 1, entries: sorted });
}

/** True when there is no entry or it was generated from a different source hash. */
export function stale(entry, hash) {
  return !entry || entry.hash !== hash;
}

/** A store entry in the shape reviewGate.ts reads; claim-bearing entries start unreviewed. */
export function newEntry({ hash, model, value, claimBearing }) {
  return { hash, model, generatedAt: new Date().toISOString(), reviewed: false, claimBearing: Boolean(claimBearing), value };
}
