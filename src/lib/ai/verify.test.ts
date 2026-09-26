import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { parseAchievements } from '../achievements.ts';
import { parseCertifications } from '../certifications.ts';
import { buildCorpus, entities, type CorpusSources } from './corpus.ts';
import {
  bannedPhrase,
  canonicalId,
  credentialIssue,
  faithful,
  honourIssue,
  normalizeDigits,
  numbersIn,
  quoteOk,
  resolveId,
  tripwire,
  unlistedAffiliation,
  verifyClaims,
} from './verify.ts';

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
const facts = new Map(chunks.map((c) => [c.id, c.text]));
const ents = entities({ profile: src.profile, projects: src.projects, skills: src.skillsIndex, reading: src.reading, certifications: src.certifications, achievements: src.achievements });
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

test("'AWS certified' is dropped with or without listed credentials; an honest negative passes", () => {
  assert.equal(tripwire('He is AWS certified.', [fact('profile:about')], ents), 'certification');
  assert.equal(tripwire('The site lists no AWS certification.', [fact('profile:about')], ents), null);
  // With nothing listed, any credential claim that is not negated fails, as it always did.
  const none = { ...ents, certifications: [] };
  assert.equal(tripwire('He holds the Google AI Professional Certificate.', [fact('profile:about')], none), 'certification');
  assert.equal(tripwire('He holds several certificates.', [fact('profile:about')], none), 'certification');
  assert.equal(tripwire('No certifications are listed on this site.', [fact('profile:about')], none), null);
});

test('a listed credential passes when the sentence names it and cites its chunk', () => {
  const kept: [string, string[]][] = [
    ['He holds the Google AI Professional Certificate from Google on Coursera.', ['cert:google-ai-professional-certificate']],
    ['He holds the Google AI Professional Certificate.', ['profile:about']],
    ['He earned 20 course-completion badges from Anthropic on Claude Academy.', ['cert:claude-academy']],
    ['He completed Claude Code in Action on Claude Academy.', ['cert:claude-academy']],
    ['He has the Claude Code in Action badge.', ['cert:claude-academy']],
    ['His Coursera course certificates come from IBM and the University of Michigan.', ['cert:coursera']],
    ['He holds IBM course certificates on Coursera.', ['cert:coursera']],
    ['He completed Understanding and Visualizing Data with Python from the University of Michigan on Coursera.', ['cert:coursera']],
    ['He holds two Programiz PRO certificates: Learn Python Basics and Practice: Python Basics.', ['cert:programiz-pro']],
    ['He has Python certificates from Programiz PRO.', ['cert:programiz-pro']],
    ['He holds a Google AI certificate from Coursera.', ['cert:google-ai-professional-certificate']],
    ['His certificates include AI Fundamentals and Data Science Methodology.', ['cert:google-ai-professional-certificate', 'cert:coursera']],
    ['His credential ID for Tools for Data Science is OO314JZV9F2X.', ['cert:coursera']],
    ['He earned a Claude Code badge from Anthropic.', ['cert:claude-academy']],
    ["The site lists 37 credentials.", ['profile:about']],
    // A project's own wording is not a claim about his credentials.
    ['MCQ Tech Challenge is aimed at government job or certification prep.', ['project:mcq-tech-challenge#summary']],
    // An ordinary phrase that happens to be a course title in lower case.
    ['He used AI for data analysis in the project.', ['exp:0']],
  ];
  for (const [s, ids] of kept) assert.equal(tripwire(s, ids.map(fact), ents), null, s);
});

test('an unlisted, uncited or inflated credential is dropped', () => {
  const dropped: [string, string[]][] = [
    ['He is AWS certified.', ['cert:claude-academy']],
    ['He holds the AWS Certified Solutions Architect credential.', ['profile:about']],
    ['He is PMP certified.', ['profile:about']],
    ['He holds a Google Cloud Professional certification.', ['cert:google-ai-professional-certificate']],
    // The Vertex AI badge is Anthropic's, on Claude Academy: it cannot vouch for a Google Cloud certificate.
    ['He holds a Google Cloud Professional certificate from Coursera.', ['cert:google-ai-professional-certificate', 'cert:claude-academy']],
    ['He is Google Cloud certified.', ['cert:claude-academy']],
    ['He holds a Google Cloud credential.', ['cert:claude-academy']],
    ['He has a Stanford certificate in machine learning.', ['profile:about']],
    ['He holds the Stanford machine learning certificate.', ['profile:about']],
    // LinkedIn's name for the Michigan course: it is a single course, not the specialization.
    ['He completed the Statistics with Python Specialization.', ['cert:coursera']],
    ['He completed the Statistics with Python specialization from the University of Michigan.', ['cert:coursera']],
    ['He has an IBM Data Science Professional Certificate.', ['cert:coursera']],
    // An issuer alone names no credential.
    ['He is Google certified.', ['cert:google-ai-professional-certificate']],
    ['He holds IBM certificates.', ['cert:coursera']],
    // Claude Academy items are course-completion badges, not certifications.
    ['He is certified in Claude Code in Action.', ['cert:claude-academy']],
    ['He holds 20 Claude Academy certifications.', ['cert:claude-academy']],
    ['He holds an Anthropic certification.', ['cert:claude-academy']],
    ['He is certified.', ['cert:claude-academy']],
    // A listed title the cited chunk does not contain.
    ['He holds the Google AI Professional Certificate.', ['exp:0']],
    ['He completed AI Fundamentals.', ['exp:0']],
    // Answer particles and contrasts do not negate the claim that follows.
    ['No, he is AWS certified.', ['profile:about']],
    ['He has not worked at OpenAI, but he is AWS certified.', ['profile:about']],
  ];
  for (const [s, ids] of dropped) assert.equal(tripwire(s, ids.map(fact), ents), 'certification', s);
});

