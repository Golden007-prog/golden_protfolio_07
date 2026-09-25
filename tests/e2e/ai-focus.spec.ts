import type { Browser, Page, TestInfo } from '@playwright/test';
import type { AiFrame, AiSource } from '../../src/lib/ai/protocol';
import { assertSafeServer } from './ai-mocks';
import { expect, test } from './helpers';

/*
 * Keyboard focus in the AI surfaces. A control that removes or disables itself when
 * pressed (a starter or follow-up chip, Send, Stop, Ask) hands focus to a stable
 * place instead of dropping it on <body>: the question field under a fine pointer,
 * the conversation (concierge) or the answer (case study) under a coarse one, so a
 * pressed chip never raises the on-screen keyboard.
 *
 * A rAF sampler records every frame in which document.activeElement is <body>
 * between pressing the control and the answer settling. Every model route is mocked.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const darkMotion = (info: TestInfo) => projectUse(info).colorScheme !== 'light' && projectUse(info).reducedMotion !== 'reduce';
const primary = (info: TestInfo) => width(info) === 1440 && darkMotion(info);
/** The desktop panel, the phone sheet (fine pointer at 320) and the coarse-pointer tablet. */
const covered = (info: TestInfo) => darkMotion(info) && [1440, 1024, 320].includes(width(info));

const OPEN = 'What kind of problems does he seem most curious about?';
const CASE_STUDY = 'bruhworking-nexusflow';
const SRC: AiSource = { id: `project:${CASE_STUDY}#summary`, label: 'Summary', cls: 'self', target: { kind: 'project', slug: CASE_STUDY } };

function answer(sentences: number): AiFrame[] {
  return [
    { type: 'meta', model: 'gemini-test', feature: 'ask', mode: 'lexical', sources: [SRC] },
    ...Array.from({ length: sentences }, (_, i): AiFrame => ({ type: 'delta', text: `Sentence ${i + 1} of the answer [c:${SRC.id}]. ` })),
    { type: 'done', finishReason: 'STOP', cited: [SRC.id], dropped: 0, degraded: false },
  ];
}

type Watch = Window & { __focusWatch?: boolean; __bodyFrames?: number; __fieldFocus?: number };

/** Skips the intro, streams /api/ai/ask frame by frame, and installs the focus sampler. */
async function prepare(page: Page, frames: AiFrame[], gapMs: number) {
  await page.addInitScript(
    ({ list, gap }) => {
      try {
        window.sessionStorage.setItem('ob-seen-loader-v2', '1');
      } catch {
        /* storage blocked */
      }
      const w = window as Watch;
      w.__bodyFrames = 0;
      w.__fieldFocus = 0;
      const tick = () => {
        if (w.__focusWatch && (!document.activeElement || document.activeElement === document.body)) w.__bodyFrames = (w.__bodyFrames ?? 0) + 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.addEventListener('focusin', (e) => {
        if (w.__focusWatch && e.target instanceof HTMLInputElement) w.__fieldFocus = (w.__fieldFocus ?? 0) + 1;
      });

      const native = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('/api/ai/ask')) return native(input, init);
        const enc = new TextEncoder();
        const signal = init?.signal;
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(c) {
            if (signal?.aborted || i >= list.length) {
              c.close();
              return;
            }
            await new Promise((r) => setTimeout(r, i === 0 ? 30 : gap));
            c.enqueue(enc.encode(`${JSON.stringify(list[i++])}\n`));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
      };
    },
    { list: frames, gap: gapMs },
  );
}

async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as Watch;
    w.__bodyFrames = 0;
    w.__fieldFocus = 0;
    w.__focusWatch = true;
  });
}

async function watched(page: Page): Promise<{ bodyFrames: number; fieldFocus: number }> {
  return page.evaluate(() => {
    const w = window as Watch;
    w.__focusWatch = false;
    return { bodyFrames: w.__bodyFrames ?? 0, fieldFocus: w.__fieldFocus ?? 0 };
  });
}

const finePointer = (page: Page) => page.evaluate(() => window.matchMedia('(pointer: fine)').matches);

