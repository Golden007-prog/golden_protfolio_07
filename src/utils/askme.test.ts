import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { answer, isMultiSentence, STARTERS, truncateSentences, type AskData } from './askme.ts';

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