test('a negated credential claims nothing, and a contrast after it is checked on its own', () => {
  const about = [fact('profile:about')];
  for (const s of [
    'He is not AWS certified.',
    'The site lists no AWS, PMP or Google Cloud certification.',
    "He doesn't hold a Google Cloud Professional certification.",
    'No certifications beyond those are listed.',
  ]) {
    assert.equal(tripwire(s, about, ents), null, s);
  }
  const gaipc = [fact('cert:google-ai-professional-certificate')];
  assert.equal(tripwire('He does not hold a Google Cloud Professional certification; he holds the Google AI Professional Certificate.', gaipc, ents), null);
  assert.equal(
    tripwire('His Michigan credential is the course Understanding and Visualizing Data with Python, not the Statistics with Python Specialization.', [fact('cert:coursera')], ents),
    null,
  );
  assert.equal(tripwire('He is not AWS certified, but he is PMP certified.', about, ents), 'certification');
});

test('credentialIssue caps a job requirement the listed credentials cannot meet', () => {
  assert.equal(credentialIssue('AWS Certified Machine Learning Specialty', [fact('profile:about')], ents), 'certification');
  assert.equal(credentialIssue('TensorFlow Developer Certificate', [fact('cert:coursera')], ents), 'certification');
  assert.equal(credentialIssue('Google AI Professional Certificate', [fact('cert:google-ai-professional-certificate')], ents), null);
  assert.equal(credentialIssue('Strong Python skills', [fact('exp:0')], ents), null, 'no credential asked for');
});

test('a hackathon result must be worded as the cited post words it', () => {
  const bharat = [fact('achievement:ai-for-bharat-finalist')];
  const pulse = [fact('achievement:promptwars-pulse')];
  const kaggle = [fact('achievement:kaggle-hai-def')];
  assert.equal(tripwire('Vyapar-Gyan was selected as a Top 36 Finalist at the AI for Bharat Hackathon.', bharat, ents), null);
  assert.equal(tripwire('VyaparGyan did not win; it was selected as a Top 36 Finalist.', bharat, ents), null);
  assert.equal(tripwire('He built VyaparGyan in a team of two.', bharat, ents), null);
  assert.equal(tripwire('PULSE Stadium AI was built solo in 48 hours for PromptWars.', pulse, ents), null);
  assert.equal(tripwire('UrbanCare AI was submitted to The MedGemma Impact Challenge on Kaggle.', kaggle, ents), null);
  assert.equal(tripwire('Vyapar-Gyan won the AI for Bharat Hackathon.', bharat, ents), 'honour:won');
  assert.equal(tripwire('Vyapar-Gyan was the winner of the AI for Bharat Hackathon.', bharat, ents), 'honour:winner');
  assert.equal(tripwire('PULSE Stadium AI was a PromptWars finalist.', pulse, ents), 'honour:finalist');
  assert.equal(tripwire('UrbanCare AI received an award in the HAI-DEF challenge.', kaggle, ents), 'honour:award');
  assert.equal(tripwire('UrbanCare AI received an award in the MedGemma Impact Challenge.', kaggle, ents), 'honour:award');
  assert.equal(tripwire('It took first place.', bharat, ents), 'honour:first place');
  assert.equal(tripwire('It was a Top 10 finalist.', bharat, ents), 'number:10');
  // honourIssue alone: a finalist is not a semi-finalist, and "won't" is not a result.
  assert.equal(honourIssue('It was a semi-finalist.', bharat), 'honour:semi-finalist');
  assert.equal(honourIssue("He won't overstate it.", []), null);
});

test('the new roles are employers only where they are cited', () => {
  assert.equal(tripwire('He works at Outlier as a Freelance AI Trainer.', [fact('exp:5')], ents), null);
  assert.equal(tripwire("He is the Owner at GOLDEN's Coreforge.", [fact('exp:3')], ents), null);
  assert.equal(tripwire('He was a Freelance AI Trainer at Outlier.', [fact('exp:1')], ents), 'employer:Outlier');
  assert.equal(tripwire('He was a Product Manager at Google.', [fact('exp:1')], ents), 'employer:Google');
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
    'Designer for Figma plugins',
    'Freelance AI Trainer at Outlier',
  ];
  for (const r of tools) assert.equal(unlistedAffiliation(r, ents), null, r);
});
