import { readFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import projects from '../../src/data/projects.json' with { type: 'json' };
import type { AiFrame } from '../../src/lib/ai/protocol';
import { matchesTech } from '../../src/lib/tech';
import { assertSafeServer, mockAiFallback, mockAiJson, mockAiStream } from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * AI in projects (#200-#208): explain-at-your-level, Ask about this project (dialog
 * and case-study page), natural-language filters, related work for an empty grid,
 * semantic neighbours and interest chips, compare, questions to ask, and alt-text
 * gating. Store content comes from fixtures injected through
 * window.__OB_AI_FIXTURES__ (honoured only where drafts show, i.e. not on a
 * production build); every model route is mocked, and the one real-route check
 * (lexical retrieval) runs only against the fake model (assertSafeServer).
 */

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string; colorScheme?: string; hasTouch?: boolean };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const reduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const light = (info: TestInfo) => projectUse(info).colorScheme === 'light';
/** Every UI check runs at 320px under reduced motion (both themes) and once on a motion desktop. */
const covered = (info: TestInfo) => (width(info) === 320 && reduced(info)) || (width(info) === 1440 && !reduced(info) && !light(info));
const once = (info: TestInfo) => width(info) === 1440 && !reduced(info) && !light(info);

const bySlug = (slug: string) => {
  const p = projects.find((x) => x.slug === slug);
  if (!p) throw new Error(`no project ${slug}`);
  return p;
};
const URBANCARE = bySlug('urbancare-ai');
const TCS = bySlug('tcs-stock-forecasting');

const PROVENANCE = {
  site: "AI-written from this site's content",
  reviewed: 'AI-written · reviewed by Oikantik',
  draft: 'Draft · not yet reviewed',
};

const dialog = (page: Page) => page.locator('[data-dialog-root] [role="dialog"]');
const cards = (page: Page) => page.locator('#projects [data-project-card]');

/* ---------------- fixtures ---------------- */

type Entry = { hash: string; model: string; generatedAt: string; reviewed: boolean; claimBearing: boolean; value: unknown };
const entry = (value: unknown, claimBearing: boolean, reviewed = false): Entry => ({
  hash: 'fixture',
  model: 'gemini-test',
  generatedAt: '2026-09-25T00:00:00.000Z',
  reviewed,
  claimBearing,
  value,
});

const LEVELS = {
  eli5: 'UrbanCare AI helps doctors see how a medical AI reached its answer, so they can check it before they trust it.',
  recruiter:
    'UrbanCare AI is a clinical dashboard project that makes medical AI auditable, using MedGemma, TxGemma and Gemini with a Semantics-to-Vector interface physicians can inspect.',
  engineer:
    'A 30-agent, 8-layer clinical pipeline on MedGemma, TxGemma and Gemini. A Semantics-to-Vector interface links human-readable clinical semantics to internal model vectors, so every layer, from lab-report extraction to differential diagnosis, can be inspected. It is a multi-tenant platform with role-based access control and real-time vitals streaming over SSE.',
};

const QUESTIONS = [
  { text: 'Why did you make interpretability the interface itself?', evidence: [{ id: 'project:urbancare-ai#lessons', quote: 'it has to be the interface itself' }] },
  { text: 'How does the Semantics-to-Vector interface work?', evidence: [{ id: 'project:urbancare-ai#solution', quote: 'A Semantics-to-Vector interface' }] },
  { text: 'Why did you pick MedGemma and TxGemma?', evidence: [{ id: 'project:urbancare-ai#stack', quote: 'MedGemma' }] },
];

const INTEREST_ORDER = ['bruhworking-nexusflow', 'omni-lab', 'urbancare-ai', 'content-storyteller'];
const REVIEWED_ALT = 'A dark clinical dashboard with a patient list, vitals charts and a chat panel';

type FixtureOpts = { reviewedLevels?: boolean; reviewedAlt?: boolean; badQuestion?: boolean; vectors?: boolean };

