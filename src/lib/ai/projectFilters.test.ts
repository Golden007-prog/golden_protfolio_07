import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { entities, type CorpusProfile, type CorpusProject } from './corpus.ts';
import {
  FILTER_Q_MAX,
  filterQuery,
  looseRank,
  readingChips,
  readingMatches,
  shouldAskAi,
  toFilterAction,
  validateFilters,
  withoutKey,
  type FilterVocab,
} from './projectFilters.ts';
import {
  ALT_MAX,
  KEYS,
  checkAlt,
  checkLevelText,
  compareFacts,
  compareMarkdown,
  interestSeeds,
  INTERESTS,
  orderByInterest,
  projectQuickAnswer,
  projectStarters,
  selectCaseStudyAi,
  selectInterests,
  verifyCompareCell,
  verifyCompareRows,
  vectorRankings,
  verifyQuestions,
  type ProjectSource,
  type VectorFile,
} from './prompts/projects.ts';
import { encodeVec } from './retrieval.ts';
import { PROVENANCE, type StoreEntry } from './reviewGate.ts';
import { techFamily } from '../tech.ts';

/*
 * projectFilters.ts (#202, #203) and prompts/projects.ts (#200, #204-#207),
 * against the site's real projects and profile, read from disk.
 */

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T;
const PROJECTS = read<ProjectSource[]>('../../data/projects.json');
const PROFILE = read<CorpusProfile>('../../data/profile.json');
const ENTITIES = entities({ profile: PROFILE, projects: PROJECTS as unknown as CorpusProject[] });

const bySlug = (slug: string) => {
  const p = PROJECTS.find((x) => x.slug === slug);
  assert.ok(p, slug);
  return p;
};
const URBANCARE = bySlug('urbancare-ai');
const NEXUS = bySlug('bruhworking-nexusflow');
const TCS = bySlug('tcs-stock-forecasting');

const VOCAB: FilterVocab = {
  categories: [...new Set(PROJECTS.map((p) => p.category))],
  techs: [...new Set(PROJECTS.flatMap((p) => p.techStack.map(techFamily)))],
};

/* ---------------- #202 filters ---------------- */

test('validateFilters keeps the mocked reading exactly', () => {
  const r = validateFilters({ cat: 'AI/ML', tech: 'Gemini', live: true }, VOCAB, 'live AI projects using Gemini');
  assert.deepEqual(r, { cat: 'AI/ML', tech: 'Gemini', live: true, q: null });
  assert.deepEqual(toFilterAction(r!), { kind: 'filter', cat: 'AI/ML', tech: 'Gemini', live: true });
});

test('validateFilters drops tech that is not in the data, and a category that is not either', () => {
  assert.equal(validateFilters({ tech: 'Kubernetes' }, VOCAB, 'kubernetes projects'), null);
  assert.deepEqual(validateFilters({ tech: 'Kubernetes', cat: 'Data Science' }, VOCAB, 'data science on kubernetes'), {
    cat: 'Data Science',
    tech: null,
    live: false,
    q: null,
  });
  assert.equal(validateFilters({ cat: 'Robotics' }, VOCAB, 'robotics'), null);
});

test('validateFilters matches names case-insensitively and maps stack entries to their family', () => {
  assert.equal(validateFilters({ tech: 'gemini' }, VOCAB, 'gemini apps')?.tech, 'Gemini');
  assert.equal(validateFilters({ tech: 'Gemini 2.0 Flash' }, VOCAB, 'flash')?.tech, 'Gemini');
  assert.equal(validateFilters({ cat: 'ai/ml' }, VOCAB, 'ml')?.cat, 'AI/ML');
});

test('live is set only by a literal true', () => {
  for (const live of ['true', 1, 'yes', null, undefined, false]) {
    assert.equal(validateFilters({ live, cat: 'AI/ML' }, VOCAB, 'ai')?.live, false, String(live));
  }
});

