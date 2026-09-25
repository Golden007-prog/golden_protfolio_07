import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AI_EXPORT_NOTE, keepAllowed, splitCitations, toMarkdown } from './citations.ts';
import type { AiSource } from './protocol.ts';

const projects = JSON.parse(readFileSync(new URL('../../data/projects.json', import.meta.url), 'utf8')) as {
  slug: string;
  problem?: string;
  solution?: string;
}[];
// Only projects with a problem and a solution get a /projects/<slug> page (hasCaseStudy; dynamicParams is false).
const CASE_STUDIES = projects.filter((p) => p.problem && p.solution).map((p) => p.slug);

test('splitCitations handles valid, multi-id and adjacent markers', () => {
  assert.deepEqual(splitCitations('He built it [c:project:omni-lab#summary].'), [
    { text: 'He built it ' },
    { cite: 'project:omni-lab#summary' },
    { text: '.' },
  ]);
  assert.deepEqual(splitCitations('A[c:exp:0][c:exp:1] B'), [{ text: 'A' }, { cite: 'exp:0' }, { cite: 'exp:1' }, { text: ' B' }]);
  assert.deepEqual(splitCitations('A [c:exp:0, c:edu:1]'), [{ text: 'A ' }, { cite: 'exp:0' }, { cite: 'edu:1' }]);
});

test('splitCitations never throws on malformed markers', () => {
  for (const bad of ['[c:', 'x [c:', '[c:]', '[c:not an id!]', '[[c:exp:0]', '[c:exp:0', ']]]', '', '[c:EXP:0]']) {
    assert.doesNotThrow(() => splitCitations(bad), bad);
  }
  assert.deepEqual(splitCitations('x [c:'), [{ text: 'x [c:' }]);
  assert.deepEqual(splitCitations('[c:not an id!]'), [{ text: '[c:not an id!]' }]);
  assert.deepEqual(splitCitations(undefined as unknown as string), []);
});

test('keepAllowed keeps allowed ids and counts every dropped one exactly', () => {
  const allowed = new Set(['exp:0', 'edu:0']);
  assert.deepEqual(keepAllowed('Works on agents [c:exp:0].', allowed), { text: 'Works on agents [c:exp:0].', cited: ['exp:0'], dropped: 0 });
  assert.deepEqual(keepAllowed('Unknown source [c:exp:9].', allowed), { text: 'Unknown source.', cited: [], dropped: 1 });
  assert.deepEqual(keepAllowed('Mixed [c:exp:0, exp:9, edu:0].', allowed), {
    text: 'Mixed [c:exp:0][c:edu:0].',
    cited: ['exp:0', 'edu:0'],
    dropped: 1,
  });
  assert.deepEqual(keepAllowed('Adjacent [c:exp:9][c:exp:8][c:edu:0]', allowed), { text: 'Adjacent [c:edu:0]', cited: ['edu:0'], dropped: 2 });
  assert.deepEqual(keepAllowed('Malformed [c:not valid!] here', allowed), { text: 'Malformed here', cited: [], dropped: 1 });
  assert.deepEqual(keepAllowed('Cut off [c:', allowed), { text: 'Cut off', cited: [], dropped: 1 });
  assert.deepEqual(keepAllowed('Twice [c:exp:0] and [c:exp:0].', ['exp:0']), {
    text: 'Twice [c:exp:0] and [c:exp:0].',
    cited: ['exp:0'],
    dropped: 0,
  });
});

test('toMarkdown numbers footnotes and links case studies to their pages', () => {
  const sources: AiSource[] = [
    { id: 'project:urbancare-ai#summary', label: 'UrbanCare AI · Summary', cls: 'self', target: { kind: 'project', slug: 'urbancare-ai' } },
    {
      id: 'project:tcs-stock-forecasting#summary',
      label: 'TCS Stock Forecasting · Summary',
      cls: 'self',
      target: { kind: 'project', slug: 'tcs-stock-forecasting' },
    },
    { id: 'ref:faiss', label: 'FAISS · reference', cls: 'reference', target: { kind: 'skill', name: 'FAISS' } },
    { id: 'live:leetcode', label: 'LeetCode', cls: 'live', target: { kind: 'section', id: 'experience' }, asOf: '2026-09-25' },
  ];
  const md = toMarkdown(
    'UrbanCare is clinical AI [c:project:urbancare-ai#summary]. TCS is forecasting [c:project:tcs-stock-forecasting#summary][c:project:urbancare-ai#summary]. FAISS is a library [c:ref:faiss]. He solves problems [c:live:leetcode]. Ghost [c:exp:9].',
    sources,
    { origin: 'https://www.basuoikantik.in/', caseStudySlugs: CASE_STUDIES },
  );
  assert.equal(CASE_STUDIES.length, 5);
  assert.match(md, /UrbanCare is clinical AI\[\^1\]\. TCS is forecasting\[\^2\]\[\^1\]\./);
  assert.match(md, /\[\^1\]: \[UrbanCare AI · Summary\]\(https:\/\/www\.basuoikantik\.in\/projects\/urbancare-ai\)/);
  assert.match(md, /\[\^2\]: \[TCS Stock Forecasting · Summary\]\(https:\/\/www\.basuoikantik\.in\/\?project=tcs-stock-forecasting\)/);
  assert.match(md, /\[\^3\]: \[FAISS · reference\]\(https:\/\/www\.basuoikantik\.in\/\?skill=faiss\) \(general reference\)/);
  assert.match(md, /\[\^4\]: \[LeetCode\]\(https:\/\/www\.basuoikantik\.in\/#experience\) \(as of 2026-09-25\)/);
  assert.ok(!md.includes('exp:9') && !md.includes('[c:'), 'unknown markers are dropped');
  assert.ok(md.trimEnd().endsWith(`_${AI_EXPORT_NOTE}_`), 'every export carries the AI-generated line');
  assert.match(AI_EXPORT_NOTE, /AI-generated/);
});

test('toMarkdown with no citations still carries the AI-generated line', () => {
  const md = toMarkdown("That isn't on this site.", [], { origin: 'https://basuoikantik.in', caseStudySlugs: [] });
  assert.equal(md, `That isn't on this site.\n\n_${AI_EXPORT_NOTE}_`);
});
