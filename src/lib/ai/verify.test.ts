import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { buildCorpus, entities, type CorpusSources } from './corpus.ts';
import { bannedPhrase, canonicalId, faithful, normalizeDigits, numbersIn, quoteOk, resolveId, tripwire, unlistedAffiliation, verifyClaims } from './verify.ts';

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
const facts = new Map(chunks.map((c) => [c.id, c.text]));
const ents = entities({ profile: src.profile, projects: src.projects, skills: src.skillsIndex, reading: src.reading });
const fact = (id: string) => facts.get(id)!;

test('normalizeDigits maps every decimal-digit script to ASCII', () => {
  assert.equal(normalizeDigits('৮৬%'), '86%');
  assert.equal(normalizeDigits('५ years'), '5 years');
  assert.equal(normalizeDigits('٣٠'), '30');
  assert.equal(normalizeDigits('１２'), '12');
  assert.equal(normalizeDigits('𝟗'), '9');
  assert.equal(normalizeDigits('R² 0.999'), 'R² 0.999', 'superscripts are not decimal digits');
});

test('numbersIn reads decimals, thousands separators and ignores citation ids', () => {
  assert.deepEqual(numbersIn('86% and R² ≈ 0.999 over 1,470 rows [c:exp:2#m0]'), ['86', '0.999', '1470']);
  assert.deepEqual(numbersIn('no digits here'), []);
});

test('quoteOk is a whitespace-normalised verbatim match', () => {
  assert.ok(quoteOk('86%   HR attrition', fact('exp:2#m0')));
  assert.ok(quoteOk("If you can't measure it", fact('copy:philosophy#1')), 'straight and curly apostrophes are equal');
  assert.ok(!quoteOk('87% HR attrition', fact('exp:2#m0')));
  assert.ok(!quoteOk('', fact('exp:2#m0')));
});

test("'86% HR attrition accuracy' passes against exp:2#m0", () => {
  const { kept, dropped } = verifyClaims(
    [{ text: '86% HR attrition accuracy', evidence: [{ id: 'exp:2#m0', quote: '86% HR attrition accuracy' }] }],
    facts,
    ents,
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped, 0);
});

test("'৮৬%' matches '86%' after normalisation", () => {
  assert.equal(tripwire('৮৬% HR attrition accuracy', [fact('exp:2#m0')], ents), null);
  assert.ok(quoteOk('৮৬%', fact('exp:2#m0')));
});

test('a stated total of years is dropped, in digits, other scripts or words', () => {
  const ev = [fact('profile:about')];
  assert.match(tripwire('He has 5 years of experience.', ev, ents) ?? '', /^number:5|years/);
  assert.match(tripwire('He has ५ years of experience.', ev, ents) ?? '', /^number:5|years/);
  assert.equal(tripwire('He has three years of hands-on experience.', ev, ents), 'years-of-experience');
  // Even when the number is in the evidence (20y of TCS stock), a total is still refused.
  assert.equal(tripwire('He has 20 years of experience.', [fact('exp:2#m1')], ents), 'years-of-experience');
});

test("'AWS certified' is dropped while certifications is empty; an honest negative passes", () => {
  assert.equal(tripwire('He is AWS certified.', [fact('profile:about')], ents), 'certification');
  assert.equal(tripwire('No certifications are listed on this site.', [fact('profile:about')], ents), null);
});

test("'worked at Google DeepMind' is dropped; a listed employer in evidence passes", () => {
  const urbancare = [fact('project:urbancare-ai#full')];
  assert.match(tripwire('He worked at Google DeepMind on UrbanCare AI.', urbancare, ents) ?? '', /^employer:Google DeepMind/);
  assert.match(tripwire('He ran evaluations for OpenAI.', [fact('exp:1')], ents) ?? '', /^employer:OpenAI/);
  assert.equal(tripwire('He is a Freelance AI Agent Specialist at Mindrift.', [fact('exp:1')], ents), null);
  assert.equal(tripwire('He works at IIT Roorkee through iHUB.', [fact('exp:0')], ents), null);
  // Listed, but not in the cited evidence: the citation does not support it.
  assert.match(tripwire('He works at Mindrift.', [fact('project:omni-lab#summary')], ents) ?? '', /^employer:Mindrift/);
  // Technologies after 'with' are not employers.
  assert.equal(tripwire('He works with LangChain and LlamaIndex.', [fact('exp:0')], ents), null);
});