test('q may only reuse the visitor’s own words, and is capped', () => {
  assert.equal(validateFilters({ q: 'healthcare' }, VOCAB, 'healthcare projects please')?.q, 'healthcare');
  assert.equal(validateFilters({ q: 'visit evil.example now' }, VOCAB, 'healthcare projects'), null);
  assert.equal(validateFilters({ q: 'x'.repeat(FILTER_Q_MAX + 1) }, VOCAB, 'x'.repeat(FILTER_Q_MAX + 1)), null);
  // Repeating the category or tech as text adds nothing.
  assert.equal(validateFilters({ tech: 'Gemini', q: 'gemini' }, VOCAB, 'gemini')?.q, null);
  assert.equal(validateFilters('not an object', VOCAB, 'x'), null);
  assert.equal(validateFilters({}, VOCAB, 'anything'), null);
});

test('shouldAskAi: Enter asks the model for a phrase, or when the text search found nothing', () => {
  assert.equal(shouldAskAi('live AI projects using Gemini', 3), true);
  assert.equal(shouldAskAi('voice', 2), false);
  assert.equal(shouldAskAi('kubernetes', 0), true);
  assert.equal(shouldAskAi('ai', 0), false);
  assert.equal(shouldAskAi('x '.repeat(100), 0), false);
});

test('chips, removal and the match check describe the same reading', () => {
  const r = { cat: 'AI/ML', tech: 'Gemini', live: true, q: 'voice' };
  assert.deepEqual(
    readingChips(r).map((c) => c.key),
    ['cat', 'tech', 'live', 'q'],
  );
  assert.deepEqual(withoutKey(r, 'live'), { ...r, live: false });
  assert.deepEqual(withoutKey(r, 'tech'), { ...r, tech: null });
  assert.equal(readingMatches(r, { q: 'voice', cat: 'AI/ML', tech: 'Gemini', live: true }), true);
  assert.equal(readingMatches(r, { q: '', cat: 'AI/ML', tech: 'Gemini', live: true }), false);
});

/* ---------------- #203 related work ---------------- */

test('filterQuery joins the active filters', () => {
  assert.equal(filterQuery({ q: 'zzzz', cat: 'Web App', tech: 'Gemini', live: true }), 'zzzz Web App Gemini live demo');
  assert.equal(filterQuery({ q: '', cat: null, tech: null, live: false }), '');
});

test('looseRank finds projects sharing any query word, strongest first', () => {
  const hits = looseRank(PROJECTS, 'forecasting stock nonsenseword', 3);
  assert.equal(hits[0]?.slug, 'tcs-stock-forecasting');
  assert.deepEqual(looseRank(PROJECTS, 'zzzz qqqq', 3), []);
  assert.ok(looseRank(PROJECTS, 'healthcare agents', 3).length <= 3);
});

/* ---------------- #205 compare ---------------- */

test('a compare cell that is not a verbatim quote is rejected', () => {
  const ok = verifyCompareCell({ field: 'problem', quote: 'physicians can’t audit how a diagnosis was reached' }, URBANCARE);
  assert.ok(ok, 'typographic apostrophe and whitespace still match');
  assert.equal(verifyCompareCell({ field: 'problem', quote: 'doctors cannot audit diagnoses' }, URBANCARE), null);
  // Verbatim, but from another field than the one named.
  assert.equal(verifyCompareCell({ field: 'lessons', quote: 'Most clinical AI is a black box' }, URBANCARE), null);
  assert.equal(verifyCompareCell({ field: 'tagline', quote: 'short' }, URBANCARE), null);
  assert.equal(verifyCompareCell({ field: 'problem', quote: 'Anything' }, TCS), null, 'TCS has no problem field');
});

test('verifyCompareRows keeps dimension order, nulls bad cells and counts them', () => {
  const { rows, rejected } = verifyCompareRows(
    [
      { dim: 'approach', a: { field: 'solution', quote: 'A Semantics-to-Vector interface' }, b: { field: 'solution', quote: 'made up approach' } },
      { dim: 'goal', a: { field: 'tagline', quote: 'AI-Native Clinical Ecosystem' }, b: { field: 'tagline', quote: 'Serverless Agent Swarm' } },
      { dim: 'nonsense', a: { field: 'tagline', quote: 'AI-Native Clinical Ecosystem' } },
    ],
    URBANCARE,
    NEXUS,
  );
  assert.deepEqual(
    rows.map((r) => r.dim),
    ['goal', 'approach', 'detail'],
  );
  assert.equal(rows[0].b?.quote, 'Serverless Agent Swarm');
  assert.equal(rows[1].b, null);
  assert.equal(rows[2].a, null);
  assert.equal(rejected, 1);
});

