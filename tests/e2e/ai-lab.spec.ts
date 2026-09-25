import { readFileSync } from 'node:fs';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Page, Route, TestInfo } from '@playwright/test';
import evalReportJson from '../../src/data/ai-eval-report.json' with { type: 'json' };
import labStore from '../../src/data/ai-generated/lab.json' with { type: 'json' };
import reading from '../../src/data/reading.json' with { type: 'json' };
import { EvalReport, parseEvalReport, staleness, type EvalReportFile } from '../../src/components/ai/lab/EvalReport';
import { RedTeamResults, parseAttacks } from '../../src/components/ai/lab/RedTeamResults';
import { GUARDS, MODEL_CARDS } from '../../src/data/ai-model-cards';
import { assertSafeServer, countAiRequests, mockAiJson } from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * The /ai lab (#236-#243): the static 'How this AI works' page, its model cards
 * and privacy copy, the eval report and red-team results, the recorded
 * structured-output demo and the embedding explorer, plus the footer, sitemap
 * and reading-list links into it. The page makes no /api/ai request until the
 * explorer's 'Plot my question' is pressed; every model reply here is recorded
 * or mocked.
 */

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const theme = (info: TestInfo) => (projectUse(info).colorScheme === 'light' ? 'light' : 'dark');
/** Checks that don't depend on viewport, theme or motion run once. */
const primary = (info: TestInfo) => width(info) === 1440 && theme(info) === 'dark' && !isReduced(info);

const REPORT = parseEvalReport(evalReportJson);
const ATTACKS = parseAttacks(readFileSync(new URL('../../evals/injection.jsonl', import.meta.url), 'utf8'));
const LAB_KEYS = Object.keys((labStore as { entries: Record<string, unknown> }).entries);
const STEP_TITLES = [
  'Your question',
  'Rule router',
  'Guard',
  'Hybrid retrieval',
  'Relevance gate',
  'Context packer',
  'Gemini fallback chain',
  'Sentence filter',
  'Stream',
  'Answer with sources',
];

/** A small projection in the committed file's shape: a 3x4 grid of points in all three evidence classes. */
const FIXTURE_POINTS = Array.from({ length: 12 }, (_, i) => ({
  id: i < 8 ? `project:fixture-${i}#summary` : i < 11 ? `ref:fixture-${i}` : 'live:github',
  label: `Fixture point ${String(i).padStart(2, '0')}`,
  cls: i < 8 ? 'self' : i < 11 ? 'reference' : 'live',
  x: -0.9 + (i % 4) * 0.6,
  y: 0.8 - Math.floor(i / 4) * 0.8,
}));

async function serveProjection(page: Page, points: unknown[]) {
  await page.route(/\/ai\/projection\.json(?:\?.*)?$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, model: 'fixture-embed', count: points.length, explained: points.length ? [0.4, 0.2] : [], points }),
    }),
  );
}

async function gotoAi(page: Page, hash = '') {
  await page.goto(`/ai${hash}`);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
}

/** Scrolls the explorer into view so it loads the projection, and waits for it to settle. */
async function openExplorer(page: Page) {
  await page.locator('#explorer').scrollIntoViewIfNeeded();
  const map = page.locator('[data-map]');
  await expect(map).toHaveAttribute('data-map-state', /ready|empty|error/, { timeout: 10_000 });
  return map;
}

