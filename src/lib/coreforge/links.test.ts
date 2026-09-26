import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cfUrl,
  COREFORGE_LINK_REL,
  COREFORGE_LINK_TARGET,
  coreforgeLinkAttrs,
  isCoreforgeUrl,
  normalizePlacement,
} from './links.ts';

const UTM = 'utm_source=basuoikantik.in&utm_medium=portfolio';

test('cfUrl appends the three UTM parameters in a fixed order', () => {
  assert.equal(cfUrl('/demo', 'hero-badge'), `https://goldensdmat.in/demo?${UTM}&utm_campaign=hero-badge`);
  assert.equal(cfUrl('/modules/wizard', 'faq'), `https://goldensdmat.in/modules/wizard?${UTM}&utm_campaign=faq`);
  assert.equal(cfUrl('demo', 'x'), `https://goldensdmat.in/demo?${UTM}&utm_campaign=x`);
});

test('the root and an empty path go straight to /welcome', () => {
  for (const path of ['/', '', '  ', 'https://goldensdmat.in', 'https://goldensdmat.in/']) {
    assert.equal(cfUrl(path, 'nav'), `https://goldensdmat.in/welcome?${UTM}&utm_campaign=nav`, path);
  }
});

test('existing query parameters stay, stale utm_* parameters are replaced, the hash stays last', () => {
  const url = new URL(cfUrl('/modules?tab=gam&utm_source=old&UTM_CAMPAIGN=old&utm_content=x#gam', 'modules-card'));
  assert.equal(url.pathname, '/modules');
  assert.equal(url.hash, '#gam');
  assert.equal(url.searchParams.get('tab'), 'gam');
  assert.deepEqual(url.searchParams.getAll('utm_source'), ['basuoikantik.in']);
  assert.deepEqual(url.searchParams.getAll('utm_medium'), ['portfolio']);
  assert.deepEqual(url.searchParams.getAll('utm_campaign'), ['modules-card']);
  assert.equal(url.searchParams.get('utm_content'), null);
  assert.equal(url.searchParams.get('UTM_CAMPAIGN'), null);
  assert.equal(
    cfUrl('/news#brain-gym-and-skills', 'news-ticker'),
    `https://goldensdmat.in/news?${UTM}&utm_campaign=news-ticker#brain-gym-and-skills`,
  );
});

test('absolute goldensdmat.in URLs are canonicalised to the https apex', () => {
  const expected = `https://goldensdmat.in/demo?${UTM}&utm_campaign=p`;
  assert.equal(cfUrl('https://goldensdmat.in/demo', 'p'), expected);
  assert.equal(cfUrl('https://www.goldensdmat.in/demo', 'p'), expected);
  assert.equal(cfUrl('http://goldensdmat.in/demo', 'p'), expected);
  assert.equal(cfUrl('https://user:pw@goldensdmat.in:8443/demo', 'p'), expected);
});

test('anything that is not goldensdmat.in falls back to the home page', () => {
  const home = `https://goldensdmat.in/welcome?${UTM}&utm_campaign=p`;
  for (const path of [
    'https://evil.example/demo',
    '//evil.example/demo',
    'https://goldensdmat.in.evil.example/demo',
    'javascript:alert(1)',
    'data:text/html,hi',
    'mailto:someone@example.com',
    'http://[::1',
  ]) {
    assert.equal(cfUrl(path, 'p'), home, path);
  }
});

test('placements are reduced to lower-kebab ASCII before they reach the URL', () => {
  assert.equal(normalizePlacement('hero-badge'), 'hero-badge');
  assert.equal(normalizePlacement('Hero Badge'), 'hero-badge');
  assert.equal(normalizePlacement('  projects / card #3  '), 'projects-card-3');
  assert.equal(normalizePlacement('Über Café'), 'uber-cafe');
  assert.equal(normalizePlacement('palette_action'), 'palette-action');
  assert.equal(normalizePlacement(''), 'unknown');
  assert.equal(normalizePlacement('***'), 'unknown');
  assert.equal(normalizePlacement('हिंदी'), 'unknown');
  const long = normalizePlacement('a'.repeat(50) + ' ' + 'b'.repeat(50));
  assert.ok(long.length <= 64 && !long.endsWith('-'), long);
});

test('a hostile placement cannot add or override query parameters or the hash', () => {
  const href = cfUrl('/demo', 'x&utm_source=evil&y=1#frag');
  const url = new URL(href);
  assert.deepEqual([...url.searchParams.keys()], ['utm_source', 'utm_medium', 'utm_campaign']);
  assert.equal(url.searchParams.get('utm_source'), 'basuoikantik.in');
  assert.equal(url.searchParams.get('utm_campaign'), 'x-utm-source-evil-y-1-frag');
  assert.equal(url.hash, '');
  assert.match(url.searchParams.get('utm_campaign') ?? '', /^[a-z0-9-]+$/);
});

test('anchor attributes open a new tab and keep the referrer', () => {
  const attrs = coreforgeLinkAttrs('/brain-gym', 'Feature Card');
  assert.equal(attrs.href, `https://goldensdmat.in/brain-gym?${UTM}&utm_campaign=feature-card`);
  assert.equal(attrs.target, '_blank');
  assert.equal(attrs.rel, 'noopener');
  assert.equal(COREFORGE_LINK_TARGET, '_blank');
  assert.equal(COREFORGE_LINK_REL, 'noopener');
  assert.ok(!attrs.rel.includes('noreferrer'));
  assert.equal(attrs.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(attrs['data-cf-placement'], 'feature-card');
});

test('isCoreforgeUrl recognises both hosts and nothing else', () => {
  assert.ok(isCoreforgeUrl(cfUrl('/demo', 'x')));
  assert.ok(isCoreforgeUrl('https://www.goldensdmat.in/'));
  assert.ok(!isCoreforgeUrl('https://goldensdmat.in.evil.example/'));
  assert.ok(!isCoreforgeUrl('/demo'));
});
