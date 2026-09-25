import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { buildCorpus, entities, type CorpusSources } from './corpus.ts';
import {
  BLURB_SHORT_MAX,
  buildMatrix,
  checkFitResponse,
  checkSynonym,
  classifyFact,
  cleanRequirements,
  clientCheckQuestions,
  computeBand,
  factRow,
  factRowsFromJd,
  filterTechFor,
  gapPrefill,
  jdSegments,
  lensParam,
  lensProjects,
  lensSources,
  LENSES,
  lexicalEvidenceFor,
  lexicalHits,
  nearestLens,
  nextStage,
  NOT_A_JD,
  NOT_STATED,
  plausibleId,
  PREFILL_MAX,
  rankProjectsByOverlap,
  reachOutPrefill,
  reportMarkdown,
  reportText,
  roleFromJd,
  runExtract,
  spellsNumber,
  stripMarkup,
  stripSofteners,
  summaryText,
  teamBlurbs,
  verifyBrief,
  verifyFitRows,
  verifyQuestions,
  visibleLenses,
  vocabulary,
  type ExtractModelOut,
  type FitData,
  type FitRow,
  type FitView,
  type LensStore,
  type LensValue,
  type Requirement,
} from './fit.ts';

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
const facts = new Map(chunks.filter((c) => c.cls === 'self').map((c) => [c.id, c.text]));
const ents = entities({ profile: src.profile, projects: src.projects, skills: src.skillsIndex, reading: src.reading });
const data: FitData = { profile: src.profile, projects: src.projects };
const vocab = vocabulary(data);
const TODAY = '2026-09';
const SITE_LINKS = { url: 'https://www.basuoikantik.in', cvUrl: 'https://www.basuoikantik.in/cv', builtAt: 'Sep 25, 2026' };

const req = (text: string, kind: Requirement['kind'] = 'must'): Requirement => ({ text, kind });

/* ---- #214 lexical pre-pass ---- */

test("lexical: 'React and LangGraph' matches LangGraph and not ReAct", () => {
  const terms = lexicalHits('React and LangGraph', data).map((h) => h.term);
  assert.ok(terms.includes('LangGraph'), terms.join(', '));
  assert.ok(!terms.includes('ReAct'), terms.join(', '));
  // React is a real project technology, so it is a hit of its own.
  assert.ok(terms.includes('React'));
});

test('lexical: hits carry categories, projectsForSkill counts and verbatim roles', () => {
  const hits = lexicalHits('We need RAG with LlamaIndex, Python and Kubernetes.', data);
  const byTerm = new Map(hits.map((h) => [h.term, h]));
  assert.equal(byTerm.get('LlamaIndex')?.category, 'GenAI & LLMs');
  assert.deepEqual(byTerm.get('LlamaIndex')?.roles, [0]);
  assert.ok((byTerm.get('Python')?.projects.length ?? 0) >= 4);
  assert.equal(byTerm.has('Kubernetes'), false);
  for (const h of hits) for (const e of h.evidence) assert.ok(facts.get(e.id)?.includes(e.quote), `${e.id} quotes '${e.quote}'`);
});

test('lexical: a lower-case multi-word skill still matches; single words keep strict case', () => {
  const terms = lexicalHits('Experience with semantic chunking. Must react to feedback.', data).map((h) => h.term);
  assert.ok(terms.includes('Semantic chunking'));
  assert.ok(!terms.includes('React'));
});

test('lexical: segments split lines and sentences but not Node.js', () => {
  assert.deepEqual(jdSegments('• Node.js and APIs. Python\n- SQL'), ['Node.js and APIs.', 'Python', 'SQL']);
});

