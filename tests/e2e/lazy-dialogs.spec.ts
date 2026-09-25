import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * The first open of a lazily loaded dialog renders in the click's own task once its
 * chunk has been warmed, like every later open. With next/dynamic the lazy component
 * suspended on its first render even with the chunk cached, and React held the retry
 * back until 300ms after the fallback: the project, skill and fit dialogs showed
 * nothing for ~0.16-0.37s on their first open and appeared in 30-60ms on the second.
 */

type ProjectUse = { viewport?: { width: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
/** DOM-timing checks: one desktop project is enough. */
const isReferenceProject = (info: TestInfo) =>
  projectUse(info).viewport?.width === 1440 &&
  !projectUse(info).hasTouch &&
  projectUse(info).reducedMotion !== 'reduce' &&
  projectUse(info).colorScheme === 'dark';

test.beforeEach(async ({ page }, info) => {
  test.skip(!isReferenceProject(info), 'runs on the 1440 dark motion project');
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  // The dialogs' chunks are warmed at idle and when their sections come near.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 5000 })));
  await page.waitForLoadState('networkidle');
});

type Probe = { inClickTask?: boolean; ms?: number };

/**
 * Clicks `trigger` and reports whether a [data-dialog-root] was in the page by the end
 * of the click's task (React commits a discrete update before the task ends unless
 * the render suspended), and how long until the first frame that had one.
 */
async function openDialog(page: Page, trigger: Locator): Promise<Required<Probe>> {
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const w = window as Window & { __dialogProbe?: Probe };
    const probe: Probe = {};
    w.__dialogProbe = probe;
    document.addEventListener(
      'click',
      () => {
        const t0 = performance.now();
        const has = () => document.querySelector('[data-dialog-root]') !== null;
        setTimeout(() => (probe.inClickTask = has()));
        const tick = () => {
          if (has()) probe.ms = performance.now() - t0;
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { capture: true, once: true },
    );
  });
  await trigger.click();
  const handle = await page.waitForFunction(
    () => {
      const p = (window as Window & { __dialogProbe?: Probe }).__dialogProbe;
      return p?.ms !== undefined && p.inClickTask !== undefined ? p : null;
    },
    null,
    { timeout: 10_000 },
  );
  const probe = (await handle.jsonValue()) as Required<Probe>;
  test.info().annotations.push({ type: 'first open (ms)', description: probe.ms.toFixed(0) });
  return probe;
}

test('a project case study renders in the click that opens it, the first time too', async ({ page }) => {
  const probe = await openDialog(page, page.locator('#projects [id^="project-open-"]').first());
  expect(probe.inClickTask, `first frame with the dialog after ${probe.ms.toFixed(0)}ms`).toBe(true);
  await expect(page.locator('[data-dialog-root] [role="dialog"]')).toBeVisible();
});

test('a skill dialog renders in the click that opens it, the first time too', async ({ page }) => {
  const probe = await openDialog(page, page.locator('#skills [data-skill-pill]').first());
  expect(probe.inClickTask, `first frame with the dialog after ${probe.ms.toFixed(0)}ms`).toBe(true);
  await expect(page.locator('#skill-modal-title')).toBeVisible();
});

test('the fit sheet renders in the click that opens it once hovering has fetched it', async ({ page }) => {
  const trigger = page.locator('#about [data-fit-trigger]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.hover();
  const probe = await openDialog(page, trigger);
  expect(probe.inClickTask, `first frame with the dialog after ${probe.ms.toFixed(0)}ms`).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Check fit against your JD' })).toBeVisible();
});
