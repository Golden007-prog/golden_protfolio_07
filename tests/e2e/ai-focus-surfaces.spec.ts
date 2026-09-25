import type { Locator, Page, TestInfo } from '@playwright/test';
import { DRAFT_SESSION_CAP } from '../../src/lib/ai/draft';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { assertSafeServer, mockAiFallback, mockAiJson } from './ai-mocks';
import { expect, test } from './helpers';

/*
 * Keyboard focus in the AI surfaces round 1 didn't cover (ai-focus.spec has the
 * concierge and the case-study island). Each control here removes or disables
 * itself when pressed: the draft helper's Write draft / Stop, its tone chips, Try
 * again and template buttons, the data notice's 'Got it', the tour pill's Finish
 * and Exit, and the 404's 'Find it'. Focus must land somewhere stable instead of
 * on <body>; a rAF sampler counts every frame it spends there.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const darkMotion = (info: TestInfo) => projectUse(info).colorScheme !== 'light' && projectUse(info).reducedMotion !== 'reduce';
/** The desktop and the coarse-pointer tablet, where focus goes to a region rather than a field. */
const covered = (info: TestInfo) => darkMotion(info) && [1440, 1024].includes(width(info));

type Watch = Window & { __focusWatch?: boolean; __bodyFrames?: number };

async function prepare(page: Page, opts: { draftsUsed?: number } = {}) {
  await page.addInitScript((used) => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
      if (used !== null) window.sessionStorage.setItem('ob-ai-draft-count', String(used));
    } catch {
      /* storage blocked */
    }
    const w = window as Watch;
    w.__bodyFrames = 0;
    const tick = () => {
      if (w.__focusWatch && (!document.activeElement || document.activeElement === document.body)) w.__bodyFrames = (w.__bodyFrames ?? 0) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, opts.draftsUsed ?? null);
}

async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as Watch;
    w.__bodyFrames = 0;
    w.__focusWatch = true;
  });
}

async function bodyFrames(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Watch;
    w.__focusWatch = false;
    return w.__bodyFrames ?? 0;
  });
}

const finePointer = (page: Page) => page.evaluate(() => window.matchMedia('(pointer: fine)').matches);

/* ---------------- contact: Help me write this ---------------- */

const DRAFT = 'Hi Oikantik,\n\nI am hiring an LLM engineer for a remote role at [your company]. Could we talk about [timeline]?\n\nThanks,\n[your name]';

function draftBody(text: string): string {
  const frames: AiFrame[] = [
    { type: 'meta', model: 'gemini-test', feature: 'draft', sources: [], mode: 'full' },
    { type: 'delta', text },
    { type: 'done', finishReason: 'STOP', cited: [], dropped: 0, degraded: false },
  ];
  return frames.map((f) => JSON.stringify(f)).join('\n') + '\n';
}

/** POST /api/ai/draft answers a whole draft after `delays[n]` ms for the nth request (the last delay repeats). */
async function routeDraft(page: Page, delays: number[]) {
  let n = 0;
  await page.route(/\/api\/ai\/draft(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, delays[Math.min(n++, delays.length - 1)]));
    // Stop aborts the request first; fulfilling it then throws.
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: draftBody(DRAFT) }).catch(() => {});
  });
}

async function openDraft(page: Page): Promise<Locator> {
  await page.goto('/#contact');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  const toggle = page.locator('#contact [data-draft-toggle]');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#contact [data-draft-panel]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-draft-notes]').fill('hiring an LLM engineer, remote');
  return panel;
}

/** Where a pressed-away control hands focus inside the panel: the notes under a fine pointer, else the panel. */
async function panelTarget(page: Page, panel: Locator): Promise<Locator> {
  return (await finePointer(page)) ? panel.locator('[data-draft-notes]') : panel;
}