test('lexical fallback: hand-offs work from keyword rows alone', () => {
  const jd = 'Senior ML Engineer\nPython, LangChain, Gemini and FastAPI required.';
  const view: FitView = { mode: 'lexical', role: roleFromJd(jd), rows: [], facts: [], lexical: lexicalHits(jd, data), projects: [], band: null };
  const prefill = reachOutPrefill(view);
  assert.equal(prefill.subject, 'Portfolio inquiry: Senior ML Engineer');
  assert.ok(prefill.message.length <= PREFILL_MAX);
  assert.match(prefill.message, /LangChain|Python|Gemini/);
  const blurbs = teamBlurbs(view, src.profile, SITE_LINKS);
  assert.ok(blurbs.short.length <= BLURB_SHORT_MAX, `${blurbs.short.length}`);
  assert.ok(blurbs.full.includes(SITE_LINKS.cvUrl));
  assert.equal(filterTechFor(view, data), 'Gemini');
});

/* ---- #215 extraction ---- */

const modelOut = (over: Partial<ExtractModelOut> = {}): ExtractModelOut => ({
  isJobDescription: true,
  language: 'en',
  title: 'ML Engineer',
  requirements: [{ text: 'Python', kind: 'must', category: 'skill' }],
  ...over,
});

test('extract: an email in the JD is redacted before the model call', async () => {
  const seen: string[] = [];
  const res = await runExtract('ML Engineer. Apply to hiring.lead@acme-corp.com or call +1 415 555 0134. Python required.', {
    generate: async (text) => {
      seen.push(text);
      return { data: modelOut() };
    },
  });
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes('hiring.lead@acme-corp.com'), seen[0]);
  assert.ok(seen[0].includes('[email removed]'));
  assert.ok(!seen[0].includes('555 0134'));
  assert.ok('isJobDescription' in res && res.isJobDescription && res.redacted >= 2);
});

test('extract: isJobDescription:false returns the refusal and no match call follows', async () => {
  let matchCalls = 0;
  const res = await runExtract('Dear Sam, lunch on Friday?', { generate: async () => ({ data: modelOut({ isJobDescription: false, requirements: [] }) }) });
  assert.deepEqual(res, { isJobDescription: false, message: NOT_A_JD });
  if (nextStage(res, true) === 'match') matchCalls += 1;
  assert.equal(nextStage(res, true), 'refused');
  assert.equal(matchCalls, 0);
});

test('extract: requirements are capped at 12 and cleaned', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ text: `Requirement ${i} ${'x'.repeat(i === 3 ? 400 : 0)}`, kind: i % 2 ? 'nice' : 'bogus', category: 'nonsense' }));
  const res = await runExtract('A job description', { generate: async () => ({ data: modelOut({ requirements: many }) }) });
  assert.ok('isJobDescription' in res && res.isJobDescription);
  if (!('isJobDescription' in res) || !res.isJobDescription) return;
  assert.equal(res.requirements.length, 12);
  assert.ok(res.requirements.every((r) => r.text.length <= 200 && (r.kind === 'must' || r.kind === 'nice') && r.category === 'other'));
  assert.equal(cleanRequirements([{ text: 'A' }, { text: ' a ' }, { text: '' }]).length, 1);
});

test('extract: a non-English JD keeps its English gloss; an English one drops it', async () => {
  const de = await runExtract('Wir suchen', {
    generate: async () => ({ data: modelOut({ language: 'de', requirements: [{ text: 'Erfahrung mit Python', kind: 'must', category: 'skill', gloss: 'Experience with Python' }] }) }),
  });
  assert.ok('isJobDescription' in de && de.isJobDescription && de.requirements[0].gloss === 'Experience with Python');
  const en = await runExtract('We need', { generate: async () => ({ data: modelOut({ requirements: [{ text: 'Python', kind: 'must', category: 'skill', gloss: 'Py' }] }) }) });
  assert.ok('isJobDescription' in en && en.isJobDescription && en.requirements[0].gloss === undefined);
});

test('extract: a model fallback passes straight through', async () => {
  const res = await runExtract('A JD', { generate: async () => ({ mode: 'fallback', reason: 'quota' }) });
  assert.deepEqual(res, { mode: 'fallback', reason: 'quota' });
  assert.equal(nextStage(res, false), 'fallback');
});

/* ---- #217 verification and the band ---- */

