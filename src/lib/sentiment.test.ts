import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, INTENSIFIER_FACTOR, lookup, NEGATION_FACTOR } from './sentiment.ts';

test("n't negates: \"I don't love it\" is negative", () => {
  const r = analyze("I don't love it");
  assert.equal(r.label, 'negative');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].word, 'love');
  assert.equal(r.hits[0].negated, true);
  assert.equal(r.hits[0].weight, NEGATION_FACTOR);
});

test('a curly apostrophe negates too: "I don’t love it" is negative', () => {
  const r = analyze('I don’t love it');
  assert.equal(r.label, 'negative');
  assert.equal(r.hits[0].negated, true);
  // Offsets still point into the text as typed.
  assert.equal('I don’t love it'.slice(r.hits[0].start, r.hits[0].end), 'love');
});

test('negating a negative word flips it: "It isn\'t slow" is positive', () => {
  const r = analyze("It isn't slow");
  assert.equal(r.label, 'positive');
  assert.ok(r.score > 0);
});

test("'broke' is in the lexicon through its stem", () => {
  assert.equal(lookup('broke'), -1);
  assert.equal(analyze('The build broke').label, 'negative');
});

test('cannot and apostrophe-less contractions negate', () => {
  assert.equal(analyze('I cannot love this').label, 'negative');
  assert.equal(analyze('I dont hate it').label, 'positive');
});

test('intensifiers scale by 1.6 and negation stops at a clause break', () => {
  const r = analyze('really fast');
  assert.equal(r.hits[0].intensified, true);
  assert.equal(r.hits[0].weight, INTENSIFIER_FACTOR);
  const split = analyze('Not the plan, but great');
  assert.equal(split.hits[0].negated, false);
  assert.equal(split.label, 'positive');
});

test('inflections reach their stems', () => {
  assert.equal(lookup('loving'), 1);
  assert.equal(lookup('crashes'), -1);
  assert.equal(lookup('happily'), 1);
  assert.equal(lookup('failed'), -1);
  assert.equal(lookup('report'), 0);
});

test('the demo examples land where their wording says', () => {
  assert.equal(analyze('The new RAG pipeline is blazing fast and surprisingly accurate.').label, 'positive');
  assert.equal(analyze('That deploy pipeline broke again — really frustrating debug session.').label, 'negative');
  assert.equal(analyze('Meeting went okay, nothing to report.').label, 'neutral');
  assert.deepEqual(analyze('   '), { label: 'neutral', score: 0, hits: [], words: 0 });
});