test('compareFacts computes the data rows; stars only once they are a signal', () => {
  const facts = compareFacts(URBANCARE, TCS, { a: 0, b: 0 });
  assert.deepEqual(
    facts.map((f) => f.label),
    ['Category', 'Language', 'Live demo', 'Tech in common', 'Tech only in this one'],
  );
  assert.ok(compareFacts(URBANCARE, TCS, { a: 7, b: 0 }).some((f) => f.label === 'GitHub stars'));
  const md = compareMarkdown(URBANCARE, NEXUS, facts, [{ dim: 'goal', a: null, b: { field: 'tagline', quote: 'Serverless | Agent' } }]);
  assert.match(md, /^\*\*UrbanCare AI compared with Bruhworking — NexusFlow\*\*/);
  assert.match(md, /Not listed/);
  assert.match(md, /Serverless \\\| Agent/);
});

/* ---------------- #206 questions ---------------- */

function factsFor(p: ProjectSource): Map<string, string> {
  return new Map([
    [`project:${p.slug}#lessons`, `${p.name}, lessons learned: ${p.lessons}`],
    [`project:${p.slug}#solution`, `${p.name}, the solution: ${p.solution}`],
    [`project:${p.slug}#stack`, `${p.name} tech stack: ${p.techStack.join(', ')}.`],
  ]);
}

test('a question with an unverified premise is dropped', () => {
  const facts = factsFor(URBANCARE);
  const { kept, dropped } = verifyQuestions(
    [
      {
        text: 'Why did you make interpretability the interface itself rather than a feature?',
        evidence: { id: 'project:urbancare-ai#lessons', quote: 'it has to be the interface itself' },
      },
      { text: 'How did you scale UrbanCare AI to 1M users?', evidence: { id: 'project:urbancare-ai#solution', quote: 'A Semantics-to-Vector interface' } },
      { text: 'What did you learn working at Google DeepMind?', evidence: { id: 'project:urbancare-ai#lessons', quote: 'Interpretability isn’t a feature' } },
      { text: 'How does the Semantics-to-Vector interface work?', evidence: { id: 'project:urbancare-ai#solution', quote: 'not in the fact at all' } },
      { text: 'Which parts use TxGemma?', evidence: { id: 'project:omni-lab#stack', quote: 'TxGemma' } },
      { text: 'How did you serve thousands of physicians?', evidence: { id: 'project:urbancare-ai#lessons', quote: 'it has to be the interface itself' } },
      { text: 'No question mark here', evidence: { id: 'project:urbancare-ai#stack', quote: 'TxGemma' } },
    ],
    facts,
    URBANCARE,
    ENTITIES,
  );
  assert.deepEqual(
    kept.map((q) => q.text),
    ['Why did you make interpretability the interface itself rather than a feature?'],
  );
  assert.equal(dropped, 6);
});

/* ---------------- #200 levels and #207 alt text ---------------- */

test('checkLevelText rejects added numbers, organisations, inflation and first person', () => {
  const good =
    'UrbanCare AI is a clinical dashboard whose Semantics-to-Vector interface lets physicians inspect how medical AI models reach a diagnosis, built on MedGemma, TxGemma and Gemini.';
  assert.equal(checkLevelText(good, 'engineer', URBANCARE, ENTITIES), null);
  assert.match(checkLevelText(`${good} It cut review time by 40%.`, 'engineer', URBANCARE, ENTITIES) ?? '', /^number:40/);
  assert.match(checkLevelText(`${good} It was built at Google DeepMind.`, 'engineer', URBANCARE, ENTITIES) ?? '', /DeepMind|employer/);
  assert.equal(checkLevelText(`${good} He is an expert in clinical AI.`, 'engineer', URBANCARE, ENTITIES), 'expert');
  assert.equal(checkLevelText(`I built ${good}`, 'engineer', URBANCARE, ENTITIES), 'first-person');
  assert.equal(checkLevelText(`${good} The system is completely transparent.`, 'engineer', URBANCARE, ENTITIES), 'absolute:completely');
  // Spelled-out numbers get the same check as digits.
  assert.equal(checkLevelText(`${good} It runs a thirty-agent pipeline.`, 'engineer', URBANCARE, ENTITIES), 'number-word:thirty');
  assert.equal(checkLevelText(`${good} It serves forty hospitals.`, 'engineer', URBANCARE, ENTITIES), 'number-word:forty');
  // A word the project itself uses is fine ('Production-ready' is in its own description).
  assert.equal(checkLevelText('UrbanCare AI is a production-ready clinical dashboard built on MedGemma, TxGemma and Gemini, with every layer inspectable.', 'engineer', URBANCARE, ENTITIES), null);
  assert.equal(checkLevelText('Too short.', 'eli5', URBANCARE, ENTITIES), 'too-short');
  assert.equal(checkLevelText(`${good} ${good} ${good}`, 'eli5', URBANCARE, ENTITIES), 'too-long');
});

