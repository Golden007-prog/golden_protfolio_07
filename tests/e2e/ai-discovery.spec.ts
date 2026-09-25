import type { Locator, Page, Request, TestInfo } from '@playwright/test';
import discovery from '../../src/data/ai-generated/discovery.json' with { type: 'json' };
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import { defaultStops, normalizeStops, type GoalPresetId } from '../../src/lib/ai/tour';
import { aiPost, assertSafeServer, countAiRequests, mockAiFallback, mockAiJson, mockAiStream } from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * AI discovery (#192-#199): the palette's Ask AI row and 'By meaning' group, the
 * mobile menu's AI rows, the assistant hotkeys, the guided tour, the section
 * tools and the smart 404. Every model route is mocked in the browser; anything
 * that reaches the server runs against the fake model (assertSafeServer).
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isDark = (info: TestInfo) => projectUse(info).colorScheme !== 'light';
const desktopKeys = (info: TestInfo) => width(info) >= 1024 && !isTouch(info);
/** API-level checks: one project. */
const primary = (info: TestInfo) => width(info) === 1440 && isDark(info) && !isReduced(info);
/** The 320px projects under reduced motion, where the tour and tools must hold up. */
const smallReduced = (info: TestInfo) => width(info) === 320 && isReduced(info);

const CATALOG = { slugs: projects.map((p) => p.slug), expCount: profile.experience.length };
const FEATURED = projects.filter((p) => p.featured).map((p) => p.slug);
type StoreEntry = { value?: { stops?: unknown } };
const ENTRIES = (discovery as { entries: Record<string, StoreEntry> }).entries;

/** The stops a goal chip plays: the precomputed order when valid, else the built-in one (as GuidedTour does). */
function chipStops(id: GoalPresetId): string[] {
  return normalizeStops(ENTRIES[`tour:${id}`]?.value?.stops, CATALOG) ?? defaultStops(id, CATALOG, FEATURED);
}

/* ---------------- helpers ---------------- */

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

/** Records every ask:open and fit:open request the bus fires. */
async function recordBus(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __bus?: { ask: unknown[]; fit: unknown[] } };
    w.__bus = { ask: [], fit: [] };
    window.addEventListener('ob:ask:open', (e) => w.__bus!.ask.push((e as CustomEvent).detail));
    window.addEventListener('ob:fit:open', (e) => w.__bus!.fit.push((e as CustomEvent).detail));
  });
}

const busOf = (page: Page) => page.evaluate(() => (window as Window & { __bus?: { ask: unknown[]; fit: unknown[] } }).__bus ?? { ask: [], fit: [] });

async function home(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
}

async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: /Search sections/ });
  await expect(input).toBeFocused({ timeout: 10_000 });
  return input;
}

/** POSTs to one AI route, with their JSON bodies. */
function recordPosts(page: Page, route: string): () => unknown[] {
  const bodies: unknown[] = [];
  page.on('request', (req: Request) => {
    if (req.method() !== 'POST' || new URL(req.url()).pathname !== `/api/ai/${route}`) return;
    try {
      bodies.push(req.postDataJSON());
    } catch {
      bodies.push(null);
    }
  });
  return () => bodies;
}

/** The combobox pattern: aria-controls is a listbox of groups of options, the active descendant is a selected option in it, and nothing interactive sits inside. */
async function expectValidCombobox(page: Page) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const input = document.querySelector('[data-command-palette] [role="combobox"]');
    if (!input) return ['no combobox'];
    const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
    if (!list || list.getAttribute('role') !== 'listbox') return ['aria-controls does not name a listbox'];
    const active = input.getAttribute('aria-activedescendant');
    if (active) {
      const opt = document.getElementById(active);
      if (!opt || opt.getAttribute('role') !== 'option' || !list.contains(opt)) out.push('aria-activedescendant is not an option of the listbox');
      else if (opt.getAttribute('aria-selected') !== 'true') out.push('the active option is not aria-selected');
    } else if (list.querySelector('[role="option"]')) {
      out.push('options but no aria-activedescendant');
    }
    list.querySelectorAll('button, a[href], input, textarea, select').forEach((el) => out.push(`interactive <${el.tagName.toLowerCase()}> inside the listbox`));
    Array.from(list.children).forEach((c) => {
      if (c.getAttribute('role') !== 'group') out.push('a listbox child that is not a group');
    });
    list.querySelectorAll('[role="group"] > *').forEach((c) => {
      if (c.getAttribute('role') !== 'option' && c.getAttribute('aria-hidden') !== 'true') out.push('a group child that is neither an option nor hidden');
    });
    const ids = Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.id);
    if (new Set(ids).size !== ids.length) out.push('duplicate option ids');
    return out;
  });
  expect(problems).toEqual([]);
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box | null, b: Box | null) =>
  Boolean(a && b && a.width > 0 && b.width > 0 && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5);

