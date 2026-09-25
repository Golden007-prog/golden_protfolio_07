import type { Page, TestInfo } from '@playwright/test';
import { INTRO_CAP_MS } from '../../src/lib/intro-timing';
import { expect, test } from './helpers';

/*
 * The first screen and what sits on it: status labels that must not resize their
 * buttons, the floating dock over the hero's calls to action and over focused
 * controls on phones, the intro cap when hydration is late, and the phone LCP still.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
const oneProject = (info: TestInfo) => width(info) === 1440 && !isReduced(info) && !isLight(info);

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function gotoSettled(page: Page) {
  await skipIntro(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
}

async function waitForDock(page: Page) {
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');
  // Let the tuck/untuck transition finish before judging what it covers.
  await dock.locator('.dock-inner').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
  return dock;
}

/** Layout boxes (transform-free), so a press or magnet animation never reads as a shift. */
function layoutBoxes(page: Page, selectors: string[]) {
  return page.evaluate((sels) => {
    const box = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    };
    return sels.map((s) => box(document.querySelector<HTMLElement>(s)!));
  }, selectors);
}

test.describe('status labels keep the resting width', () => {
  test('copying the hero email keeps the button width, so the social icons stay put', async ({ page, context }, info) => {
    test.skip(isReduced(info) || isLight(info) || (width(info) !== 1440 && width(info) !== 375), 'dark motion projects at two widths');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(info.project.use.baseURL!).origin });
    await gotoSettled(page);
    const copy = page.locator('#hero [data-copy-button]');
    const sels = ['#hero [data-copy-button]', '#hero .hero-meta a[href*="github"]', '#hero .hero-meta a[href*="linkedin"]'];
    const before = await layoutBoxes(page, sels);

    await copy.click();
    await expect(copy).toHaveAttribute('data-status', 'success');
    await expect(copy).toContainText('Copied');
    expect(await layoutBoxes(page, sels), 'while "Copied" shows').toEqual(before);

    await expect(copy).toHaveAttribute('data-status', 'idle', { timeout: 5000 });
    expect(await layoutBoxes(page, sels), 'after the reset').toEqual(before);
  });

  test('Download CV keeps its width after the click, so View CV stays put', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project');
    await gotoSettled(page);
    page.on('download', (d) => void d.cancel().catch(() => {}));
    const sels = ['#hero [data-cv-download]', '#hero [data-cv-view]'];
    const before = await layoutBoxes(page, sels);
    await page.locator('#hero [data-cv-download]').click();
    // The arrow animation (or its fallback icon) replaces the static icon.
    await expect(page.locator('#hero [data-cv-download] [data-lottie]')).toHaveCount(1);
    expect(await layoutBoxes(page, sels)).toEqual(before);
  });
});

