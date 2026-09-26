import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectStrings, containsPrice } from './copy-guard.ts';

test('prices, currency amounts and billing rates are caught', () => {
  for (const s of [
    '₹299',
    'only ₹',
    '₹ 1,999 a year',
    '€150 fee',
    '150 € fee',
    '$5',
    '£ 12',
    'Rs. 299',
    'Rs 299',
    'INR 1999',
    '299 INR',
    '150 euros',
    '299/month',
    '1,999 / yr',
    '167 per month',
    '299 a month',
  ]) {
    assert.ok(containsPrice(s), s);
  }
});

test('the numbers CoreForge copy does use are not prices', () => {
  for (const s of [
    '10 free demo questions a day',
    '3 subtests of 20 tasks in 25:00 each',
    '90 min',
    'about 3.5 hours including a 30-minute break',
    'Forty short, seeded drills, ten levels each',
    '7-day money-back guarantee on the first purchase',
    'Monthly or yearly, cancel in one tap',
    'From the SoSe-2027 intake',
    'all 8 official topic areas',
    'hours 2 and letters 3',
  ]) {
    assert.ok(!containsPrice(s), s);
  }
});

test('collectStrings walks nested objects and arrays', () => {
  assert.deepEqual(collectStrings({ a: 'x', b: ['y', { c: 'z', d: 1 }], e: null }), ['x', 'y', 'z']);
});
