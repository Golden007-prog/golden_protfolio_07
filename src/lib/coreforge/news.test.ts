import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fetchCoreforgeNews, isTimelyCoreforgeNews, parseCoreforgeNews, promotableCoreforgeNews } from './news.ts';

// goldensdmat.in/news.xml as fetched on 2026-09-26.
const FIXTURE = readFileSync(new URL('./news.fixture.xml', import.meta.url), 'utf8');
// The day after the first India sitting: registration has closed, the test date has
// passed and the certificates entry is still post-dated.
const NOW = new Date('2026-09-27T09:00:00Z');

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const item = (fields: string) => `<item>${fields}</item>`;
const ok = (title: string, date = 'Sun, 06 Sep 2026 00:00:00 GMT', link = 'https://goldensdmat.in/news#a') =>
  item(`<title>${title}</title><link>${link}</link><pubDate>${date}</pubDate>`);

test('the captured feed parses into 11 items, newest first', () => {
  const items = parseCoreforgeNews(FIXTURE);
  assert.equal(items.length, 11);
  assert.deepEqual(items[0], {
    id: 'first-cycle-certificates',
    title: 'First-cycle dMAT certificates issued from 12 October 2026',
    link: 'https://goldensdmat.in/news#first-cycle-certificates',
    date: '2026-10-12',
    categories: ['dmat', 'aps', 'results', 'dates', 'notable'],
  });
  assert.deepEqual(
    items.map((i) => i.date),
    [...items.map((i) => i.date)].sort().reverse(),
  );
  for (const i of items) {
    assert.match(i.link, /^https:\/\/goldensdmat\.in\/news#[a-z0-9-]+$/);
    assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(i.title.length > 0);
  }
  const brainGym = items.find((i) => i.id === 'brain-gym-and-skills');
  assert.equal(brainGym?.date, '2026-09-06');
  assert.ok(brainGym?.categories.includes('platform'));
});

test('promotable news drops every item that quotes a price', () => {
  const all = parseCoreforgeNews(FIXTURE);
  const priced = all.filter((i) => /₹|€/.test(i.title)).map((i) => i.id);
  assert.deepEqual(priced, ['coreforge-pro-launch', 'first-registration-window-opens']);
  const promo = promotableCoreforgeNews(all, NOW);
  for (const id of priced) assert.ok(!promo.some((i) => i.id === id), id);
  for (const i of promo) assert.doesNotMatch(i.title, /₹|€|\d+ a month/);
});

test('promotable news drops post-dated items and deadline items once their day has passed', () => {
  const all = parseCoreforgeNews(FIXTURE);
  const promo = promotableCoreforgeNews(all, NOW);
  const ids = promo.map((i) => i.id);
  for (const gone of ['registration-closes', 'first-cycle-certificates', 'first-india-test-date']) {
    assert.ok(!ids.includes(gone), gone);
  }
  for (const i of promo) {
    assert.ok(i.date <= '2026-09-27', `${i.id} is post-dated`);
    if (i.date < '2026-09-27') {
      assert.ok(!i.categories.some((c) => ['dates', 'registration', 'critical'].includes(c)), i.id);
    }
  }
  assert.ok(ids.includes('brain-gym-and-skills'));
  assert.ok(ids.includes('free-plan-replaces-trial'));
  // On its own day a dated item is still news; the next day it is not.
  const testDate = all.find((i) => i.id === 'first-india-test-date');
  assert.ok(testDate);
  assert.equal(isTimelyCoreforgeNews(testDate, new Date('2026-09-26T20:00:00Z')), true);
  assert.equal(isTimelyCoreforgeNews(testDate, NOW), false);
  // A plain platform release never expires.
  const gym = all.find((i) => i.id === 'brain-gym-and-skills');
  assert.ok(gym);
  assert.equal(isTimelyCoreforgeNews(gym, new Date('2030-01-01T00:00:00Z')), true);
});

test('entities and CDATA decode; tags and extra whitespace go', () => {
  const items = parseCoreforgeNews(
    rss(
      ok('News &amp; updates &#8212; the &#x2019;GAM&#x2019; &lt;b&gt;', 'Mon, 29 Jun 2026 00:00:00 GMT') +
        ok('<![CDATA[Brain Gym & <em>more</em>]]>', 'Sun, 06 Sep 2026 00:00:00 GMT', 'https://goldensdmat.in/news#b') +
        ok('  Split\n   across   lines  ', 'Sat, 18 Jul 2026 00:00:00 GMT', 'https://goldensdmat.in/news#c'),
    ),
  );
  assert.deepEqual(
    items.map((i) => i.title),
    ['Brain Gym & <em>more</em>', 'Split across lines', 'News & updates — the ’GAM’ <b>'],
  );
});

test('items without a title, a valid date or an on-site https link are skipped', () => {
  const items = parseCoreforgeNews(
    rss(
      ok('') +
        ok('No date', 'not a date') +
        item('<title>Missing link</title><pubDate>Sun, 06 Sep 2026 00:00:00 GMT</pubDate>') +
        ok('Off site', undefined, 'https://evil.example/news') +
        ok('Look-alike', undefined, 'https://goldensdmat.in.evil.example/news') +
        ok('Script', undefined, 'javascript:alert(1)') +
        ok('Plain http', undefined, 'http://goldensdmat.in/news') +
        ok('Kept', undefined, 'https://www.goldensdmat.in/news?x=1#kept'),
    ),
  );
  assert.deepEqual(items.map((i) => [i.title, i.link]), [['Kept', 'https://goldensdmat.in/news?x=1#kept']]);
  assert.equal(items[0]?.id, 'https://goldensdmat.in/news?x=1#kept');
});

test('duplicate guids appear once; junk and oversized input give []', () => {
  const dup = item(
    '<title>A</title><link>https://goldensdmat.in/news#a</link><guid>a</guid><pubDate>Sun, 06 Sep 2026 00:00:00 GMT</pubDate>',
  );
  assert.equal(parseCoreforgeNews(rss(dup + dup)).length, 1);
  assert.deepEqual(parseCoreforgeNews(''), []);
  assert.deepEqual(parseCoreforgeNews('<html><body>502 Bad Gateway</body></html>'), []);
  assert.deepEqual(parseCoreforgeNews(rss(ok('Big')) + ' '.repeat(1_000_001)), []);
});

test('fetchCoreforgeNews returns the latest promotable items', async () => {
  let seen: { url: string; init?: RequestInit & { next?: { revalidate?: number } } } | undefined;
  const items = await fetchCoreforgeNews({
    limit: 3,
    now: NOW,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'application/xml' } });
    },
  });
  assert.equal(seen?.url, 'https://goldensdmat.in/news.xml');
  assert.equal(seen?.init?.next?.revalidate, 21600);
  assert.ok(seen?.init?.signal instanceof AbortSignal);
  assert.deepEqual(
    items.map((i) => i.id),
    ['brain-gym-and-skills', 'free-plan-replaces-trial', 'subject-modules-live'],
  );
});

test('fetchCoreforgeNews returns [] on a non-OK status, a throw or unparseable text', async () => {
  assert.deepEqual(await fetchCoreforgeNews({ fetchImpl: async () => new Response(FIXTURE, { status: 503 }) }), []);
  assert.deepEqual(
    await fetchCoreforgeNews({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    }),
    [],
  );
  assert.deepEqual(await fetchCoreforgeNews({ fetchImpl: async () => new Response('<html></html>') }), []);
});

test('fetchCoreforgeNews gives up at the timeout even if fetch never settles, and aborts it', async () => {
  let signal: AbortSignal | null | undefined;
  const started = Date.now();
  const items = await fetchCoreforgeNews({
    timeoutMs: 50,
    fetchImpl: (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });
  assert.deepEqual(items, []);
  assert.ok(Date.now() - started < 1000);
  assert.equal(signal?.aborted, true);
});
