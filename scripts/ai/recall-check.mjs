#!/usr/bin/env node
// Keyless retrieval recall floor. Runs every query in evals/retrieval.jsonl
// ({"q": ..., "expect": [chunk ids]}) through lexical retrieval (BM25, exactly as
// the server runs it without vectors) and fails when mean recall@5 drops below
// RECALL_FLOOR. Unit tests only sample the tokenizer and the corpus; this catches
// a renamed chunk id, a lost field or a tokenizer change (say, folding ReAct into
// React) across the whole query set.
//
// When src/data/ai-vectors.json has vectors and a key is set, it also reports
// hybrid recall@5 (informational: it depends on the key and quota, so it never
// fails the step).
//
//   npm run ai:recall   (node --env-file-if-exists=.env scripts/ai/recall-check.mjs)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBm25, decodeVec, hybrid } from '../../src/lib/ai/retrieval.ts';
import { apiKey, embedTexts, loadCorpus, readJson, ROOT, VECTORS_PATH } from './lib.mjs';

// Fixed from the first run on 2026-09-25: 36 queries, lexical recall@5 0.958
// (two known partial misses, listed when the script runs). Losing any one more
// query drops it to 0.931; renaming '#tagline' ids gave 0.889 and folding ReAct
// into React 0.926 in a dry run. Raise it when retrieval or the eval set
// improves; never lower it to make a change pass.
// 2026-09-26, with the credential, hackathon-result and new-role queries: 44
// queries, lexical 0.951, hybrid 0.985. The one new partial miss is 'React':
// govprep, ksp-dappa and the-calcutta-classics now list React too and outrank
// two of the three stack chunks the row expects.
export const RECALL_FLOOR = 0.95;
const K = 5;

const evalPath = path.join(ROOT, 'evals/retrieval.jsonl');
const cases = readFileSync(evalPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, i) => {
    const c = JSON.parse(line);
    if (typeof c.q !== 'string' || !Array.isArray(c.expect) || !c.expect.length) throw new Error(`evals/retrieval.jsonl line ${i + 1} is malformed`);
    return c;
  });

const { chunks, byId } = loadCorpus();
const index = buildBm25(chunks);

function evaluate(topFor) {
  let total = 0;
  const misses = [];
  cases.forEach((c, i) => {
    const top = topFor(c, i);
    const found = c.expect.filter((id) => top.includes(id));
    total += found.length / c.expect.length;
    if (found.length < c.expect.length) {
      const lost = c.expect.filter((id) => !found.includes(id)).map((id) => (byId.has(id) ? id : `${id} (no such chunk)`));
      misses.push(`  miss: ${JSON.stringify(c.q)} expected ${lost.join(', ')}; got ${top.join(', ') || 'nothing'}`);
    }
  });
  return { recall: total / cases.length, misses };
}

const lexical = evaluate((c) => hybrid({ index, query: c.q, k: K }).map((h) => h.id));
const ok = lexical.recall >= RECALL_FLOOR;
console.log(`lexical recall@${K}: ${lexical.recall.toFixed(3)} over ${cases.length} queries (floor ${RECALL_FLOOR.toFixed(3)})`);
for (const m of lexical.misses) console.log(m);

const file = readJson(VECTORS_PATH, { model: null, entries: {} });
const vectors = new Map();
for (const c of chunks) {
  const e = file.entries?.[c.id];
  if (file.model && e && e.hash === c.hash) vectors.set(c.id, decodeVec(e));
}
if (!vectors.size) {
  console.log(`hybrid recall@${K}: skipped (no vectors; run npm run ai:embed with a key)`);
} else if (!apiKey()) {
  console.log(`hybrid recall@${K}: skipped (no key to embed the queries)`);
} else {
  const queryVecs = [];
  for (let i = 0; i < cases.length; i += 32) {
    const res = await embedTexts(
      cases.slice(i, i + 32).map((c) => c.q),
      { model: file.model, kind: 'query' },
    );
    if (!res.ok) break;
    queryVecs.push(...res.vectors);
  }
  if (queryVecs.length !== cases.length) {
    console.log(`hybrid recall@${K}: skipped (query embedding failed)`);
  } else {
    const h = evaluate((c, i) => hybrid({ index, vectors, queryVec: queryVecs[i], query: c.q, k: K }).map((x) => x.id));
    console.log(`hybrid recall@${K}: ${h.recall.toFixed(3)} with ${file.model} (${vectors.size}/${chunks.length} chunks embedded)`);
    for (const m of h.misses) console.log(m);
  }
}

if (!ok) {
  console.error(`✖ lexical recall@${K} ${lexical.recall.toFixed(3)} is below the floor ${RECALL_FLOOR.toFixed(3)}.`);
  process.exit(1);
}
