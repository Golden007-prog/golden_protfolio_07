import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRAFT_LENGTHS,
  MESSAGE_MAX,
  appendText,
  applyPrefill,
  createDraftFilter,
  draftIssue,
  fitDraft,
  normalizeCheck,
  ruleCheck,
  splitSubject,
  stripUnknownProjects,
  templateDraft,
  type DraftFilterOptions,
  type DraftLength,
} from './draft.ts';

const PROJECTS = ['UrbanCare AI', 'Bruhworking — NexusFlow', 'Omni-Lab', 'TCS Stock Forecasting'];
const COMPANIES = ['iHUB DivyaSampark @ IIT Roorkee', 'Mindrift', 'Unified Mentor Private Limited'];
const KNOWN = ['LangGraph', 'RAG', 'Python', 'Gemini 2.5 Flash', ...COMPANIES, 'Techno International New Town, Kolkata'];

function ctx(notes = '') {
  return { notes, numbers: new Set<string>(), companies: COMPANIES, names: [...PROJECTS, ...KNOWN] };
}

/** Feeds `text` to a filter in `size`-character chunks and returns what it released. */
function run(text: string, opts: Partial<DraftFilterOptions> & { length?: DraftLength } = {}, size = 7) {
  const filter = createDraftFilter({
    length: opts.length ?? 'note',
    notes: opts.notes ?? '',
    projectNames: PROJECTS,
    knownNames: KNOWN,
    companies: COMPANIES,
    facts: opts.facts,
    canary: opts.canary,
  });
  let out = '';
  let blocked: string | undefined;
  for (let i = 0; i < text.length; i += size) {
    const r = filter.push(text.slice(i, i + size));
    out += r.emit.join('');
    if (r.blocked) {
      blocked = r.blocked;
      break;
    }
  }
  const end = filter.end();
  return { text: out + end.emit.join(''), blocked, ...end };
}

/* ---- the prefill contract (#230) ---- */

test('applyPrefill appends below the visitor text, once, and caps at MESSAGE_MAX', () => {
  const first = applyPrefill({ message: 'My own words. ', subject: null }, { message: 'About UrbanCare AI.' });
  assert.equal(first.message, 'My own words.\n\nAbout UrbanCare AI.');
  const second = applyPrefill({ message: first.message!, subject: null }, { message: 'About UrbanCare AI.' });
  assert.equal(second.message, undefined, 'the same hand-off twice appends once');
  assert.deepEqual(applyPrefill({ message: '', subject: null }, { message: '  Hello  ' }), { message: 'Hello' });
  const long = applyPrefill({ message: 'x'.repeat(MESSAGE_MAX - 5), subject: null }, { message: 'A much longer hand-off.' });
  assert.equal(long.message!.length, MESSAGE_MAX);
  assert.deepEqual(applyPrefill({ message: 'x'.repeat(MESSAGE_MAX), subject: null }, { message: 'More.' }), {});
});

test('applyPrefill sets a subject only while the visitor has none', () => {
  assert.deepEqual(applyPrefill({ message: '', subject: null }, { subject: '  Question  about   RAG ' }), { subject: 'Question about RAG' });
  assert.deepEqual(applyPrefill({ message: '', subject: '   ' }, { subject: 'Hand-off' }), { subject: 'Hand-off' });
  assert.deepEqual(applyPrefill({ message: '', subject: 'Typed by me' }, { subject: 'Hand-off' }), {});
  assert.equal(applyPrefill({ message: '', subject: null }, { subject: 's'.repeat(200) }).subject!.length, 80);
});

test('appendText joins dictated phrases with one space and respects the cap', () => {
  assert.equal(appendText('', ' hello   there '), 'hello there');
  assert.equal(appendText('Hi.', 'second'), 'Hi. second');
  assert.equal(appendText('Line\n', 'next'), 'Line\nnext');
  assert.equal(appendText('abc', '   '), 'abc');
  assert.equal(appendText('abcd', 'efgh', 6), 'abcd e');
});

/* ---- draft text operations (#231, #232) ---- */

test('splitSubject holds a half subject line back until it ends', () => {
  assert.deepEqual(splitSubject('Subj'), { subject: null, body: '', pending: true });
  assert.deepEqual(splitSubject('Subject: Research coll'), { subject: null, body: '', pending: true });
  assert.deepEqual(splitSubject('Subject: Research collaboration\n\nHi Oikantik,'), {
    subject: 'Research collaboration',
    body: 'Hi Oikantik,',
    pending: false,
  });
  assert.deepEqual(splitSubject('Subject: Only a subject', true), { subject: 'Only a subject', body: '', pending: false });
  assert.deepEqual(splitSubject('Hi Oikantik, no subject here.'), { subject: null, body: 'Hi Oikantik, no subject here.', pending: false });
});