function fixtureStore(o: FixtureOpts = {}) {
  const questions = o.badQuestion
    ? [...QUESTIONS.slice(0, 2), { text: 'How did you scale it to 1M users?', evidence: [{ id: 'project:urbancare-ai#solution', quote: 'scaled to one million users' }] }]
    : QUESTIONS;
  const entries: Record<string, Entry> = {
    'level:urbancare-ai:eli5': entry({ text: LEVELS.eli5 }, true, o.reviewedLevels),
    'level:urbancare-ai:recruiter': entry({ text: LEVELS.recruiter }, true, o.reviewedLevels),
    'level:urbancare-ai:engineer': entry({ text: LEVELS.engineer }, true, o.reviewedLevels),
    'questions:urbancare-ai': entry({ questions }, false),
    'alt:urbancare-ai:still': entry({ text: REVIEWED_ALT }, true, o.reviewedAlt),
    'demo:tcs-stock-forecasting': entry({ text: 'Shows a stock price chart with a forecast line extending past the historical data.' }, true, true),
    // A demo description for a project without a demo loop never shows.
    'demo:urbancare-ai': entry({ text: 'Should never appear.' }, true, true),
    'compare:bruhworking-nexusflow~urbancare-ai': entry(
      {
        rows: [
          { dim: 'goal', a: { field: 'tagline', quote: 'Serverless Agent Swarm for Stateful Orchestration' }, b: { field: 'tagline', quote: 'AI-Native Clinical Ecosystem for Mechanistic Interpretability' } },
          // Not a verbatim quote: must render as 'Not listed'.
          { dim: 'approach', a: { field: 'solution', quote: 'A fleet of robots that writes code' }, b: { field: 'solution', quote: 'A Semantics-to-Vector interface' } },
        ],
      },
      false,
    ),
  };
  if (o.vectors) {
    entries['neighbours:urbancare-ai'] = entry(
      {
        items: [
          { slug: 'bruhworking-nexusflow', cosine: 0.8234 },
          { slug: 'omni-lab', cosine: 0.7712 },
          { slug: 'content-storyteller', cosine: 0.7 },
        ],
      },
      false,
    );
    entries.interests = entry(
      {
        agents: INTEREST_ORDER.map((slug, i) => ({ slug, score: 0.9 - i / 10 })),
        rag: [
          { slug: 'urbancare-ai', score: 0.9 },
          { slug: 'content-storyteller', score: 0.8 },
        ],
        forecasting: [
          { slug: 'tcs-stock-forecasting', score: 0.9 },
          { slug: 'ibm-hr-attrition-prediction', score: 0.7 },
        ],
      },
      false,
    );
  }
  return { version: 1, entries };
}

async function injectStore(page: Page, store: unknown, showUnreviewed?: boolean) {
  await page.addInitScript(
    ([s, show]) => {
      (window as Window & { __OB_AI_FIXTURES__?: unknown }).__OB_AI_FIXTURES__ = show === null ? { projects: s } : { projects: s, showUnreviewed: show };
    },
    [store, showUnreviewed ?? null] as const,
  );
}

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function openProject(page: Page, slug: string) {
  await page.goto(`/?project=${slug}`);
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator(`#project-dialog-title-${slug}`)).toBeVisible();
}

async function gotoProjects(page: Page, query = '') {
  await page.goto(`/${query}#projects`);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.locator('#projects').scrollIntoViewIfNeeded();
}

const params = (page: Page) => new URL(page.url()).searchParams;

/**
 * Model and retrieval calls (POSTs to /api/ai/*) from now on, mocked or not. GET
 * /api/ai/health is left out: the assistant may read it when its panel opens.
 */
function countAiPosts(page: Page): () => number {
  let n = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname.startsWith('/api/ai/')) n += 1;
  });
  return () => n;
}

/* ---------------- #200 explain at your level ---------------- */

