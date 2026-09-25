#!/usr/bin/env node
// Precomputes the skills package's AI content into src/data/ai-generated/skills.json:
//
//   summary:<slug>   2-3 sentences on where a skill appears on the site, written only
//                    from its evidence (projects whose stack lists it, role lines that
//                    name it). Claim-bearing: hidden in production until approved with
//                    `npm run ai:review`. Skills with no evidence get no summary; the
//                    modal's rule copy covers them.
//   explain:<slug>   three plain-English sentences rewritten from the generic write-up's
//                    purpose and key capabilities (public/data/skills/<slug>.json). About
//                    the technology, not about him, so not claim-bearing.
//   gallery:<nn-id>  "Where lexicons break": illustrative sentences scored with the live
//                    /api/ai/sentiment prompt and gate. Not claim-bearing.
//
// Every output is checked before it is saved: numbers and names must come from the
// source (faithful), no inflation words (bannedPhrase plus a list of judgements of
// skill), and the claim tripwire (employers, certifications, the Master's, years of
// experience). A failed item is left out and retried on the next run. Entries are
// hash-gated: an unchanged source keeps its entry, including its review.
//
//   node --env-file-if-exists=.env scripts/ai/gen-skills.mjs [--force] [--dry] [--only=summary,explain,gallery] [--delay=ms]
//
// --dry checks the inputs and prints the plan without calling Gemini or writing.
// With no key, or on a 429, it saves what it has and exits 0 with a notice.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AI_BUDGETS } from '../../src/lib/ai/config.ts';
import { newCanary } from '../../src/lib/ai/prompts/base.ts';
import { SENTIMENT_PROMPT_VERSION, sentimentSystem, sentimentUserTurn, sentimentVerdictSchema } from '../../src/lib/ai/prompts/sentiment.ts';
import { evidenceIds, experienceEvidence, finalizeVerdict, namesPhrase, sentencesOf } from '../../src/lib/ai/spans.ts';
import { tripwire } from '../../src/lib/ai/verify.ts';
import { analyze } from '../../src/lib/sentiment.ts';
import { slugify } from '../../src/lib/slug.ts';
import { matchesTech } from '../../src/lib/tech.ts';
import { apiKey, bannedPhrase, callGemini, exitSoft, faithful, loadCorpus, loadStore, MODELS, newEntry, ROOT, saveStore, stale } from './lib.mjs';

const STORE = 'skills';
const SUMMARY_VERSION = 1;
const EXPLAIN_VERSION = 1;
const SUMMARY_BATCH = 8;
const EXPLAIN_BATCH = 10;
const KINDS = ['summary', 'explain', 'gallery'];

/* ---------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const out = { force: false, dry: false, only: new Set(KINDS), delay: 2500 };
  for (const a of argv) {
    if (a === '--force') out.force = true;
    else if (a === '--dry') out.dry = true;
    else if (a.startsWith('--only=')) {
      const kinds = a.slice(7).split(',').map((k) => k.trim()).filter(Boolean);
      const bad = kinds.filter((k) => !KINDS.includes(k));
      if (bad.length || !kinds.length) fail(`--only takes a comma list of ${KINDS.join(', ')}`);
      out.only = new Set(kinds);
    } else if (a.startsWith('--delay=')) {
      const ms = Number(a.slice(8));
      if (!Number.isFinite(ms) || ms < 0) fail('--delay takes milliseconds');
      out.delay = ms;
    } else fail(`Unknown argument: ${a}`);
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
 * Sources
 * ------------------------------------------------------------------------- */

const corpus = loadCorpus();
const { profile, projects } = corpus.sources;
const entities = corpus.entities;

const SKILLS = Object.entries(profile.skills).flatMap(([category, names]) => names.map((name) => ({ name, category, slug: slugify(name) })));

function projectSlug(p) {
  return p.slug || slugify(p.name);
}

