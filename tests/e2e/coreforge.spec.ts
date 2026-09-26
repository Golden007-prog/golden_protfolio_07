import type { Locator, Page, TestInfo } from '@playwright/test';
import { CELL_LABELS, generatePuzzle, puzzleSeed } from '../../src/lib/coreforge/puzzle';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * CoreForge placements: the home section (#coreforge), the announcement bar and the
 * /ventures/coreforge page. All three are mounted, so a missing target is a failure,
 * not a skip. These run in every configured project.
 */

const SECTION = '#coreforge';
const VENTURE = '/ventures/coreforge';
const ANNOUNCE_KEY = 'cf-announce-v1';
const OVERFLOW_WIDTHS = new Set([320, 375, 768, 1440]);

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const reduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
/** Behaviour that does not vary by viewport, theme or motion runs once. */
const primary = (info: TestInfo) => width(info) === 1440 && projectUse(info).colorScheme === 'dark' && !reduced(info);

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function gotoHydrated(page: Page, path: string) {
  const res = await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
  return res;
}

/** Scrolls the page in steps so a lazily mounted section renders, then returns it (or null when absent). */
async function findSection(page: Page): Promise<Locator | null> {
  await page.evaluate(async () => {
    const step = Math.max(300, window.innerHeight * 0.9);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 60));
      if (document.querySelector('#coreforge')) break;
    }
  });
  const section = page.locator(SECTION);
  if ((await section.count()) === 0) return null;
  await section.scrollIntoViewIfNeeded();
  return section;
}

async function homeSection(page: Page): Promise<Locator> {
  await skipIntro(page);
  await gotoHydrated(page, '/');
  const section = await findSection(page);
  expect(section, 'the home page renders #coreforge').not.toBeNull();
  return section as Locator;
}

async function venturePage(page: Page) {
  await skipIntro(page);
  const res = await gotoHydrated(page, VENTURE);
  expect(res?.status(), `${VENTURE} responds`).toBe(200);
  await expect(page.locator('[data-cf-venture]')).toHaveCount(1);
}

async function expectCoreforgeLinks(scope: Locator) {
  const links = scope.locator('a[href*="goldensdmat.in"]');
  const n = await links.count();
  expect(n, 'at least one goldensdmat.in link').toBeGreaterThan(0);
  const attrs = await links.evaluateAll((els) =>
    els.map((a) => ({ href: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })),
  );
  for (const a of attrs) {
    const url = new URL(a.href);
    expect(url.hostname, a.href).toBe('goldensdmat.in');
    expect(url.searchParams.get('utm_source'), a.href).toBe('basuoikantik.in');
    expect(url.searchParams.get('utm_medium'), a.href).toBe('portfolio');
    expect(url.searchParams.get('utm_campaign'), a.href).toMatch(/^[a-z0-9-]+$/);
    expect(a.target, a.href).toBe('_blank');
    expect(a.rel.split(/\s+/), a.href).toContain('noopener');
    // The referrer is kept on purpose, so goldensdmat.in sees portfolio traffic.
    expect(a.rel.split(/\s+/), a.href).not.toContain('noreferrer');
  }
}

