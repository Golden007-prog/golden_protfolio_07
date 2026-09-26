import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  badgeInitials,
  countdown,
  deadlineMs,
  formatCount,
  formatDay,
  hasWriteup,
  httpsSrc,
  kaggleHref,
  parseDay,
  rankLabel,
  relativeTime,
  sortBadges,
  sortWriteups,
  splitCompetitions,
  writeupForProject,
} from './kaggleFormat.ts';

const at = (iso: string) => Date.parse(iso);

test('dates read in UTC and print day-month-year', () => {
  assert.equal(formatDay('2026-09-26'), '26 Sep 2026');
  assert.equal(formatDay('2026-02-24T23:30:00Z'), '24 Feb 2026');
  assert.equal(formatDay('2026-02-31'), null);
  assert.equal(formatDay('Sep 26'), null);
  assert.equal(formatDay(null), null);
  assert.equal(parseDay('2026-13-01'), null);
});

test('counts group thousands the same everywhere', () => {
  assert.equal(formatCount(3908), '3,908');
  assert.equal(formatCount(11458), '11,458');
  assert.equal(formatCount(30), '30');
});

test('a rank always carries its field size and an as-of date', () => {
  assert.equal(rankLabel(183, 3908, '2026-09-26'), 'Rank 183 of 3,908 teams · as of 26 Sep 2026');
  assert.equal(rankLabel(1049, 3462, '2026-09-26T02:30:00Z'), 'Rank 1,049 of 3,462 teams · as of 26 Sep 2026');
  assert.equal(rankLabel(1, 1, '2026-09-26'), 'Rank 1 of 1 team · as of 26 Sep 2026');
});

test('no rank label without a team count, a date, or a rank inside the field', () => {
  assert.equal(rankLabel(undefined, 3908, '2026-09-26'), null);
  assert.equal(rankLabel(183, undefined, '2026-09-26'), null);
  assert.equal(rankLabel(183, 3908, null), null);
  assert.equal(rankLabel(0, 3908, '2026-09-26'), null);
  assert.equal(rankLabel(4000, 3908, '2026-09-26'), null);
  assert.equal(rankLabel(18.5, 3908, '2026-09-26'), null);
});

test('a bare deadline date means 23:59 UTC that day', () => {
  assert.equal(deadlineMs('2026-09-29'), at('2026-09-29T23:59:00Z'));
  assert.equal(deadlineMs('2026-09-29T12:00:00Z'), at('2026-09-29T12:00:00Z'));
  assert.equal(deadlineMs(undefined), null);
});

test('countdowns round down and never promise extra time', () => {
  const now = at('2026-09-26T02:30:00Z');
  assert.deepEqual(countdown('2026-09-29', now), { label: 'Closes in 3 days', closed: false, soon: true });
  assert.deepEqual(countdown('2026-12-02', now), { label: 'Closes in 67 days', closed: false, soon: false });
  assert.deepEqual(countdown('2026-09-26', now), { label: 'Closes in 21 hours', closed: false, soon: true });
  assert.deepEqual(countdown('2026-09-27', at('2026-09-26T23:00:00Z')), { label: 'Closes in 1 day', closed: false, soon: true });
  assert.deepEqual(countdown('2026-09-26T03:00:00Z', now), { label: 'Closes within the hour', closed: false, soon: true });
  assert.deepEqual(countdown('2026-09-25', now), { label: 'Closed', closed: true, soon: false });
  assert.equal(countdown('soon', now), null);
});

test('relative update times', () => {
  const now = at('2026-09-26T12:00:00Z');
  assert.equal(relativeTime('2026-09-26T11:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-09-26T12:00:30Z', now), 'just now');
  assert.equal(relativeTime('2026-09-26T11:59:00Z', now), '1 minute ago');
  assert.equal(relativeTime('2026-09-26T11:15:00Z', now), '45 minutes ago');
  assert.equal(relativeTime('2026-09-26T09:00:00Z', now), '3 hours ago');
  assert.equal(relativeTime('2026-09-24T12:00:00Z', now), '2 days ago');
  assert.equal(relativeTime('2026-07-01T00:00:00Z', now), '1 Jul 2026');
  assert.equal(relativeTime('nonsense', now), null);
});

