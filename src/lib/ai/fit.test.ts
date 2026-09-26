import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { parseAchievements } from '../achievements.ts';
import { parseCertifications } from '../certifications.ts';
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
  onlySiteTerms,
  plausibleId,
  PREFILL_MAX,
  rankProjectsByOverlap,
  reachOutPrefill,
  reportMarkdown,
  reportText,
  requirementCap,
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
  certifications: parseCertifications(read('certifications.json')),
  achievements: parseAchievements(read('achievements.json')),
};
const chunks = buildCorpus(src);
const facts = new Map(chunks.filter((c) => c.cls === 'self').map((c) => [c.id, c.text]));
const ents = entities({ profile: src.profile, projects: src.projects, skills: src.skillsIndex, reading: src.reading, certifications: src.certifications, achievements: src.achievements });
const data: FitData = { profile: src.profile, projects: src.projects, certifications: src.certifications, achievements: src.achievements };
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

test('verify: the keyword pass overrides a wrong not-listed on a requirement that is only site terms', () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'not-listed', evidence: [] },
      { index: 1, status: 'not-listed', evidence: [] },
      { index: 2, status: 'not-listed', evidence: [] },
    ],
    requirements: [req('Python'), req('Strong Python skills'), req('Shipped Python services to 1M+ daily users')],
    facts,
    entities: ents,
    vocab,
    lexical: (r) => lexicalEvidenceFor(r, data, vocab),
  });
  assert.deepEqual(
    out.rows.map((r) => [r.status, r.source]),
    [['evidenced', 'lexical'], ['evidenced', 'lexical'], ['not-listed', 'ai']],
    "the model's not-listed stands when the requirement asks for more than the keyword",
  );
});

test('verify: the client drops rows whose ids the site cannot have', () => {
  assert.equal(plausibleId('exp:1#m2', data), true);
  assert.equal(plausibleId('exp:1#m9', data), false);
  assert.equal(plausibleId('project:omni-lab#stack', data), true);
  assert.equal(plausibleId('project:nope#stack', data), false);
  assert.equal(plausibleId('ref:react', data), false);
  assert.equal(plausibleId('cert:claude-academy', data), true);
  assert.equal(plausibleId('cert:google-ai-professional-certificate', data), true);
  assert.equal(plausibleId('cert:aws-certified', data), false);
  assert.equal(plausibleId('achievement:ai-for-bharat-finalist', data), true);
  assert.equal(plausibleId('achievement:hackathon-winner', data), false);
  // A client that has not loaded the credential data rejects those ids rather than guessing.
  assert.equal(plausibleId('cert:claude-academy', { profile: src.profile, projects: src.projects }), false);
  const rows: FitRow[] = [
    { requirement: 'a', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'LangGraph' }], source: 'ai' },
    { requirement: 'b', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:99', quote: 'x' }], source: 'ai' },
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

test('lenses: the committed store holds only claim-bearing, well-formed entries citing their own sources', (t) => {
  const store: LensStore = read('ai-generated/recruiter.json');
  const stale: string[] = [];
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
    // Projects are counted in code when the lens is written. A reviewed lens must still
    // match that count. A draft may lag new data until `npm run ai:generate` rewrites it
    // (its hash covers the projects); it still names only real projects, and drafts never
    // render in production.
    const current = lensProjects(def, data);
    for (const slug of entry.value.projects) assert.ok(data.projects.some((p) => p.slug === slug), `${key}: ${slug}`);
    if (entry.reviewed) assert.deepEqual(entry.value.projects, current, `${key} projects`);
    else if (entry.value.projects.join() !== current.join()) stale.push(key);
  }
  const shown = visibleLenses(store, false).map((l) => `lens:${l.def.id}`);
  for (const key of stale) assert.ok(!shown.includes(key), `${key} is stale and must not render in production`);
  if (stale.length) t.diagnostic(`stale lens drafts (regenerate with npm run ai:generate): ${stale.join(', ')}`);
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

/* ---- evidence ids written in the prompt's [c:<id>] marker form ---- */

// The rows of a real gemini-3.8-flash jd-fit reply to the smoke JD: every quote
// verbatim, every id prefixed with the prompt's 'c:' marker.
const PREFIXED_ROWS = [
  { index: 0, status: 'evidenced' as const, evidence: [{ id: 'c:exp:0', quote: 'Architecting multi-agent systems using ReAct framework and LangGraph' }, { id: 'c:skills:genai-llms', quote: 'LangGraph' }] },
  { index: 1, status: 'evidenced' as const, evidence: [{ id: 'c:exp:0', quote: 'Building advanced RAG pipelines with LlamaIndex, LangChain, and vector databases' }, { id: 'c:exp:0#h1', quote: 'RAG pipelines with Chroma/FAISS optimization.' }] },
  { index: 2, status: 'evidenced' as const, evidence: [{ id: 'c:profile:about', quote: 'Skilled in Python, SQL, and cloud platforms' }, { id: 'c:skills:data-science-ml', quote: 'Python' }] },
  { index: 3, status: 'adjacent' as const, evidence: [{ id: 'c:tool:4', quote: 'Containers: Docker · Compose.' }, { id: 'c:project:bruhworking-nexusflow#stack', quote: 'Docker' }] },
  { index: 4, status: 'evidenced' as const, evidence: [{ id: 'c:profile:about', quote: 'LangChain, LlamaIndex, AutoGen' }, { id: 'c:skills:genai-llms', quote: 'LlamaIndex' }] },
];
const SMOKE_REQS = [req('LLM agents with LangGraph'), req('RAG pipelines on vector databases'), req('Python'), req('Kubernetes'), req('LlamaIndex', 'nice')];
const allFacts = new Map(chunks.map((c) => [c.id, c.text]));

test("verify: a real reply whose ids carry the 'c:' marker keeps every correct row, with bare ids", () => {
  const out = verifyFitRows({ rows: PREFIXED_ROWS, requirements: SMOKE_REQS, facts: allFacts, entities: ents, vocab });
  assert.equal(out.dropped, 0);
  assert.equal(out.discarded, false);
  assert.deepEqual(
    out.rows.map((r) => [r.status, r.source]),
    [['evidenced', 'ai'], ['evidenced', 'ai'], ['evidenced', 'ai'], ['adjacent', 'ai'], ['evidenced', 'ai']],
  );
  for (const r of out.rows) for (const e of r.evidence) assert.ok(!e.id.startsWith('c:') && plausibleId(e.id, data), e.id);
  assert.equal(out.rows[3].evidence[0].id, 'tool:4');
});

test("verify: '[c:exp:0]' is read as exp:0; a prefixed unknown id or a paraphrased quote still drops", () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: '[c:exp:0]', quote: 'LangGraph' }] },
      { index: 1, status: 'evidenced', evidence: [{ id: 'c:exp:9', quote: 'Chroma' }] },
      { index: 2, status: 'evidenced', evidence: [{ id: 'c:exp:0', quote: 'Kubernetes clusters' }] },
      { index: 3, status: 'evidenced', evidence: [{ id: 'c:skills:data-science-ml', quote: 'Python' }] },
    ],
    requirements: REQS,
    facts,
    entities: ents,
    vocab,
    maxDrop: 1,
  });
  assert.equal(out.dropped, 2);
  assert.deepEqual(out.rows[0].evidence, [{ id: 'exp:0', quote: 'LangGraph' }]);
  assert.equal(out.rows[1].status, 'not-listed');
  assert.equal(out.rows[2].status, 'not-listed');
  assert.equal(out.rows[3].evidence[0].id, 'skills:data-science-ml');
});