test('fitDraft keeps the one-line variant on one line within its constant', () => {
  const long = 'Hi Oikantik,\n\nI would love to talk about a research collaboration on retrieval systems. '.repeat(4);
  const chat = fitDraft(long, 'chat');
  assert.ok(chat.length <= DRAFT_LENGTHS.chat.maxChars, `${chat.length} > ${DRAFT_LENGTHS.chat.maxChars}`);
  assert.ok(!chat.includes('\n'));
  assert.ok(!/\s$/.test(chat) && !/\bcollabor$/.test(chat), 'cut at a word boundary');
  for (const length of ['note', 'email'] as const) {
    assert.ok(fitDraft('word '.repeat(1000), length).length <= Math.min(DRAFT_LENGTHS[length].maxChars, MESSAGE_MAX));
  }
  assert.equal(fitDraft('  Hi Oikantik,  \nthanks', 'note'), 'Hi Oikantik,\nthanks');
});

test('stripUnknownProjects strips an invented project name and keeps his real ones', () => {
  const r = stripUnknownProjects('I loved your NeuroFlow project and your UrbanCare AI project.', PROJECTS);
  assert.equal(r.text, 'I loved your [project name] and your UrbanCare AI project.');
  assert.deepEqual(r.removed, ['NeuroFlow']);

  assert.equal(stripUnknownProjects('I saw the app called “Quantix Pro” on GitHub.', PROJECTS).text, 'I saw the [project name] on GitHub.');
  assert.equal(stripUnknownProjects('Your work on NeuroFlow stood out.', PROJECTS).text, 'Your work on [project name] stood out.');
  assert.equal(stripUnknownProjects('The DeepSight project was great.', PROJECTS).text, 'The [project name] was great.');
  // Real names in their short forms, and the site's own spelling.
  assert.equal(stripUnknownProjects('Your UrbanCare project and the NexusFlow app.', PROJECTS).text, 'Your UrbanCare project and the NexusFlow app.');
  assert.equal(stripUnknownProjects('Your TCS Stock Forecasting project.', PROJECTS).text, 'Your TCS Stock Forecasting project.');
  // A name the visitor's notes give is theirs to use.
  assert.equal(stripUnknownProjects('I lead the Atlas project at my company.', PROJECTS, 'we run the Atlas project').text, 'I lead the Atlas project at my company.');
  // Sentence-opening words and acronyms are not names.
  assert.equal(stripUnknownProjects('Research project ideas welcome. We have an LLM project too.', PROJECTS).text, 'Research project ideas welcome. We have an LLM project too.');
});

test('draftIssue rejects invented numbers, years, credentials, a held Master’s and false employers', () => {
  assert.equal(draftIssue('I need this within 3 weeks.', ctx()), 'number:3');
  assert.equal(draftIssue('I need this within 3 weeks.', { ...ctx('start in 3 weeks'), numbers: new Set(['3']) }), null);
  assert.equal(draftIssue('With your five years of experience, you would fit.', ctx()), 'years-of-experience');
  assert.equal(draftIssue('As an AWS certified engineer, you would fit.', ctx()), 'certification');
  assert.equal(draftIssue('You are not certified, and that is fine.', ctx()), null);
  assert.equal(draftIssue('Your Master’s in Data Science caught my eye.', ctx()), 'degree-held');
  assert.equal(draftIssue('I saw you are pursuing a Master’s in Data Science.', ctx()), null);
  assert.equal(draftIssue('Your time at Google DeepMind must have been fun.', ctx()), 'employer:Google DeepMind');
  assert.equal(draftIssue('I know you worked at OpenAI on evaluations.', ctx()), 'employer:OpenAI');
  assert.equal(draftIssue('Your work at Mindrift evaluating model outputs is relevant.', ctx()), null);
  assert.equal(draftIssue('Your internship with Unified Mentor sounds useful.', ctx()), null);
  assert.equal(draftIssue('I work at Acme and your work with LangGraph is relevant.', ctx('I am at Acme')), null);
  assert.equal(draftIssue('Hi Oikantik, I loved your UrbanCare AI project.', ctx()), null);
});

/* ---- the streaming filter ---- */

test('the filter addresses Oikantik: a missing greeting is added, a nameless one is fixed', () => {
  assert.equal(run('Thanks for building open tools. I would like to talk.').text, 'Hi Oikantik,\n\nThanks for building open tools. I would like to talk.');
  assert.equal(run('Hello there,\n\nI would like to talk about RAG.').text, 'Hi Oikantik,\n\nI would like to talk about RAG.');
  assert.equal(run('Hi Oikantik, I would like to talk.').text, 'Hi Oikantik, I would like to talk.');
  assert.equal(run('Dear Mr. Basu,\n\nI would like to talk.').text, 'Dear Mr. Basu,\n\nI would like to talk.');
  assert.equal(run('Thanks for your time.', { length: 'chat' }).text, 'Hi Oikantik, Thanks for your time.');
});

