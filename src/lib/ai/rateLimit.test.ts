import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DailyBudget, TokenBuckets, costFor, evalMultiplier, ipKey } from './rateLimit.ts';

test('the 13th quick ask in a burst is refused with retryAfterSec', () => {
  const buckets = new TokenBuckets();
  const now = 1_000_000;
  const cost = costFor('ask', 200);
  assert.equal(cost, 1);
  for (let i = 0; i < 12; i++) assert.equal(buckets.take('1.2.3.4', cost, now).ok, true, `ask ${i + 1}`);
  const refused = buckets.take('1.2.3.4', cost, now);
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 10);
  assert.equal(buckets.take('5.6.7.8', cost, now).ok, true, 'another client has its own bucket');
});

test('advancing the clock refills tokens at 6 a minute, up to capacity', () => {
  const buckets = new TokenBuckets();
  const t0 = 5_000_000;
  for (let i = 0; i < 12; i++) buckets.take('k', 1, t0);
  assert.equal(buckets.take('k', 1, t0).ok, false);
  assert.equal(buckets.take('k', 1, t0 + 10_000).ok, true, 'one token after 10s');
  assert.equal(buckets.take('k', 1, t0 + 10_000).ok, false);
  const later = t0 + 60 * 60_000;
  for (let i = 0; i < 12; i++) assert.equal(buckets.take('k', 1, later).ok, true, 'refilled to 12, not beyond');
  assert.equal(buckets.take('k', 1, later).ok, false);
});

test('two IPv6 addresses in one /64 share a bucket', () => {
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
  assert.equal(ipKey('2001:db8:1:2::5'), '2001:db8:1:2::/64');
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));

  const buckets = new TokenBuckets({ capacity: 2 });
  assert.equal(buckets.take(ipKey('2001:db8:1:2::1'), 1, 0).ok, true);
  assert.equal(buckets.take(ipKey('2001:db8:1:2::2'), 1, 0).ok, true);
  assert.equal(buckets.take(ipKey('2001:db8:1:2:ffff::3'), 1, 0).ok, false);
});

test('ipKey keeps IPv4 whole and tolerates odd input', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey(' 203.0.113.7 , 10.0.0.1'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('[2001:db8::1]'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey(''), 'unknown');
  assert.equal(ipKey(null), 'unknown');
  assert.equal(ipKey('not-an-ip'), 'unknown');
  assert.equal(ipKey('1:2:3:4:5:6:7:8:9'), 'unknown');
});

test('costFor charges long bodies more', () => {
  assert.ok(costFor('jd-fit', 8000) > costFor('ask', 200));
  assert.equal(costFor('ask', 4096), 2);
  assert.equal(costFor('jd-fit', 8000), 5);
  assert.equal(costFor('ask', -5), 1);
});

test('a request dearer than the whole bucket still passes when the bucket is full', () => {
  const buckets = new TokenBuckets();
  assert.equal(buckets.take('big', 40, 0).ok, true);
  assert.equal(buckets.take('big', 1, 0).ok, false);
});

test('buckets are LRU-capped', () => {
  const buckets = new TokenBuckets({ maxKeys: 3 });
  for (const k of ['a', 'b', 'c', 'd']) buckets.take(k, 1, 0);
  assert.equal(buckets.size, 3);
  // 'a' spent a token, then was evicted, so it starts from a full bucket again.
  for (let i = 0; i < 12; i++) assert.equal(buckets.take('a', 1, 0).ok, true, `take ${i + 1}`);
  assert.equal(buckets.take('a', 1, 0).ok, false);
});

test('the daily budget resets on the next UTC day', () => {
  const budget = new DailyBudget({ limit: 3 });
  const day1 = Date.UTC(2026, 8, 25, 23, 59);
  assert.equal(budget.take(2, day1), true);
  assert.equal(budget.take(2, day1), false);
  assert.equal(budget.take(1, day1), true);
  assert.equal(budget.take(1, Date.UTC(2026, 8, 26, 0, 1)), true);
});

test('evalMultiplier ignores AI_EVAL on Vercel', () => {
  assert.equal(evalMultiplier({ AI_EVAL: '1' }), 5);
  assert.equal(evalMultiplier({ AI_EVAL: '1', VERCEL: '1' }), 1);
  assert.equal(evalMultiplier({}), 1);
  assert.equal(evalMultiplier({ AI_EVAL: 'true' }), 1);
});
