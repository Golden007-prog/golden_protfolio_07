import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  compareYearMonth,
  durationLabel,
  expectedLabel,
  formatDuration,
  formatIsoDate,
  formatYearMonth,
  isoToYearMonth,
  isoYear,
  monthsBetween,
  parseYearMonth,
  toYearMonth,
} from './dates.ts';

test('parseYearMonth accepts only YYYY-MM', () => {
  assert.deepEqual(parseYearMonth('2025-03'), { year: 2025, month: 3 });
  assert.deepEqual(parseYearMonth(' 2027-02 '), { year: 2027, month: 2 });
  assert.equal(parseYearMonth('2025-13'), null);
  assert.equal(parseYearMonth('2025-00'), null);
  assert.equal(parseYearMonth('2025-3'), null);
  assert.equal(parseYearMonth('Mar 2025'), null);
  assert.equal(parseYearMonth(''), null);
  assert.equal(parseYearMonth(null), null);
  assert.equal(parseYearMonth(undefined), null);
});

test('monthsBetween counts both end months', () => {
  assert.equal(monthsBetween('2025-03', '2025-06'), 4);
  assert.equal(monthsBetween('2025-06', '2025-06'), 1);
  assert.equal(monthsBetween('2025-06', '2026-09'), 16);
  assert.equal(monthsBetween('2020-10', '2024-07'), 46);
  assert.equal(monthsBetween('2025-06', '2025-05'), null);
  assert.equal(monthsBetween('2025-06', null), null);
  assert.equal(monthsBetween('bad', '2025-05'), null);
});

test('formatDuration', () => {
  assert.equal(formatDuration(1), '1 mo');
  assert.equal(formatDuration(4), '4 mos');
  assert.equal(formatDuration(12), '1 yr');
  assert.equal(formatDuration(16), '1 yr 4 mos');
  assert.equal(formatDuration(25), '2 yrs 1 mo');
  assert.equal(formatDuration(16, 'long'), '1 year 4 months');
  assert.equal(formatDuration(1, 'long'), '1 month');
  assert.equal(formatDuration(24, 'long'), '2 years');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(Number.NaN), '');
});

test('durationLabel runs an open role to now, and needs a now for it', () => {
  assert.equal(durationLabel('2025-03', '2025-06', null), '4 mos');
  assert.equal(durationLabel('2025-06', null, '2026-09'), '1 yr 4 mos');
  assert.equal(durationLabel('2026-01', null, '2026-09'), '9 mos');
  assert.equal(durationLabel('2026-01', null, '2026-09', 'long'), '9 months');
  assert.equal(durationLabel('2026-01', null, null), null);
  // A clock behind the start (a wrong device date) yields no chip rather than a negative one.
  assert.equal(durationLabel('2026-01', null, '2025-12'), null);
});

test('formatYearMonth', () => {
  assert.equal(formatYearMonth('2025-03'), 'Mar 2025');
  assert.equal(formatYearMonth('2027-02', 'long'), 'February 2027');
  assert.equal(formatYearMonth(null), '');
});

test('compareYearMonth and expectedLabel', () => {
  assert.equal(compareYearMonth('2027-02', '2026-09'), 1);
  assert.equal(compareYearMonth('2026-09', '2026-09'), 0);
  assert.equal(compareYearMonth('2024-07', '2026-09'), -1);
  assert.equal(compareYearMonth('2024-07', null), null);
  assert.equal(expectedLabel('2027-02', '2026-09'), 'Expected Feb 2027');
  assert.equal(expectedLabel('2027-02', '2027-02'), null);
  assert.equal(expectedLabel('2024-07', '2026-09'), null);
  assert.equal(expectedLabel('2027-02', null), null);
});

test('ISO helpers read UTC, so every time zone agrees', () => {
  assert.equal(formatIsoDate('2026-09-25T23:30:00.000Z'), 'Sep 25, 2026');
  assert.equal(formatIsoDate('2026-01-01T00:00:00Z'), 'Jan 1, 2026');
  assert.equal(formatIsoDate('nonsense'), null);
  assert.equal(formatIsoDate(undefined), null);
  assert.equal(isoYear('2026-12-31T23:59:59Z'), 2026);
  assert.equal(isoYear(''), null);
  assert.equal(isoToYearMonth('2026-09-25T10:00:00Z'), '2026-09');
  assert.equal(isoToYearMonth(null), null);
});

test('toYearMonth uses the local calendar', () => {
  assert.equal(toYearMonth(new Date(2026, 0, 15)), '2026-01');
  assert.equal(toYearMonth(new Date(2026, 11, 1)), '2026-12');
});

test('every profile.json start/end parses, and the stated ranges agree with them', () => {
  const profile = JSON.parse(readFileSync(new URL('../data/profile.json', import.meta.url), 'utf8')) as {
    experience: { duration: string; start: string; end: string | null }[];
    education: { year: string; start: string; end: string | null }[];
  };
  for (const item of [...profile.experience, ...profile.education]) {
    assert.ok(parseYearMonth(item.start), `start ${item.start}`);
    if (item.end !== null) assert.ok(parseYearMonth(item.end), `end ${item.end}`);
  }
  for (const exp of profile.experience) {
    const [from, to] = exp.duration.split(/\s+-\s+/);
    assert.equal(from, formatYearMonth(exp.start), exp.duration);
    assert.equal(to, exp.end === null ? 'Present' : formatYearMonth(exp.end), exp.duration);
  }
  assert.equal(profile.experience.filter((e) => e.end === null).length, 3);
  const masters = profile.education.find((e) => /Master/.test(JSON.stringify(e)));
  assert.equal(expectedLabel(masters?.end, '2026-09'), 'Expected Feb 2027');
});
