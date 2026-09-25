import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { answer, STARTERS, type AskData } from '../../../utils/askme.ts';
import {
  AI_SPOKEN,
  aiSpoken,
  answerSpeech,
  ASK_DIRECTLY,
  DEGRADED_NOTE,
  englishOnlyNote,
  INCOMPLETE_NOTE,
  QUICK_IN_ENGLISH,
  ruleSpeech,
  ruleSpoken,
  spokenText,
} from './spoken.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), 'utf8'));
const DATA: AskData = { profile: read('profile.json'), projects: read('projects.json') };

// Words that belong to the bubble's controls, never to what is spoken.
const CONTROL_WORDS = /Source \d|Sources|Copy as Markdown|Helpful|Not helpful|This is wrong|Regenerate|Show the quick answer|Details|How it works|Privacy|Show in Projects|Show in English|\[c:/;

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test('a long cited answer is spoken once, with the disclosure once and no citation labels', () => {
  // The reviewer's case: the slow fake answer, a citation after each of ~20 sentences.
  const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i + 1} is about his work [c:about].`).join(' ');
  const said = spokenText(aiSpoken({ text }));
  assert.equal(count(said, 'may be wrong'), 1);
  assert.ok(said.startsWith(AI_SPOKEN));
  assert.doesNotMatch(said, CONTROL_WORDS);
  assert.equal(count(said, 'Sentence '), 20);
  assert.match(said, /Sentence 1 is about his work\. Sentence 2/);
});

test('markers go, including several ids in one and a malformed one, without leaving a space before the stop', () => {
  assert.equal(
    answerSpeech('His role is ML intern at Acme [c:exp:0]. UrbanCare AI uses MedGemma [c:project:urbancare-ai#solution][c:fake].'),
    'His role is ML intern at Acme. UrbanCare AI uses MedGemma.',
  );
  assert.equal(answerSpeech('Both [c:exp:0, exp:1] list Python.'), 'Both list Python.');
  assert.equal(answerSpeech('A dangling one [c:exp'), 'A dangling one');
  assert.equal(answerSpeech('[c:about]'), '');
});

test('a non-English answer carries its language; the disclosure and notes stay English', () => {
  const parts = aiSpoken({ text: 'वह पायथन का उपयोग करते हैं [c:about].', lang: 'hi' });
  assert.deepEqual(parts, [{ text: AI_SPOKEN }, { text: 'वह पायथन का उपयोग करते हैं.', lang: 'hi' }]);
  const fellBack = aiSpoken({ text: 'He uses Python [c:about].', lang: null, englishFrom: 'Hindi' });
  assert.equal(fellBack.at(-1)?.text, englishOnlyNote('Hindi'));
  assert.equal(fellBack.at(-1)?.lang, undefined);
});

test('a stopped answer says it is incomplete; a degraded one adds the note and the quick answer', () => {
  assert.equal(spokenText(aiSpoken({ text: 'Sentence a [c:exp:0].', stopped: true })), `${AI_SPOKEN} Sentence a. ${INCOMPLETE_NOTE}`);
  const degraded = spokenText(aiSpoken({ text: 'One kept sentence [c:exp:0].', degraded: true, ruleText: "**I didn't catch that.**\nTry a project name." }));
  assert.equal(degraded, `${AI_SPOKEN} One kept sentence. ${DEGRADED_NOTE} I didn't catch that. Try a project name.`);
  // A leaked answer shows no model text at all: disclosure, note, quick answer.
  const leaked = spokenText(aiSpoken({ text: '', degraded: true, ruleText: 'Quick answer.' }));
  assert.equal(leaked, `${AI_SPOKEN} ${DEGRADED_NOTE} Quick answer.`);
  // The "incomplete" and language notes need an answer to qualify.
  assert.equal(spokenText(aiSpoken({ text: '', stopped: true, englishFrom: 'Tamil' })), AI_SPOKEN);
});

test('rule text loses its bold markers and bullets and reads as sentences', () => {
  assert.equal(ruleSpeech('· **Alpha**: a thing\n· **Beta**: another thing.'), 'Alpha: a thing. Beta: another thing.');
  assert.equal(ruleSpeech('· **BSc**, Uni (2024) · Completed'), 'BSc, Uni (2024), Completed.');
  assert.equal(ruleSpeech('Right now:\nRole one\n\nFocus: ML.'), 'Right now: Role one. Focus: ML.');
});

test('every quick answer the rules give is speakable: no markup, no bullets, no line breaks', () => {
  const questions = [
    ...STARTERS,
    'Which projects use Gemini?',
    'What tech do you use?',
    'Are you open to work?',
    'Where did you study?',
    'What are your links?',
    'Tell me about your experience',
    'Can I get your CV?',
    'asdfgh',
  ];
  for (const q of questions) {
    const rule = answer(q, DATA);
    const said = spokenText(ruleSpoken({ text: rule.text, intent: rule.intent }));
    assert.ok(said.length > 0, q);
    assert.doesNotMatch(said, /\*\*|\n|(^|\s)·(\s|$)/, q);
    assert.doesNotMatch(said, CONTROL_WORDS, q);
  }
});

test('a fallback bubble speaks its reason unless the status line already said it', () => {
  const base = { text: 'The quick answer.', intent: 'bio' };
  assert.equal(
    spokenText(ruleSpoken({ ...base, note: 'uncited', noteText: 'Why it is the quick answer.' })),
    'Why it is the quick answer. The quick answer.',
  );
  assert.equal(
    spokenText(ruleSpoken({ ...base, note: 'unavailable', noteText: "That's a lot of questions in a short time. Give it a minute." })),
    "That's a lot of questions in a short time. Give it a minute. The quick answer.",
  );
  // 'Stopped' and 'Nothing on this site covers that.' are the status line itself.
  assert.equal(spokenText(ruleSpoken({ ...base, note: 'stopped', noteText: 'Stopped before an answer arrived.' })), 'The quick answer.');
  assert.equal(spokenText(ruleSpoken({ ...base, note: 'nothing', noteText: 'Nothing on this site covers that.' })), 'The quick answer.');
  // Nothing to answer with: the handoff line the bubble shows.
  assert.equal(spokenText(ruleSpoken({ text: 'unused', intent: 'fallback', note: 'nothing', noteText: 'x' })), ASK_DIRECTLY);
  assert.equal(spokenText(ruleSpoken({ ...base, english: true })), `The quick answer. ${QUICK_IN_ENGLISH}`);
});
