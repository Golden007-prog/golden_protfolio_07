import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { BOOTSTRAP_SCRIPT } from './bootstrap-script.ts';
import { INTRO_CAP_MS } from './intro-timing.ts';

type Timer = { fn: () => void; at: number };

/** Runs the head bootstrap against a minimal fake page with a hand-driven clock. */
function boot(opts: { path?: string; hash?: string; session?: Record<string, string>; reduce?: boolean } = {}) {
  let clock = 50_000;
  const timers: Timer[] = [];
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const session = new Map(Object.entries(opts.session ?? {}));
  const store = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  });
  const html = {
    classList: { add: (c: string) => void classes.add(c), contains: (c: string) => classes.has(c) },
    setAttribute: (k: string, v: string) => void attrs.set(k, String(v)),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
  const window: Record<string, unknown> = {
    localStorage: store(new Map()),
    sessionStorage: store(session),
    matchMedia: (q: string) => ({ matches: Boolean(opts.reduce) && q.includes('reduced-motion') }),
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, at: clock + ms }),
  };
  runInNewContext(BOOTSTRAP_SCRIPT, {
    window,
    document: { documentElement: html, readyState: 'complete', querySelectorAll: () => [], addEventListener: () => {} },
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    location: { pathname: opts.path ?? '/', search: '', hash: opts.hash ?? '' },
    Date: { now: () => clock },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (let due = timers.findIndex((t) => t.at <= clock); due !== -1; due = timers.findIndex((t) => t.at <= clock)) {
      timers.splice(due, 1)[0].fn();
    }
  };
  return { window, attrs, classes, session, timers, advance, now: () => clock };
}

test('a first visit that has not hydrated by the cap ends the intro itself', () => {
  const page = boot();
  assert.equal(page.attrs.get('data-intro'), 'pending');
  page.advance(INTRO_CAP_MS - 1);
  assert.equal(page.attrs.get('data-intro'), 'pending', 'not before the cap');
  page.advance(1);
  assert.equal(page.attrs.get('data-intro'), 'seen');
  assert.equal(page.session.get('ob-seen-loader-v2'), '1', 'the curtain does not come back on a reload');
});

test('a page that hydrated before the cap leaves the curtain to LoadingScreen', () => {
  const page = boot();
  page.advance(900);
  page.classes.add('hydrated');
  page.advance(INTRO_CAP_MS);
  assert.equal(page.attrs.get('data-intro'), 'pending');
  assert.equal(page.session.get('ob-seen-loader-v2'), undefined);
});

test('the cap is measured from window.__navStart when the timer fires', () => {
  const page = boot();
  // As the e2e specs hold the curtain open: a navigation start far in the future.
  page.window.__navStart = page.now() + 60_000;
  page.advance(INTRO_CAP_MS);
  assert.equal(page.attrs.get('data-intro'), 'pending');
  assert.equal(page.timers.length, 1, 'rescheduled for the time left');
  page.advance(60_000);
  assert.equal(page.attrs.get('data-intro'), 'seen');
});

test('an intro that already ended is left alone', () => {
  const page = boot();
  page.attrs.set('data-intro', 'seen');
  page.advance(INTRO_CAP_MS);
  assert.equal(page.session.get('ob-seen-loader-v2'), undefined);
});

test('returning, deep-link and reduced-motion visits never pend and set no timer', () => {
  for (const opts of [{ session: { 'ob-seen-loader-v2': '1' } }, { hash: '#projects' }, { path: '/projects/omni-lab' }, { reduce: true }]) {
    const page = boot(opts);
    assert.equal(page.attrs.get('data-intro'), 'seen', JSON.stringify(opts));
    assert.equal(page.timers.length, 0, JSON.stringify(opts));
  }
});
