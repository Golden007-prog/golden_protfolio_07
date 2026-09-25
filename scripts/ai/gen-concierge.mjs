#!/usr/bin/env node
// Starter questions for the concierge, per section and per project, written to
// src/data/ai-generated/concierge.json as { questions: string[] } entries keyed
// 'section:<id>' and 'project:<slug>'. Gemini proposes questions from the
// section's or project's own corpus chunks; a question is kept only when
//   - it reads as a question (not a claim) and names no number, organisation or
//     technology its source doesn't (lib.faithful), and
//   - pure BM25 over src/data/ai-corpus.json finds a 'self' chunk for it above
//     the relevance gate, so the live route would answer it rather than refuse.
// Starters are questions, not claims about Oikantik, so entries are not
// claim-bearing and need no review before they show. Hash-gated: an entry is
// regenerated only when its source chunks change (or with --force).
//
//   npm run ai:generate                  (every generator)
//   node --env-file-if-exists=.env scripts/ai/gen-concierge.mjs [--force]
//   node scripts/ai/gen-concierge.mjs --probe "Question one?" "Question two?"
//     checks questions against the gate with no key and no network.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sectionOf } from '../../src/lib/ai/actions.ts';
import { bm25, buildBm25, GATE, relevant } from '../../src/lib/ai/retrieval.ts';
import { CORPUS_PATH, apiKey, callGemini, exitSoft, faithful, loadCorpus, loadStore, newEntry, readJson, saveStore, stale } from './lib.mjs';

const STORE = 'concierge';
const PROMPT_VERSION = 1;
const MAX_KEPT = 4;
const MAX_WORDS = 14;

const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' },
  { id: 'experience', label: 'Experience' },
  { id: 'philosophy', label: 'Principles' },
  { id: 'contact', label: 'Contact' },
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const probe = args.includes('--probe');

const corpus = readJson(CORPUS_PATH);
const chunks = corpus.chunks;
const byId = new Map(chunks.map((c) => [c.id, c]));
const index = buildBm25(chunks);

/** The route's gate, offline: a 'self' chunk whose normalised BM25 clears it. */
function answerable(question) {
  return bm25(index, question, 8).some((h) => byId.get(h.id)?.cls === 'self' && relevant({ bm25: h.norm, cosine: null }, GATE));
}

function looksLikeQuestion(q) {
  return typeof q === 'string' && q.endsWith('?') && q.length >= 8 && q.length <= 110 && q.split(/\s+/).length <= MAX_WORDS && !/https?:|www\.|@/.test(q);
}

if (probe) {
  const questions = args.filter((a) => !a.startsWith('--'));
  const list = questions.length ? questions : ['What do you work on?', 'Show me your best projects', 'What tech do you use?', 'How do I hire you?'];
  for (const q of list) console.log(`${answerable(q) ? 'keep' : 'drop'}  ${q}`);
  process.exit(0);
}

if (!apiKey()) exitSoft('gen-concierge: skipped, no key (GOOGLE_AI_API_KEY). The static starters stay in use.');

const { entities } = loadCorpus();

/** What each entry is generated from: its own chunks, 'self' only. */
function targets() {
  const out = [];
  for (const s of SECTIONS) {
    const own = chunks.filter((c) => c.cls === 'self' && sectionOf(c.target) === s.id);
    if (own.length) out.push({ key: `section:${s.id}`, name: `the ${s.label} section`, chunks: own });
  }
  const slugs = [...new Set(chunks.filter((c) => c.target?.kind === 'project').map((c) => c.target.slug))];
  for (const slug of slugs) {
    const own = chunks.filter((c) => c.cls === 'self' && (c.id.startsWith(`project:${slug}#`) || c.id === `facts:${slug}`));
    const title = own.find((c) => c.id.endsWith('#tagline'))?.title ?? slug;
    if (own.length) out.push({ key: `project:${slug}`, name: title, chunks: own });
  }
  return out;
}

const schema = z.object({ questions: z.array(z.string().max(160)).min(1).max(8) });

const SYSTEM = [
  "You write starter questions for the chat assistant on Oikantik Basu's portfolio site.",
  'Write 6 short questions (at most 12 words each) that a recruiter or engineer might ask about the SOURCE below.',
  'They are questions, not claims: never put a number, employer, title, credential or technology into a question unless the SOURCE states it.',
  'Refer to him as "he" or "Oikantik". Plain text, each ending with a question mark. No numbering.',
].join('\n');

const store = loadStore(STORE);
const entries = { ...store.entries };
let made = 0;
let skipped = 0;

for (const t of targets()) {
  const source = t.chunks.map((c) => `${c.title}\n${c.text}`).join('\n\n');
  const hash = createHash('sha256').update(`v${PROMPT_VERSION}\n${source}`).digest('hex').slice(0, 16);
  if (!force && !stale(entries[t.key], hash)) {
    skipped += 1;
    continue;
  }
  const res = await callGemini({ system: SYSTEM, prompt: `SOURCE (${t.name})\n\n${source}`, schema, maxOutputTokens: 512 });
  if (!res.ok) {
    if (res.reason === 'quota' || res.reason === 'no-key') {
      saveStore(STORE, entries);
      exitSoft(`gen-concierge: stopped early (${res.reason}); ${made} entries written so far.`);
    }
    console.warn(`gen-concierge: ${t.key} skipped (${res.reason})`);
    continue;
  }
  const kept = [];
  for (const raw of res.data.questions) {
    const q = raw.replace(/\s+/g, ' ').trim();
    if (!looksLikeQuestion(q) || faithful(q, source, entities) !== null || !answerable(q)) continue;
    if (kept.some((k) => k.toLowerCase() === q.toLowerCase())) continue;
    kept.push(q);
    if (kept.length >= MAX_KEPT) break;
  }
  if (!kept.length) {
    console.warn(`gen-concierge: ${t.key} had no question that passed the checks; left as it was`);
    continue;
  }
  entries[t.key] = newEntry({ hash, model: res.model, value: { questions: kept }, claimBearing: false });
  made += 1;
  console.log(`${t.key}: ${kept.length} kept`);
}

saveStore(STORE, entries);
console.log(`gen-concierge: ${made} written, ${skipped} unchanged.`);