test('checkAlt keeps alt text under 125 characters and free of invented names', () => {
  assert.equal(checkAlt('A dark clinical dashboard with a patient list, vitals charts and a chat panel', URBANCARE, ENTITIES), null);
  assert.equal(checkAlt('x'.repeat(ALT_MAX + 1), URBANCARE, ENTITIES), 'too-long');
  assert.equal(checkAlt('Screenshot of a dashboard with charts and a sidebar', URBANCARE, ENTITIES), 'redundant-prefix');
  assert.match(checkAlt('A Kubernetes dashboard from OpenAI with charts', URBANCARE, ENTITIES) ?? '', /^name:/);
  // Counting what is in the picture is fine; claiming scale is not.
  assert.equal(checkAlt('Two clinicians beside a double monitor showing vitals charts', URBANCARE, ENTITIES), null);
  assert.equal(checkAlt('A dashboard used by thousands of hospitals', URBANCARE, ENTITIES), 'number-word:thousands');
  assert.equal(checkAlt('The first frame of the demo loop shows a chart', URBANCARE, ENTITIES), 'describes-the-medium');
});

/* ---------------- store selection ---------------- */

function e<V>(value: V, claimBearing: boolean, reviewed: boolean): StoreEntry<V> {
  return { hash: 'h', model: 'gemini-3.5-flash-lite', generatedAt: '2026-09-25T00:00:00.000Z', reviewed, claimBearing, value };
}

const LEVEL_TEXT = 'UrbanCare AI helps doctors see how a medical AI reached its answer, so they can check it before trusting it.';

function fixtureStore() {
  const [x, y] = ['bruhworking-nexusflow', 'urbancare-ai'];
  return {
    version: 1,
    entries: {
      [KEYS.level('urbancare-ai', 'eli5')]: e({ text: LEVEL_TEXT }, true, false),
      [KEYS.level('urbancare-ai', 'recruiter')]: e({ text: LEVEL_TEXT }, true, true),
      [KEYS.alt('urbancare-ai', 'still')]: e({ text: 'A clinical dashboard with vitals charts' }, true, false),
      [KEYS.alt('urbancare-ai', 'fallback')]: e({ text: 'x'.repeat(ALT_MAX + 1) }, true, true),
      [KEYS.demo('urbancare-ai')]: e({ text: 'Shows the dashboard' }, true, true),
      [KEYS.demo('tcs-stock-forecasting')]: e({ text: 'Shows a forecast chart for TCS stock' }, true, true),
      [KEYS.compare(x, y)]: e(
        {
          rows: [
            { dim: 'goal', a: { field: 'tagline', quote: 'Serverless Agent Swarm' }, b: { field: 'tagline', quote: 'AI-Native Clinical Ecosystem' } },
            { dim: 'approach', a: { field: 'solution', quote: 'invented approach text' }, b: null },
          ],
        },
        false,
        false,
      ),
      [KEYS.questions('urbancare-ai')]: e(
        {
          questions: [
            { text: 'Why is interpretability the interface itself?', evidence: [{ id: 'project:urbancare-ai#lessons', quote: 'it has to be the interface itself' }] },
            { text: 'How does the Semantics-to-Vector interface work?', evidence: [{ id: 'project:urbancare-ai#solution', quote: 'A Semantics-to-Vector interface' }] },
            { text: 'Why MedGemma and TxGemma?', evidence: [{ id: 'project:urbancare-ai#stack', quote: 'MedGemma' }] },
          ],
        },
        false,
        false,
      ),
      [KEYS.neighbours('urbancare-ai')]: e(
        {
          items: [
            { slug: 'bruhworking-nexusflow', cosine: 0.82 },
            { slug: 'urbancare-ai', cosine: 1 },
            { slug: 'no-such-project', cosine: 0.9 },
            { slug: 'omni-lab', cosine: 3 },
          ],
        },
        false,
        false,
      ),
      [KEYS.interests]: e({ agents: [{ slug: 'bruhworking-nexusflow', score: 0.9 }, { slug: 'urbancare-ai', score: 0.8 }, { slug: 'ghost', score: 0.7 }], rag: [{ slug: 'urbancare-ai', score: 1 }] }, false, false),
    },
  };
}