test('band: computed from fixed rows, must-haves weighted', () => {
  const rows = (spec: [Requirement['kind'], FitRow['status']][]) => spec.map(([kind, status]) => ({ kind, status }));
  assert.equal(computeBand(rows([['must', 'evidenced'], ['must', 'evidenced'], ['nice', 'adjacent']]))?.band, 'Strong');
  // 75% but a must-have missing: never Strong.
  assert.equal(computeBand(rows([['must', 'evidenced'], ['must', 'evidenced'], ['must', 'evidenced'], ['must', 'not-listed']]))?.band, 'Partial');
  assert.equal(computeBand(rows([['must', 'evidenced'], ['nice', 'not-listed'], ['must', 'adjacent']]))?.band, 'Partial');
  assert.equal(computeBand(rows([['must', 'not-listed'], ['must', 'not-listed'], ['nice', 'evidenced']]))?.band, 'Limited');
  assert.equal(computeBand([]), null);
  const band = computeBand(rows([['must', 'evidenced'], ['nice', 'adjacent'], ['must', 'not-listed']]));
  assert.equal(summaryText(band!.counts), '1 evidenced, 1 adjacent, 1 not listed');
});

const REQS = [req('LangGraph agents'), req('Vector databases'), req('Kubernetes'), req('Python', 'nice')];

test('verify: a row citing a nonexistent id is dropped', () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
      { index: 1, status: 'evidenced', evidence: [{ id: 'exp:9', quote: 'Chroma' }] },
      { index: 2, status: 'not-listed', evidence: [] },
      { index: 3, status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'Python' }] },
    ],
    requirements: REQS,
    facts,
    entities: ents,
    vocab,
  });
  assert.equal(out.dropped, 1);
  assert.equal(out.discarded, false);
  assert.equal(out.rows[0].status, 'evidenced');
  // The dropped row's requirement is back only as 'not listed', never with the fake evidence.
  assert.equal(out.rows[1].status, 'not-listed');
  assert.deepEqual(out.rows[1].evidence, []);
  assert.equal(out.rows[2].requirement, 'Kubernetes');
  assert.equal(out.rows[2].status, 'not-listed');
});

test('verify: more than 30% dropped discards the answer', () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'invented words' }] },
      { index: 1, status: 'evidenced', evidence: [{ id: 'project:nope#stack', quote: 'Chroma' }] },
      { index: 2, status: 'not-listed', evidence: [] },
    ],
    requirements: REQS,
    facts,
    entities: ents,
    vocab,
  });
  assert.equal(out.dropped, 2);
  assert.equal(out.discarded, true);
});

test('verify: an evidenced quote that lacks the requirement term is downgraded; a displayed synonym keeps it', () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'autonomous reasoning' }] },
      { index: 1, status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS' }], synonym: 'Chroma' },
    ],
    requirements: REQS.slice(0, 2),
    facts,
    entities: ents,
    vocab,
  });
  assert.equal(out.rows[0].status, 'adjacent');
  assert.equal(out.rows[1].status, 'evidenced');
  assert.equal(out.rows[1].synonym, 'Chroma');
});

test('verify: the keyword pass overrides a wrong not-listed', () => {
  const out = verifyFitRows({
    rows: [{ index: 0, status: 'not-listed', evidence: [] }],
    requirements: [req('Python')],
    facts,
    entities: ents,
    vocab,
    lexical: (r) => lexicalEvidenceFor(r, data, vocab),
  });
  assert.equal(out.rows[0].status, 'evidenced');
  assert.equal(out.rows[0].source, 'lexical');
});

test('verify: the client drops rows whose ids the site cannot have', () => {
  assert.equal(plausibleId('exp:1#m2', data), true);
  assert.equal(plausibleId('exp:1#m9', data), false);
  assert.equal(plausibleId('project:omni-lab#stack', data), true);
  assert.equal(plausibleId('project:nope#stack', data), false);
  assert.equal(plausibleId('ref:react', data), false);
  const rows: FitRow[] = [
    { requirement: 'a', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'LangGraph' }], source: 'ai' },
    { requirement: 'b', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:7', quote: 'x' }], source: 'ai' },
    { requirement: 'c', kind: 'must', status: 'not-listed', evidence: [], source: 'ai' },
  ];
  const { res, discarded } = checkFitResponse({ rows, projects: [], rankedBy: 'lexical', dropped: 0, model: 'm' }, data);
  assert.equal(res.rows.length, 2);
  assert.equal(discarded, true);
});

