import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { estimateTokens, packContext, passesGate, scopeFilter } from './context.ts';
import { parseAchievements } from '../achievements.ts';
import { parseCertifications } from '../certifications.ts';
import { buildCorpus, CORE_CARD_IDS, type CorpusSources } from './corpus.ts';
import { buildBm25, hybrid } from './retrieval.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
const src: CorpusSources = {
  profile: read('profile.json'),
  projects: read('projects.json'),
  githubFacts: read('github-facts.json'),
  reading: read('reading.json'),
  tools: read('tools.json'),
  skillsIndex: read('skills-index.json'),
  liveSnapshot: read('live-snapshot.json'),
  siteCopy: SITE_COPY,
  certifications: parseCertifications(read('certifications.json')),
  achievements: parseAchievements(read('achievements.json')),
};
const chunks = buildCorpus(src);
const byId = new Map(chunks.map((c) => [c.id, c]));
const index = buildBm25(chunks);
const data = { projects: src.projects, profile: src.profile };
const REACT_ONLY = ['urbancare-ai', 'omni-lab', 'content-storyteller'];

test('scope {project: omni-lab} yields no other project', () => {
  const pass = chunks.filter(scopeFilter({ project: 'omni-lab' }, data));
  assert.ok(pass.some((c) => c.id === 'project:omni-lab#summary'));
  assert.ok(pass.some((c) => c.id === 'facts:omni-lab'));
  for (const c of pass) {
    assert.ok(!(c.id.startsWith('project:') || c.id.startsWith('facts:')) || c.id.includes('omni-lab'), c.id);
    assert.ok(/^(project:omni-lab#|facts:omni-lab$|ref:|skills:)/.test(c.id), c.id);
  }
  // Its stack names Gemini, so the Gemini reference and the list that names it come along.
  assert.ok(pass.some((c) => c.id === 'ref:gemini'));
  assert.ok(pass.some((c) => c.id === 'skills:genai-llms'));

  const filter = scopeFilter({ project: 'omni-lab' }, data);
  const hits = hybrid({ index, query: 'Gemini agents voice video', k: 10, filter });
  const packed = packContext({ chunks, byId, hits, scope: { project: 'omni-lab' }, mode: 'retrieval', filter });
  const projects = packed.sources.filter((s) => s.target.kind === 'project');
  assert.ok(projects.length > 0);
  assert.ok(projects.every((s) => s.target.kind === 'project' && s.target.slug === 'omni-lab'));
  assert.equal(scopeFilter({ project: 'no-such-project' }, data)(chunks[0]), false);
});

test('scope {skill: ReAct} excludes React-only projects and keeps the reference as reference', () => {
  const pass = chunks.filter(scopeFilter({ skill: 'ReAct' }, data));
  const ids = pass.map((c) => c.id);
  for (const slug of REACT_ONLY) assert.ok(!ids.some((id) => id.includes(slug)), `${slug} leaked in`);
  assert.ok(ids.includes('exp:0'), 'the iHUB role names ReAct verbatim');
  assert.ok(ids.includes('exp:0#h0'));
  assert.ok(!ids.includes('exp:1'), 'Mindrift does not mention ReAct');
  assert.ok(ids.includes('skills:genai-llms'));
  assert.equal(byId.get('ref:react')?.cls, 'reference');
  assert.ok(ids.includes('ref:react'));

  // The same rule for React picks up exactly the React projects.
  const react = chunks.filter(scopeFilter({ skill: 'React' }, data)).map((c) => c.id);
  for (const slug of REACT_ONLY) assert.ok(react.some((id) => id.startsWith(`project:${slug}#`)), slug);
  assert.ok(!react.includes('exp:0'));
});

test('scope {experience: 1} yields only Mindrift chunks', () => {
  const pass = chunks.filter(scopeFilter({ experience: 1 }, data));
  assert.ok(pass.length >= 3);
  for (const c of pass) {
    assert.match(c.id, /^exp:1(#|$)/);
    assert.match(c.text, /Mindrift/);
  }
  const filter = scopeFilter({ experience: 1 }, data);
  const hits = hybrid({ index, query: 'RLHF evaluation agents', k: 8, filter });
  const packed = packContext({ chunks, byId, hits, scope: { experience: 1 }, mode: 'retrieval', filter });
  const extra = packed.sources.filter((s) => !CORE_CARD_IDS.includes(s.id));
  assert.ok(extra.length > 0);
  for (const s of extra) assert.match(s.id, /^exp:1(#|$)/);
});

test('scope {section: philosophy} yields the six tenets', () => {
  const pass = chunks.filter(scopeFilter({ section: 'philosophy' }, data)).map((c) => c.id);
  assert.deepEqual(pass, [0, 1, 2, 3, 4, 5].map((i) => `copy:philosophy#${i}`));
});

test('packContext always carries the core card and respects the budget', () => {
  const hits = chunks.map((c) => ({ id: c.id }));
  for (const budget of [1200, 3000]) {
    const packed = packContext({ chunks, byId, hits, mode: 'retrieval', budgetTokens: budget });
    for (const id of CORE_CARD_IDS) assert.ok(packed.allowed.has(id), id);
    assert.ok(estimateTokens(packed.text) <= budget, `${estimateTokens(packed.text)} > ${budget}`);
    assert.ok(packed.sources.length > CORE_CARD_IDS.length);
  }
  const tiny = packContext({ chunks, byId, hits, mode: 'retrieval', budgetTokens: 10 });
  assert.deepEqual([...tiny.allowed], [...CORE_CARD_IDS], 'the core card is never cut');
});

test('packContext orders the strongest hits first and last and wraps untrusted chunks', () => {
  const hits = ['exp:0', 'exp:1', 'exp:2', 'ref:react', 'live:leetcode'].map((id) => ({ id }));
  const packed = packContext({ chunks, byId, hits, mode: 'retrieval' });
  const order = packed.sources.map((s) => s.id).slice(CORE_CARD_IDS.length);
  assert.deepEqual(order, ['exp:0', 'exp:2', 'live:leetcode', 'ref:react', 'exp:1']);
  assert.match(packed.text, /<<<UNTRUSTED c:ref:react \(reference\)>>>/);
  assert.match(packed.text, /not his use of it/);
  assert.match(packed.text, /<<<UNTRUSTED c:live:leetcode \(live\)>>>/);
  assert.ok(!/<<<UNTRUSTED c:exp:0/.test(packed.text), 'self chunks are not wrapped');
  assert.equal(packed.facts.get('exp:1'), byId.get('exp:1')!.text);
  assert.equal(packed.sources.find((s) => s.id === 'live:leetcode')?.asOf, byId.get('live:leetcode')!.asOf);
});

test('an unknown prevCited id is ignored; a known one is added', () => {
  const packed = packContext({ chunks, byId, hits: [], mode: 'retrieval', prevCited: ['project:omni-lab#summary', 'project:ghost#x', 'nope'] });
  assert.ok(packed.allowed.has('project:omni-lab#summary'));
  assert.ok(!packed.allowed.has('project:ghost#x'));
  assert.ok(!packed.allowed.has('nope'));
});

test("'full' mode returns every self chunk and nothing else", () => {
  const packed = packContext({ chunks, byId, hits: [], mode: 'full' });
  const self = chunks.filter((c) => c.cls === 'self').map((c) => c.id);
  assert.deepEqual([...packed.allowed], self);
  assert.ok(!packed.text.includes('UNTRUSTED'));
});

test('the gate fails without a self hit above the threshold', () => {
  assert.equal(passesGate([{ id: 'ref:react', bm25: 0.9, cosine: 0.9 }], byId), false, 'reference only');
  assert.equal(passesGate([{ id: 'live:leetcode', bm25: 0.9, cosine: null }], byId), false, 'live only');
  assert.equal(passesGate([{ id: 'exp:0', bm25: 0.05, cosine: null }], byId), false, 'self but weak');
  assert.equal(passesGate([{ id: 'exp:0', bm25: 0.5, cosine: null }], byId), true);
  assert.equal(passesGate([{ id: 'exp:0', bm25: 0, cosine: 0.8 }], byId), true, 'a strong semantic hit passes');
  assert.equal(passesGate([], byId), false);
  const salary = hybrid({ index, query: 'What is his salary?', k: 5 });
  assert.equal(passesGate(salary, byId), false);
  const urbancare = hybrid({ index, query: 'Tell me about UrbanCare', k: 5 });
  assert.equal(passesGate(urbancare, byId), true);
});
