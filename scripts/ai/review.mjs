#!/usr/bin/env node
// Owner review of precomputed AI content in src/data/ai-generated/<store>.json.
// Claim-bearing entries stay hidden in production until approved here
// (src/lib/ai/reviewGate.ts). Approving sets reviewed:true and reviewedAt;
// rejecting deletes the entry, so the next `npm run ai:generate` can redo it.
//
//   npm run ai:review                                    walk every unreviewed entry beside its source
//   npm run ai:review -- --list                          per-store counts and pending keys (non-interactive)
//   npm run ai:review -- --approve skills:LangChain …    approve store:key entries
//   npm run ai:review -- --reject projects:omni-lab …    delete store:key entries
//   --dir <path>                                         another stores directory (tests use a fixture)

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { slugify } from '../../src/lib/slug.ts';
import { loadCorpus, loadStore, ROOT, saveStore, STORE_DIR } from './lib.mjs';

function parseArgs(argv) {
  const out = { list: false, approve: [], reject: [], dir: STORE_DIR };
  let bucket = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') {
      out.list = true;
      bucket = null;
    } else if (a === '--approve' || a === '--reject') {
      bucket = out[a.slice(2)];
    } else if (a === '--dir') {
      out.dir = path.resolve(argv[++i] ?? '');
      bucket = null;
    } else if (bucket) {
      bucket.push(a);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const storeNames = () =>
  readdirSync(args.dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();

function splitRef(ref) {
  const i = ref.indexOf(':');
  return i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : [null, null];
}

function counts(entries) {
  const all = Object.values(entries);
  return {
    total: all.length,
    claimBearing: all.filter((e) => e.claimBearing).length,
    reviewed: all.filter((e) => e.reviewed).length,
    pending: all.filter((e) => !e.reviewed && e.claimBearing).length,
    drafts: all.filter((e) => !e.reviewed && !e.claimBearing).length,
  };
}

function list() {
  const where = path.relative(ROOT, args.dir).replaceAll('\\', '/') || args.dir;
  console.log(`AI stores in ${where}:`);
  let pendingTotal = 0;
  for (const name of storeNames()) {
    const { entries } = loadStore(name, args.dir);
    const c = counts(entries);
    pendingTotal += c.pending;
    console.log(
      `  ${name}: ${c.total} entries · ${c.claimBearing} claim-bearing · ${c.reviewed} reviewed · ${c.pending} awaiting review (hidden in production) · ${c.drafts} unreviewed, not claim-bearing`,
    );
    for (const [key, e] of Object.entries(entries)) {
      if (!e.reviewed && e.claimBearing) console.log(`    pending ${name}:${key} (${e.model}, ${e.generatedAt})`);
    }
  }
  console.log(pendingTotal ? `${pendingTotal} entries await review.` : 'Nothing awaits review.');
}

function apply(refs, decision) {
  let failed = 0;
  for (const ref of refs) {
    const [name, key] = splitRef(ref);
    if (!name || !key || !storeNames().includes(name)) {
      console.error(`✖ ${ref}: expected store:key with a store in ${path.relative(ROOT, args.dir) || args.dir}`);
      failed += 1;
      continue;
    }
    const { entries } = loadStore(name, args.dir);
    if (!entries[key]) {
      console.error(`✖ ${ref}: no such entry`);
      failed += 1;
      continue;
    }
    if (decision === 'approve') {
      entries[key] = { ...entries[key], reviewed: true, reviewedAt: new Date().toISOString() };
    } else {
      delete entries[key];
    }
    saveStore(name, entries, args.dir);
    console.log(`✔ ${decision === 'approve' ? 'approved' : 'rejected'} ${ref}`);
  }
  return failed;
}

/** The corpus text an entry was written from: ids it cites, else chunks named by its key. */
function sourceFor(key, entry, corpus) {
  const v = entry.value ?? {};
  const cited = [
    ...(Array.isArray(v.evidence) ? v.evidence.map((e) => e?.id) : []),
    ...(Array.isArray(v.sources) ? v.sources.map((s) => (typeof s === 'string' ? s : s?.id)) : []),
    ...(Array.isArray(v.cited) ? v.cited : []),
  ].filter((id) => typeof id === 'string');
  let ids = cited.filter((id) => corpus.byId.has(id));
  if (!ids.length) {
    const slug = slugify(key);
    ids = corpus.chunks
      .filter((c) => c.id === key || c.id === `project:${slug}#summary` || c.id === `ref:${slug}` || c.id === `exp:${key}` || c.id === `facts:${slug}`)
      .map((c) => c.id);
  }
  return ids.slice(0, 4).map((id) => {
    const t = corpus.byId.get(id).text;
    return `  [${id}] ${t.length > 400 ? `${t.slice(0, 400)}…` : t}`;
  });
}

async function interactive() {
  if (!process.stdin.isTTY) {
    list();
    console.log('(Not a terminal: use --approve store:key or --reject store:key.)');
    return 0;
  }
  const corpus = loadCorpus();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const name of storeNames()) {
      const { entries } = loadStore(name, args.dir);
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.reviewed) continue;
        const value = JSON.stringify(entry.value, null, 2);
        console.log(`\n── ${name}:${key}  (${entry.claimBearing ? 'claim-bearing, hidden in production' : 'not claim-bearing'}; ${entry.model}, ${entry.generatedAt})`);
        console.log(value.length > 1500 ? `${value.slice(0, 1500)}…` : value);
        const source = sourceFor(key, entry, corpus);
        console.log(source.length ? `Source:\n${source.join('\n')}` : 'Source: (no matching corpus chunk; check the generator)');
        const answer = (await rl.question('[a]pprove, [r]eject, [s]kip, [q]uit? ')).trim().toLowerCase();
        if (answer === 'q') return 0;
        if (answer === 'a') apply([`${name}:${key}`], 'approve');
        else if (answer === 'r') apply([`${name}:${key}`], 'reject');
      }
    }
    console.log('\nDone.');
    return 0;
  } finally {
    rl.close();
  }
}

let failed = 0;
if (args.approve.length) failed += apply(args.approve, 'approve');
if (args.reject.length) failed += apply(args.reject, 'reject');
if (args.list) list();
if (!args.list && !args.approve.length && !args.reject.length) failed += await interactive();
process.exit(failed ? 1 : 0);