/* ---- #218 honest gaps ---- */

test("softeners: the post-check strips 'likely familiar with'", () => {
  const out = stripSofteners('He built RAG pipelines with LlamaIndex. He is likely familiar with Kubernetes. He could quickly learn Go.');
  assert.equal(out, 'He built RAG pipelines with LlamaIndex.');
  assert.ok(!/likely familiar with/i.test(out));
});

const VIEW: FitView = {
  mode: 'ai',
  role: 'Staff AI Engineer',
  rows: [
    { requirement: 'LangGraph agents', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'LangGraph', label: 'iHUB DivyaSampark @ IIT Roorkee · Agentic Systems and Design Program' }], source: 'ai' },
    { requirement: 'Python', kind: 'nice', status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'Python', label: 'Skills · Data Science & ML' }], source: 'ai' },
    { requirement: 'Vector databases', kind: 'must', status: 'adjacent', evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS' }], synonym: 'Chroma', source: 'ai' },
    { requirement: 'Kubernetes', kind: 'must', status: 'not-listed', evidence: [], source: 'ai' },
    { requirement: 'Go microservices', kind: 'nice', status: 'not-listed', evidence: [], source: 'ai' },
  ],
  facts: [],
  lexical: lexicalHits('LangGraph, Python, Kubernetes', data),
  projects: [{ slug: 'urbancare-ai', name: 'UrbanCare AI', quote: 'AI-Native Clinical Ecosystem for Mechanistic Interpretability' }],
  band: computeBand([
    { kind: 'must', status: 'evidenced' },
    { kind: 'nice', status: 'evidenced' },
    { kind: 'must', status: 'adjacent' },
    { kind: 'must', status: 'not-listed' },
    { kind: 'nice', status: 'not-listed' },
  ]),
};

test('gaps: the prefill lists exactly the not-listed rows', () => {
  const p = gapPrefill(VIEW)!;
  const listed = p.message
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
  assert.deepEqual(listed, ['Kubernetes', 'Go microservices']);
  assert.equal(gapPrefill({ ...VIEW, rows: VIEW.rows.filter((r) => r.status !== 'not-listed') }), null);
});

/* ---- #219 years and logistics from facts ---- */

test("facts: '5+ years Python' lists roles and durations with no total", () => {
  assert.equal(classifyFact('5+ years Python'), 'years');
  const row = factRow(req('5+ years Python'), src.profile, TODAY);
  const text = [row.answer, ...row.lines].join('\n');
  for (const e of src.profile.experience) assert.ok(text.includes(e.company), e.company);
  assert.ok(text.includes('1 yr 4 mos') && text.includes('9 mos') && text.includes('4 mos'));
  assert.ok(!text.includes('5 years'));
  assert.ok(!/\b\d+(?:\.\d+)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:total|experience|combined)/i.test(text));
  assert.ok(!/\b1[89]\s*months?\b/.test(text), 'no month total');
  assert.match(text, /Mar 2025 – present/);
});

test("facts: 'Visa sponsorship' is not stated; location and remote come from availability", () => {
  const visa = factRow(req('Visa sponsorship'), src.profile, TODAY);
  assert.equal(visa.fact, 'visa');
  assert.equal(visa.answer, null);
  assert.equal(NOT_STATED, 'Not stated on this site');
  assert.equal(factRow(req('Remote or hybrid'), src.profile, TODAY).answer, src.profile.availability.openTo);
  assert.equal(factRow(req('Location: Bengaluru'), src.profile, TODAY).answer, src.profile.location);
  for (const t of ['Notice period of 30 days', 'Salary: 20 LPA', 'Willing to relocate', 'Start date: ASAP']) {
    assert.equal(factRow(req(t), src.profile, TODAY).answer, null, t);
  }
});