test.describe('/ai page', () => {
  test.beforeEach(async ({ request }) => {
    await assertSafeServer(request);
  });

  test('renders in this theme with no overflow, no console errors and no AI request on load', async ({ page }, info) => {
    const errors = collectPageErrors(page);
    const aiRequests = countAiRequests(page);
    await gotoAi(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme(info));
    await expect(page.getByRole('heading', { level: 1, name: /How this site’s AI works/ })).toBeVisible();

    // The diagram's colours are theme tokens: its title text matches the page's primary text colour.
    const [svgText, h1] = await Promise.all([
      page.locator('.ai-lab-title').first().evaluate((el) => getComputedStyle(el).fill),
      page.locator('h1').evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(svgText).toBe(h1);

    // Walk the whole page, so the lazy explorer loads its static projection too.
    for (const id of ['how', 'cards', 'privacy', 'evals', 'red-team', 'demo', 'explorer']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    }
    await openExplorer(page);
    await expectNoHorizontalOverflow(page);
    expect(aiRequests(), 'the page called /api/ai before any button was pressed').toBe(0);
    expect(errors.errors).toEqual([]);
  });

  test('the diagram has a title, a description and a text equivalent of every step', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    await gotoAi(page);
    const svg = page.locator('[data-ai-diagram] svg[role="img"]');
    await expect(svg).toHaveAccessibleName('How an answer is made');
    await expect(svg).toHaveAccessibleDescription(/ten steps/);
    await expect(svg.locator('.ai-lab-node')).toHaveCount(STEP_TITLES.length);
    // With the real fonts loaded, every line fits inside its box.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const spill = await svg.evaluate((el) =>
      Array.from(el.querySelectorAll('.ai-lab-node')).flatMap((g) => {
        const box = (g.querySelector('rect') as SVGRectElement).getBBox();
        return Array.from(g.querySelectorAll('text'))
          .filter((t) => {
            const b = t.getBBox();
            return b.x + b.width > box.x + box.width - 4;
          })
          .map((t) => t.textContent);
      }),
    );
    expect(spill, 'diagram text runs past its box').toEqual([]);
    const items = page.locator('[data-ai-diagram-text] > li');
    await expect(items).toHaveCount(STEP_TITLES.length);
    for (const [i, title] of STEP_TITLES.entries()) await expect(items.nth(i)).toContainText(title);
    // The anchor the reading list links to.
    await expect(page.locator('#context-order')).toContainText('Lost in the Middle');
  });

  test('model cards, anchors and privacy copy come from the server configuration', async ({ page, request }, info) => {
    test.skip(!primary(info), 'one project');
    const health = await assertSafeServer(request);
    await gotoAi(page);
    for (const id of ['how', 'defences', 'limitations', 'cards', 'privacy', 'evals', 'red-team', 'demo', 'explorer']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    for (const card of MODEL_CARDS) await expect(page.locator(`#card-${card.id}`)).toHaveCount(1);
    // Built from the same env the server reports; no id is written into the cards data.
    await expect(page.locator('#cards')).toContainText(health.models.primary);
    await expect(page.locator('#cards')).toContainText(health.models.fallback);
    await expect(page.locator('[data-privacy-copy]')).toHaveAttribute('data-privacy-copy', health.tier === 'paid' ? 'paid' : 'free');

    // AIDisclosure's links resolve.
    for (const hash of ['#how', '#privacy']) {
      await page.goto(`/ai${hash}`);
      await expect(page.locator(hash)).toBeInViewport();
    }
  });

  test('the eval report shows the committed run, or says no run yet', async ({ page, request }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    const health = await assertSafeServer(request);
    await gotoAi(page, '#evals');
    const section = page.locator('#evals');
    if (!REPORT.run) {
      await expect(section.locator('[data-eval-empty]')).toContainText('No eval run yet');
      await expect(section.locator('[data-eval-metric]')).toHaveCount(0);
    } else {
      await expect(section.locator('[data-eval-metric]')).toHaveCount(REPORT.run.metrics.length);
      await expect(section.locator('[data-eval-stale]')).toHaveCount(staleness(REPORT.run, health.models).length ? 1 : 0);
    }
    await expect(section.locator('[data-eval-caveats] li').first()).toContainText('small sample');
  });

  test('red-team results list every attack with its guard', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    await gotoAi(page, '#red-team');
    const rows = page.locator('#red-team [data-attack]');
    await expect(rows).toHaveCount(ATTACKS.length);
    const recorded = new Map((REPORT.run?.injection ?? []).map((r) => [r.id, r]));
    for (const a of ATTACKS) {
      const row = page.locator(`#red-team [data-attack="${a.id}"]`);
      await expect(row).toContainText(a.category);
      const r = recorded.get(a.id);
      if (r) await expect(row.locator('[data-guard-label]')).toHaveText(GUARDS[r.guard as keyof typeof GUARDS] ?? r.guard);
      else await expect(row).toContainText('Not run yet');
    }
  });

  test('the recorded demo renders from the store with labelled, keyboard-reachable panes and no request', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    const aiRequests = countAiRequests(page);
    await gotoAi(page, '#demo');
    const demo = page.locator('#demo');
    if (!LAB_KEYS.length) {
      await expect(demo.locator('[data-demo-empty]')).toBeVisible();
      test.info().annotations.push({ type: 'note', description: 'lab.json has no recorded demo: only the empty state was checked' });
      return;
    }
    const shown = await demo.locator('[data-demo]').count();
    expect(shown).toBe(LAB_KEYS.length);
    const panes = demo.locator('[data-demo-pane]');
    await expect(panes).toHaveCount(shown * 3);
    for (const pane of await panes.all()) {
      await expect(pane).toHaveAttribute('tabindex', '0');
      await expect(pane).toHaveAttribute('role', 'region');
      await expect(pane).toHaveAccessibleName(/JSON Schema sent|Raw model reply|zod safeParse result/);
    }
    // Keyboard: the first pane is a tab stop.
    await panes.first().focus();
    await expect(panes.first()).toBeFocused();
    await expect(demo.locator('[data-ai-disclosure]').first()).toContainText('AI-generated');
    expect(aiRequests()).toBe(0);
  });
});

