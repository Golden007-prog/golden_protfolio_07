import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { availability, educationStatus, experienceSpans, logistics, type LogisticsKind } from './facts.ts';

const profile = JSON.parse(readFileSync(new URL('../../data/profile.json', import.meta.url), 'utf8'));

test('overlapping roles: the union of months is less than the sum', () => {
  const { rows, unionMonths } = experienceSpans(profile.experience, '2026-09');
  const sum = rows.reduce((n, r) => n + r.months, 0);
  assert.ok(unionMonths < sum, `${unionMonths} >= ${sum}`);
  // Mar 2025 to Sep 2026 inclusive.
  assert.equal(unionMonths, 19);
  assert.deepEqual(
    rows.map((r) => [r.company, r.months, r.label]),
    [
      ['iHUB DivyaSampark @ IIT Roorkee', 9, '9 mos'],
      ['Mindrift', 16, '1 yr 4 mos'],
      ['Unified Mentor Private Limited', 4, '4 mos'],
    ],
  );
});

test('bad or missing dates count as zero months', () => {
  const { rows, unionMonths } = experienceSpans([{ company: 'X', role: 'Y', start: 'soon', end: null }], '2026-09');
  assert.equal(rows[0].months, 0);
  assert.equal(rows[0].label, '');
  assert.equal(unionMonths, 0);
});

test('availability is verbatim from the profile', () => {
  assert.deepEqual(availability(profile), {
    status: profile.availability.status,
    focus: profile.availability.focus,
    openTo: profile.availability.openTo,
    sourceId: 'profile:availability',
  });
});

test('logistics answers only what the site states', () => {
  assert.equal(logistics('salary', profile).answer, null);
  for (const kind of ['visa', 'notice', 'salary', 'relocation', 'start'] as LogisticsKind[]) {
    assert.deepEqual(logistics(kind, profile), { answer: null }, kind);
  }
  const remote = logistics('remote', profile);
  assert.equal(remote.sourceId, 'profile:availability');
  assert.equal(remote.answer, profile.availability.openTo);
  assert.equal(remote.answer, 'Full-time & contract · Remote / Bengaluru');
  assert.deepEqual(logistics('location', profile), { answer: 'Bengaluru, India', sourceId: 'profile:availability' });
});

test("the Master's is in progress and the B.Tech is complete", () => {
  const [masters, btech] = educationStatus(profile);
  assert.equal(masters.held, false);
  assert.equal(masters.label, 'In progress · Expected Feb 2027');
  assert.equal(btech.held, true);
  assert.equal(btech.label, 'Completed Jul 2024 · CGPA: 8.22');
  // A future end date alone also means not held.
  const future = educationStatus({ education: [{ degree: 'D', institution: 'I', end: '2030-01', status: 'Enrolled' }] }, '2026-09');
  assert.equal(future[0].held, false);
});