test.describe('CoreForge home section', () => {
  test('every goldensdmat.in link is UTM-tagged, opens a new tab and keeps the referrer', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'link attributes do not vary by theme or motion');
    await homeSection(page);
    await expectCoreforgeLinks(page.locator('body'));
    // Every placement is distinct, so analytics can tell them apart.
    const campaigns = await page
      .locator(`${SECTION} a[href*="goldensdmat.in"]`)
      .evaluateAll((els) => els.map((a) => new URL(a.getAttribute('href') ?? '').searchParams.get('utm_campaign')));
    expect(campaigns.length).toBeGreaterThan(5);
  });

  test('shows the founder heading, CTAs, the disclaimer and no prices', async ({ page }, info) => {
    test.skip(!primary(info), 'content does not vary by project');
    const section = await homeSection(page);
    await expect(section.getByRole('heading', { level: 2, name: 'I built CoreForge.' })).toBeVisible();
    await expect(section.getByText("Founder · GOLDEN's Coreforge").first()).toBeAttached();
    await expect(section.getByRole('link', { name: /Try 10 free questions/ }).first()).toBeVisible();
    await expect(section.getByRole('link', { name: /Do I need the dMAT\?/ }).first()).toBeVisible();
    await expect(section.locator('[data-cf-disclaimer]').first()).toContainText(
      'Not affiliated with g.a.s.t., TestDaF-Institut, APS, or the DAAD.',
    );
    const text = await section.innerText();
    expect(text).not.toMatch(/₹|\d\s*\/\s*month|per month/i);
  });

  test('the mini demo plays by keyboard and announces the verdict', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 320, 'keyboard play is checked at the smallest and largest widths');
    const errors = collectPageErrors(page);
    const section = await homeSection(page);
    const demo = section.locator('[data-cf-minidemo]');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute('data-state', 'open');

    // Today's puzzle, computed the same way the page does, from the browser's local day.
    const day = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const puzzle = generatePuzzle(puzzleSeed(day));
    for (let i = 0; i < 4; i++) {
      await expect(demo.getByRole('img', { name: new RegExp(`^Frame ${i + 1}: marker ${CELL_LABELS[puzzle.frames[i]].toLowerCase()}$`) })).toBeAttached();
    }

    // Roving tab stop: one choice is tabbable, arrows move spatially.
    const choices = demo.locator('[data-cf-choice]');
    await expect(choices).toHaveCount(4);
    expect(await demo.locator('[data-cf-choice][tabindex="0"]').count()).toBe(1);
    await demo.locator('[data-cf-choice="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(demo.locator('[data-cf-choice="1"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(demo.locator('[data-cf-choice="2"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(demo.locator('[data-cf-choice="3"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(demo.locator('[data-cf-choice="0"]')).toBeFocused();

    // Walk to the right answer and pick it with Enter.
    const moves: Record<number, string[]> = { 0: [], 1: ['ArrowRight'], 2: ['ArrowRight', 'ArrowDown'], 3: ['ArrowDown'] };
    for (const key of moves[puzzle.answer]) await page.keyboard.press(key);
    await expect(demo.locator(`[data-cf-choice="${puzzle.answer}"]`)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(demo).toHaveAttribute('data-state', 'correct');
    const verdict = demo.locator('[data-cf-verdict]');
    await expect(verdict).toHaveAttribute('aria-live', 'polite');
    await expect(verdict).toContainText('Correct.');
    await expect(verdict).toContainText(CELL_LABELS[puzzle.answer].toLowerCase());
    await expect(demo.locator('[data-cf-choice][data-state="correct"]')).toHaveCount(1);
    await expect(demo.locator('[data-cf-choice][aria-disabled="true"]')).toHaveCount(4);

    // A new pattern resets the board and brings focus back to the grid.
    await demo.getByRole('button', { name: 'Try another pattern' }).click();
    await expect(demo).toHaveAttribute('data-state', 'open');
    // The verdict is replaced by a screen-reader-only note that the frames changed.
    await expect(verdict).toHaveText('New pattern: four new frames.');
    await expect(verdict).not.toContainText('Correct.');
    await expect(demo.locator('[data-cf-choice="0"]')).toBeFocused();

    // A wrong pick is announced as such.
    const next = generatePuzzle(puzzleSeed(day, 1));
    const wrong = ([0, 1, 2, 3] as const).find((c) => c !== next.answer) ?? 0;
    await demo.locator(`[data-cf-choice="${wrong}"]`).click();
    await expect(demo).toHaveAttribute('data-state', 'wrong');
    await expect(verdict).toContainText('Not quite');

    expect(errors.errors).toEqual([]);
  });

  test('no horizontal overflow', async ({ page }, info) => {
    test.skip(!OVERFLOW_WIDTHS.has(width(info)), 'overflow is checked at 320, 375, 768 and 1440');
    const section = await homeSection(page);
    await section.locator('[data-cf-minidemo]').scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    // The phone strip scrolls inside itself, never the page.
    const strip = section.locator('[data-cf-strip]').first();
    if (await strip.isVisible()) {
      const fits = await strip.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
      expect(fits).toBe(true);
    }
  });

  test('reduced motion: no pulse, no shake, no parallax drift', async ({ page }, info) => {
    test.skip(!reduced(info), 'runs in the reduced-motion projects');
    const section = await homeSection(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    const pulse = await section
      .locator('.cf-pulse-dot')
      .first()
      .evaluate((el) => getComputedStyle(el, '::after').animationName);
    expect(pulse).toBe('none');

    const parallax = section.locator('.cf-parallax');
    if (await parallax.isVisible()) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(200);
      const dy = await parallax.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
      expect(dy).toBe(0);
    }

    const demo = section.locator('[data-cf-minidemo]');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute('data-state', 'open');
    const day = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const answer = generatePuzzle(puzzleSeed(day)).answer;
    const wrong = ([0, 1, 2, 3] as const).find((c) => c !== answer) ?? 0;
    await demo.locator(`[data-cf-choice="${wrong}"]`).click();
    const shake = await demo.locator(`[data-cf-choice="${wrong}"]`).evaluate((el) => getComputedStyle(el).animationName);
    expect(shake).toBe('none');
  });
});

test.describe('CoreForge announcement bar', () => {
  test('dismissal persists across reloads', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'dismissal does not vary by theme or motion');
    await skipIntro(page);
    await gotoHydrated(page, '/');
    // The floating strip is display:none below md (768px; AnnouncementSlot), where the hero column is full width.
    test.skip(width(info) < 768, 'the floating announcement is not shown below md');
    const bar = page.locator('[data-cf-announcement]:visible');
    await expect(bar).toHaveCount(1);

    await expectCoreforgeLinks(bar);
    await bar.locator('[data-cf-dismiss]').click();
    await expect(bar).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), ANNOUNCE_KEY)).toBe('1');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-cf-announcement]')).toHaveCount(0);
  });
});

test.describe('CoreForge venture page', () => {
  test('renders the story, keeps the bar off and works by keyboard', async ({ page }, info) => {
    test.skip(!primary(info) && width(info) !== 320, 'content does not vary by theme or motion');
    await venturePage(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CoreForge');
    await expect(page.locator('[data-cf-announcement]')).toHaveCount(0);
    await expect(page.locator('[data-cf-disclaimer]').first()).toContainText('Not affiliated with g.a.s.t.');
    await expectCoreforgeLinks(page.locator('[data-cf-venture]'));
    expect(await page.locator('[data-cf-venture]').innerText()).not.toMatch(/₹|\d\s*\/\s*month|per month/i);

    // The FAQ is native details/summary: Enter toggles it.
    const faq = page.locator('[data-cf-faq]').first();
    await faq.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(faq).toHaveAttribute('open', '');
  });

  test('no horizontal overflow', async ({ page }, info) => {
    test.skip(!OVERFLOW_WIDTHS.has(width(info)), 'overflow is checked at 320, 375, 768 and 1440');
    await venturePage(page);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await expectNoHorizontalOverflow(page);
  });
});