test("facts: the Master's shows as in progress, expected Feb 2027; 'be able to' is not a degree", () => {
  const row = factRow(req("Master's degree in a quantitative field"), src.profile, TODAY);
  assert.equal(row.fact, 'education');
  assert.ok(row.lines.some((l) => /Master's/.test(l) && /In progress · Expected Feb 2027/.test(l)), row.lines.join(' | '));
  assert.equal(classifyFact('Must be able to own RAG evaluation'), null);
});

test('facts: the raw JD yields one row per kind for the no-AI path', () => {
  const rows = factRowsFromJd('ML Engineer\n5+ years Python.\nVisa sponsorship not available.\nRemote-first team.', src.profile, TODAY);
  assert.deepEqual(
    rows.map((r) => r.fact),
    ['years', 'visa', 'remote'],
  );
});

/* ---- #220 top projects ---- */

test('projects: the lexical fallback orders projects by overlap count', () => {
  const ranked = rankProjectsByOverlap('We use React, Node.js, PostgreSQL, LangChain and GCP. Python is a plus.', data.projects);
  assert.equal(ranked[0].slug, 'urbancare-ai');
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].overlap.length >= ranked[i].overlap.length);
  assert.ok(ranked[0].overlap.includes('LangChain'));
  assert.deepEqual(rankProjectsByOverlap('Kubernetes and Rust', data.projects), []);
});

/* ---- #221 the matrix ---- */

test('matrix: a React-to-ReAct mapping is rejected; a real synonym is labelled mapped by AI', () => {
  assert.equal(checkSynonym('Experience with React', 'ReAct', vocab), 'rejected');
  assert.equal(checkSynonym('ReAct-style agents', 'React', vocab), 'rejected');
  assert.equal(checkSynonym('Vector DB experience', 'Chroma', vocab), 'ok');
  assert.equal(checkSynonym('Vector DB experience', 'Pinecone', vocab), 'rejected');
  assert.equal(checkSynonym('Python scripting', 'Python', vocab), 'direct');
  const rows: FitRow[] = [
    { requirement: 'Experience with React', kind: 'must', status: 'adjacent', evidence: [], synonym: 'ReAct', source: 'ai' },
    { requirement: 'Vector DB experience', kind: 'must', status: 'evidenced', evidence: [], synonym: 'Chroma', source: 'ai' },
  ];
  const matrix = buildMatrix([], rows, data, vocab);
  assert.deepEqual(
    matrix.map((m) => [m.siteTerm, m.mappedByAi]),
    [['Chroma', true]],
  );
  assert.deepEqual(matrix[0].roles, [0]);
});

/* ---- #222 export ---- */

test("export: the Markdown carries 'AI-generated', the site URL, /cv and the data date", () => {
  const md = reportMarkdown(VIEW, SITE_LINKS);
  assert.ok(md.includes('AI-generated'));
  assert.ok(md.includes(SITE_LINKS.cvUrl));
  assert.ok(md.includes('Checked against site data built Sep 25, 2026'));
  assert.ok(md.includes('| Kubernetes | Must | Not listed on this site |'));
  const text = reportText(VIEW, SITE_LINKS);
  assert.ok(text.includes('AI-generated') && text.includes(SITE_LINKS.url) && text.includes('/cv'));
});

/* ---- #223 hand-offs ---- */

test('hand-offs: prefill at most 2000 characters, short blurb at most 280, even with long rows', () => {
  const long = (i: number) => `${'Very long requirement text '.repeat(7)}${i}`.slice(0, 200);
  const view: FitView = {
    ...VIEW,
    role: 'A'.repeat(200),
    rows: Array.from({ length: 12 }, (_, i) => ({ requirement: long(i), kind: 'must' as const, status: i % 2 ? ('not-listed' as const) : ('evidenced' as const), evidence: [], source: 'ai' as const })),
  };
  const p = reachOutPrefill(view);
  assert.ok(p.message.length <= PREFILL_MAX, `${p.message.length}`);
  assert.ok(p.subject.startsWith('Portfolio inquiry: ') && p.subject.length <= 'Portfolio inquiry: '.length + 80);
  const b = teamBlurbs(view, src.profile, SITE_LINKS);
  assert.ok(b.short.length <= BLURB_SHORT_MAX, `${b.short.length}`);
  assert.ok(b.short.includes('basuoikantik.in'));
});

