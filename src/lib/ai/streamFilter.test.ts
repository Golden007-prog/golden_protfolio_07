import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { buildCorpus, entities, type CorpusSources } from './corpus.ts';
import { createSentenceFilter, type SentenceFilterOptions } from './streamFilter.ts';

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
};
const chunks = buildCorpus(src);
const ents = entities({ profile: src.profile, projects: src.projects, skills: src.skillsIndex, reading: src.reading });
const CANARY = 'cnry-0123456789abcdef';

function filter(overrides: Partial<SentenceFilterOptions> = {}) {
  return createSentenceFilter({
    allowed: new Set(chunks.map((c) => c.id)),
    facts: new Map(chunks.map((c) => [c.id, c.text])),
    entities: ents,
    canary: CANARY,
    allow: { urls: ents.allowUrls, emails: ents.allowEmails },
    ...overrides,
  });
}

/** Feeds the deltas and returns everything released plus the end summary. */
function run(deltas: string[], overrides?: Partial<SentenceFilterOptions>) {
  const f = filter(overrides);
  const out: string[] = [];
  let blocked: string | undefined;
  for (const d of deltas) {
    const r = f.push(d);
    out.push(...r.emit);
    blocked ??= r.blocked;
  }
  const end = f.end();
  out.push(...end.emit);
  return { text: out.join(''), parts: out, end, blocked: blocked ?? end.blocked };
}

test('a Markdown link split across two pushes emits no link', () => {
  const r = run(['See [x](https://ev', 'il.example) for more. That is all.']);
  assert.ok(!/evil|https?:|\]\(/.test(r.text), r.text);
  assert.match(r.text, /See x for more\./);
});

test('a canary split across two pushes blocks the answer', () => {
  const r = run(['He built UrbanCare AI [c:project:urbancare-ai#tagline]. The marker is cnry-01234', '56789abcdef and more.']);
  assert.equal(r.blocked, 'canary');
  assert.ok(!r.text.includes('56789abcdef'));
  assert.equal(r.end.degraded, true);
  // A later push stays blocked.
  const f = filter();
  f.push('cnry-0123456789');
  assert.equal(f.push('abcdef').blocked, 'canary');
  assert.equal(f.push('More text. Here.').blocked, 'canary');
});

test("'He is AWS certified [c:profile:about]' is dropped", () => {
  const r = run(['He is AWS certified [c:profile:about].']);
  assert.equal(r.text, '');
  assert.equal(r.end.dropped, 1);
});

test("the Master's is dropped when phrased as held and kept when pursued", () => {
  const held = run(["He holds a Master's in Data Science [c:edu:0]."]);
  assert.equal(held.text, '');
  assert.equal(held.end.dropped, 1);
  const pursuing = run(["He is pursuing a Master's in Data Science [c:edu:0]."]);
  assert.equal(pursuing.text, "He is pursuing a Master's in Data Science [c:edu:0].");
  assert.deepEqual(pursuing.end.cited, ['edu:0']);
});

test("'५ years of experience' is caught", () => {
  const r = run(['He has ५ years of experience [c:profile:about].']);
  assert.equal(r.text, '');
  assert.equal(r.end.dropped, 1);
});

test('a foreign email is scrubbed while the site email is kept', () => {
  const r = run(['You can email hire@evil.example or basuoikantik@gmail.com [c:profile:availability].']);
  assert.ok(!r.text.includes('evil.example'), r.text);
  assert.ok(r.text.includes('basuoikantik@gmail.com'), r.text);
});

test('an uncited claim about him is dropped; an honest "not on this site" is kept', () => {
  const r = run(['He built UrbanCare AI. ', "His salary isn't on this site. ", 'You can ask through the contact form.']);
  assert.equal(r.text, "His salary isn't on this site. You can ask through the contact form.");
  assert.equal(r.end.dropped, 1);
  assert.equal(r.end.kept, 2);
});

test('a reference chunk alone cannot carry a claim about him', () => {
  const r = run([
    'He uses LangChain daily [c:ref:langchain]. ',
    'LangChain is a framework for LLM applications [c:ref:langchain]. ',
    'He lists LangChain under GenAI & LLMs [c:skills:genai-llms][c:ref:langchain].',
  ]);
  assert.equal(
    r.text,
    'LangChain is a framework for LLM applications [c:ref:langchain]. He lists LangChain under GenAI & LLMs [c:skills:genai-llms][c:ref:langchain].',
  );
  assert.equal(r.end.dropped, 1);
});