test("questions: a 'c:'-prefixed id is matched and returned bare", () => {
  const sent = new Map([['exp:0', facts.get('exp:0')!]]);
  const kept = verifyQuestions(
    [
      { question: 'How did you tune retrieval in the LangGraph agents?', id: 'c:exp:0' },
      { question: 'What made you pick LangGraph over plain LangChain chains?', id: '[c:exp:0]' },
      { question: 'Tell me about the retrieval layer you built there.', id: 'c:exp:7' },
    ],
    sent,
    ents,
  );
  assert.deepEqual(
    kept.map((q) => q.id),
    ['exp:0', 'exp:0'],
  );
  assert.equal(clientCheckQuestions(kept, sent).length, 2, 'the client re-check accepts what the server returns');
});

test("brief: 'c:'-prefixed evidence ids are verified and returned bare", () => {
  const out = verifyBrief(
    {
      claims: [
        { text: 'He builds multi-agent systems on LangGraph.', evidence: [{ id: 'c:exp:0', quote: 'LangGraph' }] },
        { text: 'He ran RLHF evaluations of GPT and Claude outputs.', evidence: [{ id: '[c:exp:1]', quote: 'RLHF evaluations' }] },
        { text: 'He tuned Chroma and FAISS retrieval.', evidence: [{ id: 'c:exp:0', quote: 'Chroma/FAISS' }] },
      ],
      projects: [],
    },
    facts,
    ents,
    [],
  );
  assert.equal(out.discarded, false);
  assert.equal(out.claims.length, 3);
  assert.deepEqual(
    out.claims.flatMap((c) => c.evidence.map((e) => e.id)),
    ['exp:0', 'exp:1', 'exp:0'],
  );
});

/* ---- evidence ids written without their chunk kind ---- */

