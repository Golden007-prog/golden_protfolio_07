import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  busiestWeekday,
  calendarFromTimestamps,
  currentStreak,
  formatDay,
  lastYearDays,
  levelFor,
  longestStreak,
  monthLabels,
  normalizeDays,
  plural,
  summarize,
  toWeeks,
  usernameFromUrl,
  type Day,
} from './contributionStats.ts';

/** Consecutive days from `start` with the given counts. */
function series(start: string, counts: number[]): Day[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return counts.map((count, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    count,
    level: levelFor(count),
  }));
}

test('formatDay prints the tooltip date in fixed English', () => {
  assert.equal(formatDay('2026-03-03'), 'Tue, 3 Mar 2026');
  assert.equal(formatDay('2025-12-31'), 'Wed, 31 Dec 2025');
  assert.equal(plural(12, 'contribution', 'contributions'), '12 contributions');
  assert.equal(plural(1, 'contribution', 'contributions'), '1 contribution');
  assert.equal(plural(1204, 'solve', 'solves'), '1,204 solves');
});

test('longestStreak finds the longest run and breaks on date gaps', () => {
  assert.equal(longestStreak(series('2026-01-01', [1, 1, 0, 1, 1, 1, 0, 2])), 3);
  assert.equal(longestStreak(series('2026-01-01', [0, 0, 0])), 0);
  const gapped: Day[] = [
    { date: '2026-01-01', count: 1, level: 1 },
    { date: '2026-01-02', count: 1, level: 1 },
    { date: '2026-01-05', count: 1, level: 1 },
  ];
  assert.equal(longestStreak(gapped), 2);
});

test('currentStreak forgives an empty today but not an empty yesterday', () => {
  assert.equal(currentStreak(series('2026-01-01', [1, 1, 1, 1])), 4);
  assert.equal(currentStreak(series('2026-01-01', [1, 1, 1, 0])), 3);
  assert.equal(currentStreak(series('2026-01-01', [1, 1, 0, 0])), 0);
  assert.equal(currentStreak(series('2026-01-01', [0, 1, 0, 1])), 1);
  assert.equal(currentStreak([]), 0);
});

test('busiestWeekday sums counts per weekday and is null when idle', () => {
  // 2026-03-02 is a Monday.
  const days = series('2026-03-02', [1, 5, 0, 0, 0, 0, 0, 1, 4]);
  const busiest = busiestWeekday(days);
  assert.deepEqual(busiest, { index: 2, name: 'Tuesday', total: 9 });
  assert.equal(busiestWeekday(series('2026-03-02', [0, 0])), null);
});

test('summarize reports totals, active days and streaks from the data only', () => {
  const s = summarize(series('2026-03-02', [2, 0, 3, 3, 0]));
  assert.equal(s.total, 8);
  assert.equal(s.activeDays, 3);
  assert.equal(s.longestStreak, 2);
  assert.equal(s.currentStreak, 2);
});

test('calendarFromTimestamps folds LeetCode unix-second keys into UTC days', () => {
  const cal = calendarFromTimestamps('{"1769731200": 1, "1769817600": 2, "bad": 3, "1769817601": 1}');
  assert.deepEqual(cal, { '2026-01-30': 1, '2026-01-31': 3 });
  assert.deepEqual(calendarFromTimestamps('not json'), {});
  assert.deepEqual(calendarFromTimestamps({ 1769731200: 4 }), { '2026-01-30': 4 });
});

test('lastYearDays spans exactly `length` days ending today', () => {
  const days = lastYearDays({ '2026-09-25': 3, '2025-09-26': 1, '2025-09-25': 9 }, '2026-09-25');
  assert.equal(days.length, 365);
  assert.equal(days[0].date, '2025-09-26');
  assert.equal(days[0].count, 1);
  assert.equal(days[364].date, '2026-09-25');
  assert.equal(days[364].level, 2);
  assert.equal(days.reduce((n, d) => n + d.count, 0), 4);
});

test('toWeeks builds Sunday-first columns padded at both ends', () => {
  // 2026-03-03 is a Tuesday; 10 days end on Thursday 12 Mar.
  const weeks = toWeeks(series('2026-03-03', Array(10).fill(1)));
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0][0], null);
  assert.equal(weeks[0][1], null);
  assert.equal(weeks[0][2]?.date, '2026-03-03');
  assert.equal(weeks[1][4]?.date, '2026-03-12');
  assert.equal(weeks[1][5], null);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(toWeeks(lastYearDays({}, '2026-09-25')).length, 53);
});

test('monthLabels marks month starts and drops a crowded first label', () => {
  const weeks = toWeeks(lastYearDays({}, '2026-09-25'));
  const labels = monthLabels(weeks);
  assert.ok(labels.length >= 11 && labels.length <= 13);
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i].col - labels[i - 1].col >= 3);
  assert.equal(labels[labels.length - 1].label, 'Sep');
});

test('normalizeDays keeps valid entries, sorts them and fixes levels', () => {
  const days = normalizeDays([
    { date: '2026-01-02', count: 3, level: 9 },
    { date: 'nope', count: 1, level: 1 },
    { date: '2026-01-01', count: 0, level: 2 },
    null,
  ]);
  assert.deepEqual(days, [
    { date: '2026-01-01', count: 0, level: 0 },
    { date: '2026-01-02', count: 3, level: 4 },
  ]);
  assert.deepEqual(normalizeDays('x'), []);
});

test('usernameFromUrl reads the last path segment', () => {
  assert.equal(usernameFromUrl('https://leetcode.com/oikantik007'), 'oikantik007');
  assert.equal(usernameFromUrl('https://leetcode.com/u/oikantik007/'), 'oikantik007');
  assert.equal(usernameFromUrl('https://github.com/Golden007-prog?tab=repositories'), 'Golden007-prog');
  assert.equal(usernameFromUrl('not a url'), '');
});