/* ---- #224 screening questions ---- */

test('questions: an unknown id or an unsupported number is dropped', () => {
  const sent = new Map([
    ['exp:2#m0', facts.get('exp:2#m0')!],
    ['exp:0', facts.get('exp:0')!],
  ]);
  const kept = verifyQuestions(
    [
      { question: 'How did you validate the 86% HR attrition accuracy?', id: 'exp:2#m0' },
      { question: 'What made you pick LangGraph over plain LangChain chains?', id: 'exp:0' },
      { question: 'How did you get 97% retrieval accuracy with FAISS?', id: 'exp:0' },
      { question: 'Tell me about your Kubernetes work at Google.', id: 'exp:7' },
      { question: 'Which evaluation metrics did you track?', id: 'exp:0' },
    ],
    sent,
    ents,
  );
  assert.deepEqual(
    kept.map((q) => q.id),
    ['exp:2#m0', 'exp:0', 'exp:0'],
  );
  assert.ok(!kept.some((q) => q.question.includes('97%')));
  const client = clientCheckQuestions([{ question: 'Why 42 agents?', id: 'exp:0' }, { question: 'Why LangGraph?', id: 'exp:9' }, { question: 'Why LangGraph?', id: 'exp:0' }], sent);
  assert.deepEqual(client, [{ question: 'Why LangGraph?', id: 'exp:0' }]);
});

/* ---- #225 lenses ---- */

const lensValue = (id: LensValue['id']): LensValue => ({
  id,
  label: id,
  versions: { plain: [{ text: 'a', cites: ['exp:0'] }], manager: [{ text: 'b', cites: ['exp:0'] }], engineer: [{ text: 'c', cites: ['exp:0'] }] },
  projects: [],
});

test('lenses: a production-flag render with unreviewed fixtures hides every chip', () => {
  const store: LensStore = {
    version: 1,
    entries: Object.fromEntries(
      LENSES.map((l) => [`lens:${l.id}`, { hash: 'h', model: 'm', generatedAt: '2026-09-25', reviewed: false, claimBearing: true, value: lensValue(l.id) }]),
    ),
  };
  assert.deepEqual(visibleLenses(store, false), []);
  assert.equal(visibleLenses(store, true).length, 3);
  store.entries['lens:freelance'].reviewed = true;
  assert.deepEqual(
    visibleLenses(store, false).map((l) => l.def.id),
    ['freelance'],
  );
  assert.deepEqual(visibleLenses({ version: 1, entries: {} }, true), []);
});

test('lenses: the committed store holds only claim-bearing, well-formed entries citing their own sources', () => {
  const store: LensStore = read('ai-generated/recruiter.json');
  for (const [key, entry] of Object.entries(store.entries)) {
    const def = LENSES.find((l) => `lens:${l.id}` === key);
    assert.ok(def, `unknown key ${key}`);
    assert.equal(entry.claimBearing, true, key);
    const allowed = new Set([...lensSources(def, data), ...entry.value.projects.map((s) => `project:${s}#tagline`)]);
    for (const [audience, sentences] of Object.entries(entry.value.versions)) {
      const words = sentences.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
      assert.ok(words >= 90 && words <= 120, `${key} ${audience}: ${words} words`);
      for (const s of sentences) {
        assert.ok(s.cites.length > 0 && s.cites.every((c) => allowed.has(c)), `${key} ${audience}: ${s.cites.join(',')}`);
        assert.equal(spellsNumber(s.text), false, s.text);
      }
    }
    assert.deepEqual(entry.value.projects, lensProjects(def, data), `${key} projects`);
  }
});