test.describe('explain at your level (#200)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('with an empty store the control is hidden, and the dialog makes no AI request', async ({ page }) => {
    await injectStore(page, { version: 1, entries: {} });
    const ai = countAiPosts(page);
    await openProject(page, 'urbancare-ai');
    await expect(dialog(page).locator('[data-section="compare"]')).toBeVisible();
    // Nothing in an empty store to wait for: give its chunk time to load.
    await page.waitForTimeout(1000);
    await expect(dialog(page).locator('[data-ai-levels]')).toHaveCount(0);
    await expect(dialog(page).locator('[data-project-toc] li', { hasText: 'At your level' })).toHaveCount(0);
    expect(ai()).toBe(0);
  });

  test('with fixtures it switches by click and arrow keys with no layout shift, and shows its provenance', async ({ page }) => {
    await injectStore(page, fixtureStore());
    await openProject(page, 'urbancare-ai');
    const levels = dialog(page).locator('[data-ai-levels]');
    await expect(levels).toBeVisible();
    await levels.scrollIntoViewIfNeeded();
    await expect(levels.locator('[data-ai-provenance]')).toHaveText(PROVENANCE.draft);
    await expect(levels.locator('[data-ai-disclosure]')).toBeVisible();

    const stack = levels.locator('[data-ai-levels-stack]');
    const heightBefore = (await stack.boundingBox())!.height;
    await page.evaluate(() => {
      const w = window as Window & { __shifts?: number };
      w.__shifts = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__shifts! += (e as PerformanceEntry & { value: number }).value;
      }).observe({ type: 'layout-shift', buffered: false });
    });

    const tabs = levels.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await tabs.nth(0).click();
    await expect(levels).toHaveAttribute('data-level-active', 'eli5');
    await page.keyboard.press('ArrowRight');
    await expect(levels).toHaveAttribute('data-level-active', 'recruiter');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(levels).toHaveAttribute('data-level-active', 'engineer');
    await expect(levels.getByRole('tabpanel')).toContainText('30-agent');
    await levels.getByRole('tab', { name: 'Plain language' }).click();
    await expect(levels).toHaveAttribute('data-level-active', 'eli5');
    await page.waitForTimeout(500);

    expect((await stack.boundingBox())!.height).toBeCloseTo(heightBefore, 0);
    // Switching must not move the page. Chromium reports a deterministic ~1e-5 sub-pixel
    // entry on the motion desktop run (the stack height above is unchanged), so the bar is
    // "imperceptible" (< 0.001, a hundredth of the 'good' CLS line) rather than exactly 0.
    expect(await page.evaluate(() => (window as Window & { __shifts?: number }).__shifts)).toBeLessThan(0.001);
    // Hidden levels are out of the accessibility tree.
    await expect(levels.locator('[data-level-text="engineer"]')).toHaveAttribute('aria-hidden', 'true');
    if (await page.evaluate(() => 'speechSynthesis' in window)) await expect(levels.getByRole('button', { name: 'Listen' })).toBeVisible();
  });

  test('a production-flag render hides unreviewed fixtures and shows reviewed ones', async ({ page }) => {
    await injectStore(page, fixtureStore(), false);
    await openProject(page, 'urbancare-ai');
    // Claim-free entries still show in production (and prove the store has loaded).
    await expect(dialog(page).locator('[data-ai-questions]')).toBeVisible();
    await expect(dialog(page).locator('[data-ai-levels]')).toHaveCount(0);

    const page2 = await page.context().newPage();
    await injectStore(page2, fixtureStore({ reviewedLevels: true }), false);
    await openProject(page2, 'urbancare-ai');
    const levels = dialog(page2).locator('[data-ai-levels]');
    await expect(levels).toBeVisible();
    await expect(levels.locator('[data-ai-provenance]')).toHaveText(PROVENANCE.reviewed);
    await page2.close();
  });
});

/* ---------------- #201 ask about this project ---------------- */