test('unknown citation ids are removed and cannot carry a claim', () => {
  const r = run(['He built UrbanCare AI [c:project:fake#x].'], { allowed: new Set(['project:urbancare-ai#tagline']) });
  assert.equal(r.text, '');
  const ok = run(['He built UrbanCare AI [c:project:fake#x][c:project:urbancare-ai#tagline].']);
  assert.equal(ok.text, 'He built UrbanCare AI [c:project:urbancare-ai#tagline].');
});

test('sentences release as soon as they end, keeping separators and trailing citations', () => {
  const f = filter();
  assert.deepEqual(f.push('UrbanCare AI is clinical AI [c:project:urbancare-ai#tagline'), { emit: [] });
  assert.deepEqual(f.push(']. '), { emit: [] }, 'waits: the next sentence has not started');
  assert.deepEqual(f.push('[c'), { emit: [] }, 'waits: a late citation could still belong to it');
  const r = f.push(':project:urbancare-ai#summary] It uses MedGemma [c:project:urbancare-ai#full].\n\n- Omni-Lab is a tutor');
  assert.deepEqual(r.emit, [
    'UrbanCare AI is clinical AI [c:project:urbancare-ai#tagline]. [c:project:urbancare-ai#summary] ',
    'It uses MedGemma [c:project:urbancare-ai#full].\n\n',
  ]);
  const end = f.end();
  assert.deepEqual(end.emit, [], 'the trailing uncited project claim is dropped');
  assert.equal(end.kept, 2);
  assert.equal(end.dropped, 1);
  assert.deepEqual(end.cited, ['project:urbancare-ai#tagline', 'project:urbancare-ai#summary', 'project:urbancare-ai#full']);
});

test('abbreviations and decimals do not split sentences', () => {
  const r = run(['It reached R² ≈ 0.999 on trend fitting, e.g. with Linear Regression [c:project:tcs-stock-forecasting#full]. Done.']);
  assert.equal(r.parts.length, 2);
  assert.match(r.parts[0], /0\.999 on trend fitting, e\.g\. with Linear Regression/);
});

test('degraded is set when more than 30% of sentences are dropped', () => {
  const r = run([
    'He built UrbanCare AI [c:project:urbancare-ai#tagline]. ',
    'He has 9 years of experience [c:profile:about]. ',
    'He is AWS certified [c:profile:about]. ',
    'Omni-Lab uses Gemini 3 Pro [c:project:omni-lab#summary].',
  ]);
  assert.equal(r.end.kept, 2);
  assert.equal(r.end.dropped, 2);
  assert.equal(r.end.degraded, true);
  const fine = run(['He built UrbanCare AI [c:project:urbancare-ai#tagline]. Omni-Lab uses Veo [c:project:omni-lab#summary].']);
  assert.equal(fine.end.degraded, false);
});

test('a truthful denial of employment is released; an employer claim is still dropped', () => {
  const denial = run(['No, he has not worked at OpenAI or Google DeepMind [c:profile:about]. ', 'He is a Freelance AI Agent Specialist at Mindrift [c:exp:1].']);
  assert.match(denial.text, /has not worked at OpenAI or Google DeepMind/);
  assert.equal(denial.end.dropped, 0);
  assert.equal(denial.end.degraded, false);

  const claim = run(['He works at Google DeepMind [c:profile:about]. ', 'He is a Freelance AI Agent Specialist at Mindrift [c:exp:1].']);
  assert.ok(!claim.text.includes('DeepMind'), claim.text);
  assert.equal(claim.end.dropped, 1);
});

test('a Title Case employer claim is withheld; a listed role in Title Case with its own citation is released', () => {
  const r = run([
    'He was a Research Scientist at Google DeepMind [c:project:urbancare-ai#summary]. ',
    'He is a Senior Researcher at Anthropic [c:exp:1]. ',
    'He is a Freelance AI Agent Specialist at Mindrift [c:exp:1].',
  ]);
  assert.ok(!/DeepMind|Anthropic/.test(r.text), r.text);
  assert.match(r.text, /Freelance AI Agent Specialist at Mindrift/);
  assert.equal(r.end.dropped, 2);
  assert.equal(r.end.kept, 1);
});