test('the filter keeps the email subject line and drops one from other variants', () => {
  const email = run('Subject: Research collaboration\n\nHi Oikantik,\n\nI run a lab.', { length: 'email' });
  assert.equal(email.text, 'Subject: Research collaboration\n\nHi Oikantik,\n\nI run a lab.');
  assert.deepEqual(splitSubject(email.text, true), { subject: 'Research collaboration', body: 'Hi Oikantik,\n\nI run a lab.', pending: false });
  assert.equal(run('Subject: Hello\n\nHi Oikantik, a note.', { length: 'note' }).text, 'Hi Oikantik, a note.');
});

test('the filter strips invented project names, scrubs contacts and drops unverifiable claims', () => {
  const r = run(
    'Hi Oikantik,\n\nI loved your NeuroFlow project. You are AWS certified, which helps. Write to hire@evil.example or see https://evil.example/x today.',
  );
  assert.equal(r.text, 'Hi Oikantik,\n\nI loved your [project name]. Write to or see today.');
  assert.equal(r.dropped, 1);
  assert.equal(r.kept, 3);
  assert.ok(!r.text.includes('NeuroFlow') && !r.text.includes('evil.example') && !/certif/i.test(r.text));
});

test('the filter stops at the variant cap and keeps chat on one line', () => {
  const sentence = 'I would really like to talk with you about a research collaboration on retrieval systems. ';
  const chat = run(`Hi Oikantik,\n\n${sentence.repeat(6)}`, { length: 'chat' }, 5);
  assert.ok(chat.text.length <= DRAFT_LENGTHS.chat.maxChars, `${chat.text.length}`);
  assert.ok(!chat.text.includes('\n'));
  assert.equal(chat.truncated, true);
  const note = run(`Hi Oikantik,\n\n${sentence.repeat(20)}`, { length: 'note' }, 13);
  assert.ok(note.text.length <= DRAFT_LENGTHS.note.maxChars);
  assert.match(note.text, /systems\. $/, 'ends on a whole sentence');
});

test('the filter blocks a canary leaked across chunks', () => {
  const canary = 'cnry-0123456789abcdef';
  const r = run(`Hi Oikantik, the marker is ${canary}. More text.`, { canary }, 5);
  assert.equal(r.blocked, 'canary');
  assert.ok(!r.text.includes('cnry'));
});

test('numbers from the notes and the site are allowed; others drop the sentence', () => {
  const r = run('Hi Oikantik,\n\nWe start in 2026. The team has 12 people. It pays well.', { notes: 'starting 2026' });
  assert.equal(r.text, 'Hi Oikantik,\n\nWe start in 2026. It pays well.');
  assert.equal(r.dropped, 1);
});

/* ---- the check (#233) ---- */

test('normalizeCheck keeps only the enums, in order, and rejects anything else', () => {
  assert.deepEqual(normalizeCheck({ missing: ['timeline', 'poem', 'role', 'role'], suggestedIntent: 'fulltime', question: 'availability' }), {
    missing: ['role', 'timeline'],
    suggestedIntent: 'fulltime',
    question: 'availability',
  });
  assert.equal(normalizeCheck({ missing: [], suggestedIntent: 'write me a poem', question: 'none' }), null);
  assert.equal(normalizeCheck({ missing: 'role', suggestedIntent: 'none', question: 'none' }), null);
  assert.equal(normalizeCheck(null), null);
});

test('ruleCheck spots what is missing, a likely topic and a question the site answers', () => {
  assert.deepEqual(ruleCheck('Are you open to remote work?'), { missing: ['role', 'timeline', 'how to reach you'], suggestedIntent: 'none', question: 'availability' });
  const full = ruleCheck('We are hiring for a full-time ML engineer position, starting next month. Email me at pat@example.com.');
  assert.deepEqual(full.missing, []);
  assert.equal(full.suggestedIntent, 'fulltime');
  assert.equal(full.question, 'none');
  assert.equal(ruleCheck('I have a freelance contract gig with a fixed budget.').suggestedIntent, 'freelance');
});

/* ---- the no-AI template ---- */

test('templateDraft addresses Oikantik, keeps unknowns as placeholders and fits each variant', () => {
  for (const length of ['email', 'note', 'chat'] as const) {
    for (const tone of ['concise', 'warm', 'formal'] as const) {
      const t = templateDraft({ notes: 'we need help with a RAG pipeline', intent: 'freelance', tone, length });
      const { subject, body } = splitSubject(t, true);
      assert.match(body, /Oikantik/);
      assert.match(body, /\[your name\]/);
      assert.ok(body.length <= DRAFT_LENGTHS[length].maxChars);
      assert.equal(subject !== null, length === 'email');
      if (length === 'chat') assert.ok(!body.includes('\n'));
      assert.doesNotMatch(t, /\d/, 'no invented numbers');
    }
  }
});