// The rows of a real gemini-3.8-flash jd-fit reply that came back 'unverified': two
// ids lost their 'project:' kind ('content-storyteller#stack'), though every quote
// was verbatim in project:content-storyteller#stack.
const KINDLESS_ROWS = [
  { index: 0, status: 'adjacent' as const, evidence: [{ id: 'tool:4', quote: 'Docker · Compose' }] },
  { index: 1, status: 'not-listed' as const, evidence: [] },
  { index: 2, status: 'adjacent' as const, evidence: [{ id: 'content-storyteller#stack', quote: 'Pub/Sub' }] },
  { index: 3, status: 'evidenced' as const, evidence: [{ id: 'content-storyteller#stack', quote: 'Terraform' }] },
  { index: 4, status: 'evidenced' as const, evidence: [{ id: 'skills:data-science-ml', quote: 'Python' }, { id: 'profile:about', quote: 'Skilled in Python' }] },
  { index: 5, status: 'not-listed' as const, evidence: [] },
];
const KINDLESS_REQS = [req('Kubernetes'), req('Apache Spark'), req('Kafka streaming pipelines'), req('Terraform infrastructure as code'), req('Python'), req('Scala', 'nice')];

test("verify: a real reply whose project ids lost their 'project:' kind keeps every row, with full ids", () => {
  const out = verifyFitRows({ rows: KINDLESS_ROWS, requirements: KINDLESS_REQS, facts: allFacts, entities: ents, vocab, lexical: (r) => lexicalEvidenceFor(r, data, vocab) });
  assert.equal(out.dropped, 0);
  assert.equal(out.discarded, false);
  assert.deepEqual(
    out.rows.map((r) => [r.status, r.source]),
    [['adjacent', 'ai'], ['not-listed', 'ai'], ['adjacent', 'ai'], ['evidenced', 'ai'], ['evidenced', 'ai'], ['not-listed', 'ai']],
  );
  assert.equal(out.rows[3].evidence[0].id, 'project:content-storyteller#stack');
  for (const r of out.rows) for (const e of r.evidence) assert.ok(plausibleId(e.id, data), e.id);
});

test('verify: an invented slug, a quote not in the resolved chunk, a bare part or an ambiguous number still drops', () => {
  const out = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: 'rust-project#stack', quote: 'Rust' }] },
      { index: 1, status: 'evidenced', evidence: [{ id: 'content-storyteller#stack', quote: 'Kafka' }] },
      { index: 2, status: 'evidenced', evidence: [{ id: 'stack', quote: 'Python' }] },
      { index: 3, status: 'evidenced', evidence: [{ id: '0', quote: 'LangGraph' }] },
    ],
    requirements: [req('Rust'), req('Kafka'), req('Python'), req('LangGraph')],
    facts: allFacts,
    entities: ents,
    vocab,
    maxDrop: 1,
  });
  assert.equal(out.dropped, 4);
  assert.ok(out.rows.every((r) => r.status === 'not-listed' && r.evidence.length === 0));
});

test('questions and brief: a kind-less id resolves to the full id it names, and comes back in full', () => {
  const sent = new Map([['project:content-storyteller#stack', allFacts.get('project:content-storyteller#stack')!]]);
  const kept = verifyQuestions([{ question: 'Why did you pick Pub/Sub over a direct call between services?', id: 'content-storyteller#stack' }], sent, ents);
  assert.deepEqual(
    kept.map((q) => q.id),
    ['project:content-storyteller#stack'],
  );
  assert.equal(clientCheckQuestions(kept, sent).length, 1);
  const brief = verifyBrief(
    { claims: [{ text: 'Content Storyteller runs on Cloud Run with Pub/Sub and Terraform.', evidence: [{ id: 'content-storyteller#stack', quote: 'Terraform' }] }], projects: [] },
    allFacts,
    ents,
    [],
  );
  assert.equal(brief.discarded, false);
  assert.equal(brief.claims[0].evidence[0].id, 'project:content-storyteller#stack');
});

/* ---- employer, venue and credential requirements are never evidenced ---- */

// The requirements of a live jd-fit call that came back 'Strong': the keyword pass
// had turned the model's answers into 'evidenced' through 'RLHF' and 'TensorFlow'.
const AFFILIATION_REQS = [
  req('Prior employment at OpenAI or Anthropic doing RLHF'),
  req('Research Scientist experience at Google DeepMind with Gemma models'),
  req('TensorFlow Developer Certificate'),
  req('Led a team of 10+ engineers building RAG systems', 'nice'),
  req('Python'),
];