test.describe('ask about this project (#201)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('the dialog button closes the dialog and opens the assistant scoped to the project', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as Window & { __askOpen?: unknown[] };
      w.__askOpen = [];
      window.addEventListener('ob:ask:open', (e) => w.__askOpen!.push((e as CustomEvent).detail));
    });
    const ai = countAiPosts(page);
    await openProject(page, 'urbancare-ai');
    await dialog(page).getByRole('button', { name: 'Ask about this project' }).click();
    // The project dialog closes. On phones the assistant then opens as a Dialog sheet
    // of its own, so this checks the project's title, not every [data-dialog-root].
    await expect(page.locator('#project-dialog-title-urbancare-ai')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as Window & { __askOpen?: unknown[] }).__askOpen))
      .toEqual([{ scope: { project: 'urbancare-ai' } }]);
    expect(params(page).get('project')).toBeNull();
    // AskMeBot (ai-concierge) shows the scope as a removable chip.
    await expect(page.getByText('About: UrbanCare AI')).toBeVisible({ timeout: 15_000 });
    expect(ai(), 'opening the assistant sends nothing').toBe(0);
  });

  test('InlineAsk on /projects/urbancare-ai streams a scoped, cited answer with the disclosure', async ({ page }, info) => {
    const frames: AiFrame[] = [
      {
        type: 'meta',
        model: 'gemini-test',
        feature: 'ask',
        mode: 'lexical',
        sources: [{ id: 'project:urbancare-ai#solution', label: 'UrbanCare AI · Solution', cls: 'self', target: { kind: 'project', slug: 'urbancare-ai' } }],
      },
      { type: 'delta', text: 'Every layer of the pipeline can be inspected through its Semantics-to-Vector interface [c:project:urbancare-ai#solution].' },
      { type: 'done', finishReason: 'STOP', cited: ['project:urbancare-ai#solution'], dropped: 0, degraded: false },
    ];
    await mockAiStream(page, '/api/ai/ask', frames);
    const ai = countAiPosts(page);
    const errors = collectPageErrors(page);
    await page.goto('/projects/urbancare-ai');
    const island = page.locator('[data-inline-ask]');
    await expect(island).toBeVisible({ timeout: 20_000 });
    await island.scrollIntoViewIfNeeded();
    expect(ai(), 'no AI request on load').toBe(0);

    const request = page.waitForRequest((r) => r.url().endsWith('/api/ai/ask') && r.method() === 'POST');
    await island.getByRole('button', { name: 'How is UrbanCare AI built?' }).click();
    const body = (await request).postDataJSON() as { question: string; scope: unknown };
    expect(body).toEqual({ question: 'How is UrbanCare AI built?', scope: { project: 'urbancare-ai' } });

    const answer = island.locator('[data-inline-answer="done"]');
    await expect(answer).toContainText('Semantics-to-Vector interface');
    await expect(answer.locator('[data-ai-sources] [data-cite-id="project:urbancare-ai#solution"]')).toBeVisible();
    await expect(answer.locator('[data-ai-disclosure]')).toContainText('AI-generated · may be wrong');
    if (width(info) === 320) await expectNoHorizontalOverflow(page);
    expect(errors.errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });

  test('InlineAsk falls back to the write-up and a link to the full assistant', async ({ page }) => {
    await mockAiFallback(page, 'quota');
    await page.goto('/projects/urbancare-ai');
    const island = page.locator('[data-inline-ask]');
    await expect(island).toBeVisible({ timeout: 20_000 });
    await island.getByRole('button', { name: 'What problem does UrbanCare AI solve?' }).click();
    await expect(island.locator('[data-ai-error="quota"]')).toBeVisible();
    await expect(island.locator('[data-quick-answer]')).toContainText(URBANCARE.problem!);
    await expect(island.locator('[data-quick-answer] [data-source="rules"]')).toBeVisible();
    await expect(island.getByRole('link', { name: 'Ask the full assistant on the home page' }).first()).toHaveAttribute('href', '/');
  });
});

/* ---------------- #202 natural-language filters ---------------- */