/* ---------------- concierge ---------------- */

const chat = (page: Page) => page.locator('[data-ask-panel], [data-ask-sheet]').first();

async function openChat(page: Page) {
  await page.goto('/');
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');
  // On the shortest phones the dock stays tucked at the top of the page; focus brings it back.
  const launcher = page.locator('[data-ask-launcher]');
  await launcher.focus();
  await launcher.click();
  const input = chat(page).locator('input').first();
  await expect(input).toBeVisible();
  return input;
}

/** A bot bubble is in the log and nothing is streaming or typing. */
async function settled(page: Page) {
  await expect(chat(page).locator('[data-ask-answer]').first()).toBeVisible({ timeout: 15_000 });
  await expect(chat(page).locator('[data-ask-live], [data-ask-typing]')).toHaveCount(0, { timeout: 15_000 });
}

async function conciergeTarget(page: Page) {
  return (await finePointer(page)) ? chat(page).locator('input').first() : chat(page).locator('[role="log"]');
}

test.describe('concierge keeps focus (a11y)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), 'desktop panel, 320px sheet and the touch tablet');
    await assertSafeServer(request);
  });

  test('a starter chip pressed with Enter hands focus to the field or the conversation', async ({ page }) => {
    await prepare(page, answer(2), 60);
    await openChat(page);
    const starter = chat(page).locator('[data-ask-starters] > button').first();
    await starter.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await settled(page);
    await expect(await conciergeTarget(page)).toBeFocused();
    expect((await watched(page)).bodyFrames, 'frames with focus on <body>').toBe(0);
  });

  test('Send pressed with Enter on a rule answer (Send turns disabled) keeps focus in the chat', async ({ page }) => {
    await prepare(page, answer(2), 60);
    const input = await openChat(page);
    await input.fill('Can I download your CV?');
    await chat(page).getByRole('button', { name: 'Send' }).focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await settled(page);
    await expect(await conciergeTarget(page)).toBeFocused();
    expect((await watched(page)).bodyFrames, 'frames with focus on <body>').toBe(0);
  });

  test('Stop pressed with Enter, and an answer that settles under a focused Stop, keep focus in the chat', async ({ page }) => {
    await prepare(page, answer(6), 350);
    const input = await openChat(page);
    const stop = chat(page).getByRole('button', { name: 'Stop' });

    // Stopped by keyboard.
    await input.fill(OPEN);
    await input.press('Enter');
    await expect(chat(page).locator('[data-ask-live]')).toContainText('Sentence 1', { timeout: 10_000 });
    await stop.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(chat(page).locator('[data-ask-answer="ai"][data-status="stopped"]')).toHaveCount(1, { timeout: 5000 });
    await settled(page);
    await expect(await conciergeTarget(page)).toBeFocused();
    expect((await watched(page)).bodyFrames, 'Stop: frames with focus on <body>').toBe(0);

    // Left to finish: Stop turns back into a disabled Send.
    await input.fill(OPEN);
    await input.press('Enter');
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await stop.focus();
    await watch(page);
    await expect(chat(page).locator('[data-ask-live]')).toHaveCount(0, { timeout: 15_000 });
    await expect(await conciergeTarget(page)).toBeFocused();
    expect((await watched(page)).bodyFrames, 'settled: frames with focus on <body>').toBe(0);
  });
});

/** A phone with a touch screen, where focusing the field would raise the keyboard. */
async function touchPhone(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  return context.newPage();
}

test('phone sheet under a coarse pointer: a starter chip hands focus to the conversation, not the field', async ({ browser, baseURL, request }, info) => {
  test.skip(!primary(info), 'makes its own touch context, once');
  await assertSafeServer(request);
  const page = await touchPhone(browser, baseURL);
  try {
    await prepare(page, answer(2), 60);
    await openChat(page);
    await expect(page.locator('[data-ask-sheet]')).toBeVisible();
    expect(await finePointer(page), 'the touch context reports a coarse pointer').toBe(false);
    await chat(page).locator('[data-ask-starters] > button').first().focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await settled(page);
    await expect(page.locator('[data-ask-sheet] [role="log"]')).toBeFocused();
    const w = await watched(page);
    expect(w.bodyFrames, 'frames with focus on <body>').toBe(0);
    expect(w.fieldFocus, 'the field took focus (on-screen keyboard)').toBe(0);
  } finally {
    await page.context().close();
  }
});