test('lenses: only known ids, sources the data backs, projects counted in code', () => {
  assert.equal(lensParam('llm-agents'), 'llm-agents');
  assert.equal(lensParam('nope'), null);
  assert.equal(lensParam(null), null);
  const llm = LENSES.find((l) => l.id === 'llm-agents')!;
  const ids = lensSources(llm, data);
  assert.ok(ids.includes('profile:availability') && ids.includes('skills:genai-llms') && ids.includes('skills:agentic-ai') && ids.includes('exp:0'));
  for (const id of ids) assert.ok(facts.has(id), id);
  assert.equal(lensProjects(llm, data)[0], 'urbancare-ai');
  assert.equal(lensProjects(llm, data).length, 3);
  const ds = LENSES.find((l) => l.id === 'data-science')!;
  assert.ok(lensSources(ds, data).includes('exp:2'));
  assert.equal(nearestLens('Data Analyst'), 'data-science');
  assert.equal(nearestLens('Contract GenAI developer'), 'freelance');
  assert.equal(nearestLens('Chief Llama Wrangler'), 'llm-agents');
  assert.equal(nearestLens('anything', []), null);
});

/* ---- #226 custom brief ---- */

test('brief: one unverifiable claim is dropped and only verified ones render', () => {
  const out = verifyBrief(
    {
      claims: [
        { text: 'He builds multi-agent systems on LangGraph.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
        { text: 'He ran RLHF evaluations of GPT and Claude outputs.', evidence: [{ id: 'exp:1', quote: 'RLHF evaluations' }] },
        { text: 'He tuned Chroma and FAISS retrieval.', evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS' }] },
        { text: 'He has 5 years of experience at Google.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
      ],
      projects: ['urbancare-ai', 'nope', 'urbancare-ai'],
    },
    facts,
    ents,
    data.projects.map((p) => p.slug),
  );
  assert.equal(out.claims.length, 3);
  assert.equal(out.discarded, false);
  assert.ok(!out.claims.some((c) => /5 years|Google/.test(c.text)));
  assert.deepEqual(out.projects, ['urbancare-ai']);
});

test('numbers spelled out in words are caught, since the digit tripwire cannot check them', () => {
  assert.equal(spellsNumber('an eighty-six percent accuracy rate'), true);
  assert.equal(spellsNumber('twenty years of share history'), true);
  assert.equal(spellsNumber('one of two roles'), false);
  assert.equal(spellsNumber('86% HR attrition accuracy'), false);
  const out = verifyBrief(
    {
      claims: [
        { text: 'He reached eighty-six percent attrition accuracy.', evidence: [{ id: 'exp:2#m0', quote: '86% HR attrition accuracy' }] },
        { text: 'He reached 86% HR attrition accuracy.', evidence: [{ id: 'exp:2#m0', quote: '86% HR attrition accuracy' }] },
        { text: 'He builds on LangGraph.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
        { text: 'He tuned Chroma and FAISS retrieval.', evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS' }] },
      ],
      projects: [],
    },
    facts,
    ents,
    [],
  );
  assert.deepEqual(
    out.claims.map((c) => c.text),
    ['He reached 86% HR attrition accuracy.', 'He builds on LangGraph.', 'He tuned Chroma and FAISS retrieval.'],
  );
});

test('model prose loses [c:id] markers and tags', () => {
  assert.equal(stripMarkup('He builds on LangGraph [c:exp:0]. <b>Yes</b>'), 'He builds on LangGraph. Yes');
});

test('brief: mostly unverifiable or softened output is discarded', () => {
  const out = verifyBrief(
    {
      claims: [
        { text: 'He is likely familiar with Kubernetes.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
        { text: 'He is AWS certified.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
        { text: 'He builds on LangGraph.', evidence: [{ id: 'exp:0', quote: 'LangGraph' }] },
      ],
      projects: [],
    },
    facts,
    ents,
    [],
  );
  assert.equal(out.discarded, true);
});
