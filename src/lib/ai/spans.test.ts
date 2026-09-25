import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { visible, type Store, type StoreEntry } from './reviewGate.ts';
import {
  agreement,
  evidenceIds,
  experienceEvidence,
  finalizeVerdict,
  isSentimentResponse,
  MAX_SPANS,
  namesPhrase,
  RATIONALE_MAX,
  sentencesOf,
  tidyRationale,
  verifySpans,
} from './spans.ts';

const span = (text: string, start: number, end: number, polarity = 'positive') => ({ text, start, end, polarity });

/* ---- verifySpans ---- */

test('a span whose offsets hold is kept in place', () => {
  const src = 'The docs are good but the API is a mess.';
  const r = verifySpans(src, [span('good', 13, 17), span('a mess', 33, 39, 'negative')]);
  assert.deepEqual(r.kept, [
    { text: 'good', start: 13, end: 17, polarity: 'positive' },
    { text: 'a mess', start: 33, end: 39, polarity: 'negative' },
  ]);
  assert.equal(r.dropped, 0);
  assert.equal(r.relocated, 0);
});

test('wrong offsets are relocated to the exact occurrence', () => {
  const src = 'Oh great, another outage.';
  const r = verifySpans(src, [span('another outage', 0, 3, 'negative')]);
  assert.deepEqual(r.kept, [{ text: 'another outage', start: 10, end: 24, polarity: 'negative' }]);
  assert.equal(src.slice(r.kept[0].start, r.kept[0].end), 'another outage');
  assert.equal(r.relocated, 1);
});

test('code-point offsets after an emoji are moved onto UTF-16 offsets', () => {
  const src = '🚀 launch went great';
  // A model counting code points says 'great' starts at 14; in UTF-16 it is 15.
  const r = verifySpans(src, [span('great', 14, 19)]);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].start, 15);
  assert.equal(r.relocated, 1);
  assert.equal(src.slice(r.kept[0].start, r.kept[0].end), 'great');
});

test('with several occurrences the one nearest the claimed start wins', () => {
  const src = 'fast build, fast tests, fast deploy';
  const r = verifySpans(src, [span('fast', 20, 24)]);
  assert.equal(r.kept[0].start, 24);
});

test('a phrase that is not in the text is dropped, never paraphrased or case-folded', () => {
  const src = 'Really love waiting ten minutes for a build.';
  const r = verifySpans(src, [span('loves waiting', 7, 20, 'negative'), span('Love', 7, 11), span('ten minutes', 20, 31, 'negative')]);
  assert.deepEqual(
    r.kept.map((s) => s.text),
    ['ten minutes'],
  );
  assert.equal(r.dropped, 2);
});

test('a span that would cut a word in half is dropped', () => {
  const src = 'Both skills improved.';
  const r = verifySpans(src, [span('kill', 6, 10, 'negative'), span('improved', 12, 20)]);
  assert.deepEqual(
    r.kept.map((s) => s.text),
    ['improved'],
  );
});

test('a second span on the same words takes the next free occurrence or is dropped', () => {
  const src = 'good, good';
  const r = verifySpans(src, [span('good', 0, 4), span('good', 0, 4), span('good', 0, 4)]);
  assert.deepEqual(
    r.kept.map((s) => s.start),
    [0, 6],
  );
  assert.equal(r.dropped, 1);
});

test('overlapping spans keep the first', () => {
  const src = 'not bad at all';
  const r = verifySpans(src, [span('not bad', 0, 7), span('bad at all', 4, 14)]);
  assert.deepEqual(
    r.kept.map((s) => s.text),
    ['not bad'],
  );
});

test('padding whitespace is trimmed and bad entries are ignored', () => {
  const src = 'Kill the stuck process and the error is gone.';
  const r = verifySpans(src, [
    span(' error is gone ', 30, 45),
    { text: 'stuck', start: 9, end: 14, polarity: 'angry' },
    { text: '', start: 0, end: 0, polarity: 'neutral' },
    { text: 42, start: 0, end: 2, polarity: 'neutral' },
    null,
    'error',
  ]);
  assert.deepEqual(r.kept, [{ text: 'error is gone', start: 31, end: 44, polarity: 'positive' }]);
  assert.equal(r.dropped, 5);
  assert.deepEqual(verifySpans(src, 'not a list'), { kept: [], dropped: 0, relocated: 0 });
  assert.equal(verifySpans('', [span('x', 0, 1)]).dropped, 1);
});