test.describe('embedding explorer', () => {
  test.beforeEach(async ({ request }) => {
    await assertSafeServer(request);
  });

  test('says so when no embeddings exist', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    await serveProjection(page, []);
    await gotoAi(page);
    const map = await openExplorer(page);
    await expect(map).toHaveAttribute('data-map-state', 'empty');
    await expect(map).toContainText('Embeddings not generated yet');
  });

  test('points are focusable, arrow keys move between them and the table lists the same labels', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    const aiRequests = countAiRequests(page);
    await serveProjection(page, FIXTURE_POINTS);
    await gotoAi(page);
    const map = await openExplorer(page);
    await expect(map).toHaveAttribute('data-map-state', 'ready');

    const points = map.locator('[data-point]');
    await expect(points).toHaveCount(FIXTURE_POINTS.length);
    expect(await points.evaluateAll((els) => els.every((el) => el.getAttribute('tabindex') === '0' || el.getAttribute('tabindex') === '-1'))).toBe(true);
    await expect(map.locator('[data-point][tabindex="0"]')).toHaveCount(1);

    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-point') ?? null);
    const pos = (id: string | null) => FIXTURE_POINTS.find((p) => p.id === id)!;

    await map.locator('[data-point][tabindex="0"]').focus();
    await page.keyboard.press('Home');
    const start = await focused();
    expect(start).not.toBeNull();

    // From the top-left fixture point, Right and Down land on its neighbours.
    const topLeft = FIXTURE_POINTS[0];
    await map.locator(`[data-point="${topLeft.id}"]`).focus();
    await page.keyboard.press('ArrowRight');
    expect(pos(await focused())).toMatchObject({ y: topLeft.y });
    expect(pos(await focused()).x).toBeGreaterThan(topLeft.x);
    await page.keyboard.press('ArrowDown');
    expect(pos(await focused()).y).toBeLessThan(topLeft.y);
    await expect(map.locator('[data-point][aria-selected="true"]')).toHaveCount(1);
    await expect(map.locator('[data-map-detail]')).toContainText(pos(await focused()).label);

    // The table carries the same labels.
    await map.locator('summary', { hasText: 'as a table' }).click();
    const rowLabels = await map.locator('[data-map-table] tbody th').allInnerTexts();
    expect(rowLabels.map((t) => t.replace(/\s*\(show on map\)\s*$/, '').trim()).sort()).toEqual(FIXTURE_POINTS.map((p) => p.label).sort());
    await expect(map.locator('[data-map-table] th[aria-sort="ascending"]')).toHaveCount(1);

    expect(aiRequests(), 'keyboard use sent an AI request').toBe(0);
  });

  test('Plot my question makes exactly one retrieve call and draws lines to the hits', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and 320px');
    const aiRequests = countAiRequests(page);
    await serveProjection(page, FIXTURE_POINTS);
    await mockAiJson(page, '/api/ai/retrieve', {
      mode: 'hybrid',
      hits: [
        { id: FIXTURE_POINTS[1].id, label: FIXTURE_POINTS[1].label, target: { kind: 'section', id: 'projects' }, score: 0.03, cosine: 0.71, bm25: 0.4 },
        { id: FIXTURE_POINTS[5].id, label: FIXTURE_POINTS[5].label, target: { kind: 'section', id: 'projects' }, score: 0.02, cosine: 0.64, bm25: 0.3 },
        { id: 'exp:9', label: 'Not on the map', target: { kind: 'section', id: 'experience' }, score: 0.01, cosine: 0.5, bm25: 0.1 },
      ],
    });
    await gotoAi(page);
    const map = await openExplorer(page);
    expect(aiRequests()).toBe(0);

    await map.getByLabel('Plot a question of your own').fill('agents that plan and review each other');
    await map.locator('[data-map-plot]').click();
    await expect(map.locator('[data-query-line]')).toHaveCount(2);
    await expect(map.locator('[data-query-marker]')).toHaveCount(1);
    await expect(map.locator('[data-map-hit]')).toHaveCount(3);
    await expect(map.locator('[data-map-hit="exp:9"]')).toContainText('not on the map');
    await expect(map.getByRole('status').filter({ hasText: 'Plotted' })).toHaveText(/3 matches, 2 on the map/);
    expect(aiRequests()).toBe(1);
  });

  test('no transitions under reduced motion', async ({ page }, info) => {
    test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 320), 'reduced-motion projects at 1440 and 320');
    await serveProjection(page, FIXTURE_POINTS);
    await gotoAi(page);
    const map = await openExplorer(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    const style = await map
      .locator('[data-point]')
      .first()
      .evaluate((el) => ({ duration: getComputedStyle(el).transitionDuration, animation: getComputedStyle(el).animationName }));
    // index.css's site-wide reduced rule pins every duration to 0.001ms (!important), so 'none' reads as 1e-06s.
    expect(style.duration.split(',').every((d) => parseFloat(d) <= 0.001)).toBe(true);
  });
});