const topOf = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().top ?? NaN, sel);

const OMNI_HIT = {
  mode: 'hybrid',
  hits: [{ id: 'project:omni-lab#summary', label: 'Omni-Lab', target: { kind: 'project', slug: 'omni-lab' }, score: 0.032, cosine: 0.82, bm25: 0.4 }],
};

test.beforeEach(async ({ page, request }) => {
  await assertSafeServer(request);
  await skipIntro(page);
  await recordBus(page);
});

/* ---------------- #192 Ask AI row ---------------- */

test.describe('palette Ask AI row (#192)', () => {
  test("mod+k, 'agents that plan', Ask AI: the assistant opens with the question sent; the combobox stays valid", async ({ page }, info) => {
    test.skip(!(width(info) === 1440 || width(info) === 320), 'desktop and the smallest phone');
    const { errors } = collectPageErrors(page);
    await mockAiJson(page, 'retrieve', { mode: 'lexical', hits: [] });
    await mockAiStream(page, 'ask', [
      { type: 'meta', model: 'gemini-test', feature: 'ask', sources: [], mode: 'lexical' },
      { type: 'delta', text: 'The site does not say.' },
      { type: 'done', finishReason: 'STOP', cited: [], dropped: 0, degraded: false },
    ]);
    await home(page);
    const input = await openPalette(page);
    await input.fill('agents that plan');
    const ask = page.getByRole('option', { name: /Ask AI: “agents that plan”/ });
    await expect(ask).toBeVisible();
    await expectValidCombobox(page);
    // Moving onto the row keeps the pattern valid too.
    await ask.hover();
    await expectValidCombobox(page);
    await ask.click();

    await expect(page.locator('[data-command-palette]')).toHaveCount(0);
    await expect.poll(async () => (await busOf(page)).ask).toEqual([{ question: 'agents that plan', send: true }]);

    // The rest belongs to AskMeBot (ai-concierge #182): its panel shows the sent question.
    const panel = page.locator('[data-ask-panel], [data-ask-sheet]').first();
    const opened = await panel.waitFor({ state: 'visible', timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    test.skip(!opened, 'AskMeBot does not consume ask:open yet (ai-concierge #182)');
    await expect(panel).toContainText('agents that plan', { timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test('with no match, the empty state offers Ask AI as the one option, still inside a valid listbox', async ({ page }, info) => {
    test.skip(!desktopKeys(info) && width(info) !== 320, 'keyboard projects and 320');
    await mockAiJson(page, 'retrieve', { mode: 'lexical', hits: [] });
    await home(page);
    const input = await openPalette(page);
    await input.fill('qzx zzv');
    await expect(page.locator('[data-palette-empty]')).toBeVisible();
    await expect(page.locator('[data-palette-empty]')).toContainText('No matches for “qzx zzv”');
    const options = page.getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute('data-item-id', 'action:ask-ai');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expectValidCombobox(page);
  });
});

/* ---------------- #193 By meaning ---------------- */

test.describe("palette 'By meaning' group (#193)", () => {
  test('typing quickly sends one request per settled query; a hit shows its score; a repeat is cached', async ({ page }, info) => {
    test.skip(!desktopKeys(info) && width(info) !== 320, 'keyboard projects and 320');
    await mockAiJson(page, 'retrieve', OMNI_HIT);
    const posts = recordPosts(page, 'retrieve');
    await home(page);
    const input = await openPalette(page);

    // 30ms between keys: nothing settles until the last one.
    await input.pressSequentially('qzx tutoring', { delay: 30 });
    const group = page.locator('[data-palette-group="By meaning"]');
    await expect(group).toBeVisible();
    await page.waitForTimeout(500);
    const queries = posts().map((b) => (b as { query?: string }).query);
    // Never twice for one settled query, and the whole query was the one asked.
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.at(-1)).toBe('qzx tutoring');
    expect(queries.length, `requests while typing: ${queries.join(' | ')}`).toBeLessThanOrEqual(2);
    expect(posts().at(-1)).toEqual({ query: 'qzx tutoring', k: 6, scope: 'all' });
    const sent = posts().length;

    const omni = group.locator('[role="option"][data-item-id="project:omni-lab"]');
    await expect(omni).toBeVisible();
    await expect(omni.locator('[data-semantic-score]')).toHaveAttribute('data-semantic-score', '0.82');
    await expect(omni).toContainText('Omni-Lab');
    await expectValidCombobox(page);

    // The same query again is answered from memory.
    await input.fill('');
    await input.fill('qzx tutoring');
    await expect(group).toBeVisible();
    await page.waitForTimeout(700);
    expect(posts()).toHaveLength(sent);

    // A different settled query is one more request.
    await input.fill('hospital triage');
    await expect.poll(() => posts().length).toBe(sent + 1);
    await page.waitForTimeout(600);
    expect(posts()).toHaveLength(sent + 1);
  });

  test('a fallback omits the group and leaves the lexical results as they were', async ({ page }, info) => {
    test.skip(!desktopKeys(info) && width(info) !== 320, 'keyboard projects and 320');
    await mockAiFallback(page, 'upstream');
    const posts = recordPosts(page, 'retrieve');
    await home(page);
    const input = await openPalette(page);
    await input.fill('tutor');
    const before = await page.getByRole('option').allTextContents();
    expect(before.some((t) => t.includes('Content Storyteller'))).toBe(true);
    await expect.poll(() => posts().length).toBe(1);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-palette-group="By meaning"]')).toHaveCount(0);
    expect(await page.getByRole('option').allTextContents()).toEqual(before);
    await expectValidCombobox(page);
  });

  test('Enter on a vague query searches by meaning at once instead of waiting', async ({ page }, info) => {
    test.skip(!desktopKeys(info), 'keyboard projects');
    await mockAiJson(page, 'retrieve', OMNI_HIT);
    const posts = recordPosts(page, 'retrieve');
    await home(page);
    const input = await openPalette(page);
    await input.fill('hospital triage');
    await input.press('Enter');
    await expect(page.locator('[data-palette-group="By meaning"]')).toBeVisible();
    await expect(page.locator('[data-command-palette]')).toBeVisible();
    await page.waitForTimeout(600);
    expect(posts()).toHaveLength(1);
    // The next Enter opens the top match.
    await input.press('Enter');
    await expect(page.locator('[data-command-palette]')).toHaveCount(0);
  });
});

/* ---------------- #194 mobile menu ---------------- */

test.describe('mobile menu AI rows (#194)', () => {
  test("both rows are 44px; the fit row scrolls to About and opens the fit check", async ({ page }, info) => {
    test.skip(width(info) >= 768, 'phone widths only');
    await mockAiFallback(page, 'no-key');
    await home(page);
    await page.locator('#site-nav').getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Site menu' });
    await expect(menu).toBeVisible();
    const ask = menu.locator('[data-mobile-ask]');
    const fit = menu.locator('[data-mobile-fit]');
    await expect(ask).toHaveText(/Ask AI/);
    await expect(fit).toHaveText(/For recruiters: check job fit/);
    // Measured once the menu's entrance scale has settled (mid-animation a 44px row reads 43.99998).
    for (const row of [ask, fit]) {
      await expect.poll(async () => (await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((await row.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    await fit.click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await busOf(page)).fit).toEqual([{}]);
    await expect.poll(() => topOf(page, '#about'), { timeout: 5000 }).toBeLessThan(200);

    // The sheet itself belongs to FitCheckTrigger (ai-recruiter #213), which drains the pending slot.
    const textarea = page.locator('[role="dialog"] textarea').first();
    const opened = await textarea.waitFor({ state: 'visible', timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    test.skip(!opened, 'FitCheckTrigger does not consume fit:open yet (ai-recruiter #213)');
    await expect(textarea).toBeFocused();
  });

  test('the Ask AI row closes the menu and asks the bus for the assistant', async ({ page }, info) => {
    test.skip(width(info) >= 768, 'phone widths only');
    await home(page);
    await page.locator('#site-nav').getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Site menu' });
    await menu.locator('[data-mobile-ask]').click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await busOf(page)).ask).toEqual([{}]);
  });
});

/* ---------------- #195 hotkeys ---------------- */

test.describe('assistant hotkeys (#195)', () => {
  test("'a' opens the assistant, and the shortcuts dialog lists both keys", async ({ page }, info) => {
    test.skip(!desktopKeys(info), 'keyboard projects');
    await home(page);
    await page.keyboard.press('a');
    await expect.poll(async () => (await busOf(page)).ask).toEqual([{}]);

    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.keyboard.press('Shift+Slash');
    const dialog = page.locator('[data-shortcuts]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Ask the AI assistant')).toHaveCount(2);
    await expect(dialog).toContainText('J');
  });

  test('with single-key shortcuts off, only mod+j opens the assistant', async ({ page }, info) => {
    test.skip(!desktopKeys(info), 'keyboard projects');
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('ob-keys', 'off');
      } catch {
        /* storage blocked */
      }
    });
    await home(page);
    await page.keyboard.press('a');
    await page.waitForTimeout(400);
    expect((await busOf(page)).ask).toEqual([]);
    await page.keyboard.press('ControlOrMeta+j');
    await expect.poll(async () => (await busOf(page)).ask).toEqual([{}]);
  });

  test("typing 'a' in a field does nothing", async ({ page }, info) => {
    test.skip(!desktopKeys(info), 'keyboard projects');
    await home(page);
    const field = page.locator('#contact input:not([type="hidden"]):not([name="_honey"])').first();
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await page.keyboard.type('a');
    await expect(field).toHaveValue(/a/);
    await page.waitForTimeout(300);
    expect((await busOf(page)).ask).toEqual([]);
  });
});

/* ---------------- #196 guided tour ---------------- */

async function openTourPicker(page: Page) {
  await openPalette(page);
  // Chosen from the list, not typed: typing would search by meaning, and a chip tour makes no request.
  await page.getByRole('option', { name: /Show me around/ }).click();
  const picker = page.locator('[data-tour-picker]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  return picker;
}

async function pillBox(page: Page) {
  return page.locator('[data-tour-pill]').boundingBox();
}

test.describe('guided tour (#196)', () => {
  test('a chip tour at 320px makes no request, starts below the hero, clears the dock and a toast, jumps with Next and ends on Esc', async ({ page }, info) => {
    test.skip(!smallReduced(info) && !primary(info), '320 under reduced motion, and desktop');
    const { errors } = collectPageErrors(page);
    const aiRequests = countAiRequests(page);
    await home(page);
    await expect(page.locator('[data-dock]')).toHaveCount(1, { timeout: 15_000 });

    await openTourPicker(page);
    const stops = chipStops('quick-look');
    await page.locator('[data-tour-goal="quick-look"]').click();
    const pill = page.locator('[data-tour-pill]');
    await expect(pill).toBeVisible();
    await expect(pill.locator('[data-tour-count]')).toHaveText(`Stop 1 of ${stops.length}`);
    await expect(pill.getByRole('button', { name: /Next/ })).toBeFocused();

    // Below the hero from the first stop.
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(200);
    const lift = await page.evaluate(() => document.documentElement.style.getPropertyValue('--ai-lift'));
    expect(parseFloat(lift)).toBeGreaterThan(40);

    // Clear of the dock.
    const box = await pillBox(page);
    for (const sel of ['[data-dock]', '[data-dock] .dock-inner']) {
      const dock = await page.locator(sel).first().boundingBox();
      expect(overlaps(box, dock), `${sel} overlaps the tour pill`).toBe(false);
    }
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width(info) + 0.5).toBe(true);

    // The chip tour itself has made no request. (Typing into the palette below may,
    // by design: a query that settles for 400ms with few matches also searches by meaning.)
    expect(aiRequests()).toBe(0);

    // A toast lands above the pill, never on it.
    const input = await openPalette(page);
    await input.fill('copy email');
    await input.press('Enter');
    const toast = page.locator('[data-toast-region] [data-toast]').first();
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    const afterToast = await pillBox(page);
    expect(overlaps(toastBox, afterToast), 'a toast overlaps the tour pill').toBe(false);
    expect((toastBox?.y ?? 0) + (toastBox?.height ?? 0)).toBeLessThanOrEqual((afterToast?.y ?? 0) + 0.5);

    // Next moves on (a jump under reduced motion); Esc ends the tour and drops the lift.
    const beforeStops = aiRequests();
    await pill.getByRole('button', { name: /Next/ }).click();
    await expect(pill.locator('[data-tour-count]')).toHaveText(`Stop 2 of ${stops.length}`);
    await expect(pill.locator('[data-tour-title]')).not.toHaveText('');
    await page.keyboard.press('Escape');
    await expect(pill).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ai-lift'))).toBe('');

    expect(aiRequests(), 'moving through the tour sends nothing').toBe(beforeStops);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('a typed goal plans with one request, and each stop line comes from the data', async ({ page }, info) => {
    test.skip(!smallReduced(info) && !primary(info), '320 under reduced motion, and desktop');
    await mockAiJson(page, 'tour', { stops: ['section:experience', 'project:omni-lab', 'exp:1', 'section:contact'], model: 'gemini-test' });
    const posts = recordPosts(page, 'tour');
    await home(page);
    const picker = await openTourPicker(page);
    await picker.getByLabel(/Or say what you/).fill('hiring for an agents role');
    await expect(picker.locator('[data-ai-disclosure]')).toBeVisible();
    await picker.getByRole('button', { name: /Plan my tour/ }).click();

    const pill = page.locator('[data-tour-pill]');
    await expect(pill.locator('[data-tour-count]')).toHaveText('Stop 1 of 4');
    await expect(pill.locator('[data-tour-title]')).toHaveText('Experience');
    await expect(pill.locator('[data-source="ai"]')).toBeVisible();
    await pill.getByRole('button', { name: /Next/ }).click();
    await expect(pill.locator('[data-tour-title]')).toHaveText('Omni-Lab');
    await expect(pill).toContainText(projects.find((p) => p.slug === 'omni-lab')!.tagline);
    await pill.getByRole('button', { name: /Next/ }).click();
    await expect(pill.locator('[data-tour-title]')).toHaveText(profile.experience[1].role);
    await expect(pill).toContainText(profile.experience[1].company);
    await pill.getByRole('button', { name: /Next/ }).click();
    await expect(pill.getByRole('button', { name: /Finish/ })).toBeVisible();
    await pill.getByRole('button', { name: /Finish/ }).click();
    await expect(pill).toHaveCount(0);

    expect(posts()).toEqual([{ goal: 'hiring for an agents role' }]);
    await expectNoHorizontalOverflow(page);
  });

  test('when planning falls back, the closest chip runs and the pill says so', async ({ page }, info) => {
    test.skip(!smallReduced(info) && !primary(info), '320 under reduced motion, and desktop');
    await mockAiFallback(page, 'quota');
    await home(page);
    const picker = await openTourPicker(page);
    await picker.getByLabel(/Or say what you/).fill('we are hiring an ML engineer');
    await picker.getByRole('button', { name: /Plan my tour/ }).click();
    const pill = page.locator('[data-tour-pill]');
    await expect(pill.locator('[data-tour-count]')).toHaveText(`Stop 1 of ${chipStops('hiring-ml').length}`);
    await expect(pill.locator('[data-tour-note]')).toContainText('Hiring for ML');
  });
});

/* ---------------- #197 section tools ---------------- */

test.describe('section tools (#197)', () => {
  test('translations make no request; Bengali carries lang="bn"; Show original returns to English; the sheet fits 320px', async ({ page }, info) => {
    test.skip(!smallReduced(info) && !primary(info), '320 under reduced motion, and desktop');
    const aiRequests = countAiRequests(page);
    await home(page);
    await openPalette(page);
    await page.getByRole('option', { name: /Read this section in/ }).click();
    const tools = page.locator('[data-section-tools]');
    await expect(tools).toBeVisible({ timeout: 10_000 });

    await tools.locator('[data-tool-mode="bn"]').click();
    const text = tools.locator('[data-section-tool-text]');
    await expect(text).toHaveAttribute('lang', 'bn');
    await expect(tools.locator('[data-tool-note]')).toContainText('Machine-translated');
    await expect(tools.locator('[data-ai-disclosure]')).toBeVisible();
    await tools.locator('[data-tool-original]').click();
    await expect(text).toHaveAttribute('lang', 'en');

    for (const section of ['about', 'experience', 'philosophy', 'contact']) {
      await tools.locator(`[data-tool-section="${section}"]`).click();
      await tools.locator('[data-tool-mode="hi"]').click();
      await expect(text).toHaveAttribute('lang', 'hi');
    }

    const panel = await page.locator('[role="dialog"]').filter({ has: tools }).boundingBox();
    expect(panel && panel.x >= -0.5 && panel.x + panel.width <= width(info) + 0.5).toBe(true);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(tools).toHaveCount(0);
    expect(aiRequests()).toBe(0);
  });

  test("'Explain this section simply' shows the plain-English version with its note", async ({ page }, info) => {
    test.skip(!smallReduced(info) && !primary(info), '320 under reduced motion, and desktop');
    await home(page);
    await openPalette(page);
    await page.getByRole('option', { name: /Explain this section simply/ }).click();
    const tools = page.locator('[data-section-tools]');
    await expect(tools).toHaveAttribute('data-mode', 'simple', { timeout: 10_000 });
    await expect(tools.locator('[data-section-tool-text]')).toHaveAttribute('lang', 'en');
    await expect(tools.locator('[data-tool-note]')).toContainText('Simplified by AI');
    // An AI rewrite describes him; it never speaks as him.
    await expect(tools.locator('[data-section-tool-text]')).not.toContainText(/\bI am\b/);
  });
});

/* ---------------- #198 404 ---------------- */

test.describe('smart 404 (#198)', () => {
  test("/projects/urbancare offers /projects/urbancare-ai with no request; 'Find it' makes exactly one", async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'desktop and the smallest phone');
    await mockAiJson(page, 'retrieve', {
      mode: 'lexical',
      hits: [
        { id: 'project:urbancare-ai#summary', label: 'UrbanCare AI', target: { kind: 'project', slug: 'urbancare-ai' }, score: 1, cosine: null, bm25: 1 },
        { id: 'exp:1', label: `${profile.experience[1].company} · ${profile.experience[1].role}`, target: { kind: 'experience', index: 1 }, score: 0.5, cosine: null, bm25: 0.5 },
      ],
    });
    const aiRequests = countAiRequests(page);
    const posts = recordPosts(page, 'retrieve');
    const res = await page.goto('/projects/urbancare');
    expect(res?.status()).toBe(404);
    const island = page.locator('[data-not-found-suggest]');
    await expect(island).toContainText('Looking for something?');
    await expect(island.locator('[data-requested-path]')).toHaveText('/projects/urbancare');
    await expect(island.locator('[data-suggestions] a[href="/projects/urbancare-ai"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(aiRequests()).toBe(0);

    const find = island.locator('[data-find-it]');
    await find.click();
    await expect(island.locator('[data-found] a[href="/#experience"]')).toBeVisible();
    // The case study was already suggested, so it is not listed twice.
    await expect(island.locator('[data-found] a[href="/projects/urbancare-ai"]')).toHaveCount(0);
    await expect(find).toBeDisabled();
    await find.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    expect(posts()).toEqual([{ query: 'projects urbancare', k: 5, scope: 'all' }]);
    await expectNoHorizontalOverflow(page);
  });

  test("'Find it' against the real (fake-model) server lists site pages", async ({ page }, info) => {
    test.skip(!primary(info), 'one project');
    await page.goto('/projects/urbancare');
    const island = page.locator('[data-not-found-suggest]');
    await island.locator('[data-find-it]').click();
    await expect(island.locator('[data-found] a, [data-find-failed]').first()).toBeVisible({ timeout: 10_000 });
  });
});

/* ---------------- the tour route ---------------- */

test.describe('POST /api/ai/tour', () => {
  test('answers valid stop ids or a fallback, and refuses bad input before the model', async ({ request }, info) => {
    test.skip(!primary(info), 'API-level: one project');
    const ok = await aiPost(request, 'tour', { goal: 'hiring for an ML role' });
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { stops?: unknown; mode?: string; reason?: string };
    if (body.mode === 'fallback') {
      // The fake model repeats the first enum value, which normalizeStops rejects.
      expect(body.reason).toBe('unverified');
    } else {
      expect(normalizeStops(body.stops, CATALOG)).toEqual(body.stops);
    }

    const tooLong = await aiPost(request, 'tour', { goal: 'x'.repeat(121) });
    expect(await tooLong.json()).toEqual({ mode: 'fallback', reason: 'too-long' });
    const extra = await aiPost(request, 'tour', { goal: 'hiring', stops: ['section:about'] });
    expect(await extra.json()).toEqual({ mode: 'fallback', reason: 'bad-request' });
    const crossSite = await aiPost(request, 'tour', { goal: 'hiring' }, { headers: { origin: 'https://evil.example' } });
    expect(await crossSite.json()).toEqual({ mode: 'fallback', reason: 'origin' });
  });
});
