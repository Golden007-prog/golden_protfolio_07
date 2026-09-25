#!/usr/bin/env node
// Precomputes the projects package's AI content into src/data/ai-generated/projects.json.
//
//   levels     ELI5, Recruiter and Engineer summaries for every project (claim-bearing)
//   compare    three quoted rows for each of the 45 project pairs; every cell is a
//              verbatim quote from that project's own fields, or it is dropped
//   questions  3-5 interview questions per featured project, each with the id and
//              quote its premise rests on (quoteOk + tripwire)
//   alt        alt text for each still and fallback image, and what each demo loop
//              shows, from the image itself (claim-bearing: vision can misdescribe UI)
//   vectors    semantic neighbours and interest rankings from ai-vectors.json, with
//              meanVector; no model call, so it runs without a key
//
// Every value passes the checks in src/lib/ai/prompts/projects.ts before it is
// saved; a rejected draft is retried once, then left out. Entries are hash-gated
// on their inputs, so unchanged ones are kept (with their review) and only new or
// changed sources cost a call. Claim-bearing entries start unreviewed and stay
// hidden in production until `npm run ai:review` approves them.
//
//   node --env-file-if-exists=.env scripts/ai/gen-projects.mjs [--only=levels,compare,questions,alt,vectors]
//        [--project=<slug>] [--force] [--delay=<ms between calls, default 4000>] [--dry-run]
//
// With no key the model kinds are skipped with a notice and the exit code is 0;
// on a 429 the progress so far is saved and the script exits 0.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT, VECTORS_PATH, apiKey, callGemini, loadCorpus, loadStore, newEntry, readJson, saveStore, stale } from './lib.mjs';
import {
  CLAIM_BEARING,
  COMPARE_DIMS,
  DEMO_MAX,
  KEYS,
  LEVELS,
  PROMPT_VERSION,
  TEXT_FIELDS,
  altPrompt,
  altSystem,
  checkAlt,
  checkLevelText,
  comparePrompt,
  compareSystem,
  hasFullStory,
  levelPrompt,
  levelSystem,
  pairOf,
  projectBlock,
  questionFactIds,
  questionsPrompt,
  questionsSystem,
  verifyCompareRows,
  vectorRankings,
  verifyQuestions,
} from '../../src/lib/ai/prompts/projects.ts';

const STORE = 'projects';
const KINDS = ['vectors', 'levels', 'questions', 'compare', 'alt'];

/* ---------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const force = flag('force');
const dryRun = flag('dry-run');
const delayMs = Math.max(0, Number(option('delay') ?? 4000) || 0);
const only = option('only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const unknownKinds = (only ?? []).filter((k) => !KINDS.includes(k));
if (unknownKinds.length) {
  console.error(`Unknown --only kind(s): ${unknownKinds.join(', ')}. Use ${KINDS.join(', ')}.`);
  process.exit(2);
}
const kinds = only?.length ? KINDS.filter((k) => only.includes(k)) : KINDS;

const { sources, chunks, entities } = loadCorpus();
const PROJECTS = sources.projects;
const onlyProject = option('project');
if (onlyProject && !PROJECTS.some((p) => p.slug === onlyProject)) {
  console.error(`Unknown --project ${onlyProject}.`);
  process.exit(2);
}
const inScope = (...slugs) => !onlyProject || slugs.includes(onlyProject);

/* ---------------------------------------------------------------------------
 * Store bookkeeping
 * ------------------------------------------------------------------------- */

const previous = loadStore(STORE).entries;
const entries = { ...previous };
const stats = { kept: 0, written: 0, rejected: 0, dropped: 0, calls: 0 };
const kindOf = (key) => key.split(':')[0];