test.describe('Help me write this keeps focus (a11y)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), 'desktop and the touch tablet');
    await assertSafeServer(request);
  });

  test('Write draft and Stop are one button: Enter on either keeps focus on it, and a draft settles under it', async ({ page }) => {
    await prepare(page);
    await routeDraft(page, [4000, 150]);
    const panel = await openDraft(page);
    const run = panel.locator('[data-draft-generate], [data-draft-stop]');

    await panel.locator('[data-draft-generate]').focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-draft-stop]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-draft-generate]')).toBeFocused();
    await expect(page.locator('#contact [data-draft-status]')).toContainText('Stopped');
    expect(await bodyFrames(page), 'Write draft, Stop: frames with focus on <body>').toBe(0);

    await watch(page);
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-ai-disclosure]')).toBeVisible({ timeout: 10_000 });
    await expect(run).toHaveText('Rewrite draft');
    await expect(run).toBeFocused();
    expect(await bodyFrames(page), 'settled: frames with focus on <body>').toBe(0);
  });

  test('a tone chip pressed with Enter keeps focus while it regenerates, and ignores presses meanwhile', async ({ page }) => {
    await prepare(page);
    await routeDraft(page, [100, 1500]);
    const panel = await openDraft(page);
    await panel.locator('[data-draft-generate]').click();
    await expect(panel.locator('[data-ai-disclosure]')).toBeVisible({ timeout: 10_000 });

    const formal = panel.locator('[data-draft-tone="formal"]');
    const warm = panel.locator('[data-draft-tone="warm"]');
    await formal.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-draft-stop]')).toBeVisible();
    await expect(formal).toBeFocused();
    await expect(warm).toHaveAttribute('aria-disabled', 'true');
    // force: Playwright waits for an aria-disabled element to become enabled. The click
    // is ignored but still focuses the chip, which then has to keep focus as the draft settles.
    await warm.click({ force: true });
    await expect(warm).toHaveAttribute('aria-pressed', 'false');
    await expect(warm).toBeFocused();
    await expect(panel.locator('[data-draft-generate]')).toBeVisible({ timeout: 10_000 });
    await expect(warm).toBeFocused();
    await expect(warm).not.toHaveAttribute('aria-disabled', 'true');
    await expect(formal).toHaveAttribute('aria-pressed', 'true');
    expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
  });

  test("the visit's last draft: Stop comes back disabled, so focus moves on when it settles or is stopped", async ({ page }) => {
    await prepare(page, { draftsUsed: DRAFT_SESSION_CAP - 1 });
    await routeDraft(page, [800]);
    const panel = await openDraft(page);
    const target = await panelTarget(page, panel);

    await panel.locator('[data-draft-generate]').focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-draft-stop]')).toBeFocused();
    await expect(panel.locator('[data-draft-generate]')).toBeDisabled({ timeout: 10_000 });
    await expect(target).toBeFocused();
    expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
  });

  test('Try again and the template button hand focus on as their fallback goes', async ({ page }) => {
    await prepare(page);
    await mockAiFallback(page, 'upstream');
    const panel = await openDraft(page);
    await panel.locator('[data-draft-generate]').click();
    const error = panel.locator('[data-ai-error="upstream"]');
    await expect(error).toBeVisible();

    await error.getByRole('button', { name: 'Try again' }).focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(error).toBeVisible();
    await expect(panel.locator('[data-draft-generate]')).toBeFocused();
    expect(await bodyFrames(page), 'Try again: frames with focus on <body>').toBe(0);

    const fine = await finePointer(page);
    await panel.locator('[data-draft-template]').focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-draft-source="template"]')).toBeVisible();
    // The template's [brackets] wait in the message; a coarse pointer keeps the keyboard down.
    await expect(fine ? page.locator('#contact textarea[name="message"]') : panel).toBeFocused();
    expect(await bodyFrames(page), 'template: frames with focus on <body>').toBe(0);
  });
});

/* ---------------- the data notice ---------------- */

test.describe("the data notice's 'Got it' hands focus to its field (a11y)", () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), 'desktop and the touch tablet');
    await assertSafeServer(request);
  });

  test('in the pitch dialog, focus goes to the role field and the dialog stays open', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const trigger = page.locator('#about [data-pitch-trigger]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.locator('[data-role-brief-toggle]').click();
    const got = page.locator('[data-ai-notice="brief"]').getByRole('button', { name: 'Got it' });
    await got.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ai-notice="brief"]')).toHaveCount(0);
    await expect(page.locator('[data-role-brief-input]')).toBeFocused();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
  });

  test('in the tour picker, focus goes back to the goal field', async ({ page }) => {
    await prepare(page);
    const picker = await openTourPicker(page);
    const goal = picker.getByRole('textbox', { name: /say what you/i });
    await goal.fill('hiring for an LLM agents role');
    const got = picker.locator('[data-ai-notice="tour"]').getByRole('button', { name: 'Got it' });
    await got.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(picker.locator('[data-ai-notice]')).toHaveCount(0);
    await expect(goal).toBeFocused();
    expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
  });
});