/** The deterministic evidence for one skill, exactly as the modal computes it. */
function evidenceFor(skill) {
  const using = projects.filter((p) => matchesTech(p.techStack, skill.name));
  const roles = experienceEvidence(profile.experience, skill.name);
  const ids = evidenceIds(using.map(projectSlug), roles);
  const lines = [`Skill: ${skill.name}`, `Listed in his skills under: ${skill.category}`];
  if (using.length) {
    lines.push(`Projects on the site whose tech stack lists ${skill.name}:`);
    for (const p of using) lines.push(`- Project name: ${p.name}. Tagline: ${p.tagline ?? ''}`.trim());
  } else lines.push(`No project on the site lists ${skill.name}.`);
  if (roles.length) {
    lines.push(`Roles on the site whose text names ${skill.name}:`);
    for (const r of roles) {
      lines.push(`- Role: ${r.role}. Organisation: ${r.company}. Refer to it as: ${r.role} at ${r.company}.`);
      for (const l of r.lines) lines.push(`  Line: ${l}`);
    }
  }
  const sources = [
    ...using.map((p) => `project:${projectSlug(p)}#tagline`),
    ...roles.map((r) => `exp:${r.index}`),
  ].filter((id) => corpus.byId.has(id));
  return { ids, source: lines.join('\n'), sources, empty: ids.length === 0 };
}

function writeUpFor(skill) {
  const file = path.join(ROOT, 'public/data/skills', `${skill.slug}.json`);
  if (!existsSync(file)) return null;
  const w = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof w.purpose !== 'string' || !w.purpose.trim()) return null;
  const caps = Array.isArray(w.keyCapabilities) ? w.keyCapabilities.filter((c) => typeof c === 'string') : [];
  return { purpose: w.purpose.trim(), keyCapabilities: caps, source: [`Technology: ${skill.name}`, `Purpose: ${w.purpose.trim()}`, 'Key capabilities:', ...caps.map((c) => `- ${c}`)].join('\n') };
}

/* ---------------------------------------------------------------------------
 * Output checks
 * ------------------------------------------------------------------------- */

// Judgements of how good he is. Allowed only where the source itself says them.
const EVALUATIVE = [
  'expert', 'expertise', 'proficient', 'proficiency', 'skilled', 'skillful', 'mastery', 'mastered', 'adept', 'strong', 'deep',
  'deeply', 'extensive', 'extensively', 'advanced', 'solid', 'excellent', 'exceptional', 'impressive', 'seasoned', 'veteran',
  'versatile', 'fluent', 'fluency', 'in-depth', 'thorough', 'significant', 'substantial', 'cutting-edge', 'state-of-the-art',
  'world-class', 'passionate', 'hands-on',
];
const COUNT_WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'dozen', 'several', 'numerous', 'multiple', 'many', 'various'];

const wordRe = (w) => new RegExp(`(?<![A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[\\s-]')}(?![A-Za-z0-9])`, 'i');

function firstUnsourced(words, output, source) {
  return words.find((w) => wordRe(w).test(output) && !wordRe(w).test(source)) ?? null;
}

