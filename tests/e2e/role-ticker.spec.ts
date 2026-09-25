import type { TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * Role ticker layout (#52): a decode frame is always as long as its role, and
 * rotating roles never changes the line's height, so the hero never shifts.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;

type Write = { text: string; lineHeight: number };

test.describe('role ticker layout (#52)', () => {
  test('no decode frame outgrows its role and the line never changes height', async ({ page }, info) => {
    const use = projectUse(info);
    const width = use.viewport?.width ?? 1280;
    // 320 is the width where the longest role wraps; 1440 is the desktop layout.
    test.skip(use.reducedMotion === 'reduce' || use.colorScheme === 'light' || (width !== 320 && width !== 1440), 'dark motion at 320 and 1440');
    test.setTimeout(60_000);

    await page.addInitScript(() => {
      try {
        window.sessionStorage.setItem('ob-seen-loader-v2', '1');
      } catch {
        /* storage blocked */
      }
      // Chrome stamps a frame with the time it began, which under load can be well
      // before a performance.now() read taken later in that frame. Stamp every frame
      // 40ms early so that ordering happens on every decode, not only on a busy phone.
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => cb(t - 40));

      const w = window as Window & { __tickerWrites?: Write[] };
      w.__tickerWrites = [];
      const watch = () => {
        const span = document.querySelector<HTMLElement>('#hero [data-role-text]');
        const line = span?.closest('p');
        if (!span || !line) return void setTimeout(watch, 50);
        new MutationObserver(() => {
          w.__tickerWrites?.push({ text: span.textContent ?? '', lineHeight: line.getBoundingClientRect().height });
        }).observe(span, { childList: true, characterData: true, subtree: true });
      };
      watch();
    });

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 15_000 });
    const line = page.locator('#hero [data-role-ticker] p');
    const settledHeight = await line.evaluate((el) => el.getBoundingClientRect().height);
    // The screen-reader list carries every role, so the spec never drifts from the component.
    const roles = await page.locator('#hero [data-role-ticker] ul.sr-only li').allTextContents();
    expect(roles.length).toBeGreaterThan(1);

    // Two full decodes into later roles; generous for a slow CI main thread.
    const writes = () => page.evaluate(() => (window as Window & { __tickerWrites?: Write[] }).__tickerWrites ?? []);
    const later = roles.slice(1);
    await expect
      .poll(async () => new Set((await writes()).map((w) => w.text).filter((t) => later.includes(t))).size, {
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(2);

    const seen = await writes();
    expect(seen.length).toBeGreaterThan(10);
    const offShape = seen.filter(
      ({ text }) => !roles.some((role) => role.length === text.length && [...role].every((ch, i) => (ch === ' ') === (text[i] === ' '))),
    );
    expect.soft(offShape.map((w) => w.text), 'decode frames that are not the shape of any role').toEqual([]);
    const heights = [...new Set(seen.map((w) => Math.round(w.lineHeight)))];
    expect(heights, 'ticker line heights while decoding').toEqual([Math.round(settledHeight)]);
  });
});