test("the in-progress Master's is never phrased as held", () => {
  const ev = [fact('edu:0')];
  assert.equal(tripwire("He holds a Master's in Data Science.", ev, ents), 'degree-held');
  assert.equal(tripwire("He has completed his Master's.", ev, ents), 'degree-held');
  assert.equal(tripwire("His Master's in Data Science is complete.", ev, ents), 'degree-held');
  assert.equal(tripwire("His Master's degree was conferred last year.", ev, ents), 'degree-held');
  assert.equal(tripwire("He is pursuing a Master's in Data Science.", ev, ents), null);
  assert.equal(tripwire("His Master's runs Sept 2025 - Feb 2027.", ev, ents), null);
});

test('numbers must be in the evidence; list markers are not numbers', () => {
  assert.equal(tripwire('1. He built UrbanCare AI.', [fact('project:urbancare-ai#tagline')], ents), null);
  assert.equal(tripwire('It uses a 30-agent pipeline.', [fact('project:urbancare-ai#summary')], ents), null);
  assert.equal(tripwire('It uses a 40-agent pipeline.', [fact('project:urbancare-ai#summary')], ents), 'number:40');
});

test('spelled-out numbers need the evidence to give that number, as a numeral or in words', () => {
  const summary = [fact('project:urbancare-ai#summary')];
  assert.equal(tripwire('It uses a thirty-agent pipeline.', summary, ents), null, '30 is in the summary');
  assert.equal(tripwire('It uses a forty-agent pipeline.', summary, ents), 'number-word:forty');
  assert.equal(tripwire('It uses a thirty-five agent pipeline.', summary, ents), 'number-word:thirty-five');
  assert.equal(tripwire('It served thousands of patients.', summary, ents), 'number-word:thousands');
  assert.equal(tripwire('One of its agents triages patients.', summary, ents), null, "'one' is usually a pronoun");
  assert.equal(tripwire('Two clinicians read the chart.', summary, ents, { numberWords: false }), null);
});

test('4 of 10 dropped claims returns discarded:true; 3 of 10 does not', () => {
  const good = { text: '86% HR attrition accuracy', evidence: [{ id: 'exp:2#m0', quote: '86%' }] };
  const bad = { text: 'He is AWS certified', evidence: [{ id: 'profile:about', quote: 'Skilled in Python' }] };
  const four = verifyClaims([...Array(6).fill(good), ...Array(4).fill(bad)], facts, ents);
  assert.equal(four.dropped, 4);
  assert.equal(four.discarded, true);
  const three = verifyClaims([...Array(7).fill(good), ...Array(3).fill(bad)], facts, ents);
  assert.equal(three.dropped, 3);
  assert.equal(three.discarded, false);
});

test('verifyClaims drops missing evidence, unknown ids and non-verbatim quotes', () => {
  const { kept, dropped } = verifyClaims(
    [
      { text: 'Built UrbanCare AI', evidence: [] },
      { text: 'Built UrbanCare AI', evidence: [{ id: 'project:nope#tagline', quote: 'UrbanCare' }] },
      { text: 'Built UrbanCare AI', evidence: [{ id: 'project:urbancare-ai#tagline', quote: 'Clinical Ecosystem for Surgery' }] },
      { text: 'Built UrbanCare AI', evidence: [{ id: 'project:urbancare-ai#tagline', quote: 'AI-Native Clinical Ecosystem' }] },
    ],
    facts,
    ents,
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped, 3);
});

test("faithful rejects an added '99%' and names absent from the source", () => {
  const source = fact('project:ibm-hr-attrition-prediction#summary');
  assert.equal(faithful('Seven models, XGBoost at 86% accuracy.', source, ents), null);
  assert.equal(faithful('Seven models, XGBoost at 99% accuracy.', source, ents), 'number:99');
  assert.equal(faithful('Built with XGBoost for OpenAI.', source, ents), 'name:OpenAI');
  assert.equal(faithful('Built with PyTorch.', source, ents), 'name:PyTorch');
});