/** The hash an entry is gated on: its kind's prompt version plus every input. */
function hashOf(kind, ...parts) {
  return createHash('sha256')
    .update(JSON.stringify([PROMPT_VERSION[kind] ?? 0, kind, ...parts]))
    .digest('hex')
    .slice(0, 16);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Saves a value; an identical value keeps the existing entry, and with it any review. */
function put(key, { hash, model, value }) {
  const old = entries[key];
  if (old && same(old.value, value)) {
    entries[key] = { ...old, hash };
    stats.kept += 1;
    return;
  }
  entries[key] = newEntry({ hash, model, value, claimBearing: CLAIM_BEARING[kindOf(key)] });
  stats.written += 1;
}

function drop(key, why) {
  if (!entries[key]) return;
  delete entries[key];
  stats.dropped += 1;
  console.log(`  dropped ${key} (${why})`);
}

/**
 * After a failed regeneration: an entry that describes an older source is removed;
 * one that is still current (a --force run) is kept.
 */
function failed(key, hash) {
  if (stale(entries[key], hash)) drop(key, 'regeneration failed');
}

function fresh(key, hash) {
  if (force || stale(entries[key], hash)) return false;
  stats.kept += 1;
  return true;
}

/** Keys the current data can still produce; anything else is an orphan. */
function validKey(key) {
  const slugs = new Set(PROJECTS.map((p) => p.slug));
  const [kind, rest = ''] = [kindOf(key), key.slice(key.indexOf(':') + 1)];
  switch (kind) {
    case 'level': {
      const [slug, level] = rest.split(':');
      return slugs.has(slug) && LEVELS.some((l) => l.id === level);
    }
    case 'compare': {
      const [x, y] = rest.split('~');
      return slugs.has(x) && slugs.has(y) && x < y;
    }
    case 'questions':
      return PROJECTS.some((p) => p.slug === rest && p.featured);
    case 'alt': {
      const [slug, which] = rest.split(':');
      return slugs.has(slug) && (which === 'still' || which === 'fallback');
    }
    case 'demo':
      return PROJECTS.some((p) => p.slug === rest && p.demoVideo);
    case 'neighbours':
      return slugs.has(rest);
    case 'interests':
      return key === KEYS.interests;
    default:
      return false;
  }
}

// Ends by letting the event loop drain rather than process.exit(): on Windows an
// exit while the SDK's keep-alive sockets close can abort in libuv (UV_HANDLE_CLOSING).
function finish(message) {
  for (const key of Object.keys(entries)) if (!validKey(key)) drop(key, 'orphan');
  if (!dryRun) saveStore(STORE, entries);
  const summary = `${stats.written} written, ${stats.kept} unchanged, ${stats.rejected} rejected, ${stats.dropped} dropped, ${stats.calls} model calls`;
  console.log(`${message ? `${message}\n` : ''}gen-projects: ${summary}${dryRun ? ' (dry run, nothing saved)' : ''}.`);
  process.exitCode = 0;
}

/* ---------------------------------------------------------------------------
 * Model calls
 * ------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

class QuotaSpent extends Error {}

/** One call, spaced by --delay; a spent quota stops the run (progress is saved). */
async function call(opts) {
  const wait = lastCall + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  stats.calls += 1;
  const res = await callGemini(opts);
  if (!res.ok && res.reason === 'quota') throw new QuotaSpent();
  return res;
}

/**
 * Generates with one retry: `check(data)` returns { value } to save or { reject }
 * with the reason, which the retry is told about.
 */
async function generate(label, opts, check) {
  let note = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call({ ...opts, prompt: `${opts.prompt}${note}` });
    if (!res.ok) {
      console.log(`  ${label}: ${res.reason}`);
      if (res.reason === 'no-key' || res.reason === 'safety') return null;
      continue;
    }
    const out = check(res.data);
    if (out.value !== undefined) return { value: out.value, model: res.model };
    stats.rejected += 1;
    console.log(`  ${label}: rejected (${out.reject})`);
    note = `\n\nA previous draft was rejected (${out.reject}). Write it again, strictly within the rules.`;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Kinds
 * ------------------------------------------------------------------------- */

const LevelSchema = z.object({ text: z.string() });

async function runLevels() {
  for (const p of PROJECTS) {
    if (!inScope(p.slug)) continue;
    for (const { id } of LEVELS) {
      const key = KEYS.level(p.slug, id);
      const hash = hashOf('level', id, projectBlock(p));
      if (fresh(key, hash)) continue;
      const got = await generate(key, { system: levelSystem(id, hasFullStory(p)), prompt: levelPrompt(p), schema: LevelSchema, maxOutputTokens: 1024 }, (data) => {
        const text = String(data.text ?? '').replace(/\s+/g, ' ').trim();
        const reject = checkLevelText(text, id, p, entities);
        return reject ? { reject } : { value: { text } };
      });
      if (got) put(key, { hash, model: got.model, value: got.value });
      else failed(key, hash);
    }
  }
}

const CompareSchema = z.object({
  rows: z
    .array(
      z.object({
        dim: z.enum(COMPARE_DIMS.map((d) => d.id)),
        a: z.object({ field: z.enum(TEXT_FIELDS), quote: z.string() }),
        b: z.object({ field: z.enum(TEXT_FIELDS), quote: z.string() }),
      }),
    )
    .max(COMPARE_DIMS.length),
});

async function runCompare() {
  for (let i = 0; i < PROJECTS.length; i++) {
    for (let j = i + 1; j < PROJECTS.length; j++) {
      const [x, y] = pairOf(PROJECTS[i].slug, PROJECTS[j].slug);
      if (!inScope(x, y)) continue;
      const a = PROJECTS.find((p) => p.slug === x);
      const b = PROJECTS.find((p) => p.slug === y);
      const key = KEYS.compare(x, y);
      const hash = hashOf('compare', projectBlock(a), projectBlock(b));
      if (fresh(key, hash)) continue;
      const got = await generate(key, { system: compareSystem(), prompt: comparePrompt(a, b), schema: CompareSchema, maxOutputTokens: 2048 }, (data) => {
        // Cells that are not verbatim become 'Not listed'; an all-empty table is a reject.
        const { rows, rejected } = verifyCompareRows(data.rows, a, b);
        if (rejected) console.log(`  ${key}: ${rejected} non-verbatim cell(s) set to Not listed`);
        return rows.some((r) => r.a || r.b) ? { value: { rows } } : { reject: 'no verbatim quotes' };
      });
      if (got) put(key, { hash, model: got.model, value: got.value });
      else failed(key, hash);
    }
  }
}

async function runQuestions() {
  for (const p of PROJECTS) {
    if (!p.featured || !inScope(p.slug)) continue;
    const facts = questionFactIds(p.slug)
      .map((id) => chunks.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => ({ id: c.id, text: c.text }));
    if (!facts.length) continue;
    const factMap = new Map(facts.map((f) => [f.id, f.text]));
    const key = KEYS.questions(p.slug);
    const hash = hashOf('questions', facts);
    if (fresh(key, hash)) continue;
    const schema = z.object({
      questions: z.array(z.object({ text: z.string(), evidence: z.object({ id: z.enum(facts.map((f) => f.id)), quote: z.string() }) })).max(8),
    });
    const got = await generate(key, { system: questionsSystem(), prompt: questionsPrompt(p, facts), schema, maxOutputTokens: 2048 }, (data) => {
      const items = (data.questions ?? []).map((q) => ({ text: q.text, evidence: [q.evidence] }));
      const { kept, dropped } = verifyQuestions(items, factMap, p, entities);
      if (dropped) console.log(`  ${key}: ${dropped} question(s) failed verification`);
      return kept.length >= 3 ? { value: { questions: kept } } : { reject: `${kept.length} verified question(s), need 3` };
    });
    if (got) put(key, { hash, model: got.model, value: got.value });
    else failed(key, hash);
  }
}

const AltSchema = z.object({ alt: z.string() });
const DemoSchema = z.object({ alt: z.string(), shows: z.string() });

function imagePart(publicPath) {
  const file = path.join(ROOT, 'public', publicPath.replace(/^\//, ''));
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mimeType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : null;
  if (!mimeType) return null;
  return { part: { inlineData: { mimeType, data: bytes.toString('base64') } }, sha: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
}

async function runAlt() {
  for (const p of PROJECTS) {
    if (!inScope(p.slug)) continue;
    const images = [
      { key: KEYS.alt(p.slug, 'still'), kind: 'still', src: p.thumbnail },
      { key: KEYS.alt(p.slug, 'fallback'), kind: 'fallback', src: p.fallbackThumbnail },
    ];
    if (p.demoVideo) images.push({ key: KEYS.demo(p.slug), kind: 'demo', src: p.demoVideo.replace(/[^/]+\.mp4$/, 'poster.webp') });
    for (const img of images) {
      const found = imagePart(img.src);
      if (!found) {
        drop(img.key, `no image at public${img.src}`);
        continue;
      }
      const hash = hashOf('alt', img.kind, found.sha, p.name, p.tagline, p.techStack);
      if (fresh(img.key, hash)) continue;
      const demo = img.kind === 'demo';
      const got = await generate(
        img.key,
        { system: altSystem(img.kind), prompt: altPrompt(p), parts: [found.part], schema: demo ? DemoSchema : AltSchema, maxOutputTokens: 1024 },
        (data) => {
          const text = String((demo ? data.shows : data.alt) ?? '').replace(/\s+/g, ' ').trim();
          const reject = checkAlt(text, p, entities, demo ? DEMO_MAX : undefined);
          return reject ? { reject } : { value: { text } };
        },
      );
      if (got) put(img.key, { hash, model: got.model, value: got.value });
      else failed(img.key, hash);
    }
  }
}

/** Neighbours and interest rankings from the committed chunk vectors; no model call. */
function runVectors() {
  const file = readJson(VECTORS_PATH, { model: null, dims: 768, entries: {} });
  const vectorKeys = [...PROJECTS.map((p) => KEYS.neighbours(p.slug)), KEYS.interests];
  const ranked = vectorRankings(file, chunks, PROJECTS);
  if (!ranked) {
    for (const key of vectorKeys) drop(key, 'no vectors');
    console.log('vectors: ai-vectors.json has no current vectors for two or more projects (run `npm run ai:embed`); neighbours and interest chips stay hidden.');
    return;
  }
  const projectChunks = chunks.filter((c) => c.id.startsWith('project:'));
  const hash = hashOf('vectors', file.model, projectChunks.map((c) => [c.id, c.hash, file.entries[c.id]?.hash === c.hash]));
  for (const p of PROJECTS) {
    const key = KEYS.neighbours(p.slug);
    const value = ranked.neighbours[p.slug];
    if (!value) drop(key, 'no vector');
    else if (!fresh(key, hash)) put(key, { hash, model: file.model, value });
  }
  if (!Object.keys(ranked.interests).length) drop(KEYS.interests, 'no seeds with vectors');
  else if (!fresh(KEYS.interests, hash)) put(KEYS.interests, { hash, model: file.model, value: ranked.interests });
}

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------- */

const RUNNERS = { levels: runLevels, compare: runCompare, questions: runQuestions, alt: runAlt };

async function main() {
  if (kinds.includes('vectors')) runVectors();

  const modelKinds = kinds.filter((k) => k !== 'vectors');
  if (modelKinds.length && !apiKey()) return finish(`skipped: no key (GOOGLE_AI_API_KEY). Not generated: ${modelKinds.join(', ')}.`);

  try {
    for (const kind of modelKinds) {
      console.log(`\n${kind}`);
      await RUNNERS[kind]();
      if (!dryRun) saveStore(STORE, entries);
    }
  } catch (err) {
    if (err instanceof QuotaSpent) return finish('Quota reached (429). Progress so far is saved; run again later to continue.');
    throw err;
  }
  return finish();
}

await main();
