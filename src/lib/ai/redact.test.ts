import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact } from './redact.ts';

test('emails, phones and token-bearing URLs are removed with exact counts', () => {
  const r = redact('Contact hr@acme.com or +1 (415) 555-0100. Apply at https://x.io/j?token=abc now.');
  assert.equal(r.text, 'Contact [email removed] or [phone removed]. Apply at [link removed] now.');
  assert.equal(r.removed, 3);
  assert.deepEqual(r.counts, { emails: 1, phones: 1, urls: 1 });
});

test('technical numbers and plain links survive', () => {
  const text = 'Needs Python 3.12 by 2026, R² 0.999 models, 1,20,000 rows, dated 2025-09-25. See https://acme.com/jobs/123?ref=board.';
  const r = redact(text);
  assert.equal(r.text, text);
  assert.equal(r.removed, 0);
});

test('credential query and fragment keys are recognised in their common spellings', () => {
  const cases = [
    'https://a.io/x?api_key=1',
    'https://a.io/x?key=1',
    'https://a.io/x?a=1&sig=2',
    'https://a.io/x?X-Amz-Signature=2',
    'https://a.io/cb#access_token=zzz',
    'https://a.io/x?auth=1',
    'www.a.io/x?apikey=1',
  ];
  for (const url of cases) {
    const r = redact(`see ${url} ok`);
    assert.equal(r.text, 'see [link removed] ok', url);
    assert.equal(r.counts.urls, 1, url);
  }
  assert.equal(redact('https://a.io/monkey?keyboard=1').removed, 0, 'words that merely contain key are left alone');
});

test('several items are each counted', () => {
  const r = redact('a@b.co, c@d.org; call 415-555-0100 or +91 7001124396.');
  assert.deepEqual(r.counts, { emails: 2, phones: 2, urls: 0 });
  assert.equal(r.removed, 4);
  assert.ok(!/\d{4}/.test(r.text));
  assert.deepEqual(redact(''), { text: '', removed: 0, counts: { emails: 0, phones: 0, urls: 0 } });
});