test.describe('links into /ai', () => {
  test.beforeEach(async ({ request }) => {
    await assertSafeServer(request);
  });

  test('the footer links to /ai and the sitemap lists it', async ({ page, request }, info) => {
    test.skip(!primary(info) && width(info) !== 360, 'desktop and 360px');
    await gotoAi(page);
    const link = page.locator('#site-footer a[href="/ai"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(/How the AI works/);
    await expect(link).not.toHaveAttribute('target', '_blank');
    const xml = await (await request.get('/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls.some((u) => new URL(u).pathname === '/ai')).toBe(true);
  });

  test('only the Lost in the Middle reading entry links to /ai, and every entry has its index anchor', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 360, 'desktop and 360px');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
    const list = page.locator('#experience [data-reading-list]');
    await list.scrollIntoViewIfNeeded();
    await expect(list.locator('[data-reading-item]')).toHaveCount(reading.length);
    for (let i = 0; i < reading.length; i++) await expect(list.locator(`[data-reading-index="${i}"]`)).toHaveCount(1);
    const applied = list.locator('[data-reading-applied]');
    await expect(applied).toHaveCount(1);
    const lost = reading.findIndex((r) => r.title.startsWith('Lost in the Middle'));
    await expect(list.locator(`[data-reading-index="${lost}"] [data-reading-applied]`)).toHaveAttribute('href', '/ai#context-order');
  });
});

/* ---- components rendered from fixtures, without a browser ---- */

/*
 * Playwright compiles JSX in the test graph to its own component-testing objects
 * ({__pw_type: 'jsx'}), not React elements. This turns them back, wrapping each
 * function component so what it returns is converted too, so the lab's server
 * components can be rendered with react-dom/server here.
 */
type PwNode = { __pw_type: 'jsx'; type: unknown; props?: Record<string, unknown>; key?: string | null };
const wrapped = new WeakMap<object, (p: object) => unknown>();
function toReact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toReact);
  if (!node || typeof node !== 'object' || (node as PwNode).__pw_type !== 'jsx') return node;
  const n = node as PwNode;
  let type = n.type;
  if (type && typeof type === 'object' && (type as { __pw_jsx_fragment?: boolean }).__pw_jsx_fragment) type = Fragment;
  else if (typeof type === 'function') {
    const fn = type as (p: object) => unknown;
    if (!wrapped.has(fn)) wrapped.set(fn, (p: object) => toReact(fn(p)));
    type = wrapped.get(fn);
  }
  const { children, ...props } = { ...(n.props ?? {}) } as Record<string, unknown>;
  if (n.key !== undefined && n.key !== null) props.key = n.key;
  // Static children go in as arguments, as compiled JSX would pass them, so React
  // asks for keys only on real lists.
  const kids = children === undefined ? [] : Array.isArray(children) ? children.map(toReact) : [toReact(children)];
  return createElement(type as Parameters<typeof createElement>[0], props, ...(kids as ReactNode[]));
}

