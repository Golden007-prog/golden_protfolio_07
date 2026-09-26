import type { Locator, Page, TestInfo } from '@playwright/test';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Package "kaggle": the Kaggle section (profile, tiers, counts, open competitions,
 * writeups, badges, competition history) and the badge strip. The section is
 * mounted on the home page, so a page without #kaggle fails rather than skips.
 * Assertions compare the page with itself (counts against lists, links against
 * data-url), so they hold for live data and for the snapshot alike.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
const oneProject = (info: TestInfo) => width(info) === 1440 && !isReduced(info) && !isLight(info);

// Where the section may live: the home page first, then a route of its own.
const CANDIDATE_PATHS = (process.env.PW_KAGGLE_PATH ?? '/,/kaggle').split(',').map((p) => p.trim()).filter(Boolean);
const SECTION = '#kaggle';

// Public writeups captured on 26 Sep 2026. Published writeups stay published, so
// live data must still list them (newer ones may join).
const KNOWN_WRITEUPS = [
  'https://www.kaggle.com/competitions/med-gemma-impact-challenge/writeups/urbancare-ai-a-multimodal-clinical-copilot-for-re',
  'https://www.kaggle.com/competitions/google-tunix-hackathon/writeups/new-writeup-1767949274949',
];

const COUNTDOWN = /^(Closes in [\d,]+ (day|days|hour|hours)|Closes within the hour|Closed)$/;
const RANK = /^Rank [\d,]+ of [\d,]+ teams? · as of \d{1,2} [A-Z][a-z]{2} \d{4}$/;
const DAY = String.raw`\d{1,2} [A-Z][a-z]{2} \d{4}`;
const SOURCE = new RegExp(`^(Updated (just now|[\\d,]+ (minute|minutes|hour|hours|day|days) ago|${DAY}) · live from Kaggle|Live from Kaggle|Snapshot from ${DAY}|Snapshot of Kaggle data)$`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

/**
 * Opens the first candidate page that renders #kaggle, stepping down the page so
 * a lazily mounted section gets the chance to mount. False when none does.
 */
async function openKaggle(page: Page): Promise<boolean> {
  for (const path of CANDIDATE_PATHS) {
    const res = await page.goto(path);
    if (!res || !res.ok()) continue;
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
    const found = await page.evaluate(async (sel) => {
      const pause = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));
      const bottom = () => document.documentElement.scrollHeight - window.innerHeight;
      while (!document.querySelector(sel) && window.scrollY < bottom() - 1) {
        window.scrollTo({ top: window.scrollY + window.innerHeight * 0.7, behavior: 'instant' });
        await pause();
      }
      return Boolean(document.querySelector(sel));
    }, SECTION);
    if (found) {
      await page.locator(SECTION).scrollIntoViewIfNeeded();
      return true;
    }
  }
  return false;
}

async function kaggle(page: Page): Promise<Locator> {
  const found = await openKaggle(page);
  expect(found, 'a page renders #kaggle').toBe(true);
  return page.locator(SECTION);
}

async function statValue(section: Locator, key: string): Promise<number> {
  return Number(await section.locator(`[data-kaggle-stat="${key}"]`).getAttribute('data-value'));
}

/** Opens every disclosure in the section, so width checks see the longest layout. */
async function expandAll(page: Page, section: Locator) {
  for (const sel of ['[data-kaggle-history-toggle]', '[data-kaggle-badges-toggle]']) {
    const toggle = section.locator(sel);
    if ((await toggle.count()) === 0) continue;
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
  }
  // Let the height animation settle.
  await page.waitForTimeout(600);
}

