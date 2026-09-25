import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_RETRY_DELAY_MS,
  classifyStatus,
  nextAttemptBudget,
  retryDelayMs,
  thinkingFor,
} from './modelPolicy.ts';

test('thinkingFor never gives MINIMAL to a non-lite model', () => {
  assert.equal(thinkingFor('gemini-3.8-flash'), 'LOW');
  assert.notEqual(thinkingFor('gemini-3.8-flash'), 'MINIMAL');
  assert.equal(thinkingFor('gemini-3.8-pro'), 'LOW');
  assert.equal(thinkingFor('some-future-model'), 'LOW');
});

test('thinkingFor gives MINIMAL to Flash-Lite', () => {
  assert.equal(thinkingFor('gemini-3.5-flash-lite'), 'MINIMAL');
  assert.equal(thinkingFor('gemini-3.5-flash-lite-preview-09-2026'), 'MINIMAL');
});

test('classifyStatus retries only 429 and 503', () => {
  assert.equal(classifyStatus(429), 'next');
  assert.equal(classifyStatus(503), 'next');
  for (const status of [400, 401, 403, 404, 500, 504]) assert.equal(classifyStatus(status), 'upstream', String(status));
});

test('nextAttemptBudget refuses a second attempt under 8s', () => {
  assert.equal(nextAttemptBudget(7999, 25000), null);
  assert.equal(nextAttemptBudget(0, 25000), null);
  assert.equal(nextAttemptBudget(Number.NaN, 25000), null);
  assert.equal(nextAttemptBudget(8000, 25000), 8000);
  assert.equal(nextAttemptBudget(20000, 12000), 12000);
});

test('retryDelayMs parses RetryInfo in every shape the SDK hands over', () => {
  assert.equal(retryDelayMs('37s'), 37000);
  assert.equal(retryDelayMs('1.5s'), 1500);
  const body = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure' },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
      ],
    },
  };
  assert.equal(retryDelayMs(body), 37000);
  assert.equal(retryDelayMs(JSON.stringify(body)), 37000);
  const apiError = Object.assign(new Error(JSON.stringify(body)), { name: 'ApiError', status: 429 });
  assert.equal(retryDelayMs(apiError), 37000);
  assert.equal(retryDelayMs({ retryDelay: { seconds: 12, nanos: 500000000 } }), 12500);
});

test('retryDelayMs falls back to 60s and caps absurd delays', () => {
  assert.equal(retryDelayMs(undefined), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryDelayMs('not json'), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryDelayMs({ error: { code: 429 } }), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryDelayMs('0s'), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryDelayMs('86400s'), 15 * 60000);
});
