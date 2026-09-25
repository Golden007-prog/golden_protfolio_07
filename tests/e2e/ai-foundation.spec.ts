import http from 'node:http';
import https from 'node:https';
import type { APIRequestContext, APIResponse, Page, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import reading from '../../src/data/reading.json' with { type: 'json' };
import { PHILOSOPHY } from '../../src/data/site-copy';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { slugify } from '../../src/lib/slug';
import {
  aiHealth,
  aiPost,
  assertSafeServer,
  countAiRequests,
  fakeStats,
  mockAiStream,
  startNextServer,
  testOrigin,
  totalCalls,
} from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * AI foundation (#141, #150, #160, #161, #163, #164, #170, #173). Pages make no
 * /api/ai request on load; the guard refuses cheaply and never reaches the model;
 * retrieval answers lexically with AI off or no key; the UI kit meets its size,
 * disclosure, announcement and reduced-motion rules at 320px.
 */

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
/** API-level checks do not depend on the viewport, theme or motion: one project runs them. */
const primary = (info: TestInfo) => width(info) === 1440 && projectUse(info).colorScheme === 'dark' && !isReduced(info);
/** The same condition as a test.skip() callback. */
const notPrimary = ({ viewport, colorScheme, reducedMotion }: { viewport: { width: number } | null; colorScheme: string | null; reducedMotion: string | null }) =>
  !(viewport?.width === 1440 && colorScheme === 'dark' && reducedMotion !== 'reduce');

const SLUGS = new Set(projects.map((p) => slugify(p.name)));
const SECTIONS = new Set(['about', 'skills', 'projects', 'experience', 'philosophy', 'contact']);
const inRange = (i: unknown, n: number) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n;

/** Mirrors sanitize.validTarget against the site's own data. */
function isValidTarget(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  switch (o.kind) {
    case 'project':
      return typeof o.slug === 'string' && SLUGS.has(o.slug);
    case 'skill':
      return typeof o.name === 'string' && o.name.trim().length > 0 && o.name.length <= 80;
    case 'section':
      return typeof o.id === 'string' && SECTIONS.has(o.id);
    case 'experience':
      return inRange(o.index, profile.experience.length);
    case 'education':
      return inRange(o.index, profile.education.length);
    case 'reading':
      return inRange(o.index, reading.length);
    case 'tenet':
      return inRange(o.index, PHILOSOPHY.length);
    case 'cv':
    case 'contact':
      return true;
    default:
      return false;
  }
}

async function expectFallback(res: APIResponse, reason: string) {
  expect(res.status(), `expected HTTP 200 for '${reason}'`).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(await res.json()).toEqual({ mode: 'fallback', reason });
}

/** Runs `fn` until the fake model's counters did not move across it (other workers may call it too). */
async function expectNoModelWork(request: APIRequestContext, fn: () => Promise<void>) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fakeStats(request);
    await fn();
    const after = await fakeStats(request);
    const calls = totalCalls(after) - totalCalls(before);
    const embeds = after.embeds - before.embeds;
    if (calls === 0 && embeds === 0) return;
    last = `model calls +${calls}, embeds +${embeds}`;
  }
  throw new Error(`guard refusals reached the model in three windows running (${last})`);
}

/** POSTs a body in 1 KB chunks with Transfer-Encoding: chunked and no Content-Length. */
function postChunked(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; type: string; text: string }> {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = lib.request(url, { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } }, (res) => {
      answered = true;
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }));
    });
    // The guard stops reading at the cap, so a late write may fail after the answer.
    req.on('error', (err) => {
      if (!answered) reject(err);
    });
    void (async () => {
      for (let i = 0; i < body.length; i += 1024) {
        if (req.destroyed) return;
        if (!req.write(body.slice(i, i + 1024))) await new Promise((r) => req.once('drain', r));
        await new Promise((r) => setTimeout(r, 5));
      }
      req.end();
    })();
  });
}

/** Is POST /api/ai/ask built yet (ai-concierge)? A gibberish question is refused by the relevance gate before any model call. */
async function askRouteExists(request: APIRequestContext): Promise<boolean> {
  const res = await aiPost(request, 'ask', { question: 'zzqx vvbn' });
  return res.status() !== 404;
}

