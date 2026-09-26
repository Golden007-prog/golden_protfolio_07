import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectStrings, containsPrice } from './copy-guard.ts';
import * as facts from './facts.ts';
import {
  COREFORGE_CHANGELOG,
  COREFORGE_DISCLAIMER,
  COREFORGE_DISCLAIMER_FULL,
  COREFORGE_DISCLAIMER_SHORT,
  COREFORGE_FAQ,
  COREFORGE_FEATURES,
  COREFORGE_ICON_NAMES,
  COREFORGE_PATHS,
  COREFORGE_RESOURCES,
  COREFORGE_STATS,
  coreforgeAbsoluteUrl,
} from './facts.ts';

// Every page captured from goldensdmat.in on 2026-09-26 that returned its own content
// (/rankings and /learn bounce to /welcome for signed-out visitors, so they are not linkable).
const CAPTURED_PATHS = new Set([
  '/welcome',
  '/demo',
  '/dmat-info',
  '/news',
  '/news.xml',
  '/pricing',
  '/modules',
  '/modules/wizard',
  '/brain-gym',
  '/dmat-exam-pattern',
  '/general-academic-module',
  '/guides',
  '/free-learning',
  '/changelog',
]);

const ALL_STRINGS = collectStrings(facts);

test('the site disclaimer is carried verbatim', () => {
  assert.equal(
    COREFORGE_DISCLAIMER,
    'Unofficial practice tool. Not affiliated with g.a.s.t., TestDaF-Institut, APS, or the DAAD.',
  );
  assert.equal(COREFORGE_DISCLAIMER_SHORT, 'Unofficial dMAT practice tool');
  assert.ok(COREFORGE_DISCLAIMER_FULL.startsWith(COREFORGE_DISCLAIMER));
  assert.ok(COREFORGE_DISCLAIMER_FULL.endsWith('dMAT is a trademark of its owners.'));
  const official = COREFORGE_FAQ.find((f) => f.id === 'official');
  assert.ok(official?.a.startsWith('No.'));
  assert.ok(official?.a.includes(COREFORGE_DISCLAIMER));
});

test('no string quotes a price, a currency amount or the superseded trial', () => {
  assert.ok(ALL_STRINGS.length > 100, `only ${ALL_STRINGS.length} strings collected`);
  for (const s of ALL_STRINGS) {
    assert.ok(!containsPrice(s), `price in: ${s}`);
    assert.doesNotMatch(s, /7-day trial|free trial|launch sale|\b(?:299|999|1,999|5,999|167)\b/i, s);
  }
});

test('no invented social proof', () => {
  for (const s of ALL_STRINGS) {
    assert.doesNotMatch(
      s,
      /\b(?:users?|students have|learners|downloads|rated|rating|stars?|testimonial|pass rate|trusted by|featured in|#1|best|leading)\b/i,
      s,
    );
  }
});

test('features: 8 to 10 one-line cards with a known icon and a captured deep link', () => {
  assert.ok(COREFORGE_FEATURES.length >= 8 && COREFORGE_FEATURES.length <= 10);
  for (const list of [COREFORGE_FEATURES, COREFORGE_RESOURCES]) {
    assert.equal(new Set(list.map((f) => f.id)).size, list.length);
    for (const f of list) {
      assert.ok(f.title.length > 0 && f.title.length <= 40, f.title);
      assert.ok(f.body.length > 0 && f.body.length <= 140, `${f.id}: ${f.body.length} chars`);
      assert.doesNotMatch(f.body, /\n/);
      assert.ok((COREFORGE_ICON_NAMES as readonly string[]).includes(f.icon), f.icon);
      assert.ok(CAPTURED_PATHS.has(f.path), f.path);
    }
  }
  const used = new Set([...COREFORGE_FEATURES, ...COREFORGE_RESOURCES].map((f) => f.icon));
  assert.deepEqual([...COREFORGE_ICON_NAMES].filter((n) => !used.has(n)), [], 'unused icon names');
});

test('stats are exactly the sourced six', () => {
  assert.deepEqual(
    COREFORGE_STATS.map((s) => [s.id, s.value, s.display]),
    [
      ['subject-modules', 8, '8'],
      ['core-subtests', 3, '3'],
      ['subtest-clock', 25, '25:00'],
      ['subject-slot', 90, '90 min'],
      ['demo-questions', 10, '10'],
      ['brain-gym-drills', 40, '40'],
    ],
  );
  for (const s of COREFORGE_STATS) {
    assert.equal(`${s.value}${s.suffix ?? ''}`, s.display);
    assert.ok(CAPTURED_PATHS.has(s.path), s.path);
  }
});

test('changelog: newest first, ISO dates, news-hub anchors, no superseded pricing entry', () => {
  const dates = COREFORGE_CHANGELOG.map((m) => m.date);
  assert.deepEqual(dates, ['2026-09-06', '2026-08-21', '2026-08-07', '2026-07-18']);
  for (const m of COREFORGE_CHANGELOG) {
    assert.match(m.path, /^\/news#[a-z0-9-]+$/);
    assert.doesNotMatch(m.title, /CoreForge Pro:|trial, then/);
  }
});

test('faq: 6 to 8 answers covering the required questions, pricing ones pointing at /pricing', () => {
  assert.ok(COREFORGE_FAQ.length >= 6 && COREFORGE_FAQ.length <= 8);
  const ids = COREFORGE_FAQ.map((f) => f.id);
  for (const id of ['what-is-dmat', 'who-must-sit', 'free-plan', 'pro', 'official', 'generation', 'brain-gym', 'hindi']) {
    assert.ok(ids.includes(id), id);
  }
  for (const f of COREFORGE_FAQ) {
    assert.ok(f.q.endsWith('?'), f.q);
    assert.ok(CAPTURED_PATHS.has(f.path), f.path);
  }
  assert.equal(COREFORGE_FAQ.find((f) => f.id === 'free-plan')?.path, '/pricing');
  assert.equal(COREFORGE_FAQ.find((f) => f.id === 'pro')?.path, '/pricing');
  assert.match(COREFORGE_FAQ.find((f) => f.id === 'who-must-sit')?.a ?? '', /Summer Semester 2027/);
});

test('every key path was captured, and absolute URLs carry no tracking', () => {
  for (const path of Object.values(COREFORGE_PATHS)) assert.ok(CAPTURED_PATHS.has(path), path);
  assert.equal(coreforgeAbsoluteUrl(COREFORGE_PATHS.pricing), 'https://goldensdmat.in/pricing');
  assert.equal(coreforgeAbsoluteUrl('/news#x'), 'https://goldensdmat.in/news#x');
});