test.describe('natural-language filters (#202)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('Enter (never a keystroke) applies exactly ?cat, ?tech and ?live, and Back restores the previous filters', async ({ page }) => {
    await skipIntro(page);
    await mockAiJson(page, '/api/ai/project-filters', { mode: 'model', model: 'gemini-test', reading: { cat: 'AI/ML', tech: 'Gemini', live: true, q: null } });
    const ai = countAiPosts(page);
    await gotoProjects(page, '?cat=Data+Science');
    const search = page.locator('#projects input[type="search"]');
    await search.fill('live AI projects using Gemini');
    await expect(page.locator('[data-ai-filter-hint]')).toBeVisible();
    await page.waitForTimeout(400);
    expect(ai(), 'typing sends nothing').toBe(0);

    await search.press('Enter');
    await expect.poll(() => params(page).get('tech')).toBe('Gemini');
    const p = params(page);
    expect([p.get('cat'), p.get('tech'), p.get('live'), p.get('q')]).toEqual(['AI/ML', 'Gemini', '1', null]);
    expect(ai()).toBe(1);
    const expected = projects.filter((x) => x.category === 'AI/ML' && x.liveUrl && matchesTech(x.techStack, 'Gemini'));
    await expect(cards(page)).toHaveCount(expected.length);
    const chips = page.locator('[data-ai-understood]');
    await expect(chips).toContainText('live AI projects using Gemini');
    await expect(chips.locator('[data-understood]')).toHaveCount(3);

    await page.goBack();
    await expect.poll(() => params(page).get('tech')).toBeNull();
    expect(params(page).get('cat')).toBe('Data Science');
    expect(params(page).get('live')).toBeNull();
    await expect(chips).toHaveCount(0);
  });

  test('a technology the site does not list is dropped, and removing a chip removes its filter', async ({ page }) => {
    await skipIntro(page);
    await mockAiJson(page, '/api/ai/project-filters', { mode: 'model', model: 'gemini-test', reading: { cat: 'AI/ML', tech: 'Kubernetes', live: true, q: null } });
    await gotoProjects(page);
    const search = page.locator('#projects input[type="search"]');
    await search.fill('live ai on kubernetes');
    await search.press('Enter');
    await expect.poll(() => params(page).get('cat')).toBe('AI/ML');
    expect(params(page).get('tech')).toBeNull();
    await page.locator('[data-understood="live"]').click();
    await expect.poll(() => params(page).get('live')).toBeNull();
    expect(params(page).get('cat')).toBe('AI/ML');
  });

  test('when the model is unavailable the phrase stays a text search', async ({ page }) => {
    await skipIntro(page);
    await mockAiFallback(page, 'quota');
    await gotoProjects(page);
    const search = page.locator('#projects input[type="search"]');
    await search.fill('clinical agents');
    await search.press('Enter');
    await expect(page.locator('[data-ai-filter-note]')).toContainText('text search');
    // urlState throttles ?q writes by 250ms, so the note can show before the URL has it.
    await expect.poll(() => params(page).get('q')).toBe('clinical agents');
    expect(params(page).get('cat')).toBeNull();
  });
});

/* ---------------- #203 related work ---------------- */

test.describe('related work for an empty grid (#203)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('mocked hits render three cards captioned with their own taglines, and no URL param is added', async ({ page }) => {
    await skipIntro(page);
    const slugs = ['urbancare-ai', 'omni-lab', 'vyapar-gyan'];
    await mockAiJson(page, '/api/ai/retrieve', {
      mode: 'hybrid',
      hits: slugs.map((slug, i) => ({ id: `project:${slug}#summary`, label: slug, target: { kind: 'project', slug }, score: 1 - i / 10, cosine: 0.8, bm25: 0.5 })),
    });
    await gotoProjects(page);
    await page.locator('#projects input[type="search"]').fill('zzzz-no-such-project');
    const empty = page.locator('[data-projects-empty]');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    // The typed ?q lands after urlState's 250ms throttle; read the URL once it has.
    await expect.poll(() => params(page).get('q')).toBe('zzzz-no-such-project');
    const before = new URL(page.url()).search;
    await empty.getByRole('button', { name: 'Find related work with AI' }).click();
    const related = empty.locator('[data-related-slug]');
    await expect(related).toHaveCount(3);
    for (const slug of slugs) await expect(empty.locator(`[data-related-slug="${slug}"]`)).toContainText(bySlug(slug).tagline);
    await expect(empty.locator('[data-ai-disclosure]')).toBeVisible();
    expect(new URL(page.url()).search).toBe(before);
    await expectNoHorizontalOverflow(page);
  });

  test('with no model (lexical retrieval) related work still renders', async ({ page }) => {
    await skipIntro(page);
    await gotoProjects(page);
    // No single project has both words, so the grid is empty, but BM25 finds each.
    await page.locator('#projects input[type="search"]').fill('clinical forecasting');
    const empty = page.locator('[data-projects-empty]');
    await expect(empty).toBeVisible();
    await empty.getByRole('button', { name: 'Find related work with AI' }).click();
    await expect(empty.locator('[data-related-slug]').first()).toBeVisible();
    await expect(empty.locator('[data-source="rules"]')).toBeVisible();
  });
});

/* ---------------- #204 neighbours and interest chips ---------------- */