test.describe('lab components from fixtures', () => {
  const current = { primary: 'model-now', fallback: 'lite-now' };
  const sets = { golden: 40, bait: 12, injection: 12 };
  const run = (models: { primary: string; fallback: string }): EvalReportFile => ({
    version: 1,
    run: {
      date: '2026-09-25T10:00:00.000Z',
      models,
      tier: 'free',
      sets,
      metrics: [{ key: 'factRecall', label: 'Fact recall', value: 0.9, n: 40, definition: 'Share of expected facts found.' }],
      injection: [
        { id: 'i01', category: 'Instruction override', expect: 'relevance-gate', guard: 'relevance-gate', resisted: true },
        { id: 'i04', category: 'Markdown link injection', expect: 'link-scrub', guard: 'link-scrub', resisted: true },
        { id: 'i07', category: 'False employer', expect: 'sentence-filter', guard: 'none', resisted: false },
      ],
    },
  });
  const html = (type: unknown, props: object) => renderToStaticMarkup(toReact({ __pw_type: 'jsx', type, props }) as ReactNode);

  test('the model cards data names no model id', async ({}, info) => {
    test.skip(!primary(info), 'no browser needed: one project');
    const source = readFileSync(new URL('../../src/data/ai-model-cards.ts', import.meta.url), 'utf8');
    expect(source.match(/\b(?:gemini|gemma|imagen|veo)-[\w.-]+/gi)).toBeNull();
  });

  test('an empty report says no eval run yet', async ({}, info) => {
    test.skip(!primary(info), 'no browser needed: one project');
    const out = html(EvalReport, { report: parseEvalReport({ version: 1, run: null }), current, sets });
    expect(out).toContain('No eval run yet');
    expect(out).not.toContain('data-eval-metric');
    // Malformed JSON reads as no run rather than crashing the build.
    expect(parseEvalReport({ run: { date: 1 } }).run).toBeNull();
  });

  test('a report from another model shows the stale badge; the current model does not', async ({}, info) => {
    test.skip(!primary(info), 'no browser needed: one project');
    const stale = html(EvalReport, { report: run({ primary: 'model-then', fallback: 'lite-now' }), current, sets });
    expect(stale).toContain('stale: re-run evals');
    expect(stale).toContain('n = 40');
    expect(stale).toContain('model-then');
    const fresh = html(EvalReport, { report: run(current), current, sets });
    expect(fresh).not.toContain('stale: re-run evals');
    expect(fresh).toContain('Share of expected facts found.');
  });

  test('each recorded attack shows the guard that fired', async ({}, info) => {
    test.skip(!primary(info), 'no browser needed: one project');
    const report = run(current);
    const attacks = ATTACKS.filter((a) => ['i01', 'i04', 'i07'].includes(a.id));
    expect(attacks).toHaveLength(3);
    const out = html(RedTeamResults, { attacks, results: report.run!.injection, date: report.run!.date });
    expect(out).toContain(`data-attack-guard="relevance-gate"`);
    for (const label of [GUARDS['relevance-gate'], GUARDS['link-scrub'], GUARDS.none]) expect(out).toContain(label.replace(/'/g, '&#x27;'));
    expect(out).toContain('Got through');
    const none = html(RedTeamResults, { attacks, results: null });
    expect(none.match(/Not run yet/g)).toHaveLength(3);
  });
});