/* ---------------- the tour pill ---------------- */

async function openTourPicker(page: Page): Promise<Locator> {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: /Search sections/ })).toBeFocused({ timeout: 10_000 });
  await page.getByRole('option', { name: /Show me around/ }).click();
  const picker = page.locator('[data-tour-picker]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  return picker;
}

async function startQuickLook(page: Page, picker: Locator): Promise<{ next: Locator; total: number }> {
  await picker.getByRole('button', { name: 'Quick look' }).focus();
  await page.keyboard.press('Enter');
  const next = page.locator('[data-tour-next]');
  await expect(next).toBeFocused({ timeout: 10_000 });
  const count = (await page.locator('[data-tour-count]').textContent()) ?? '';
  return { next, total: Number(/of (\d+)/.exec(count)?.[1] ?? 0) };
}

/** Focus is on the page where the tour ended: a shown element in <main>, in the viewport. */
async function focusOnScreen(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, what: 'BODY' };
    const r = el.getBoundingClientRect();
    const ok = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && Boolean(el.closest('main'));
    return { ok, what: `${el.tagName}#${el.id} ${(el.textContent ?? '').trim().slice(0, 40)}` };
  });
}

test.describe('the tour pill hands focus back as it goes (a11y)', () => {
  test.beforeEach(async ({ request }, info) => {
    // Reduced motion too: the picker closes at once there, but fades out under the pill otherwise.
    const reducedDesktop = width(info) === 1440 && projectUse(info).colorScheme !== 'light';
    test.skip(!covered(info) && !reducedDesktop, 'desktop (both motion settings) and the touch tablet');
    await assertSafeServer(request);
  });

  for (const how of ['Finish', 'Exit tour', 'Escape'] as const) {
    test(`${how} from the keyboard leaves focus on the page where the tour ended`, async ({ page }) => {
      await prepare(page);
      const picker = await openTourPicker(page);
      const { next, total } = await startQuickLook(page, picker);
      const pill = page.locator('[data-tour-pill]');
      if (how === 'Finish') {
        for (let i = 1; i < total; i++) {
          await page.keyboard.press('Enter');
          await expect(pill).toHaveAttribute('data-tour-index', String(i));
        }
        await expect(next).toHaveText(/Finish/);
        await expect(next).toBeFocused();
      } else if (how === 'Exit tour') {
        await page.keyboard.press('Enter');
        await expect(pill).toHaveAttribute('data-tour-index', '1');
        await page.locator('[data-tour-exit]').focus();
      }
      await watch(page);
      await page.keyboard.press(how === 'Escape' ? 'Escape' : 'Enter');
      await expect(pill).toHaveCount(0);
      const focus = await focusOnScreen(page);
      expect(focus.ok, `focus after ${how}: ${focus.what}`).toBe(true);
      expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
    });
  }
});

/* ---------------- 404 ---------------- */

test.describe("the 404's 'Find it' (a11y)", () => {
  test('hands focus to the results before it rests, and runs once', async ({ page, request }, info) => {
    test.skip(!covered(info), 'desktop and the touch tablet');
    await assertSafeServer(request);
    await prepare(page);
    let posts = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/ai/retrieve') posts += 1;
    });
    await mockAiJson(
      page,
      'retrieve',
      { mode: 'lexical', hits: [{ id: 'section:experience', label: 'Experience', target: { kind: 'section', id: 'experience' }, score: 1, cosine: null, bm25: 1 }] },
      { delayMs: 600 },
    );
    await page.goto('/nope-xyz');
    const island = page.locator('[data-not-found-suggest]');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const find = island.locator('[data-find-it]');
    await find.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    // Searching: the button keeps focus, and a second press does nothing.
    await expect(find).toHaveAttribute('aria-busy', 'true');
    await expect(find).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(island.locator('[data-found] a')).toHaveCount(1, { timeout: 10_000 });
    await expect(island.locator('[data-find-results]')).toBeFocused();
    await expect(find).toBeDisabled();
    expect(await bodyFrames(page), 'frames with focus on <body>').toBe(0);
    expect(posts).toBe(1);
  });
});