function checkSummary(text, skill, ev) {
  const sentences = sentencesOf(text);
  if (sentences.length < 2 || sentences.length > 3) return `sentences:${sentences.length}`;
  if (text.length > 640) return 'too-long';
  if (!namesPhrase(text, skill.name)) return 'skill-not-named';
  if (/\bcertif|\bdegree\b|\bmaster['’]?s\b/i.test(text)) return 'credential';
  return (
    faithful(text, ev.source, entities) ??
    bannedPhrase(text, ev.source) ??
    tripwire(text, [ev.source], entities) ??
    (firstUnsourced(EVALUATIVE, text, ev.source) ? `evaluative:${firstUnsourced(EVALUATIVE, text, ev.source)}` : null) ??
    (firstUnsourced(COUNT_WORDS, text, ev.source) ? `count:${firstUnsourced(COUNT_WORDS, text, ev.source)}` : null)
  );
}

function checkExplain(sentences, skill, w) {
  if (!Array.isArray(sentences) || sentences.length !== 3) return 'not-three';
  const clean = sentences.map((s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''));
  if (clean.some((s) => !s || s.length > 260)) return 'sentence-length';
  const text = clean.join(' ');
  if (/\b(?:Oikantik|Basu|he|his|him|she|her|I|my|we|our)\b/.test(text)) return 'mentions-a-person';
  if (/https?:|www\.|@/.test(text)) return 'link';
  return faithful(text, w.source, entities) ?? bannedPhrase(text, w.source) ?? null;
}

/* ---------------------------------------------------------------------------
 * Prompts
 * ------------------------------------------------------------------------- */

const SUMMARY_SYSTEM = [
  "You write short factual notes for Oikantik Basu's portfolio site. For each skill you receive an EVIDENCE block: the projects on the site whose tech stack lists the skill, and lines from his listed roles that name it.",
  'For each skill, write 2 or 3 plain sentences that say where the skill appears on the site.',
  [
    'RULES',
    "1. Use only that skill's EVIDENCE. Name each project by its project name alone (never with its tagline), and each role exactly as its 'Refer to it as' text writes it, for example 'the Data Science Intern role at Unified Mentor Private Limited'. Never write 'at' or 'for' directly before a role or programme name.",
    '2. Say where the skill appears, never how good he is: no words such as expert, proficient, skilled, strong, deep, extensive, advanced, solid or mastery, and no claims about impact, scale or results beyond the evidence.',
    '3. Write about him in the third person (he, his, Oikantik). Start the first sentence with the skill name exactly as given.',
    '4. No numbers, counts, dates or durations unless copied exactly from the evidence.',
    '5. A project is his own project, not employment. Only the organisations in the role lines are places he worked or studied, exactly as written. UrbanCare AI is a challenge entry built on Google\'s open models, not employment at Google or DeepMind. At Mindrift he evaluated GPT and Claude outputs as a freelancer, not as an employee of OpenAI or Anthropic; describe that work as evaluations of model outputs, never as work "for" or "at" a model or its maker.',
    '6. Never mention certifications or degrees.',
    '7. Plain text only: no markdown, links or quotation marks.',
  ].join('\n'),
].join('\n\n');

const EXPLAIN_SYSTEM = [
  'You rewrite reference notes about technologies in plain English for visitors who are not specialists.',
  'For each technology you receive its PURPOSE and KEY CAPABILITIES. Write exactly three short sentences, each under 30 words: what it is for, what it can do, and why that matters.',
  [
    'RULES',
    "1. Use only the facts in that technology's notes. Add no names, products, numbers or claims that are not there.",
    '2. Describe the technology in general. Never mention Oikantik, any person, anyone\'s use of it, or any project.',
    "3. Start the first sentence with the technology's name exactly as given.",
    '4. Use plain words: explain jargon or leave it out. No markdown, links, hype or marketing words.',
  ].join('\n'),
].join('\n\n');

const summarySchema = z.object({
  items: z
    .array(z.object({ skill: z.string().describe('The skill name exactly as given.'), text: z.string().describe('2 or 3 plain sentences.') }))
    .max(SUMMARY_BATCH),
});

const explainSchema = z.object({
  items: z
    .array(
      z.object({
        skill: z.string().describe('The technology name exactly as given.'),
        sentences: z.array(z.string()).min(3).max(3).describe('Exactly three short plain sentences.'),
      }),
    )
    .max(EXPLAIN_BATCH),
});

/* ---------------------------------------------------------------------------
 * Gallery: every sentence must actually trip this lexicon (checked below), so
 * each note stays true of src/lib/sentiment.ts.
 * ------------------------------------------------------------------------- */

const GALLERY = [
  {
    id: '01-negation-scope',
    trap: 'Negation scope',
    text: "I wouldn't say the new build is fast.",
    intended: 'negative',
    note: "“wouldn't” sits six words before “fast”, outside the lexicon's three-word negation window, so “fast” still counts as praise.",
  },
  {
    id: '02-sarcasm',
    trap: 'Sarcasm',
    text: 'Oh great, another outage. Just what I needed on a Friday.',
    intended: 'negative',
    note: "“great” is the only word on its lists, and a word list can't hear irony, so the complaint scores as praise.",
  },
  {
    id: '03-technical-idiom',
    trap: 'Technical idiom',
    text: 'Kill the stuck process and the error is gone.',
    intended: 'positive',
    note: '“error” is on its negative list, so a fix that makes the error go away reads as bad news.',
  },
  {
    id: '04-contrast',
    trap: 'Contrast',
    text: 'The docs are good but the API is a mess.',
    intended: 'mixed',
    note: '“good” and “mess” cancel out to exactly zero, so two strong opinions average into neutral.',
  },
  {
    id: '05-double-negative',
    trap: 'Double negative',
    text: "I can't say I didn't enjoy it.",
    intended: 'positive',
    note: "“didn't” flips “enjoy” to negative, and the lexicon never sees that “can't say” flips it back.",
  },
  {
    id: '06-domain-meaning',
    trap: 'Domain meaning',
    text: "The model's error rate dropped to almost nothing.",
    intended: 'positive',
    note: '“error” is on its negative list; it cannot tell that a falling error rate is good news.',
  },
  {
    id: '07-slang',
    trap: 'Slang',
    text: 'This release slaps, zero crashes all week.',
    intended: 'positive',
    note: "“slaps” isn't in its vocabulary and “zero” isn't one of its negators, so “crashes” counts against the release.",
  },
  {
    id: '08-sarcasm-intensifier',
    trap: 'Sarcasm with an intensifier',
    text: 'Really love waiting ten minutes for a build.',
    intended: 'negative',
    note: '“Really” multiplies “love” by 1.6, so the sarcasm scores as strong praise.',
  },
  {
    id: '09-elliptical-answer',
    trap: 'Elliptical answer',
    text: 'Is it fast? Not really.',
    intended: 'negative',
    note: "A negator only affects the words after it, and “really” carries no sentiment, so “fast” in the question still counts as praise.",
  },
  {
    id: '10-idiomatic-negation',
    trap: 'Idiom with a negator',
    text: 'Hardly a day goes by without a crash.',
    intended: 'negative',
    note: "“without” flips “crash” into a positive; the lexicon can't see that the sentence means crashes happen almost daily.",
  },
];

for (const g of GALLERY) {
  const got = analyze(g.text).label;
  if (got === g.intended) fail(`gallery ${g.id}: the lexicon now reads it as ${got}, the intended label, so its note is no longer true. Replace the example.`);
}

/* ---------------------------------------------------------------------------
 * Plan
 * ------------------------------------------------------------------------- */

const store = loadStore(STORE);
const entries = { ...store.entries };
const want = new Set();
const plan = { summary: [], explain: [], gallery: [] };

for (const skill of SKILLS) {
  if (args.only.has('summary')) {
    const ev = evidenceFor(skill);
    const key = `summary:${skill.slug}`;
    if (!ev.empty) {
      want.add(key);
      const h = hash({ v: SUMMARY_VERSION, source: ev.source, ids: ev.ids });
      if (args.force || stale(entries[key], h)) plan.summary.push({ key, skill, ev, h });
    }
  }
  if (args.only.has('explain')) {
    const w = writeUpFor(skill);
    const key = `explain:${skill.slug}`;
    if (w) {
      want.add(key);
      const h = hash({ v: EXPLAIN_VERSION, name: skill.name, purpose: w.purpose, keyCapabilities: w.keyCapabilities });
      if (args.force || stale(entries[key], h)) plan.explain.push({ key, skill, w, h });
    }
  }
}
if (args.only.has('gallery')) {
  for (const g of GALLERY) {
    const key = `gallery:${g.id}`;
    want.add(key);
    const h = hash({ v: SENTIMENT_PROMPT_VERSION, text: g.text, trap: g.trap, note: g.note, intended: g.intended });
    if (args.force || stale(entries[key], h)) plan.gallery.push({ key, g, h });
  }
}

// Entries of the kinds being generated that no longer have a source, or whose
// source changed, go now; a failed regeneration must not leave a stale text behind.
const pruned = [];
for (const key of Object.keys(entries)) {
  const kind = key.split(':')[0];
  if (!args.only.has(kind)) continue;
  const redo = plan[kind]?.some((p) => p.key === key);
  if (!want.has(key) || redo) {
    delete entries[key];
    if (!want.has(key)) pruned.push(key);
  }
}

const skipped = SKILLS.filter((s) => evidenceFor(s).empty).map((s) => s.name);
console.log(
  `skills store: ${plan.summary.length} summaries, ${plan.explain.length} explanations, ${plan.gallery.length} gallery verdicts to generate` +
    ` (models ${MODELS.fallback} then ${MODELS.primary}).`,
);
if (args.only.has('summary')) console.log(`No evidence, so no summary (the modal's rule copy covers them): ${skipped.length} skills: ${skipped.join(', ')}.`);
if (pruned.length) console.log(`Removing entries with no source: ${pruned.join(', ')}`);

if (args.dry) {
  for (const kind of KINDS) for (const p of plan[kind]) console.log(`  would generate ${p.key}`);
  console.log('Dry run: nothing called, nothing written.');
  process.exit(0);
}

const nothingToDo = !plan.summary.length && !plan.explain.length && !plan.gallery.length;
if (nothingToDo) {
  if (pruned.length) saveStore(STORE, entries);
  console.log('Up to date.');
  process.exit(0);
}
if (!apiKey()) exitSoft('skipped: no key (GOOGLE_AI_API_KEY). src/data/ai-generated/skills.json left as it was.');

/* ---------------------------------------------------------------------------
 * Generate
 * ------------------------------------------------------------------------- */

const rejected = [];
let calls = 0;

async function call(opts) {
  if (calls++ > 0 && args.delay) await sleep(args.delay);
  const res = await callGemini(opts);
  if (!res.ok && res.reason === 'quota') {
    saveStore(STORE, entries);
    exitSoft(`stopped: Gemini quota (429). Saved what was generated; run again later to finish.`);
  }
  return res;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

for (const batch of chunk(plan.summary, SUMMARY_BATCH)) {
  const prompt = [
    'Write the summary for each skill below.',
    ...batch.map((p) => `=== EVIDENCE for ${p.skill.name} ===\n${p.ev.source}\n=== END EVIDENCE for ${p.skill.name} ===`),
  ].join('\n\n');
  const res = await call({ system: SUMMARY_SYSTEM, prompt, schema: summarySchema, maxOutputTokens: 2048 });
  if (!res.ok) {
    console.warn(`summary batch failed: ${res.reason}`);
    rejected.push(...batch.map((p) => `${p.key} (${res.reason})`));
    continue;
  }
  for (const p of batch) {
    const item = res.data.items.find((it) => it.skill.trim() === p.skill.name);
    const text = item?.text.replace(/\s+/g, ' ').trim() ?? '';
    const why = item ? checkSummary(text, p.skill, p.ev) : 'missing';
    if (why) {
      rejected.push(`${p.key} (${why})${text ? `: ${text}` : ''}`);
      continue;
    }
    entries[p.key] = newEntry({
      hash: p.h,
      model: res.model,
      claimBearing: true,
      value: { skill: p.skill.name, text, evidence: p.ev.ids, sources: p.ev.sources },
    });
  }
}

for (const batch of chunk(plan.explain, EXPLAIN_BATCH)) {
  const prompt = [
    'Rewrite the notes for each technology below.',
    ...batch.map((p) => `=== NOTES for ${p.skill.name} ===\n${p.w.source}\n=== END NOTES for ${p.skill.name} ===`),
  ].join('\n\n');
  const res = await call({ system: EXPLAIN_SYSTEM, prompt, schema: explainSchema, maxOutputTokens: 3072 });
  if (!res.ok) {
    console.warn(`explain batch failed: ${res.reason}`);
    rejected.push(...batch.map((p) => `${p.key} (${res.reason})`));
    continue;
  }
  for (const p of batch) {
    const item = res.data.items.find((it) => it.skill.trim() === p.skill.name);
    const why = item ? checkExplain(item.sentences, p.skill, p.w) : 'missing';
    if (why) {
      rejected.push(`${p.key} (${why})`);
      continue;
    }
    entries[p.key] = newEntry({
      hash: p.h,
      model: res.model,
      claimBearing: false,
      value: { skill: p.skill.name, sentences: item.sentences.map((s) => s.replace(/\s+/g, ' ').trim()), sources: [`ref:${p.skill.slug}`] },
    });
  }
}

for (const p of plan.gallery) {
  const canary = newCanary();
  const res = await call({
    system: sentimentSystem(canary),
    prompt: sentimentUserTurn(p.g.text),
    schema: sentimentVerdictSchema,
    maxOutputTokens: AI_BUDGETS.sentiment.maxOutputTokens,
  });
  if (!res.ok) {
    rejected.push(`${p.key} (${res.reason})`);
    continue;
  }
  const checked = finalizeVerdict(p.g.text, res.data, { canary });
  if (!checked) {
    rejected.push(`${p.key} (unverified)`);
    continue;
  }
  entries[p.key] = newEntry({
    hash: p.h,
    model: res.model,
    claimBearing: false,
    value: { text: p.g.text, trap: p.g.trap, note: p.g.note, intended: p.g.intended, ...checked.verdict },
  });
}

saveStore(STORE, entries);
const made = Object.keys(entries).length;
console.log(`✔ skills store: ${made} entries saved after ${calls} Gemini calls.`);
if (rejected.length) console.log(`Left out (checks failed; they are retried next run):\n  ${rejected.join('\n  ')}`);