test('at most MAX_SPANS are kept, sorted by start', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${String.fromCharCode(97 + i)}`);
  const src = words.join(' ');
  const r = verifySpans(
    src,
    [...words].reverse().map((w) => span(w, 0, 0)),
  );
  assert.equal(r.kept.length, MAX_SPANS);
  assert.equal(r.dropped, 12 - MAX_SPANS);
  const starts = r.kept.map((s) => s.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

/* ---- finalizeVerdict ---- */

test('finalizeVerdict clamps the score, tidies the rationale and verifies the spans', () => {
  const src = 'Oh great, another outage.';
  const r = finalizeVerdict(src, {
    label: 'negative',
    score: -1.4,
    rationale: '**Sarcasm**: see https://evil.example or mail hi@evil.example — "great" is ironic.',
    aspects: [span('Oh great', 0, 8, 'negative'), span('outage!', 18, 25, 'negative')],
  });
  assert.ok(r);
  assert.equal(r.verdict.score, -1);
  assert.equal(r.verdict.label, 'negative');
  assert.doesNotMatch(r.verdict.rationale, /evil|https?:|@|\*\*/);
  assert.match(r.verdict.rationale, /Sarcasm/);
  assert.deepEqual(
    r.verdict.aspects.map((s) => s.text),
    ['Oh great'],
  );
  assert.equal(r.dropped, 1);
});

test('finalizeVerdict refuses contradictions, unknown labels and canary leaks', () => {
  const src = 'fine';
  assert.equal(finalizeVerdict(src, { label: 'positive', score: -0.5, rationale: '', aspects: [] }), null);
  assert.equal(finalizeVerdict(src, { label: 'negative', score: 0.2, rationale: '', aspects: [] }), null);
  assert.equal(finalizeVerdict(src, { label: 'angry', score: -0.5, rationale: '', aspects: [] }), null);
  assert.equal(finalizeVerdict(src, { label: 'neutral', score: 'high', rationale: '', aspects: [] }), null);
  assert.equal(finalizeVerdict(src, { label: 'neutral', score: 0, rationale: 'marker cnry-0123456789abcdef', aspects: [] }), null);
  assert.equal(finalizeVerdict(src, { label: 'neutral', score: 0, rationale: 'says XYZ', aspects: [] }, { canary: 'XYZ' }), null);
  assert.equal(finalizeVerdict(src, null), null);
  // Neutral and mixed may carry either sign.
  assert.ok(finalizeVerdict(src, { label: 'mixed', score: -0.2, rationale: 'both', aspects: [] }));
  assert.ok(finalizeVerdict(src, { label: 'neutral', score: 0.1, rationale: 'flat', aspects: [] }));
});

test('tidyRationale keeps at most 160 characters, cut at a word', () => {
  const long = 'The writer uses the positive word great ironically about an outage, so the sentence reads as a complaint even though its only lexicon word is positive and upbeat in isolation.';
  const out = tidyRationale(long);
  assert.ok(out.length <= RATIONALE_MAX, String(out.length));
  assert.match(out, /…$/);
  assert.doesNotMatch(out, / …$/);
  assert.equal(tidyRationale('  short\n\nline  '), 'short line');
  assert.equal(tidyRationale(undefined), '');
});

test('isSentimentResponse checks the success body shape', () => {
  const ok = { label: 'mixed', score: 0, rationale: 'r', model: 'm', dropped: 0, aspects: [span('a', 0, 1, 'neutral')] };
  assert.equal(isSentimentResponse(ok), true);
  assert.equal(isSentimentResponse({ ...ok, label: 'happy' }), false);
  assert.equal(isSentimentResponse({ ...ok, aspects: [span('a', 0.5, 1)] }), false);
  assert.equal(isSentimentResponse({ mode: 'fallback', reason: 'quota' }), false);
});

test('agreement: same label agrees, opposite polarities disagree, the rest differ', () => {
  assert.equal(agreement('negative', 'negative'), 'agree');
  assert.equal(agreement('positive', 'negative'), 'disagree');
  assert.equal(agreement('negative', 'positive'), 'disagree');
  assert.equal(agreement('neutral', 'mixed'), 'differ');
  assert.equal(agreement('positive', 'neutral'), 'differ');
  assert.equal(agreement('neutral', 'positive'), 'differ');
});

/* ---- where the site names a skill ---- */

test('namesPhrase: exact but for the first letter, and whole words only', () => {
  assert.equal(namesPhrase('Architecting multi-agent systems using ReAct framework', 'ReAct'), true);
  assert.equal(namesPhrase('A React front end', 'ReAct'), false);
  assert.equal(namesPhrase('Built with ReAct', 'React'), false);
  assert.equal(namesPhrase('accuracy through semantic chunking and vectorization', 'Semantic chunking'), true);
  assert.equal(namesPhrase('accuracy through semantic chunking and vectorization', 'Vectorization'), true);
  assert.equal(namesPhrase('Pushed to GitHub', 'Git'), false);
  assert.equal(namesPhrase('vector databases (Chroma/FAISS)', 'FAISS'), true);
  assert.equal(namesPhrase('Built SQL-based data mining queries', 'SQL'), true);
  assert.equal(namesPhrase('anything', ''), false);
});

const ROLES = [
  {
    company: 'Lab One',
    role: 'Program',
    description: 'Architecting agents with ReAct and LangGraph. Serving them via FastAPI. Tuning FastAPI workers.',
    highlights: ['Agents on ReAct + LangGraph', 'FastAPI serving'],
  },
  { company: 'Two Co', role: 'Intern', description: 'Built React dashboards.', highlights: ['React front ends'] },
];

test('experienceEvidence lists the roles naming a skill, highlights first, capped', () => {
  assert.deepEqual(experienceEvidence(ROLES, 'ReAct'), [
    { index: 0, company: 'Lab One', role: 'Program', lines: ['Agents on ReAct + LangGraph', 'Architecting agents with ReAct and LangGraph.'] },
  ]);
  assert.deepEqual(
    experienceEvidence(ROLES, 'FastAPI', 3)[0].lines,
    ['FastAPI serving', 'Serving them via FastAPI.', 'Tuning FastAPI workers.'],
  );
  assert.deepEqual(experienceEvidence(ROLES, 'Tableau'), []);
  assert.deepEqual(
    sentencesOf('One. Two! Three? four'),
    ['One.', 'Two!', 'Three? four'],
  );
  assert.deepEqual(evidenceIds(['b-proj', 'a-proj'], [{ index: 2 }, { index: 0 }]), ['exp:0', 'exp:2', 'project:a-proj', 'project:b-proj']);
});

/* ---- the precomputed store (src/data/ai-generated/skills.json) ---- */

type StoreValue = Record<string, unknown>;

function readStore(): Store<StoreValue> {
  const raw = readFileSync(new URL('../../data/ai-generated/skills.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as Store<StoreValue>;
}

test('skills store: summaries are claim-bearing and a production render hides them until reviewed', () => {
  const store = readStore();
  assert.equal(store.version, 1);
  for (const [key, entry] of Object.entries(store.entries) as [string, StoreEntry<StoreValue>][]) {
    const kind = key.split(':')[0];
    assert.ok(['summary', 'explain', 'gallery'].includes(kind), `unexpected key ${key}`);
    if (kind === 'summary') {
      assert.equal(entry.claimBearing, true, key);
      assert.equal(visible(entry, false), entry.reviewed === true, `${key} in production`);
      assert.equal(visible(entry, true), true, `${key} on preview`);
      assert.ok(Array.isArray(entry.value.evidence) && entry.value.evidence.length > 0, `${key} has evidence ids`);
    } else {
      assert.equal(entry.claimBearing, false, key);
      assert.equal(visible(entry, false), true, key);
    }
  }
});

test('skills store: every gallery verdict passes the same gate as the live route', () => {
  const store = readStore();
  for (const [key, entry] of Object.entries(store.entries)) {
    if (!key.startsWith('gallery:')) continue;
    const v = entry.value as { text: string; label: unknown; score: unknown; rationale: unknown; aspects: unknown };
    const again = finalizeVerdict(v.text, v);
    assert.ok(again, `${key} passes finalizeVerdict`);
    assert.deepEqual(again.verdict.aspects, v.aspects, `${key} spans are already verified`);
    assert.ok(again.verdict.rationale.length <= RATIONALE_MAX, key);
  }
});