test("verify: 'Prior employment at OpenAI' and a certificate are never evidenced, from the model or the keyword pass", () => {
  const lexical = (r: Requirement) => lexicalEvidenceFor(r, data, vocab);
  const honest = verifyFitRows({
    rows: AFFILIATION_REQS.map((r, index) =>
      r.text === 'Python' ? { index, status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'Python' }] } : { index, status: 'not-listed', evidence: [] },
    ),
    requirements: AFFILIATION_REQS,
    facts,
    entities: ents,
    vocab,
    lexical,
  });
  const eager = verifyFitRows({
    rows: [
      { index: 0, status: 'evidenced', evidence: [{ id: 'exp:1', quote: 'RLHF' }] },
      { index: 1, status: 'adjacent', evidence: [{ id: 'skills:genai-llms', quote: 'Gemma' }] },
      { index: 2, status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'TensorFlow' }] },
      { index: 4, status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'Python' }] },
    ],
    requirements: AFFILIATION_REQS,
    facts,
    entities: ents,
    vocab,
    lexical,
  });
  const silent = verifyFitRows({ rows: [], requirements: AFFILIATION_REQS, facts, entities: ents, vocab, lexical });
  for (const out of [honest, eager, silent]) {
    assert.deepEqual(
      out.rows.slice(0, 3).map((r) => r.status),
      ['not-listed', 'not-listed', 'not-listed'],
    );
    assert.ok(out.rows.slice(0, 3).every((r) => r.evidence.length <= 1), 'at most the closest thing on the site');
    assert.notEqual(computeBand(out.rows)?.band, 'Strong');
    assert.equal(out.rows[4].status, 'evidenced');
  }
  // The team-lead ask is more than 'RAG': with no model row it is adjacent, never evidenced.
  assert.deepEqual([silent.rows[3].status, silent.rows[3].source], ['adjacent', 'lexical']);
  const view: FitView = { ...VIEW, rows: silent.rows, band: computeBand(silent.rows) };
  const text = reportText(view, SITE_LINKS);
  assert.ok(text.includes('- [Must] Prior employment at OpenAI or Anthropic doing RLHF: Not listed on this site — closest on the site: "RLHF"'), text);
  assert.ok(text.includes('Led a team of 10+ engineers building RAG systems: Adjacent (keyword match, not the whole requirement)'), text);
  assert.ok(text.includes('- [Must] Python: Evidenced (exact keyword match)'), text);
  assert.ok(reportMarkdown(view, SITE_LINKS).includes('| Python | Must | Evidenced (exact keyword match) |'));
  assert.ok(!/OpenAI|Certificate/.test(teamBlurbs(view, src.profile, SITE_LINKS).full));
});

test('requirementCap: employers, venues and credentials the profile does not list; a listed employer passes', () => {
  assert.equal(requirementCap(req('Previously worked at OpenAI or Anthropic on RLHF'), [], ents), 'affiliation:OpenAI');
  assert.equal(requirementCap(req('Published papers at NeurIPS on LangGraph agents'), [], ents), 'affiliation:NeurIPS');
  assert.equal(requirementCap({ text: 'Vorherige Anstellung bei OpenAI', gloss: 'Prior employment at OpenAI' }, [], ents), 'affiliation:OpenAI', 'the English gloss is checked too');
  assert.equal(requirementCap(req('AWS Certified Machine Learning Specialty'), [], ents), 'credential');
  assert.equal(requirementCap(req('Freelance AI Agent Specialist at Mindrift'), [], ents), null);
  assert.equal(requirementCap(req('Experience with Kubernetes'), [], ents), null);
  // Once a certification is listed, a row citing text that states one may keep its status.
  const certified = { ...ents, certifications: ['AWS Certified Machine Learning Specialty'] };
  assert.equal(requirementCap(req('AWS Certified Machine Learning Specialty'), ['AWS Certified Machine Learning Specialty (2026)'], certified), null);
  assert.equal(requirementCap(req('AWS Certified Machine Learning Specialty'), ['AWS Lambda'], certified), 'credential');
  // With the real list: a listed credential cited by its chunk stands; an unlisted one or a licence never does.
  const gaipc = [facts.get('cert:google-ai-professional-certificate')!];
  assert.equal(requirementCap(req('Google AI Professional Certificate'), gaipc, ents), null);
  assert.equal(requirementCap(req('Google Cloud Professional Machine Learning Engineer certification'), gaipc, ents), 'credential');
  assert.equal(requirementCap(req('Licensed Professional Engineer'), gaipc, ents), 'credential');
});

test('onlySiteTerms: a requirement that is just site terms, not a larger ask naming one', () => {
  for (const t of ['Python', 'Strong Python skills', 'Python and SQL', 'RAG pipelines', 'Python 3.10+', 'Knowledge of Scikit-learn and Pandas libraries']) assert.equal(onlySiteTerms(t, vocab), true, t);
  for (const t of ['Prior employment at OpenAI doing RLHF', 'TensorFlow Developer Certificate', 'Shipped Python services to 1M+ daily users', 'Kubernetes', 'Kafka streaming pipelines']) assert.equal(onlySiteTerms(t, vocab), false, t);
});
