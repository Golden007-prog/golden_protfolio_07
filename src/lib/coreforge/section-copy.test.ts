import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectStrings, containsPrice } from './copy-guard.ts';
import {
  ANNOUNCEMENT,
  BUILT_WITH_COPY,
  CTA,
  MINI_DEMO_COPY,
  PRICING_COPY,
  PROJECT_CARD_COPY,
  QR_COPY,
  SECTION_COPY,
  SHARE_COPY,
  VENTURE_COPY,
} from './section-copy.ts';
import * as facts from './facts.ts';
import * as sectionCopy from './section-copy.ts';

const ALL = {
  ANNOUNCEMENT,
  BUILT_WITH_COPY,
  CTA,
  MINI_DEMO_COPY,
  PRICING_COPY,
  PROJECT_CARD_COPY,
  QR_COPY,
  SECTION_COPY,
  SHARE_COPY,
  VENTURE_COPY,
};

test('no section copy quotes a price, a currency amount or a billing rate', () => {
  for (const s of collectStrings(ALL)) assert.equal(containsPrice(s), false, s);
});

test('no invented social proof: no user counts, ratings, pass rates, rankings or press', () => {
  // 'answer review' is a real feature, so reviews only count as proof next to a number or a rating.
  const banned =
    /\b(\d[\d,.]*\+?\s*(users?|students?|learners?|reviews?|downloads?)|testimonials?|rated|ratings?|stars?|pass rate|ranked|#1|best-in|featured in|as seen)\b/i;
  for (const s of collectStrings(ALL)) assert.equal(banned.test(s), false, s);
});

test('every CTA points at a goldensdmat.in path', () => {
  for (const cta of Object.values(CTA)) assert.match(cta.path, /^\/[a-z-/.]*$/);
});

test('the announcement carries the brief’s wording, the short disclaimer and no dated lead', () => {
  assert.equal(ANNOUNCEMENT.cta, 'Try 10 free questions');
  assert.match(ANNOUNCEMENT.body, /free dMAT practice for German Master’s applicants/);
  assert.equal(ANNOUNCEMENT.disclaimer, 'Unofficial dMAT practice tool');
  assert.doesNotMatch(ANNOUNCEMENT.lead, /\bnew\b/i);
});

test('the mini demo says it is the portfolio’s own puzzle, not CoreForge content', () => {
  assert.match(MINI_DEMO_COPY.footnote, /I wrote for this page/);
  assert.match(MINI_DEMO_COPY.footnote, /not a CoreForge question/);
});

test('the section eyebrow names the founder role and the company', () => {
  assert.equal(SECTION_COPY.eyebrow, "Founder · GOLDEN's Coreforge");
  assert.equal(SECTION_COPY.titlePlain, SECTION_COPY.title.replaceAll('*', ''));
});

test('pricing lists name no amounts and point to the pricing page', () => {
  assert.ok(PRICING_COPY.free.includes('No card, no expiry'));
  assert.equal(CTA.pricing.path, '/pricing');
});

test('no why-built paraphrase ships until the launch post text is captured in sources', () => {
  // The earlier 'why I built it' lines paraphrased a post that sources/ does not hold.
  assert.ok(!('COREFORGE_WHY_BUILT' in facts));
  assert.ok(!('WHY_BUILT_FIRST_PERSON' in sectionCopy));
  assert.ok(!('whyTitle' in VENTURE_COPY));
});
