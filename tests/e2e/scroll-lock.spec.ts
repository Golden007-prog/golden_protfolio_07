import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * useScrollLock with classic scrollbars. Playwright hides scrollbars by default,
 * which turns them into overlays and hides any gutter bug, so this file brings
 * them back (the default for Chrome and Edge on Windows). html has
 * scrollbar-gutter: stable, so locking must not move the page at all.
 */

test.use({
  launchOptions: {
    ...(process.platform === 'win32' ? { args: ['--use-angle=d3d11'] } : {}),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const oneDesktop = (info: TestInfo) =>
  projectUse(info).viewport?.width === 1440 && !projectUse(info).hasTouch && projectUse(info).colorScheme !== 'light';

// Rects catch any move; offsetWidth ignores the curtain's scale transform.
type Layout = { main: string; mainWidth: number; h1: string; padR: string };

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const span = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? `${Math.round(r.left)}..${Math.round(r.right)}` : 'missing';
    };
    const main = document.querySelector<HTMLElement>('#main');
    return { main: span('#main'), mainWidth: main?.offsetWidth ?? -1, h1: span('#hero h1'), padR: document.body.style.paddingRight };
  });
}

test('opening a dialog does not squeeze the page when the gutter is already reserved', async ({ page }, info) => {
  test.skip(!oneDesktop(info), 'one desktop project is enough');
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter);
  test.skip(!gutter.startsWith('stable'), 'the no-gutter fallback pads on purpose');

  const idle = await layout(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('[data-command-palette]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-scroll-lock', '');
  expect(await layout(page)).toEqual(idle);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-command-palette]')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-scroll-lock', '');
  expect(await layout(page)).toEqual(idle);
});

test('the intro curtain lays the hero out at its final width, so nothing jumps on release', async ({ page }, info) => {
  test.skip(!oneDesktop(info) || projectUse(info).reducedMotion === 'reduce', 'the curtain runs with motion only');
  await page.goto('/');
  // Sample while the curtain holds the lock, then again once it lets go.
  await expect(page.locator('html')).toHaveAttribute('data-scroll-lock', '', { timeout: 5000 });
  const locked = await layout(page);
  await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 6000 });
  await expect(page.locator('html')).not.toHaveAttribute('data-scroll-lock', '');
  const released = await layout(page);
  expect(locked.mainWidth).toBe(released.mainWidth);
  expect(locked.padR).toBe('');
});