/* ---------------- case study: InlineAsk ---------------- */

async function openIsland(page: Page) {
  await page.goto(`/projects/${CASE_STUDY}`);
  const island = page.locator('[data-inline-ask]');
  await expect(island).toBeVisible({ timeout: 20_000 });
  await island.scrollIntoViewIfNeeded();
  return island;
}

test.describe('case-study InlineAsk keeps focus (a11y)', () => {
  test.beforeEach(async ({ request }, info) => {
    test.skip(!covered(info), 'desktop, 320px and the touch tablet');
    await assertSafeServer(request);
  });

  test('a suggested question and the Ask button pressed with Enter keep focus in the section', async ({ page }) => {
    await prepare(page, answer(2), 60);
    const island = await openIsland(page);
    const fine = await finePointer(page);
    const target = fine ? island.locator('input') : island.locator('[data-inline-answer]');

    await island.locator('[data-ai-prompts] button').first().focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(island.locator('[data-inline-answer="done"]')).toBeVisible({ timeout: 10_000 });
    await expect(target).toBeFocused();
    expect((await watched(page)).bodyFrames, 'prompt: frames with focus on <body>').toBe(0);

    await island.locator('input').fill('What data does it use?');
    await island.getByRole('button', { name: 'Ask', exact: true }).focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(island.locator('[data-inline-answer="done"]')).toBeVisible({ timeout: 10_000 });
    await expect(target).toBeFocused();
    expect((await watched(page)).bodyFrames, 'Ask: frames with focus on <body>').toBe(0);
  });

  test('Stop pressed with Enter, and an answer that settles under a focused Stop, keep focus in the section', async ({ page }) => {
    await prepare(page, answer(6), 350);
    const island = await openIsland(page);
    const input = island.locator('input');
    const button = island.locator('form button');
    const target = (await finePointer(page)) ? input : island.locator('[data-inline-answer]');

    await input.fill('How does it work?');
    await input.press('Enter');
    await expect(button).toHaveText('Stop');
    await button.focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(island.locator('[data-inline-answer="stopped"]')).toBeVisible({ timeout: 5000 });
    await expect(target).toBeFocused();
    expect((await watched(page)).bodyFrames, 'Stop: frames with focus on <body>').toBe(0);

    await input.fill('What would he change?');
    await input.press('Enter');
    await expect(button).toHaveText('Stop');
    await button.focus();
    await watch(page);
    await expect(island.locator('[data-inline-answer="done"]')).toBeVisible({ timeout: 15_000 });
    await expect(target).toBeFocused();
    expect((await watched(page)).bodyFrames, 'settled: frames with focus on <body>').toBe(0);
  });
});

test('case study under a coarse pointer: a suggested question hands focus to the answer, not the field', async ({ browser, baseURL, request }, info) => {
  test.skip(!primary(info), 'makes its own touch context, once');
  await assertSafeServer(request);
  const page = await touchPhone(browser, baseURL);
  try {
    await prepare(page, answer(2), 60);
    const island = await openIsland(page);
    expect(await finePointer(page), 'the touch context reports a coarse pointer').toBe(false);
    await island.locator('[data-ai-prompts] button').first().focus();
    await watch(page);
    await page.keyboard.press('Enter');
    await expect(island.locator('[data-inline-answer="done"]')).toBeVisible({ timeout: 10_000 });
    await expect(island.locator('[data-inline-answer]')).toBeFocused();
    const w = await watched(page);
    expect(w.bodyFrames, 'frames with focus on <body>').toBe(0);
    expect(w.fieldFocus, 'the field took focus (on-screen keyboard)').toBe(0);
  } finally {
    await page.context().close();
  }
});
