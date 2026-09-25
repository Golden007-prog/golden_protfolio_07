#!/usr/bin/env node
// Precomputes the discovery store, src/data/ai-generated/discovery.json:
//
//   tour:<preset>             the stop order behind each guided-tour goal chip
//                             (ids only; not claim-bearing, so shown in production)
//   section:<id>:<mode>       plain-English, Hindi, Bengali and Spanish versions of
//                             About, Experience, Principles and Contact
//                             (claim-bearing: hidden in production until approved
//                             with `npm run ai:review`)
//
// Every section version must pass checkTranslation (no number or name of the
// original lost), faithful (no number or name added) and, for plain English,
// bannedPhrase. A version that fails twice is not written. Entries are
// hash-gated, so unchanged sources are skipped; --force regenerates everything,
// and --redo=<key,key> regenerates just those entries (after a rejected review).
//
//   node --env-file-if-exists=.env scripts/ai/gen-discovery.mjs [--force] [--only=tour|sections] [--redo=section:about:bn]
//
// With no key, or on a 429, it exits 0 with a notice and keeps what it wrote.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CONTACT_COPY, PHILOSOPHY, SECTION_COPY } from '../../src/data/site-copy.ts';
import { sectionSystem, sectionUser, tourSystem, tourUser } from '../../src/lib/ai/prompts/tour.ts';
import {
  blocksText,
  checkBlocks,
  GOAL_PRESETS,
  hashText,
  normalizeStops,
  sectionBlocks,
  sectionSourceOf,
  sourceHash,
  stopIds,
  stopViews,
  TOOL_LANG,
  TOOL_MODES,
  TOOL_SECTIONS,
  toolKey,
  tourCatalogOf,
  tourKey,
  TOUR_MAX,
  TOUR_MIN,
  TOUR_PROMPT_VERSION,
} from '../../src/lib/ai/tour.ts';
import { apiKey, bannedPhrase, callGemini, exitSoft, faithful, loadCorpus, loadStore, MODELS, newEntry, ROOT, saveStore, stale } from './lib.mjs';

const STORE = 'discovery';
const ATTEMPTS = 2;
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
const redo = new Set((args.find((a) => a.startsWith('--redo='))?.slice('--redo='.length) ?? '').split(',').filter(Boolean));
/** Whether an entry is to be (re)generated this run. */
const due = (key, hash) => force || redo.has(key) || stale(entries[key], hash);

if (!apiKey()) exitSoft('gen-discovery: skipped, no key (GOOGLE_AI_API_KEY). The store is unchanged.');

// site.ts imports profile.json, which Node cannot load without an import attribute,
// so the section list is read from its source (actions.test.ts checks the same list).
function readSections() {
  const src = readFileSync(path.join(ROOT, 'src/lib/site.ts'), 'utf8');
  const out = [...src.matchAll(/\{ id: '([a-z]+)', label: '([^']+)', index: '\d+' \}/g)].map((m) => ({ id: m[1], label: m[2] }));
  if (out.length !== 6) throw new Error(`Expected 6 sections in src/lib/site.ts, found ${out.length}`);
  return out;
}

const { sources, entities } = loadCorpus();
const inputs = {
  profile: sources.profile,
  projects: sources.projects,
  sections: readSections(),
  sectionCopy: SECTION_COPY,
  tenets: PHILOSOPHY,
  contact: CONTACT_COPY,
};

const store = loadStore(STORE);
const entries = { ...store.entries };
const log = { wrote: [], kept: 0, rejected: [] };

function save() {
  saveStore(STORE, entries);
}

/** On a spent quota: keep what was written and stop without failing the build. */
function stopOnQuota(result) {
  if (result.ok || result.reason !== 'quota') return;
  save();
  exitSoft(`gen-discovery: quota reached; saved ${log.wrote.length} new entries. Run it again later.`);
}

/* ---- 1. goal chip tours ---- */

async function tours() {
  const catalog = tourCatalogOf(inputs);
  const ids = stopIds(catalog);
  const system = tourSystem(stopViews(inputs));
  const schema = z.object({ stops: z.array(z.enum(ids)).min(TOUR_MIN).max(TOUR_MAX) });

  for (const preset of GOAL_PRESETS) {
    const key = tourKey(preset.id);
    const hash = hashText(JSON.stringify({ v: TOUR_PROMPT_VERSION, system, goal: preset.goal }));
    if (!due(key, hash)) {
      log.kept += 1;
      continue;
    }
    let done = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
      // The cheap tier, as at runtime: Flash-Lite first, the primary on 429/503.
      const r = await callGemini({ system, prompt: tourUser(preset.goal), schema, maxOutputTokens: 256 });
      stopOnQuota(r);
      if (!r.ok) {
        log.rejected.push(`${key}: ${r.reason}`);
        continue;
      }
      const stops = normalizeStops(r.data?.stops, catalog);
      if (!stops) {
        log.rejected.push(`${key}: fewer than ${TOUR_MIN} distinct stops`);
        continue;
      }
      entries[key] = newEntry({ hash, model: r.model, value: { stops }, claimBearing: false });
      log.wrote.push(key);
      done = true;
    }
  }
}

/* ---- 2. section versions ---- */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const states = (text, name) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`).test(text);

const ALL_NAMES = [
  ...new Set(
    [...entities.companies, ...entities.institutions, ...entities.projectNames, ...entities.skills, ...entities.tech].filter(
      (n) => typeof n === 'string' && n.trim().length >= 2,
    ),
  ),
];

const versionSchema = z.object({
  blocks: z.array(z.object({ heading: z.string().optional(), text: z.string() })),
});

/** The first reason a checked version must not ship, or null. */
function problemWith(mode, source, checked) {
  const out = blocksText(checked);
  const added = faithful(out, source, entities);
  if (added) return `added ${added}`;
  if (mode === 'simple') {
    const banned = bannedPhrase(out, source);
    if (banned) return `banned phrase '${banned}'`;
  }
  return null;
}

async function sections() {
  const src = sectionSourceOf(inputs);
  for (const section of TOOL_SECTIONS) {
    const blocks = sectionBlocks(section, src);
    const source = blocksText(blocks);
    const names = ALL_NAMES.filter((n) => states(source, n));

    for (const mode of TOOL_MODES) {
      const key = toolKey(section, mode);
      const hash = sourceHash(blocks, mode);
      if (!due(key, hash)) {
        log.kept += 1;
        continue;
      }
      let done = false;
      for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
        const r = await callGemini({
          model: MODELS.primary,
          system: sectionSystem(mode),
          prompt: sectionUser(blocks, names),
          schema: versionSchema,
          maxOutputTokens: 8192,
        });
        stopOnQuota(r);
        if (!r.ok) {
          log.rejected.push(`${key}: ${r.reason}`);
          continue;
        }
        const checked = checkBlocks(blocks, r.data?.blocks, ALL_NAMES);
        const problem = typeof checked === 'string' ? `lost ${checked}` : problemWith(mode, source, checked);
        if (problem) {
          log.rejected.push(`${key}: ${problem}`);
          continue;
        }
        entries[key] = newEntry({ hash, model: r.model, value: { lang: TOOL_LANG[mode], blocks: checked }, claimBearing: true });
        log.wrote.push(key);
        done = true;
      }
    }
  }
}

if (!only || only === 'tour') await tours();
if (!only || only === 'sections') await sections();
save();

console.log(`gen-discovery: wrote ${log.wrote.length} (${log.wrote.join(', ') || 'none'}), kept ${log.kept} unchanged.`);
if (log.rejected.length) console.log(`gen-discovery: rejected attempts:\n  ${log.rejected.join('\n  ')}`);