test("bannedPhrase rejects 'architected' unless the source says it", () => {
  assert.equal(bannedPhrase('He architected a multi-agent system.', fact('exp:0')), 'architected');
  assert.equal(bannedPhrase('He is proficient in LangChain.', fact('profile:about')), null, "'Proficient' is in the About text");
  assert.equal(bannedPhrase('He led the team.', fact('exp:0')), 'led');
  assert.equal(bannedPhrase('He labeled the data.', fact('exp:0')), null, "'labeled' is not 'led'");
  assert.equal(bannedPhrase('A world-class engineer.', ''), 'world-class');
});

test("a denied employer passes: 'has not worked at OpenAI' names an org without claiming it", () => {
  const about = [fact('profile:about')];
  const exp1 = [fact('exp:1')];
  const kept = [
    ['No, he does not work as an engineer at Google DeepMind.', about],
    ['He has not been employed by OpenAI or Anthropic.', exp1],
    ['He has not worked at OpenAI or Google DeepMind.', about],
    ["He doesn't work at Google DeepMind.", about],
    ['He is not a Google DeepMind engineer.', about],
    ['The site does not list any role at OpenAI or Anthropic.', about],
    ['No role at OpenAI is listed.', about],
    ['He has not worked at OpenAI, but at Mindrift he evaluated GPT and Claude outputs.', exp1],
    ['He did not study at MIT.', about],
  ] as const;
  for (const [s, ev] of kept) assert.equal(tripwire(s, ev, ents), null, s);
});

test('an employer claim still trips when a negation does not govern it', () => {
  const about = [fact('profile:about')];
  const dropped = [
    ['He works at Google DeepMind.', 'Google DeepMind'],
    ['He worked at Google DeepMind, not OpenAI.', 'Google DeepMind'],
    ['He not only interned at OpenAI but also worked at Anthropic.', 'OpenAI'],
    ["He didn't just evaluate for OpenAI; he worked there.", 'OpenAI'],
    ["It's not surprising he worked at OpenAI.", 'OpenAI'],
    ['It is not true that he has not worked at OpenAI.', 'OpenAI'],
    ["He hasn't worked at OpenAI since then.", 'OpenAI'],
    ["He doesn't work at OpenAI anymore.", 'OpenAI'],
    ['He was not employed by Google but by OpenAI.', 'OpenAI'],
    ['He is not only an engineer at OpenAI.', 'OpenAI'],
    ['He never stopped working at OpenAI.', 'OpenAI'],
  ] as const;
  for (const [s, org] of dropped) assert.equal(tripwire(s, about, ents), `employer:${org}`, s);
});

test("canonicalId strips the prompt's [c:…] marker form, and verifyClaims looks ids up through it", () => {
  assert.equal(canonicalId('exp:0'), 'exp:0');
  assert.equal(canonicalId('c:exp:0'), 'exp:0');
  assert.equal(canonicalId(' [c:project:urbancare-ai#stack] '), 'project:urbancare-ai#stack');
  assert.equal(canonicalId('copy:contact'), 'copy:contact', "a kind that merely starts with 'c' is untouched");
  const claim = (id: string) => ({ text: 'He builds with LangGraph.', evidence: [{ id, quote: 'LangGraph' }] });
  const out = verifyClaims([claim('c:exp:0'), claim('[c:exp:0]'), claim('c:exp:9')], facts, ents, 1);
  assert.equal(out.kept.length, 2, 'the prefixed real id passes; an unknown id still fails');
  assert.equal(out.dropped, 1);
});