test('a production-flag render hides unreviewed claim-bearing fixtures', () => {
  const ai = selectCaseStudyAi(fixtureStore(), URBANCARE, PROJECTS, false);
  assert.deepEqual(
    ai.levels.map((l) => [l.id, l.provenance]),
    [['recruiter', PROVENANCE.reviewed]],
  );
  // The unreviewed still alt is hidden; the reviewed fallback is too long to use.
  assert.deepEqual(ai.alt, {});
  assert.equal(ai.demo, null, 'no demo loop, so no description');
  // Claim-free entries show everywhere.
  assert.equal(ai.questions?.items.length, 3);
  assert.equal(ai.questions?.provenance, PROVENANCE.site);
});

test('preview and local builds show drafts, labelled as drafts', () => {
  const ai = selectCaseStudyAi(fixtureStore(), URBANCARE, PROJECTS, true);
  assert.deepEqual(
    ai.levels.map((l) => [l.id, l.provenance]),
    [
      ['eli5', PROVENANCE.draft],
      ['recruiter', PROVENANCE.reviewed],
    ],
  );
  assert.equal(ai.alt.still, 'A clinical dashboard with vitals charts');
  assert.ok(ai.alt.still!.length < 125);
  assert.equal(selectCaseStudyAi(fixtureStore(), TCS, PROJECTS, true).demo?.text, 'Shows a forecast chart for TCS stock');
});

test('compare entries are oriented to the open project and re-verified', () => {
  const fromUrban = selectCaseStudyAi(fixtureStore(), URBANCARE, PROJECTS, false).compare['bruhworking-nexusflow'];
  assert.equal(fromUrban.rows[0].a?.quote, 'AI-Native Clinical Ecosystem');
  assert.equal(fromUrban.rows[0].b?.quote, 'Serverless Agent Swarm');
  assert.equal(fromUrban.rows[1].b, null, 'a non-verbatim cell becomes Not listed');
  const fromNexus = selectCaseStudyAi(fixtureStore(), NEXUS, PROJECTS, false).compare['urbancare-ai'];
  assert.equal(fromNexus.rows[0].a?.quote, 'Serverless Agent Swarm');
});

test('questions need three verified items and a featured project; neighbours need known slugs', () => {
  const store = fixtureStore();
  const q = store.entries[KEYS.questions('urbancare-ai')].value as { questions: { text: string; evidence: { id: string; quote: string }[] }[] };
  q.questions[2].evidence[0].quote = 'not in the project';
  assert.equal(selectCaseStudyAi(store, URBANCARE, PROJECTS, true).questions, null);
  assert.equal(selectCaseStudyAi(fixtureStore(), { ...URBANCARE, featured: false }, PROJECTS, true).questions, null);
  assert.deepEqual(selectCaseStudyAi(fixtureStore(), URBANCARE, PROJECTS, true).neighbours, [
    { slug: 'bruhworking-nexusflow', cosine: 0.82, shared: 1 },
  ]);
  assert.deepEqual(selectCaseStudyAi({ version: 1, entries: {} }, URBANCARE, PROJECTS, true), {
    levels: [],
    questions: null,
    compare: {},
    alt: {},
    demo: null,
    neighbours: [],
  });
});