test.describe('the floating dock on phones', () => {
  test('at the top of the page it covers none of the hero calls to action', async ({ page }, info) => {
    test.skip(width(info) >= 640 || isLight(info), 'phone projects, dark only');
    await gotoSettled(page);
    await waitForDock(page);
    const covered = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('#hero :is(.hero-ctas, .hero-meta) :is(a[href], button)')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
        const points = [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + 4, r.top + 4],
          [r.right - 4, r.top + 4],
          [r.left + 4, Math.min(r.bottom, window.innerHeight) - 4],
          [r.right - 4, Math.min(r.bottom, window.innerHeight) - 4],
        ];
        if (points.some(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-dock]'))) {
          out.push((el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40));
        }
      }
      return out;
    });
    expect(covered, 'hero controls under the dock').toEqual([]);
  });

  test('a control reached with Tab lands above the dock, not under it', async ({ page }, info) => {
    test.skip(width(info) >= 640 || isLight(info) || isReduced(info), 'phone projects, dark motion only');
    await gotoSettled(page);
    await waitForDock(page);
    const group = page.locator('#projects [role="group"][aria-label="Filter by category"]');
    await group.scrollIntoViewIfNeeded();
    await expect(group.locator('button').nth(1)).toBeVisible();

    // Park the chips' first row in the dock's band, arriving from below so the dock shows.
    const target = await page.evaluate(() => {
      const dockTop = document.querySelector('[data-dock]')!.getBoundingClientRect().top;
      const first = document.querySelector('#projects [role="group"][aria-label="Filter by category"] button')!;
      return Math.round(first.getBoundingClientRect().top + window.scrollY - dockTop - 8);
    });
    await page.evaluate((y) => window.scrollTo({ top: y + 80, behavior: 'instant' }), target);
    await page.waitForTimeout(150);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), target);
    const dock = await waitForDock(page);
    await expect(dock).not.toHaveAttribute('data-hidden', '');

    // The chip to reach: in the band and under the dock's row; Tab to it from its neighbour.
    const index = await page.evaluate(() => {
      const d = document.querySelector('[data-dock] .dock-inner')!.getBoundingClientRect();
      const pills = [...document.querySelectorAll<HTMLElement>('#projects [role="group"][aria-label="Filter by category"] button')];
      return pills.findIndex((p, i) => {
        const r = p.getBoundingClientRect();
        return i > 0 && r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top;
      });
    });
    test.skip(index < 1, 'no chip sits under the dock at this width');
    const pills = group.locator('button');
    await pills.nth(index - 1).evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
    await page.keyboard.press('Tab');
    await expect(pills.nth(index)).toBeFocused();
    await page.waitForTimeout(600);

    const hidden = await pills.nth(index).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const points = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 4],
        [r.right - 4, r.bottom - 4],
      ];
      return points.filter(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-dock]')).length;
    });
    expect(hidden, 'points of the focused chip under the dock').toBe(0);
  });
});

test.describe('intro curtain cap before hydration', () => {
  test('a first visit whose JS is late still drops the curtain at the cap and shows the hero', async ({ page }, info) => {
    test.skip(isReduced(info) || isLight(info) || (width(info) !== 1440 && width(info) !== 375), 'dark motion projects at two widths');
    // Hold every JS chunk back, so hydration lands long after the cap.
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue().catch(() => {});
    });
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: INTRO_CAP_MS + 2500 });
    const state = await page.evaluate(() => ({
      elapsed: Date.now() - (window.__navStart ?? 0),
      hydrated: document.documentElement.classList.contains('hydrated'),
      seenFlag: window.sessionStorage.getItem('ob-seen-loader-v2'),
    }));
    expect(state.hydrated, 'ended by the head bootstrap, not by React').toBe(false);
    expect(state.elapsed).toBeLessThan(INTRO_CAP_MS + 1500);
    expect(state.seenFlag).toBe('1');
    await expect(page.locator('[data-intro-curtain]')).toBeHidden();
    await expect.poll(() => page.locator('#hero .hero-char').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('phone LCP still', () => {
  test('the server HTML preloads it at high priority, scoped to where it shows', async ({ request }, info) => {
    test.skip(!oneProject(info), 'server HTML: one project');
    const html = await (await request.get('/')).text();
    const links = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /rel="preload"/i.test(tag) && /as="image"/i.test(tag) && /hero-still/.test(tag));
    expect(links, 'one preload for the still').toHaveLength(1);
    expect(links[0]).toMatch(/fetchpriority="high"/i);
    expect(links[0]).toMatch(/imagesrcset="[^"]*hero-still/i);
    expect(links[0]).toMatch(/imagesizes="/i);
    expect(links[0]).toMatch(/media="\(max-width: 1023\.98px\)/);
  });

  test('a desktop that hides the still never fetches it', async ({ page }, info) => {
    test.skip(!oneProject(info) || isTouch(info), 'desktop motion only');
    const hits: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('hero-still')) hits.push(r.url());
    });
    await gotoSettled(page);
    await page.waitForTimeout(1500);
    expect(hits).toEqual([]);
  });
});
