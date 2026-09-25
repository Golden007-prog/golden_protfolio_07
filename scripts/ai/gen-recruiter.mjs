#!/usr/bin/env node
// Precomputes the recruiter lens pitches (plain, hiring-manager and engineer
// versions, 90 to 120 words each) into src/data/ai-generated/recruiter.json.
//
//   npm run ai:generate                      (runs every gen-*.mjs)
//   node --env-file-if-exists=.env scripts/ai/gen-recruiter.mjs [--force]
//
// Each lens draws only on the chunks its data backs (lensSources) plus its top
// projects' taglines. Every sentence must cite those ids and pass the tripwire,
// faithful() and bannedPhrase() against what it cites, with no softeners, or the
// lens is retried and, failing that, left as it was. Entries are claim-bearing,
// so they stay hidden in production until `npm run ai:review` approves them.
// Hash-gated: an unchanged lens is skipped. No key or a 429 exits 0.

import { z } from 'zod';
import { hashText } from '../../src/lib/ai/corpus.ts';
import { hasSoftener, LENS_AUDIENCES, LENSES, lensKey, lensProjects, lensSources, spellsNumber, stripMarkup, wordCount } from '../../src/lib/ai/fit.ts';
import { newCanary } from '../../src/lib/ai/prompts/base.ts';
import { lensSystem } from '../../src/lib/ai/prompts/brief.ts';
import { canonicalId, tripwire } from '../../src/lib/ai/verify.ts';
import { apiKey, bannedPhrase, callGemini, exitSoft, faithful, loadCorpus, loadStore, MODELS, newEntry, saveStore, stale } from './lib.mjs';

const PROMPT_VERSION = 'lens-v2';
const ATTEMPTS = 3;
const WORDS = { min: 90, max: 120 };
const force = process.argv.includes('--force');

if (!apiKey()) exitSoft('gen-recruiter: skipped, no key (GOOGLE_AI_API_KEY).');

const { sources, byId, entities } = loadCorpus();
const data = { profile: sources.profile, projects: sources.projects };
const entries = { ...loadStore('recruiter').entries };

const sentence = z.object({ text: z.string(), cites: z.array(z.string()).min(1).max(4) });
const version = z.array(sentence).min(3).max(8);
const schema = z.object({ plain: version, manager: version, engineer: version });

// The model sometimes echoes the prompt's '[c:id]' marker form inside cites; the runtime verifiers strip it the same way.
const citeId = (c) => canonicalId(c);

/** The first reason a draft fails, or null. `allowed` are the lens's chunk ids. */
function problemWith(draft, allowed) {
  for (const audience of LENS_AUDIENCES) {
    const sentences = draft[audience];
    const words = wordCount(sentences.map((s) => ({ text: stripMarkup(s.text), cites: s.cites })));
    if (words < WORDS.min || words > WORDS.max) return `the ${audience} version has ${words} words; it needs ${WORDS.min} to ${WORDS.max}`;
    for (const s of sentences) {
      const text = stripMarkup(s.text);
      const cites = s.cites.map(citeId).filter((c) => allowed.includes(c));
      if (!text) return `${audience}: an empty sentence`;
      if (!cites.length) return `${audience}: a sentence cites ${JSON.stringify(s.cites)}, none of them a CONTEXT id`;
      if (hasSoftener(text)) return `${audience}: a softener`;
      if (spellsNumber(text)) return `${audience}: a number spelled out in words ("${text.slice(0, 60)}…"); write numbers as digits exactly as CONTEXT does`;
      const facts = cites.map((c) => byId.get(c).text);
      const reason = tripwire(text, facts, entities) ?? faithful(text, facts.join('\n'), entities) ?? bannedPhrase(text, facts.join('\n'));
      if (reason) return `${audience}: ${reason}`;
    }
  }
  return null;
}

function clean(draft, allowed) {
  return Object.fromEntries(
    LENS_AUDIENCES.map((a) => [a, draft[a].map((s) => ({ text: stripMarkup(s.text), cites: [...new Set(s.cites.map(citeId).filter((c) => allowed.includes(c)))] }))]),
  );
}

let written = 0;
for (const lens of LENSES) {
  const key = lensKey(lens.id);
  const projects = lensProjects(lens, data);
  const allowed = [...lensSources(lens, data), ...projects.map((slug) => `project:${slug}#tagline`)].filter((id) => byId.get(id)?.cls === 'self');
  const context = allowed.map((id) => `[c:${id}] ${byId.get(id).title}\n${byId.get(id).text}`).join('\n\n');
  const hash = hashText(`${PROMPT_VERSION}\n${lens.id}\n${projects.join(',')}\n${context}`);
  if (!force && !stale(entries[key], hash)) {
    console.log(`= ${key} unchanged`);
    continue;
  }

  let value = null;
  let model = null;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS && !value; attempt++) {
    // A rejected draft's reason goes back into the next attempt.
    const prompt = `Write the three versions for the lens "${lens.label}".${last ? ` Your previous draft was rejected (${last}); fix that.` : ''}`;
    const call = (m) => callGemini({ model: m, system: lensSystem({ lens: lens.label, context, canary: newCanary() }), prompt, schema, maxOutputTokens: 4096 });
    // The chat model first; the lite model only when the chat model is busy or out of quota.
    let res = await call(MODELS.primary);
    if (!res.ok && (res.reason === 'quota' || res.status === 503)) res = await call(MODELS.fallback);
    if (!res.ok) {
      if (res.reason === 'quota') exitSoft(`gen-recruiter: quota reached after ${written} lens(es); run it again later.`);
      last = res.reason;
      continue;
    }
    const problem = problemWith(res.data, allowed);
    if (problem) {
      last = problem;
      console.log(`  ${key} attempt ${attempt}: rejected (${problem})`);
      continue;
    }
    value = { id: lens.id, label: lens.label, versions: clean(res.data, allowed), projects };
    model = res.model;
  }

  if (!value) {
    console.warn(`✖ ${key}: ${last}; the previous entry is kept`);
    continue;
  }
  entries[key] = newEntry({ hash, model, value, claimBearing: true });
  written += 1;
  console.log(`✔ ${key} (${model}): ${LENS_AUDIENCES.map((a) => `${a} ${wordCount(value.versions[a])}w`).join(', ')}`);
}

saveStore('recruiter', entries);
console.log(`gen-recruiter: ${written} lens(es) written. Claim-bearing: review with npm run ai:review before they show in production.`);