test('interests keep known slugs and need two of them; ordering is stable', () => {
  const views = selectInterests(fixtureStore(), PROJECTS.map((p) => p.slug), false);
  assert.deepEqual(
    views.map((v) => [v.id, v.order]),
    [['agents', ['bruhworking-nexusflow', 'urbancare-ai']]],
  );
  const ordered = orderByInterest(PROJECTS, views[0].order).map((p) => p.slug);
  assert.deepEqual(ordered.slice(0, 3), ['bruhworking-nexusflow', 'urbancare-ai', 'vyapar-gyan']);
  assert.equal(ordered.length, PROJECTS.length);
  assert.deepEqual(selectInterests(null, ['a'], true), []);
});

test('interest seeds come from topics, stack and the write-up', () => {
  const seeds = (id: string) => interestSeeds(INTERESTS.find((i) => i.id === id)!, PROJECTS);
  assert.ok(seeds('agents').includes('bruhworking-nexusflow'));
  assert.ok(seeds('rag').includes('urbancare-ai'));
  // KSP DAPPA lists a forecasting topic; MarketPulse 'makes no forecasting claims', which is no seed.
  assert.deepEqual(seeds('forecasting'), ['tcs-stock-forecasting', 'ksp-dappa']);
});

/* ---------------- #201 starters and quick answers ---------------- */

test('starters follow the fields a project has, and quick answers quote them', () => {
  assert.deepEqual(projectStarters(URBANCARE), [
    'What problem does UrbanCare AI solve?',
    'How is UrbanCare AI built?',
    'What would he do differently on UrbanCare AI?',
  ]);
  assert.equal(projectStarters(TCS)[0], 'What does TCS Stock Forecasting do?');
  for (const [q, text] of [
    ['What problem does UrbanCare AI solve?', URBANCARE.problem],
    ['How is UrbanCare AI built?', URBANCARE.solution],
    ['What would he do differently on UrbanCare AI?', URBANCARE.lessons],
    ['Tell me something', URBANCARE.shortDescription],
  ] as const) {
    assert.equal(projectQuickAnswer(URBANCARE, q).text, text, q);
  }
  assert.match(projectQuickAnswer(TCS, 'Which tech stack?').text, /^TCS Stock Forecasting uses Python, Streamlit/);
  assert.equal(projectQuickAnswer(TCS, 'How is it built?').text, TCS.fullDescription);
});

/* ---------------- #204 vectors ---------------- */

test('vectorRankings: neighbours by cosine of mean chunk vectors, interests by seed centroid', () => {
  const vec = (...xs: number[]) => ({ hash: 'h', ...encodeVec(Float32Array.from(xs)) });
  const file: VectorFile = {
    model: 'gemini-embedding-2',
    dims: 3,
    entries: {
      'project:urbancare-ai#summary': vec(1, 0, 0),
      'project:urbancare-ai#full': vec(1, 0.2, 0),
      'project:bruhworking-nexusflow#summary': vec(0.9, 0.3, 0),
      'project:tcs-stock-forecasting#summary': vec(0, 0, 1),
      // A stale vector (its chunk changed) is ignored.
      'project:omni-lab#summary': { ...vec(1, 0, 0), hash: 'old' },
    },
  };
  const chunks = [
    'project:urbancare-ai#summary',
    'project:urbancare-ai#full',
    'project:bruhworking-nexusflow#summary',
    'project:tcs-stock-forecasting#summary',
    'project:omni-lab#summary',
  ].map((id) => ({ id, hash: 'h' }));
  const r = vectorRankings(file, chunks, PROJECTS);
  assert.ok(r);
  assert.deepEqual(
    r.neighbours['urbancare-ai'].items.map((n) => n.slug),
    ['bruhworking-nexusflow', 'tcs-stock-forecasting'],
  );
  assert.ok(r.neighbours['urbancare-ai'].items[0].cosine > 0.9);
  assert.equal(r.neighbours['omni-lab'], undefined);
  assert.equal(r.interests.forecasting?.[0].slug, 'tcs-stock-forecasting');
  assert.notEqual(r.interests.agents?.[0].slug, 'tcs-stock-forecasting');
  assert.equal(vectorRankings({ model: null, dims: 768, entries: {} }, chunks, PROJECTS), null);
});