test.describe('no AI request on load (#161)', () => {
  test('/ and a case study make zero /api/ai requests while loading and scrolling', async ({ page }) => {
    const aiRequests = countAiRequests(page);
    const { errors } = collectPageErrors(page);
    for (const path of ['/', '/projects/urbancare-ai']) {
      await page.goto(path);
      await page.evaluate(async () => {
        const step = Math.max(200, window.innerHeight * 0.8);
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      // The dock and AskMeBot mount on idle; give them time to (not) call anything.
      await page.waitForTimeout(1500);
    }
    expect(aiRequests(), 'a page called /api/ai on load').toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('guard (#141)', () => {
  test.skip(notPrimary, 'API-level check');
  test.beforeEach(async ({ request }) => {
    await assertSafeServer(request);
  });

  test('refusals answer HTTP 200 fallbacks before the body, the schema or the model', async ({ request }) => {
    test.skip(!(await aiHealth(request)).fake, 'the call counters need the fake model');
    const routes: { name: string; valid: Record<string, unknown>; long: Record<string, unknown> }[] = [
      { name: 'retrieve', valid: { query: 'UrbanCare AI' }, long: { query: 'x'.repeat(201) } },
    ];
    if (await askRouteExists(request)) routes.push({ name: 'ask', valid: { question: 'What is UrbanCare AI?' }, long: { question: 'x'.repeat(501) } });
    const origin = testOrigin();

    await expectNoModelWork(request, async () => {
      for (const { name, valid, long } of routes) {
        const url = `/api/ai/${name}`;
        await expectFallback(await aiPost(request, url, valid, { headers: { origin: 'https://evil.example' } }), 'origin');
        await expectFallback(await aiPost(request, url, valid, { headers: { origin: 'https://basuoikantik.in.evil.example' } }), 'origin');
        await expectFallback(await aiPost(request, url, valid, { headers: { 'sec-fetch-site': 'cross-site' } }), 'origin');
        await expectFallback(
          await request.post(url, { headers: { 'content-type': 'application/json' }, data: JSON.stringify(valid), failOnStatusCode: false }),
          'origin',
        );
        await expectFallback(await aiPost(request, url, JSON.stringify(valid), { headers: { 'content-type': 'text/plain' } }), 'bad-request');
        await expectFallback(await aiPost(request, url, '{"query": '), 'bad-request');
        await expectFallback(await aiPost(request, url, { ...valid, extra: true }), 'bad-request');
        await expectFallback(await aiPost(request, url, long), 'too-long');
        await expectFallback(await aiPost(request, url, JSON.stringify({ ...valid, pad: 'x'.repeat(20_000) })), 'too-long');

        const chunked = await postChunked(
          `${origin}${url}`,
          { origin, 'content-type': 'application/json' },
          `{"query":"${'x'.repeat(20_400)}"}`,
        );
        expect(chunked.status).toBe(200);
        expect(chunked.type).toContain('application/json');
        expect(JSON.parse(chunked.text)).toEqual({ mode: 'fallback', reason: 'too-long' });

        const get = await request.get(url, { failOnStatusCode: false });
        expect(get.status(), `GET ${url}`).toBe(405);
        expect(await get.text()).not.toMatch(/AIza/);
      }
      if (routes.some((r) => r.name === 'ask')) {
        await expectFallback(await aiPost(request, 'ask', { question: 'What is UrbanCare AI?', lang: 'xx-<script>' }), 'bad-request');
        await expectFallback(await aiPost(request, 'ask', { question: 'What is UrbanCare AI?', history: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), 'too-long');
        await expectFallback(await aiPost(request, 'ask', { question: 'What is UrbanCare AI?', scope: { project: 'not-a-project' } }), 'bad-request');
      }
    });
  });
});

test.describe('retrieve (#150)', () => {
  test.skip(notPrimary, 'API-level check');
  test.beforeEach(async ({ request }) => {
    await assertSafeServer(request);
  });

  test('answers labelled, validated hits, one per destination', async ({ request }) => {
    const health = await aiHealth(request);
    const res = await aiPost(request, 'retrieve', { query: 'UrbanCare AI', k: 5 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = (await res.json()) as { mode: string; hits: Record<string, unknown>[] };
    // The fake model has no embeddings, and AI off is BM25 by definition.
    if (health.fake || !health.enabled) expect(body.mode).toBe('lexical');
    else expect(['lexical', 'hybrid']).toContain(body.mode);
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits.length).toBeLessThanOrEqual(5);
    for (const hit of body.hits) {
      expect(Object.keys(hit).sort()).toEqual(['bm25', 'cosine', 'id', 'label', 'score', 'target']);
      expect(typeof hit.id).toBe('string');
      expect(typeof hit.label).toBe('string');
      expect(typeof hit.score).toBe('number');
      expect(hit.cosine === null || typeof hit.cosine === 'number').toBe(true);
      expect(hit.bm25).toBeGreaterThanOrEqual(0);
      expect(hit.bm25).toBeLessThanOrEqual(1);
      expect(isValidTarget(hit.target), `invalid target ${JSON.stringify(hit.target)}`).toBe(true);
    }
    expect(body.hits.map((h) => h.target)).toContainEqual({ kind: 'project', slug: 'urbancare-ai' });
    const destinations = body.hits.map((h) => JSON.stringify(h.target));
    expect(new Set(destinations).size).toBe(destinations.length);

    const scoped = (await (await aiPost(request, 'retrieve', { query: 'agents', k: 10, scope: 'projects' })).json()) as { hits: { target: { kind: string } }[] };
    expect(scoped.hits.length).toBeGreaterThan(0);
    expect(scoped.hits.every((h) => h.target.kind === 'project')).toBe(true);

    await expectFallback(await aiPost(request, 'retrieve', { query: 'agents', k: 11 }), 'bad-request');
    await expectFallback(await aiPost(request, 'retrieve', { query: 'agents', k: 0 }), 'bad-request');
    await expectFallback(await aiPost(request, 'retrieve', { query: '   ' }), 'bad-request');
    await expectFallback(await aiPost(request, 'retrieve', { query: 'agents', scope: 'everything' }), 'bad-request');
    await expectFallback(await aiPost(request, 'retrieve', { query: 'agents' }, { headers: { origin: 'https://evil.example' } }), 'origin');
  });

  test('GET /api/ai/health is no-store and never carries a key', async ({ request }) => {
    const res = await request.get('/api/ai/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    const text = await res.text();
    expect(text).not.toMatch(/AIza/);
    const health = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['enabled', 'configured', 'fake', 'tier', 'models', 'cooling']) expect(health).toHaveProperty(key);
    expect(Object.keys(health.models as object).sort()).toEqual(['fallback', 'primary']);
  });
});

test.describe('AI switched off or keyless (#150, #160)', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(notPrimary, 'starts its own server; one project is enough');
  test.skip(Boolean(process.env.PW_BASE_URL), 'needs the local build');

  async function check(
    playwright: PlaywrightWorkerArgs['playwright'],
    env: Record<string, string>,
    expected: { enabled: boolean; askReason: string },
  ) {
    const server = await startNextServer(env);
    const ctx = await playwright.request.newContext({ baseURL: server.baseURL });
    try {
      const health = await aiHealth(ctx);
      expect(health.fake).toBe(false);
      expect(health.enabled).toBe(expected.enabled);
      // Stop before any POST if the real key got in: nothing here may reach Gemini.
      expect(health.configured, 'the real key reached a server that should have none').toBe(false);

      const post = (path: string, data: unknown, origin = server.baseURL) =>
        ctx.post(path, { headers: { origin, 'content-type': 'application/json' }, data: JSON.stringify(data), failOnStatusCode: false });
      const res = await post('/api/ai/retrieve', { query: 'UrbanCare AI', k: 5 });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { mode: string; hits: { target: unknown }[] };
      expect(body.mode).toBe('lexical');
      expect(body.hits.map((h) => h.target)).toContainEqual({ kind: 'project', slug: 'urbancare-ai' });
      await expectFallback(await post('/api/ai/retrieve', { query: 'agents' }, 'https://evil.example'), 'origin');

      const ask = await post('/api/ai/ask', { question: 'What did he build with Gemini in UrbanCare AI?' });
      if (ask.status() !== 404) await expectFallback(ask, expected.askReason);
    } finally {
      await ctx.dispose();
      await server.stop();
    }
  }

  test('AI_ENABLED=0: health says disabled, retrieval stays lexical, model routes fall back', async ({ playwright }) => {
    test.setTimeout(90_000);
    await check(playwright, { AI_ENABLED: '0', AI_FAKE_MODEL: '', GOOGLE_AI_API_KEY: '' }, { enabled: false, askReason: 'disabled' });
  });

  test('no key: configured is false, retrieval stays lexical, model routes answer no-key', async ({ playwright }) => {
    test.setTimeout(90_000);
    await check(playwright, { AI_ENABLED: '1', AI_FAKE_MODEL: '', GOOGLE_AI_API_KEY: '', AI_FEATURES_OFF: '' }, { enabled: true, askReason: 'no-key' });
  });
});

test.describe('robots and deep links (#173)', () => {
  test('robots.txt keeps crawlers out of /api/', async ({ request }, info) => {
    test.skip(!primary(info), 'build-level check');
    const text = await (await request.get('/robots.txt')).text();
    expect(text).toMatch(/Disallow: \/api\//);
    expect(text).toMatch(/Allow: \/\s/);
  });

  test('/?lens=… skips the intro loader like ?project and ?skill', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) !== 1440, 'the intro only plays with motion; one width is enough');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => document.documentElement.dataset.intro)).not.toBe('seen');
    const fresh = await page.context().newPage();
    await fresh.goto('/?lens=llm-agents', { waitUntil: 'domcontentloaded' });
    expect(await fresh.evaluate(() => document.documentElement.dataset.intro)).toBe('seen');
  });
});

/* ---- the UI kit, through the first surface that mounts it (AskMeBot) ---- */

const EXP0 = profile.experience[0];
const PHRASE = `${EXP0.role} at ${EXP0.company}`;
const ANSWER: AiFrame[] = [
  {
    type: 'meta',
    model: 'gemini-test',
    feature: 'ask',
    sources: [{ id: 'exp:0', label: `Experience · ${EXP0.company}`, cls: 'self', target: { kind: 'experience', index: 0 } }],
    mode: 'lexical',
  },
  { type: 'delta', text: `His first listed role is ${PHRASE} [c:exp:0].` },
  { type: 'done', finishReason: 'STOP', cited: ['exp:0'], dropped: 0, degraded: false },
];
// Open-ended, so a rule-first assistant escalates it instead of answering from rules.
const OPEN_QUESTION = 'What kind of problems does he seem most curious about?';

/** Counts live-region announcements whose spoken text newly contains `phrase` (aria-hidden subtrees are silent). */
async function installAnnouncementCounter(page: Page, phrase: string) {
  await page.addInitScript((p) => {
    const w = window as Window & { __aiAnnouncements?: number };
    w.__aiAnnouncements = 0;
    const had = new WeakMap<Element, boolean>();
    const spoken = (el: Element): string => {
      let out = '';
      const walk = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
        else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true') n.childNodes.forEach(walk);
      };
      walk(el);
      return out;
    };
    const scan = () => {
      document
        .querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]')
        .forEach((el) => {
          if (el.closest('[aria-hidden="true"]')) return;
          const now = spoken(el).includes(p);
          if (now && !had.get(el)) w.__aiAnnouncements = (w.__aiAnnouncements ?? 0) + 1;
          had.set(el, now);
        });
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-live', 'role'] });
  }, phrase);
}

async function openAssistant(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');
  await page.locator('[data-ask-launcher]').click();
  const input = page.locator('[data-ask-panel] input, [data-ask-sheet] input').first();
  await expect(input).toBeVisible();
  return input;
}

/** Sends the open question; skips the test when the assistant has no AI path yet (ai-concierge #178). */
async function askAi(page: Page, aiRequests: () => number) {
  const input = await openAssistant(page);
  await input.fill(OPEN_QUESTION);
  await input.press('Enter');
  await expect.poll(aiRequests, { timeout: 5000 }).toBeGreaterThan(0).catch(() => {});
  test.skip(aiRequests() === 0, 'AskMeBot answered from rules only: no AI surface mounts the kit yet (ai-concierge #178/#179)');
  await expect(page.locator('[data-source="ai"]').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('UI kit (#163, #164)', () => {
  test('at 320px an AI answer shows the disclosure, 44px targets, one announcement and no Lottie under reduce', async ({ page, request }, info) => {
    test.skip(width(info) !== 320, '320x568 projects');
    await assertSafeServer(request);
    const { errors } = collectPageErrors(page);
    const lottie: string[] = [];
    page.on('request', (r) => {
      if (/\/lottie\/[^/]+\.json/.test(r.url())) lottie.push(r.url());
    });
    await installAnnouncementCounter(page, PHRASE);
    await mockAiStream(page, 'ask', ANSWER);
    const aiRequests = countAiRequests(page);
    await askAi(page, aiRequests);

    const disclosure = page.locator('[data-ai-disclosure]').first();
    await disclosure.scrollIntoViewIfNeeded();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText(/AI-generated/);
    await expect(disclosure.locator('a[href="/ai#how"]')).toHaveCount(1);
    await expect(disclosure.locator('a[href="/ai#privacy"]')).toHaveCount(1);

    const small = await page.$$eval(
      '[data-ai-disclosure] a, [data-ai-sources] button, button.ai-cite, [data-ai-button], [data-ai-prompts] button, [data-ai-read] button, [data-ai-voice] button',
      (els) =>
        els
          .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert],[aria-hidden="true"]'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), what: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) };
          })
          .filter((s) => s.w < 44 || s.h < 44),
    );
    expect(small, 'AI kit targets under 44px').toEqual([]);

    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as Window & { __aiAnnouncements?: number }).__aiAnnouncements)).toBe(1);
    if (isReduced(info)) expect(lottie, 'Lottie JSON fetched under reduced motion').toEqual([]);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('a source chip runs the action runner: #experience and "Moved to Experience"', async ({ page, request }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and the smallest phone');
    await assertSafeServer(request);
    await mockAiStream(page, 'ask', ANSWER);
    const aiRequests = countAiRequests(page);
    await askAi(page, aiRequests);

    const chip = page.locator('[data-ai-sources] button[data-cite-id="exp:0"], button.ai-cite[data-cite-id="exp:0"]').first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect(page.locator('[data-ai-announcer]')).toHaveText('Moved to Experience');
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#experience');
    await expect(page.locator('[data-ai-spotlight]')).toHaveCount(1);
  });
});