test('writeups sort newest first with undated ones last', () => {
  const list = [
    { id: 'tunix', published: '2026-01-09' },
    { id: 'undated', published: null },
    { id: 'urbancare', published: '2026-02-24' },
    { id: 'new', published: '2026-09-20T10:00:00Z' },
  ];
  assert.deepEqual(
    sortWriteups(list).map((w) => w.id),
    ['new', 'urbancare', 'tunix', 'undated'],
  );
  assert.equal(list[0]?.id, 'tunix', 'the input is not mutated');
});

test('badges: featured first in their given order, then newest, then name', () => {
  const list = [
    { name: 'Python Coder', achieved: '2026-01-10' },
    { name: 'Competitor', achieved: '2026-03-17', featured: true },
    { name: 'Code Uploader', achieved: '2026-01-10' },
    { name: 'Research Competitor', achieved: '2026-09-24', featured: true },
    { name: 'API Dataset Creator', achieved: '2026-09-25' },
    { name: 'No date' },
  ];
  assert.deepEqual(
    sortBadges(list).map((b) => b.name),
    ['Competitor', 'Research Competitor', 'API Dataset Creator', 'Code Uploader', 'Python Coder', 'No date'],
  );
});

test('competitions split by the data time, not the visitor clock', () => {
  const list = [
    { url: 'a', title: 'Gemma paper', deadline: '2026-11-12', active: true },
    { url: 'b', title: 'Biohub', deadline: '2026-09-29', active: true },
    { url: 'c', title: 'March Mania', deadline: '2026-04-07', active: false },
    { url: 'd', title: 'Gemma agent', deadline: '2026-12-02', active: true },
    { url: 'e', title: 'MedGemma', deadline: '2026-02-24', active: false },
  ];
  const { active, past } = splitCompetitions(list, at('2026-09-26T02:30:00Z'));
  assert.deepEqual(active.map((c) => c.title), ['Biohub', 'Gemma paper', 'Gemma agent']);
  assert.deepEqual(past.map((c) => c.title), ['March Mania', 'MedGemma']);

  // A snapshot read after Biohub closed files it under history even though it says active.
  const later = splitCompetitions(list, at('2026-10-01T00:00:00Z'));
  assert.deepEqual(later.active.map((c) => c.title), ['Gemma paper', 'Gemma agent']);
  assert.equal(later.past[0]?.title, 'Biohub');
});

test('a competition has a writeup by flag or by a matching writeup URL', () => {
  const writeups = [{ competitionUrl: 'https://www.kaggle.com/competitions/med-gemma-impact-challenge/' }];
  assert.equal(hasWriteup({ url: 'https://www.kaggle.com/competitions/med-gemma-impact-challenge' }, writeups), true);
  assert.equal(hasWriteup({ url: 'https://www.kaggle.com/competitions/google-tunix-hackathon', hasWriteup: true }, []), true);
  assert.equal(hasWriteup({ url: 'https://www.kaggle.com/competitions/gemini-3' }, writeups), false);
});

test('writeups link to projects by slug', () => {
  const writeups = [{ title: 'UrbanCare AI', project: 'urbancare-ai' }, { title: 'Tunix' }];
  assert.equal(writeupForProject(writeups, 'urbancare-ai')?.title, 'UrbanCare AI');
  assert.equal(writeupForProject(writeups, 'pulse'), null);
});

test('badge initials for the text fallback', () => {
  assert.equal(badgeInitials('Code Submitter'), 'CS');
  assert.equal(badgeInitials('7 Day Login Streak'), '7D');
  assert.equal(badgeInitials('5-Day AI Agents Intensive Course with Google'), '5D');
  assert.equal(badgeInitials('Competitor'), 'C');
});

test('links must point at kaggle.com over https; images need https', () => {
  assert.equal(kaggleHref('https://www.kaggle.com/oikantikbasu007'), 'https://www.kaggle.com/oikantikbasu007');
  assert.equal(kaggleHref('https://kaggle.com/competitions/x'), 'https://kaggle.com/competitions/x');
  assert.equal(kaggleHref('http://www.kaggle.com/x'), null);
  assert.equal(kaggleHref('https://www.kaggle.com.evil.example/x'), null);
  assert.equal(kaggleHref('javascript:alert(1)'), null);
  assert.equal(kaggleHref(''), null);
  assert.equal(httpsSrc('https://www.googleapis.com/download/storage/v1/b/x/o/y.svg?alt=media'), 'https://www.googleapis.com/download/storage/v1/b/x/o/y.svg?alt=media');
  assert.equal(httpsSrc('data:image/svg+xml,<svg/>'), null);
});
