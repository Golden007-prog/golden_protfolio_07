import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * Active-section tracking under slow scrolling. The observer only fires when a
 * section edge crosses its band, so a section whose top creeps across the probe
 * line (Lenis easing, trackpads, small wheel steps) must be activated by that one
 * crossing. About (nothing observed above it) and Projects (ToolsStrip before it)
 * used to stay inactive for their whole height.
 */

// SECTIONS order in src/lib/site.ts; the hero above About is not a section.
const IDS = ['about', 'skills', 'projects', 'experience', 'philosophy', 'contact'] as const;
const PROBE = 0.45;

type ProjectUse = { viewport?: { width: number; height: number } | null; colorScheme?: string; reducedMotion?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function sectionTop(page: Page, id: string) {
  return page.evaluate((i) => document.getElementById(i)?.getBoundingClientRect().top ?? NaN, id);
}

/** Scrolls by `px` once per two frames, so the observer sees every intermediate position. */
async function creep(page: Page, frames: number, px: number) {
  await page.evaluate(
    async ([n, d]) => {
      for (let i = 0; i < n; i++) {
        window.scrollBy({ top: d, behavior: 'instant' });
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      }
    },
    [frames, px] as const,
  );
}

const hash = (page: Page) => page.evaluate(() => location.hash);
const navLink = (page: Page, id: string) => page.locator(`#site-nav a[href="#${id}"]`);

test.describe('active section under slow scrolling', () => {
  test('every section activates when its top creeps across the probe line, and releases on the way back', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'a desktop and a phone viewport are enough');
    test.skip(projectUse(info).colorScheme === 'light', 'theme does not affect tracking');
    test.setTimeout(90_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const line = await page.evaluate((p) => window.innerHeight * p, PROBE);

    for (const [i, id] of IDS.entries()) {
      const prev = i === 0 ? '' : `#${IDS[i - 1]}`;
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(200);
      // Park the top 20px below the line, then creep up across it 1px at a time.
      const top = await sectionTop(page, id);
      await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'instant' }), top - (line + 20));
      await page.waitForTimeout(300);
      await creep(page, 40, 1);
      // Keep reading into the section without any section edge crossing the band.
      await creep(page, 30, 3);
      await expect.poll(() => hash(page), { message: `${id} after its top crossed the line` }).toBe(`#${id}`);
      await expect(navLink(page, id)).toHaveAttribute('aria-current', 'location');

      // And back: creep down until the top is 20px below the line again.
      await creep(page, 30, -3);
      await creep(page, 40, -1);
      expect(await sectionTop(page, id)).toBeGreaterThan(line);
      await expect.poll(() => hash(page), { message: `${id} after its top dropped below the line` }).toBe(prev);
      await expect(navLink(page, id)).not.toHaveAttribute('aria-current', 'location');
    }
  });

  test('small wheel steps through Lenis mark About and Projects', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || projectUse(info).reducedMotion === 'reduce', 'desktop Lenis wheel only');
    test.skip(projectUse(info).colorScheme === 'light', 'theme does not affect tracking');
    test.setTimeout(90_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.mouse.move(700, 450);
    const seen = new Set<string>();
    const projectsTop = await page.evaluate(() => document.getElementById('projects')!.getBoundingClientRect().top + window.scrollY);
    // 100px wheel steps: Lenis eases each one into small per-frame moves.
    for (let i = 0; i < 120 && (await page.evaluate(() => window.scrollY)) < projectsTop + 1500; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(200);
      seen.add(await hash(page));
    }
    await page.waitForTimeout(600);
    seen.add(await hash(page));
    expect([...seen]).toEqual(expect.arrayContaining(['#about', '#skills', '#projects']));
  });
});
