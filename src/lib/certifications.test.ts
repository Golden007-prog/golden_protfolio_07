import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  allCertifications,
  byIssuer,
  byPlatform,
  certificationCounts,
  certificationGroups,
  compareIssued,
  formatIssued,
  getCertification,
  isAllowedCredentialUrl,
  parseCertifications,
  parseIssued,
} from './certifications.ts';

const raw = JSON.parse(readFileSync(new URL('../data/certifications.json', import.meta.url), 'utf8'));
const data = parseCertifications(raw);

test('the data file parses and holds all 37 publicly verified credentials', () => {
  assert.equal(data.items.length, 37);
  assert.equal(data.verifiedAt, '2026-09-26');
});

test('ids are unique kebab slugs', () => {
  const ids = data.items.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('every issued date is a real YYYY-MM or YYYY-MM-DD date, none after verification', () => {
  for (const c of data.items) {
    assert.ok(parseIssued(c.issued), `${c.id}: ${c.issued}`);
    assert.ok(compareIssued(c.issued, data.verifiedAt) <= 0, `${c.id} is dated after ${data.verifiedAt}`);
  }
});

test('every credential links to its issuer verification host over https', () => {
  const hostFor: Record<string, string> = { 'Claude Academy': 'academy.claude.com', Coursera: 'www.coursera.org', 'Programiz PRO': 'programiz.pro' };
  for (const c of data.items) {
    assert.ok(isAllowedCredentialUrl(c.url), c.url);
    assert.equal(new URL(c.url).hostname, hostFor[c.platform], `${c.id} on ${c.platform}`);
  }
});

test('isAllowedCredentialUrl rejects everything but https on the three hosts', () => {
  assert.equal(isAllowedCredentialUrl('https://academy.claude.com/verify/abc'), true);
  assert.equal(isAllowedCredentialUrl('https://www.coursera.org/account/accomplishments/verify/X'), true);
  assert.equal(isAllowedCredentialUrl('https://programiz.pro/certificates/detail/X'), true);
  for (const bad of [
    'http://academy.claude.com/verify/abc',
    'https://coursera.org/account/accomplishments/verify/X',
    'https://academy.claude.com.evil.example/verify/abc',
    'https://evil.example/academy.claude.com',
    'https://user:pw@academy.claude.com/verify/abc',
    'https://academy.claude.com:8443/verify/abc',
    'javascript:alert(1)',
    '/verify/abc',
    '',
  ]) {
    assert.equal(isAllowedCredentialUrl(bad), false, bad);
  }
});

test("every partOf names a professional certificate whose includes list names it back", () => {
  const programs = data.items.filter((c) => c.kind === 'professional-certificate');
  assert.deepEqual(
    programs.map((p) => p.title),
    ['Google AI Professional Certificate'],
  );
  const parts = data.items.filter((c) => c.partOf);
  assert.equal(parts.length, 7);
  for (const c of parts) {
    const program = programs.find((p) => p.title === c.partOf);
    assert.ok(program, `${c.id}: ${c.partOf}`);
    assert.ok(program.includes?.includes(c.title), `${program.title} does not include ${c.title}`);
  }
  for (const p of programs) {
    for (const title of p.includes ?? []) assert.ok(parts.some((c) => c.title === title && c.partOf === p.title), `${p.title} lists missing ${title}`);
  }
});

test('titles follow the issuer: the Michigan credential is one course, not the Specialization', () => {
  assert.ok(data.items.every((c) => !/specialization/i.test(c.title)));
  const michigan = byIssuer(data, 'University of Michigan');
  assert.deepEqual(
    michigan.map((c) => [c.title, c.issued]),
    [['Understanding and Visualizing Data with Python', '2025-04']],
  );
  assert.equal(getCertification(data, 'data-science-methodology')?.issued, '2025-04');
});

test('counts are derived from the data', () => {
  const counts = certificationCounts(data);
  assert.equal(counts.total, data.items.length);
  assert.equal(counts.issuers, 5);
  assert.equal(counts.platforms, 3);
  assert.equal(counts.latest, '2026-09-25');
  assert.equal(
    byPlatform(data, 'Claude Academy').length + byPlatform(data, 'Coursera').length + byPlatform(data, 'Programiz PRO').length,
    counts.total,
  );
});

test('groups put every credential in exactly one place and keep the certificate with its courses', () => {
  const groups = certificationGroups(data);
  assert.deepEqual(
    groups.map((g) => [g.id, g.label, g.lead?.id ?? null, g.items.length]),
    [
      ['claude-academy', 'Claude Academy', null, 20],
      ['google-ai-professional-certificate', 'Google AI Professional Certificate', 'google-ai-professional-certificate', 7],
      ['coursera', 'Coursera', null, 7],
      ['programiz-pro', 'Programiz PRO', null, 2],
    ],
  );
  const placed = groups.flatMap((g) => [...(g.lead ? [g.lead.id] : []), ...g.items.map((c) => c.id)]);
  assert.equal(placed.length, data.items.length);
  assert.equal(new Set(placed).size, data.items.length);
  const google = groups[1];
  assert.ok(google.items.every((c) => c.partOf === google.label));
  assert.deepEqual(google.issuers, ['Google']);
  assert.deepEqual(groups[2].issuers, ['IBM', 'University of Michigan']);
  assert.equal(groups[0].latest, '2026-09-25');
});

test('allCertifications is newest first and a month-only date sorts before dated days of that month', () => {
  const all = allCertifications(data);
  for (let i = 1; i < all.length; i++) assert.ok(compareIssued(all[i - 1].issued, all[i].issued) >= 0, `${all[i - 1].id} before ${all[i].id}`);
  assert.ok(compareIssued('2026-09-25', '2026-09') > 0);
  assert.equal(compareIssued('2026-09', '2026-09'), 0);
});

test('parseIssued and formatIssued', () => {
  assert.deepEqual(parseIssued('2026-09'), { year: 2026, month: 9, day: null });
  assert.deepEqual(parseIssued('2024-02-29'), { year: 2024, month: 2, day: 29 });
  for (const bad of ['2026-13', '2026-02-30', '2025-02-29', '2026-9', 'Sep 2026', '', null, undefined]) {
    assert.equal(parseIssued(bad), null, String(bad));
  }
  assert.equal(formatIssued('2026-09'), 'Sep 2026');
  assert.equal(formatIssued('2026-09-25'), 'Sep 25, 2026');
  assert.equal(formatIssued('soon'), '');
});

test('parseCertifications refuses a broken file', () => {
  const good = { id: 'a', title: 'A', issuer: 'Anthropic', platform: 'Claude Academy', kind: 'course-completion-badge', issued: '2026-09', url: 'https://academy.claude.com/verify/a' };
  const wrap = (items: unknown[]) => ({ verifiedAt: '2026-09-26', items });
  assert.doesNotThrow(() => parseCertifications(wrap([good])));
  assert.throws(() => parseCertifications(wrap([good, { ...good, title: 'B' }])), /not unique/);
  assert.throws(() => parseCertifications(wrap([{ ...good, url: 'https://example.com/a' }])), /allowed credential link/);
  assert.throws(() => parseCertifications(wrap([{ ...good, kind: 'degree' }])), /unknown/);
  assert.throws(() => parseCertifications(wrap([{ ...good, issued: '2026-02-30' }])), /not a date/);
  assert.throws(() => parseCertifications(wrap([{ ...good, partOf: 'Nothing' }])), /not a professional certificate/);
  assert.throws(() => parseCertifications({ verifiedAt: '2026-09', items: [] }), /verifiedAt/);
  assert.throws(() => parseCertifications(null), /not an object/);
});
