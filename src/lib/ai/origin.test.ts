import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedOrigin } from './origin.ts';

const PROD = { host: 'www.basuoikantik.in', secFetchSite: 'same-origin', onVercel: true };

test('same host is allowed', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://www.basuoikantik.in' }), true);
  const preview = 'golden-portfolio-07-git-feat-abc.vercel.app';
  assert.equal(isAllowedOrigin({ ...PROD, host: preview, origin: `https://${preview}` }), true);
  assert.equal(
    isAllowedOrigin({ origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', secFetchSite: 'same-origin', onVercel: false }),
    true,
  );
});

test('apex and www are allowed from either host', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://basuoikantik.in' }), true);
  assert.equal(isAllowedOrigin({ ...PROD, host: 'basuoikantik.in', origin: 'https://www.basuoikantik.in' }), true);
  assert.equal(isAllowedOrigin({ ...PROD, host: 'basuoikantik.in', origin: 'https://WWW.BasuOikantik.in' }), true);
});

test('look-alike hosts are refused', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://basuoikantik.in.evil.example' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://evilbasuoikantik.in' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://basuoikantik.in:8443' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'http://basuoikantik.in' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://evil.example' }), false);
});

test('another *.vercel.app deployment is refused', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://someone-else.vercel.app' }), false);
  assert.equal(
    isAllowedOrigin({ ...PROD, host: 'golden-portfolio-07.vercel.app', origin: 'https://golden-portfolio-07-evil.vercel.app' }),
    false,
  );
});

test('a missing or opaque Origin is refused', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: null }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: undefined }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: '' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'null' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'not a url' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'chrome-extension://abc' }), false);
});

test('Sec-Fetch-Site cross-site is refused even with a matching Origin', () => {
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://www.basuoikantik.in', secFetchSite: 'cross-site' }), false);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://www.basuoikantik.in', secFetchSite: 'same-site' }), true);
  assert.equal(isAllowedOrigin({ ...PROD, origin: 'https://www.basuoikantik.in', secFetchSite: null }), true);
});

test('localhost is allowed only off Vercel', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3100', 'http://[::1]:3000']) {
    assert.equal(isAllowedOrigin({ ...PROD, origin, onVercel: true }), false, `${origin} on Vercel`);
    assert.equal(isAllowedOrigin({ ...PROD, origin, onVercel: false }), true, `${origin} off Vercel`);
  }
});
