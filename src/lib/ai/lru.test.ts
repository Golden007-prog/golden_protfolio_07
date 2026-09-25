import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheable, cacheKey, Lru, normalizeQuestion } from './lru.ts';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('evicts the least recently used entry once over size', () => {
  const c = clock();
  const lru = new Lru<string>(2, 1000, c.now);
  lru.set('a', 'A');
  lru.set('b', 'B');
  assert.equal(lru.get('a'), 'A', 'touching a makes b the oldest');
  lru.set('c', 'C');
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 'A');
  assert.equal(lru.get('c'), 'C');
  assert.equal(lru.size, 2);
});

test('expires entries by TTL with the injected clock', () => {
  const c = clock(1000);
  const lru = new Lru<number>(200, 600_000, c.now);
  lru.set('q', 1);
  c.advance(599_999);
  assert.equal(lru.get('q'), 1);
  c.advance(1);
  assert.equal(lru.get('q'), undefined);
  assert.equal(lru.size, 0);
  // A rewrite restarts the clock.
  lru.set('q', 2);
  c.advance(300_000);
  lru.set('q', 3);
  c.advance(400_000);
  assert.equal(lru.get('q'), 3);
});

test('defaults are 200 entries for 10 minutes', () => {
  const c = clock();
  const lru = new Lru<number>(undefined, undefined, c.now);
  for (let i = 0; i < 205; i++) lru.set(String(i), i);
  assert.equal(lru.size, 200);
  assert.equal(lru.get('0'), undefined);
  c.advance(600_000);
  assert.equal(lru.get('204'), undefined);
});

test('cacheable() is false with any history, prior citations, other language or tools', () => {
  assert.equal(cacheable({}), true);
  assert.equal(cacheable({ history: [], prevCited: [], lang: 'en' }), true);
  assert.equal(cacheable({ lang: 'en-GB' }), true);
  assert.equal(cacheable({ history: ['What does he do?'] }), false);
  assert.equal(cacheable({ history: [''] }), false);
  assert.equal(cacheable({ prevCited: ['exp:0'] }), false);
  assert.equal(cacheable({ lang: 'hi' }), false);
  assert.equal(cacheable({ tools: true }), false);
  assert.equal(cacheable({ history: 'x' as unknown as string[] }), false);
});

test('the key binds feature, question, scope, model and corpus hash', () => {
  const base = { feature: 'ask', question: 'What is UrbanCare?', model: 'm1', corpusHash: 'h1' };
  const k = cacheKey(base);
  assert.equal(cacheKey({ ...base, question: '  what is   urbancare ?? ' }), k, 'case, spacing and trailing punctuation fold');
  assert.notEqual(cacheKey({ ...base, feature: 'brief' }), k);
  assert.notEqual(cacheKey({ ...base, model: 'm2' }), k);
  assert.notEqual(cacheKey({ ...base, corpusHash: 'h2' }), k);
  assert.notEqual(cacheKey({ ...base, scope: { project: 'urbancare-ai' } }), k);
  assert.notEqual(cacheKey({ ...base, scope: { project: 'omni-lab' } }), cacheKey({ ...base, scope: { project: 'urbancare-ai' } }));
  assert.equal(normalizeQuestion('Hello？'), 'hello');
});