test.describe('Kaggle section', () => {
  test('names itself and links to the Kaggle profile in a new tab', async ({ page }) => {
    const section = await kaggle(page);
    await expect(section.locator('h2').first()).toHaveAccessibleName(/On Kaggle/);

    const link = section.locator('a[data-kaggle-profile-link]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', /^https:\/\/www\.kaggle\.com\/oikantikbasu007\/?$/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAccessibleName(/opens in new tab/);
  });

  test('says where the data came from and when', async ({ page }) => {
    const section = await kaggle(page);
    const source = section.locator('[data-kaggle-source]');
    await expect(source).toHaveCount(1);
    await expect(source).toHaveText(SOURCE);
    const mode = await source.getAttribute('data-kaggle-source');
    expect(['live', 'snapshot']).toContain(mode);
  });

  test('the headline counts match the lists they summarise', async ({ page }) => {
    const section = await kaggle(page);
    expect(await statValue(section, 'badges')).toBe(await section.locator('[data-kaggle-badge]').count());
    expect(await statValue(section, 'writeups')).toBe(await section.locator('[data-kaggle-writeup]').count());
    const entered = (await section.locator('[data-kaggle-active]').count()) + (await section.locator('[data-kaggle-past]').count());
    expect(await statValue(section, 'competitions')).toBe(entered);
    // CountUp keeps the final value in its sr-only copy from the first paint.
    for (const key of ['badges', 'writeups', 'competitions']) {
      await expect(section.locator(`[data-kaggle-stat="${key}"] .sr-only`)).toHaveText(String(await statValue(section, key)));
    }
  });

  test('every writeup links to itself on Kaggle, newest first', async ({ page }) => {
    const section = await kaggle(page);
    const cards = section.locator('[data-kaggle-writeup]');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);

    const hrefs: string[] = [];
    const dates: number[] = [];
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const url = await card.getAttribute('data-url');
      expect(url).toMatch(/^https:\/\/(www\.)?kaggle\.com\//);
      const link = card.locator('a[data-kaggle-writeup-link]');
      await expect(link).toHaveAttribute('href', url!);
      await expect(link).toHaveAttribute('target', '_blank');
      // WCAG 2.5.3 Label in Name: the accessible name starts with the visible label.
      await expect(link).toHaveAccessibleName(/^Read on Kaggle: \S/);
      hrefs.push(url!);
      const published = await card.locator('time').first().getAttribute('datetime');
      dates.push(Date.parse(published ?? ''));
    }
    for (const url of KNOWN_WRITEUPS) expect(hrefs).toContain(url);
    for (let i = 1; i < dates.length; i++) expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]!);
  });

  test('open competitions show a countdown, and any rank says of how many teams and when', async ({ page }) => {
    const section = await kaggle(page);
    const cards = section.locator('[data-kaggle-active]');
    const n = await cards.count();
    if (n === 0) {
      await expect(section.getByText(/No open competition right now/)).toBeVisible();
    }
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      // The date stands in until hydration; the countdown replaces it.
      await expect(card.locator('[data-countdown]')).toHaveText(COUNTDOWN);
      await expect(card.locator('a[href*="kaggle.com"]')).toHaveCount(1);
    }

    const ranks = section.locator('[data-kaggle-rank]');
    for (let i = 0; i < (await ranks.count()); i++) await expect(ranks.nth(i)).toHaveText(RANK);
    // No bare 'Rank N' anywhere: a rank is always 'of M teams'.
    const text = await section.evaluate((el) => el.textContent ?? '');
    expect(text).not.toMatch(/\bRank [\d,]+(?![\d,])(?! of [\d,]+ teams?)/);
  });

  test('badge art is silent beside its visible name, with fixed dimensions and lazy loading', async ({ page }) => {
    const section = await kaggle(page);
    const imgs = page.locator(`${SECTION} img[data-kaggle-badge-img], [data-kaggle-badge-strip] img[data-kaggle-badge-img]`);
    const n = await imgs.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const img = imgs.nth(i);
      // The name is printed right beside the art, so alt="" avoids announcing it twice.
      await expect(img).toHaveAttribute('alt', '');
      await expect(img).toHaveAttribute('width', /^\d+$/);
      await expect(img).toHaveAttribute('height', /^\d+$/);
      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('src', /^https:\/\//);
    }
    // Featured badges lead the grid.
    const featured = await section
      .locator('[data-kaggle-badge]')
      .evaluateAll((els) => els.map((el) => el.hasAttribute('data-featured')));
    const firstPlain = featured.indexOf(false);
    if (firstPlain >= 0) expect(featured.slice(firstPlain)).not.toContain(true);
  });

  test('a badge whose image fails shows its initials, and the name stays in the text', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    await page.route(/kaggle-user-content|storage\.googleapis\.com/, (route) => route.abort());
    const section = await kaggle(page);
    const tile = section.locator('[data-kaggle-badge]').first();
    await tile.scrollIntoViewIfNeeded();
    const fallback = tile.locator('[data-kaggle-badge-fallback]');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('aria-hidden', 'true');
    await expect(tile).toContainText(/\S/);
    await expect(tile.locator('img[data-kaggle-badge-img]')).toBeHidden();
  });

  test('the history disclosure works from the keyboard', async ({ page }) => {
    const section = await kaggle(page);
    const toggle = section.locator('[data-kaggle-history-toggle]');
    test.skip((await toggle.count()) === 0, 'no past competitions in the data');
    await toggle.scrollIntoViewIfNeeded();

    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const regionId = await toggle.getAttribute('aria-controls');
    const region = page.locator(`[id="${regionId}"]`);
    await expect(region).toHaveJSProperty('inert', true);

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region).toHaveJSProperty('inert', false);
    const firstLink = region.locator('a').first();
    await expect(firstLink).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(firstLink).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toHaveJSProperty('inert', true);
  });

  test('past entries show a rank only where Kaggle gave one', async ({ page }) => {
    const section = await kaggle(page);
    const entries = section.locator('[data-kaggle-past]');
    const n = await entries.count();
    test.skip(n === 0, 'no past competitions in the data');
    for (let i = 0; i < n; i++) {
      const ranks = entries.nth(i).locator('[data-kaggle-rank]');
      expect(await ranks.count()).toBeLessThanOrEqual(1);
      if ((await ranks.count()) === 1) await expect(ranks).toHaveText(RANK);
    }
  });

  test('links and buttons are at least 44px', async ({ page }) => {
    const section = await kaggle(page);
    await expandAll(page, section);
    const targets = section.locator('a, button');
    const n = await targets.count();
    const small: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = targets.nth(i);
      if (!(await t.isVisible())) continue;
      const box = await t.boundingBox();
      if (box && (box.width < 43.5 || box.height < 43.5)) {
        small.push(`${(await t.innerText()).slice(0, 40)} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    expect(small, `targets under 44px:\n${small.join('\n')}`).toEqual([]);
  });

  test('nothing overflows the viewport', async ({ page }, info) => {
    test.skip(![320, 375, 768, 1440].includes(width(info)), 'checked at 320, 375, 768 and 1440');
    const section = await kaggle(page);
    await expandAll(page, section);
    await expectNoHorizontalOverflow(page);
    const inner = await section.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(inner).toBeLessThanOrEqual(0);
  });

  test('reduced motion: content is shown at once and the badge shine never runs', async ({ page }, info) => {
    test.skip(!isReduced(info), 'reduced-motion projects only');
    const section = await kaggle(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

    await expect
      .poll(() =>
        section.evaluate((el) =>
          Array.from(el.querySelectorAll('[data-reveal]')).every((n) => getComputedStyle(n).opacity === '1'),
        ),
      )
      .toBe(true);

    if (!isTouch(info)) {
      const tile = section.locator('[data-kaggle-badge]').first();
      await tile.scrollIntoViewIfNeeded();
      await tile.hover();
      const shining = await page.evaluate(
        () => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'kaggle-shine').length,
      );
      expect(shining).toBe(0);
    }

    // The disclosure opens without a height tween.
    const toggle = section.locator('[data-kaggle-history-toggle]');
    if ((await toggle.count()) > 0) {
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      const region = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
      await expect
        .poll(() => region.evaluate((el) => getComputedStyle(el).opacity), { timeout: 1000 })
        .toBe('1');
    }
  });

  test('loads without console or page errors', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    // Badge art lives on Google storage; an offline runner cannot fetch it, and the text fallback covers that.
    const collected = collectPageErrors(page, { allow: [/googleapis\.com|kaggle-user-content|kaggle-avatars/] });
    await kaggle(page);
    await page.waitForTimeout(500);
    const errors = collected.errors.filter((e) => !/googleapis\.com|kaggle-user-content|kaggle-avatars/.test(e));
    expect(errors).toEqual([]);
  });
});
