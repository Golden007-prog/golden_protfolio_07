import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { answer, historyFor, isMultiSentence, isOpenEnded, isRefusal, shouldEscalate, STARTERS, truncateSentences, type AskData } from './askme.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const data: AskData = { profile: read('profile.json'), projects: read('projects.json') };
const ask = (q: string) => answer(q, data);

test('"Do you know React?" answers about React, never the ReAct pattern', () => {
  const a = ask('Do you know React?');
  assert.equal(a.intent, 'skill');
  assert.match(a.text, /\*\*React\*\*/);
  assert.doesNotMatch(a.text, /ReAct/);
  assert.doesNotMatch(a.text, /production/i);
  assert.match(a.text, /isn't one of my listed skills/);
  assert.ok(a.projects.includes('urbancare-ai'));
});

test('"ReAct" answers with its listed category', () => {
  const a = ask('Have you used ReAct?');
  assert.equal(a.intent, 'skill');
  assert.match(a.text, /\*\*ReAct\*\*.*GenAI & LLMs/);
  assert.doesNotMatch(a.text, /\*\*React\*\*/);
});

test('a lower-case "react" is reported as ambiguous instead of guessed', () => {
  const a = ask('do you know react');
  assert.match(a.text, /Did you mean/);
  assert.match(a.text, /\*\*ReAct\*\*/);
  assert.match(a.text, /\*\*React\*\*/);
});

test('"Git" matches the Git skill and not GitHub', () => {
  const a = ask('Do you use Git?');
  assert.equal(a.intent, 'skill');
  assert.match(a.text, /\*\*Git\*\*.*Infrastructure/);
  assert.doesNotMatch(a.text, /GitHub/);
  const links = ask("What's your GitHub?");
  assert.equal(links.intent, 'links');
  assert.match(links.text, /github\.com\/Golden007-prog/);
});

test('"storage" no longer matches RAG', () => {
  for (const q of ['How do you handle storage?', 'storage']) {
    const a = ask(q);
    assert.doesNotMatch(a.text, /\bRAG\b/, q);
    assert.equal(a.intent, 'fallback', q);
  }
});

test('"Tell me about UrbanCare" answers with the project, not the bio', () => {
  const a = ask('Tell me about UrbanCare');
  assert.equal(a.intent, 'project');
  assert.deepEqual(a.projects, ['urbancare-ai']);
  assert.match(a.text, /\*\*UrbanCare AI\*\*/);
  assert.ok(!a.text.includes(data.profile.about.slice(0, 40)));
  assert.ok(a.handoff?.includes('UrbanCare AI'));
});

test('other project names resolve by their distinctive words', () => {
  assert.deepEqual(ask('What is NexusFlow?').projects, ['bruhworking-nexusflow']);
  assert.deepEqual(ask('omni lab demo?').projects, ['omni-lab']);
  assert.deepEqual(ask('Tell me about the Netflix one').projects, ['netflix-content-analytics']);
  assert.deepEqual(ask('The TCS project').projects, ['tcs-stock-forecasting']);
});

test('"What do you work on?" answers with the current roles', () => {
  const a = ask(STARTERS[0]);
  assert.equal(a.intent, 'experience');
  for (const e of data.profile.experience.filter((x) => x.end === null)) assert.ok(a.text.includes(e.company), e.company);
});

test('every starter chip gets a real answer', () => {
  const intents = STARTERS.map((q) => ask(q).intent);
  assert.deepEqual(intents, ['experience', 'projects', 'stack', 'hire']);
});

test('no skill answer claims production use', () => {
  for (const list of Object.values(data.profile.skills)) {
    for (const skill of list) {
      const a = ask(`Do you know ${skill}?`);
      assert.equal(a.intent, 'skill', skill);
      assert.match(a.text, new RegExp(`\\*\\*${skill.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\*\\*`), skill);
      assert.doesNotMatch(a.text, /production/i, skill);
    }
  }
});

test('skill answers only name projects whose stack lists the skill', () => {
  const a = ask('Which projects use Gemini?');
  assert.equal(a.intent, 'skill');
  assert.match(a.text, /6 projects/);
  const rag = ask('Do you know RAG?');
  assert.match(rag.text, /No project on this site lists it/);
});

test('hiring answers carry the email, a handoff draft and a CV action', () => {
  const a = ask('How do I hire you?');
  assert.equal(a.intent, 'hire');
  assert.ok(a.text.includes(data.profile.email));
  assert.ok(a.handoff);
  assert.ok(a.actions.some((x) => x.kind === 'cv'));
  const mail = a.actions.find((x) => x.kind === 'link' && x.href.startsWith('mailto:'));
  assert.ok(mail && mail.kind === 'link' && !mail.external);
  assert.equal(ask('Can I see your resume?').intent, 'cv');
});

test('the bio is cut at a sentence boundary', () => {
  const a = ask('Tell me about yourself');
  assert.equal(a.intent, 'about');
  assert.ok(a.text.length <= 320);
  assert.match(a.text, /[.!?]$/);
  assert.equal(truncateSentences('One two three four five six.', 12), 'One two…');
  assert.equal(truncateSentences('Short one. Another one here.', 12), 'Short one.');
});

test('isMultiSentence drives the typing cue', () => {
  assert.equal(isMultiSentence("Here's my CV."), false);
  assert.equal(isMultiSentence('**RAG** is listed. No project uses it.'), true);
  assert.equal(isMultiSentence('line one\nline two'), true);
});

/* ---- rule-first escalation (#178) ---- */

const escalates = (q: string, opts: { scoped?: boolean } = {}) => shouldEscalate(q, ask(q), opts);

test('deterministic intents stay on the rules: no AI call', () => {
  for (const q of [
    ...STARTERS,
    'Which projects use Gemini?',
    'Tell me about UrbanCare',
    'Can I see your resume?',
    "What's your GitHub?",
    'Do you know React?',
    'hi',
    '',
  ]) {
    assert.equal(escalates(q), false, q);
  }
});

test('fallback, about and open-ended questions escalate', () => {
  for (const q of [
    'What kind of problems does he seem most curious about?',
    'Why do you think his UrbanCare AI work matters, in your own words?',
    'Tell me about yourself',
    "What's his salary?",
    'Did he work at Google DeepMind?',
    'How does Omni-Lab route between models?',
    'Compare UrbanCare AI and Vyapar-Gyan',
    'What challenges did he face in Omni-Lab?',
  ]) {
    assert.equal(escalates(q), true, q);
  }
});

test('navigation requests escalate unless the rule answer already offers the action', () => {
  assert.equal(escalates('Filter the projects to Python ones'), true);
  assert.equal(escalates('Take me to his experience'), true);
  assert.equal(escalates('Download your CV'), false);
  assert.equal(escalates('Open the UrbanCare project'), false);
});

test('a question in another language escalates even when a rule matches a name in it', () => {
  assert.equal(escalates('UrbanCare AI में उन्होंने क्या बनाया?'), false);
  assert.equal(shouldEscalate('UrbanCare AI में उन्होंने क्या बनाया?', ask('UrbanCare AI में उन्होंने क्या बनाया?'), { foreign: true }), true);
});

test('a scoped question always escalates; the rules know nothing about the scope', () => {
  assert.equal(escalates('What stack?'), false);
  assert.equal(escalates('What stack?', { scoped: true }), true);
  assert.equal(escalates('hi', { scoped: true }), false);
});

test('isOpenEnded ignores visitor-action "how do I" questions', () => {
  assert.equal(isOpenEnded('How do I hire you?'), false);
  assert.equal(isOpenEnded('How can we get in touch?'), false);
  assert.equal(isOpenEnded('How does the RAG pipeline in Omni-Lab work?'), true);
});

test('isRefusal spots "not on this site" answers, citations ignored', () => {
  assert.equal(isRefusal("His salary isn't on this site. You can ask him through the contact form."), true);
  assert.equal(isRefusal('Google DeepMind is not listed as an employer [c:exp:0].'), true);
  assert.equal(isRefusal('He built UrbanCare AI with MedGemma [c:project:urbancare-ai#stack].'), false);
});

test('history carries at most 6 of the visitor questions, 2000 characters, exactly as typed', () => {
  const qs = ['one?', 'two?', 'three?', 'four?', 'five?', 'six?', 'seven?'];
  assert.deepEqual(historyFor(qs), qs.slice(1));
  const long = ['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(500), 'd'.repeat(500), 'e'.repeat(10)];
  const h = historyFor(long);
  assert.ok(h.reduce((n, q) => n + q.length, 0) <= 2000);
  assert.deepEqual(h, long.slice(1));
  assert.deepEqual(historyFor(['  Mixed Case?  ']), ['  Mixed Case?  ']);
});