test.describe('semantic neighbours and interest chips (#204)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('without vectors both are hidden', async ({ page }) => {
    await skipIntro(page);
    await injectStore(page, fixtureStore());
    await gotoProjects(page);
    // Nothing on the grid depends on this store without vectors: give its chunk time to load.
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-ai-interests]')).toHaveCount(0);
    await openProject(page, 'urbancare-ai');
    await expect(dialog(page).locator('[data-ai-levels]')).toBeVisible();
    await expect(dialog(page).locator('[data-section="related"]')).toBeVisible();
    await expect(dialog(page).locator('[data-neighbour-score]')).toHaveCount(0);
  });

  test('with fixtures, scores show to two decimals and a chip reorders the grid with no request', async ({ page }) => {
    await skipIntro(page);
    await injectStore(page, fixtureStore({ vectors: true }));
    await openProject(page, 'urbancare-ai');
    const scores = dialog(page).locator('[data-ai-neighbours] [data-neighbour-score]');
    await expect(scores).toHaveCount(3);
    await expect(scores.first()).toHaveText(/^shared tech: \d+ · semantic: 0\.82$/);

    await page.goto('/#projects');
    await page.locator('#projects').scrollIntoViewIfNeeded();
    const chips = page.locator('[data-ai-interests]');
    await expect(chips).toBeVisible();
    const ai = countAiPosts(page);
    await chips.getByRole('button', { name: 'Agents' }).click();
    await expect(chips.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page).first()).toHaveAttribute('data-project-card', INTEREST_ORDER[0]);
    const order = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-project-card')));
    expect(order.slice(0, INTEREST_ORDER.length)).toEqual(INTEREST_ORDER);
    expect(order).toHaveLength(projects.length);
    await chips.getByRole('button', { name: 'Agents' }).click();
    await expect(chips.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-pressed', 'false');
    expect(ai()).toBe(0);
  });
});

/* ---------------- #205 compare ---------------- */

test.describe('compare two projects (#205)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('a pair renders an accessible table; a non-verbatim cell reads Not listed', async ({ page, context }, info) => {
    await injectStore(page, fixtureStore());
    const ai = countAiPosts(page);
    await openProject(page, 'urbancare-ai');
    const compare = dialog(page).locator('[data-ai-compare]');
    await compare.scrollIntoViewIfNeeded();
    await compare.getByLabel('Compare with').selectOption('bruhworking-nexusflow');
    const table = compare.locator('table');
    await expect(table.locator('caption')).toHaveText('UrbanCare AI compared with Bruhworking — NexusFlow');
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(3);
    expect(await table.locator('tbody th').count()).toBe(await table.locator('tbody th[scope="row"]').count());
    const goal = table.locator('[data-compare-ai-row="goal"]');
    await expect(goal).toContainText('AI-Native Clinical Ecosystem for Mechanistic Interpretability');
    await expect(goal).toContainText('Serverless Agent Swarm for Stateful Orchestration');
    const approach = table.locator('[data-compare-ai-row="approach"] td');
    await expect(approach.nth(0)).toContainText('A Semantics-to-Vector interface');
    await expect(approach.nth(1)).toHaveText('Not listed');
    await expect(compare.locator('[data-ai-disclosure]')).toBeVisible();
    if (width(info) === 320) await expectNoHorizontalOverflow(page);
    if (once(info)) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await compare.getByRole('button', { name: 'Copy as Markdown' }).click();
      const md = await page.evaluate(() => navigator.clipboard.readText());
      expect(md).toContain('**UrbanCare AI compared with Bruhworking — NexusFlow**');
      expect(md).toContain('| A notable detail (AI-picked quote) | Not listed | Not listed |');
    }
    expect(ai()).toBe(0);
  });

  test('every one of the 45 pairs renders with no request', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    test.setTimeout(180_000);
    const ai = countAiPosts(page);
    for (let i = 0; i < projects.length - 1; i++) {
      await openProject(page, projects[i].slug);
      const compare = dialog(page).locator('[data-ai-compare]');
      for (let j = i + 1; j < projects.length; j++) {
        await compare.getByLabel('Compare with').selectOption(projects[j].slug);
        await expect(compare.locator('table caption')).toHaveText(`${projects[i].name} compared with ${projects[j].name}`);
      }
    }
    expect(ai()).toBe(0);
  });
});