test("resolveId reads a kind-less id ('content-storyteller#stack') only when one known id fits it", () => {
  assert.equal(resolveId('content-storyteller#stack', facts), 'project:content-storyteller#stack');
  assert.equal(resolveId('c:content-storyteller#stack', facts), 'project:content-storyteller#stack');
  assert.equal(resolveId('project:content-storyteller#stack', facts), 'project:content-storyteller#stack');
  assert.equal(resolveId('exp:0', facts), 'exp:0');
  // exp:0, edu:0, tool:0 and reading:0 all fit '0', and a bare number is never guessed at.
  assert.equal(resolveId('0', facts), '0');
  assert.equal(resolveId('0#h1', facts), '0#h1');
  assert.equal(resolveId('rust-project#stack', facts), 'rust-project#stack', 'an invented slug stays unknown');
  assert.equal(resolveId('stack', facts), 'stack');
  assert.equal(resolveId('storyteller#stack', facts), 'storyteller#stack', 'only a whole kind is ever added back');
  assert.equal(resolveId('content-storyteller#stack', { 'project:content-storyteller#stack': 'x' }), 'project:content-storyteller#stack', 'plain records work too');
  // verifyClaims looks through it, and the quote must still be in the chunk it resolves to.
  const claim = (id: string, quote: string) => ({ text: 'He used Terraform.', evidence: [{ id, quote }] });
  const out = verifyClaims([claim('content-storyteller#stack', 'Terraform'), claim('content-storyteller#stack', 'Kafka'), claim('rust-project#stack', 'Rust')], facts, ents, 1);
  assert.equal(out.kept.length, 1);
  assert.equal(out.dropped, 2);
});

test('the employer tripwire reads Title Case job titles and sentence-initial verbs', () => {
  const urbancare = [fact('project:urbancare-ai#summary')];
  const exp1 = [fact('exp:1')];
  const tripped = [
    ['He was a Research Scientist at Google DeepMind.', urbancare, 'Google DeepMind'],
    ['He was a Software Engineer at OpenAI.', exp1, 'OpenAI'],
    ['He is a Senior Researcher at Anthropic.', exp1, 'Anthropic'],
    ['Worked at OpenAI as a contractor.', exp1, 'OpenAI'],
    ['Joined Anthropic after Mindrift.', exp1, 'Anthropic'],
    ['Employed by OpenAI.', exp1, 'OpenAI'],
    ['He Worked At Anthropic.', exp1, 'Anthropic'],
    ['A Google DeepMind engineer built it.', urbancare, 'Google DeepMind'],
  ] as const;
  for (const [s, ev, org] of tripped) assert.equal(tripwire(s, ev, ents), `employer:${org}`, s);
  assert.equal(tripwire('Studied at MIT.', [fact('profile:about')], ents), 'employer:MIT');
  // Listed roles in Title Case, cited to their own chunk, still pass.
  const kept = [
    ['He is a Freelance AI Agent Specialist at Mindrift.', exp1],
    ['He was a Data Science Intern at Unified Mentor.', [fact('exp:2')]],
    ['Worked at Mindrift as a Freelance AI Agent Specialist.', exp1],
    ['He has not worked at OpenAI.', exp1],
  ] as const;
  for (const [s, ev] of kept) assert.equal(tripwire(s, ev, ents), null, s);
});

test('unlistedAffiliation finds an employer, school or venue a job requirement asks for', () => {
  const asked = [
    ['Prior employment at OpenAI or Anthropic doing RLHF', 'OpenAI'],
    ['Previously worked at OpenAI or Anthropic on RLHF', 'OpenAI'],
    ['Research Scientist experience at Google DeepMind with Gemma models', 'Google DeepMind'],
    ['Ex-Google engineer', 'Google'],
    ['Former OpenAI researcher', 'OpenAI'],
    ['Published papers at NeurIPS on LangGraph agents', 'NeurIPS'],
  ] as const;
  for (const [r, org] of asked) assert.equal(unlistedAffiliation(r, ents), org, r);
  const tools = [
    'Experience with Kubernetes',
    'Experience in Python',
    'Engineer for AWS Lambda deployments',
    'Experience at a startup',
    'Freelance AI Agent Specialist at Mindrift',
    'Data Science Intern at Unified Mentor',
    'Evaluate LLM outputs for RLHF',
  ];
  for (const r of tools) assert.equal(unlistedAffiliation(r, ents), null, r);
});
