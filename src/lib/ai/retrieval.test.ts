import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { techFamily } from '../tech.ts';
import { buildCorpus, type Chunk } from './corpus.ts';
import {
  bm25,
  buildBm25,
  CASE_SENSITIVE_TERMS,
  cosine,
  decodeVec,
  encodeVec,
  hybrid,
  meanVector,
  relevant,
  rrf,
  tokenize,
} from './retrieval.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
const chunks = buildCorpus({
  profile: read('profile.json'),
  projects: read('projects.json'),
  githubFacts: read('github-facts.json'),
  reading: read('reading.json'),
  tools: read('tools.json'),
  skillsIndex: read('skills-index.json'),
  liveSnapshot: read('live-snapshot.json'),
  siteCopy: SITE_COPY,
});
const index = buildBm25(chunks);

// A seeded PRNG, so the vector tests are reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomVec(n: number, seed: number): Float32Array {
  const r = rng(seed);
  return Float32Array.from({ length: n }, () => r() * 2 - 1);
}

test('the tokenizer keeps ReAct apart from React, as techFamily does', () => {
  for (const term of CASE_SENSITIVE_TERMS) {
    assert.equal(techFamily(term), term, `${term} is its own tech family`);
  }
  assert.notEqual(techFamily('ReAct'), techFamily('React'));
  assert.deepEqual(tokenize('ReAct agents'), ['ReAct', 'agent']);
  assert.deepEqual(tokenize('React 19'), ['react', '19']);
  assert.ok(tokenize('MedGemma').includes('gemma'), 'Gemma derivatives also index as their family');
  assert.deepEqual(tokenize('What is the UrbanCare project?'), ['urbancare', 'project']);
});

test("'ReAct agents' ranks a ReAct chunk above every React chunk", () => {
  const hits = bm25(index, 'ReAct agents', 40);
  const text = (id: string) => chunks.find((c) => c.id === id)!.text;
  const firstReAct = hits.findIndex((h) => /(?<![A-Za-z])ReAct(?![A-Za-z])/.test(text(h.id)));
  const reactOnly = hits
    .map((h, i) => ({ i, t: text(h.id) }))
    .filter(({ t }) => /(?<![A-Za-z])React(?![A-Za-z])/.test(t) && !/(?<![A-Za-z])ReAct(?![A-Za-z])/.test(t));
  assert.equal(firstReAct, 0, 'a ReAct chunk is the top hit');
  for (const { i } of reactOnly) assert.ok(i > firstReAct);
});

test("'urbancare' puts project:urbancare-ai#tagline in the top 3", () => {
  const top = bm25(index, 'urbancare', 3).map((h) => h.id);
  assert.ok(top.includes('project:urbancare-ai#tagline'), top.join(', '));
});

test('an off-topic question scores nothing, so the gate can refuse it', () => {
  assert.deepEqual(bm25(index, 'What is his salary?', 5), []);
  const weak = bm25(index, 'Does he like hiking in the mountains or knowing FAISS?', 5);
  assert.ok(weak.every((h) => h.norm < 0.5));
});

test('lexical mode works with null vectors', () => {
  const hits = hybrid({ index, vectors: null, queryVec: null, query: 'voice commerce WhatsApp', k: 5 });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.cosine === null));
  assert.deepEqual(
    hits.map((h) => h.rank),
    hits.map((_, i) => i + 1),
  );
  assert.match(hits[0].id, /^project:vyapar-gyan#/);
  assert.ok(relevant(hits[0]));
});

test('hybrid fuses cosine with BM25 and honours the filter', () => {
  const target = 'project:omni-lab#summary';
  const queryVec = randomVec(16, 7);
  const vectors = new Map<string, Float32Array>(chunks.map((c, i) => [c.id, randomVec(16, 100 + i)]));
  vectors.set(target, queryVec);
  const hits = hybrid({ index, vectors, queryVec, query: 'qqzz xxyy', k: 3 });
  assert.deepEqual(bm25(index, 'qqzz xxyy', 3), [], 'no lexical signal at all');
  assert.equal(hits[0].id, target, 'a pure semantic match still surfaces');
  assert.equal(hits[0].cosine, 1);
  assert.equal(hits[0].bm25, 0);

  const onlyProjects = (c: Chunk) => c.target.kind === 'project';
  const filtered = hybrid({ index, vectors, queryVec, query: 'agents', k: 10, filter: onlyProjects });
  assert.ok(filtered.every((h) => h.id.startsWith('project:') || h.id.startsWith('facts:')));
});

test('RRF ordering is deterministic, ties broken by best rank then id', () => {
  const lists = [
    ['a', 'b', 'c'],
    ['c', 'b', 'a'],
  ];
  const once = rrf(lists);
  assert.deepEqual(once, rrf(lists));
  assert.deepEqual(
    once.map((x) => x.id),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(
    rrf([['x'], ['y']]).map((x) => x.id),
    ['x', 'y'],
  );
  assert.equal(rrf([['a']], 60)[0].score, Number((1 / 61).toFixed(6)));
});

test('int8 encode then decode stays within 1% cosine error at 768 dims', () => {
  for (const seed of [1, 2, 3]) {
    const v = randomVec(768, seed);
    const enc = encodeVec(v);
    assert.equal(atob(enc.v).length, 768);
    assert.ok(enc.v.length <= 1100, 'about 1 KB per vector');
    const back = decodeVec(enc);
    assert.ok(cosine(v, back) > 0.99, `seed ${seed}: ${cosine(v, back)}`);
  }
  assert.deepEqual([...decodeVec(encodeVec(new Float32Array(4)))], [0, 0, 0, 0]);
});

test('meanVector is the unit-length centroid and skips mismatched lengths', () => {
  const m = meanVector([Float32Array.from([1, 0]), Float32Array.from([0, 1]), Float32Array.from([1, 2, 3])]);
  assert.equal(m.length, 2);
  assert.ok(Math.abs(m[0] - Math.SQRT1_2) < 1e-6 && Math.abs(m[1] - Math.SQRT1_2) < 1e-6);
  assert.equal(meanVector([]).length, 0);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 0])), 0);
});