/* ---------------- #206 questions to ask ---------------- */

test.describe('questions to ask (#206)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  test('a native disclosure; Copy all copies every question', async ({ page, context }, info) => {
    await injectStore(page, fixtureStore());
    await openProject(page, 'urbancare-ai');
    const details = dialog(page).locator('[data-ai-questions]');
    await details.scrollIntoViewIfNeeded();
    expect(await details.evaluate((el) => el.tagName)).toBe('DETAILS');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.locator('[data-question]')).toHaveCount(3);
    await expect(details.locator('[data-ai-provenance]')).toHaveText(PROVENANCE.site);
    if (once(info)) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await details.getByRole('button', { name: 'Copy all' }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      for (const q of QUESTIONS) expect(copied).toContain(q.text);
    }
  });

  test('a question with an unverified premise is dropped (and fewer than three hide the list)', async ({ page }) => {
    await injectStore(page, fixtureStore({ badQuestion: true }));
    await openProject(page, 'urbancare-ai');
    await expect(dialog(page).locator('[data-ai-levels]')).toBeVisible();
    await expect(dialog(page).locator('[data-ai-questions]')).toHaveCount(0);
    await expect(dialog(page)).not.toContainText('1M users');
  });

  test('on the static page the list works without JavaScript', async ({ browser }, info) => {
    test.skip(!once(info), 'one project is enough');
    const store = JSON.parse(readFileSync(new URL('../../src/data/ai-generated/projects.json', import.meta.url), 'utf8')) as { entries: Record<string, unknown> };
    const withQuestions = projects.find((p) => p.featured && p.problem && p.solution && store.entries[`questions:${p.slug}`]);
    test.skip(!withQuestions, 'the committed store has no questions for a case-study project yet (run gen-projects.mjs)');
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(`/projects/${withQuestions!.slug}`);
    const details = page.locator('[data-ai-questions]');
    await expect(details).toBeAttached();
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('[data-question]').first()).toBeVisible();
    await ctx.close();
  });
});

/* ---------------- #207 alt text ---------------- */

test.describe('alt text and demo descriptions (#207)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), '320px reduced motion, and one desktop');
    await assertSafeServer(request);
  });

  const heroImg = (page: Page) => dialog(page).locator('[data-case-study] header [data-project-media] img').first();

  test('an unreviewed alt in a production-flag render leaves the alt unchanged', async ({ page }) => {
    await injectStore(page, fixtureStore(), false);
    await openProject(page, 'urbancare-ai');
    await expect(dialog(page).locator('[data-ai-questions]')).toBeVisible();
    await expect(heroImg(page)).toHaveAttribute('alt', 'UrbanCare AI cover');
    await expect(heroImg(page)).not.toHaveAttribute('data-alt-source', 'ai');
  });

  test('a reviewed alt replaces it, under 125 characters', async ({ page }) => {
    await injectStore(page, fixtureStore({ reviewedAlt: true }), false);
    await openProject(page, 'urbancare-ai');
    await expect(heroImg(page)).toHaveAttribute('alt', REVIEWED_ALT);
    expect(REVIEWED_ALT.length).toBeLessThan(125);
  });

  test("'Describe this demo' appears only for a project with a demo loop", async ({ page }, info) => {
    await injectStore(page, fixtureStore());
    await openProject(page, 'urbancare-ai');
    await expect(dialog(page).locator('[data-ai-levels]')).toBeVisible();
    await expect(dialog(page).locator('[data-ai-demo]')).toHaveCount(0);

    await openProject(page, TCS.slug);
    const demo = dialog(page).locator('[data-ai-demo]');
    await expect(demo).toBeAttached();
    const button = demo.getByRole('button', { name: 'Describe this demo' });
    // Loops are off under reduced motion, so the control is on screen; while a loop plays it is for screen readers and keyboard focus.
    if (reduced(info)) await expect(button).toBeVisible();
    await button.focus();
    await button.press('Enter');
    await expect(demo).toContainText('forecast line');
    await expect(demo.getByRole('button', { name: 'Hide the demo description' })).toHaveAttribute('aria-expanded', 'true');
  });
});
