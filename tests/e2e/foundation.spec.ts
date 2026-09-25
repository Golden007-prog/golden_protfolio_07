import type { Page, TestInfo } from '@playwright/test';
import projects from '../../src/data/projects.json' with { type: 'json' };
import profile from '../../src/data/profile.json' with { type: 'json' };
import { slugify } from '../../src/lib/slug';
import { collectPageErrors, expect, test } from './helpers';

/*
 * Foundation UI kit: providers, Lenis anchors and scroll lock, Dialog, Button,
 * LottieIcon, Toast/Tooltip and the small widgets. Consumer-dependent checks
 * (a CopyButton, a Tooltip, the hero scroll cue) skip with a reason when no
 * consumer renders that primitive yet.
 */

const FIRST_SLUG = slugify(projects[0].name);

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';

/** Skip the intro curtain: it covers the page for a few seconds on a fresh session. */
async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function waitForScrollToSettle(page: Page, timeout = 6000) {
  const end = Date.now() + timeout;
  let last = await page.evaluate(() => window.scrollY);
  while (Date.now() < end) {
    await page.waitForTimeout(200);
    const y = await page.evaluate(() => window.scrollY);
    if (Math.abs(y - last) < 1) return;
    last = y;
  }
}

/** Scrolls to the bottom in steps so lazily mounted sections render. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 60));
    }
  });
}

test.beforeEach(async ({ page }, info) => {
  // The intro tests exercise a real first visit.
  if (!info.titlePath.some((t) => t.startsWith('intro phase'))) await skipIntro(page);
});

test.describe('providers (#14, #11)', () => {
  test('marks html.hydrated and mirrors the motion preference', async ({ page }, info) => {
    const errors = collectPageErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await expect(page.locator('html')).toHaveAttribute('data-motion', isReduced(info) ? 'reduced' : 'full');
    expect(errors.errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  });

  test('reduced motion: a dialog panel enters without a transform', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) < 1024, 'reduced-motion desktop projects only');
    await page.goto(`/?project=${FIRST_SLUG}`);
    const panel = page.locator('[data-dialog-root] [role="dialog"]');
    await expect(panel).toBeVisible();
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
  });
});

test.describe('smooth anchors (#15)', () => {
  test('a #projects link lands under the nav and focuses the section heading', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer projects only');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    if (!isReduced(info)) await expect(page.locator('html')).toHaveClass(/\blenis\b/);
    await expect(page.locator('#projects')).toHaveCount(1);

    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '#projects';
      a.id = 'pw-anchor';
      a.textContent = 'Projects';
      a.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:12px;background:#000;color:#fff';
      document.body.appendChild(a);
    });
    const startY = await page.evaluate(() => window.scrollY);
    await page.click('#pw-anchor');

    if (!isReduced(info)) {
      // A glide passes through intermediate positions; a jump does not.
      await page.waitForFunction((y0) => window.scrollY > y0 + 10, startY);
    }
    await waitForScrollToSettle(page);
    const top = await page.locator('#projects').evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(64);
    expect(top).toBeLessThan(112);

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, id: el.id, inProjects: Boolean(el.closest('#projects')) } : null;
    });
    expect(focused?.inProjects).toBe(true);
    expect(focused?.tag).toBe('H2');
  });
});

test.describe('dialog (#25)', () => {
  test('traps focus, locks the page, wheels its own scroller and survives a selection drag', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer projects only');
    await page.goto(`/?project=${FIRST_SLUG}`);
    const root = page.locator('[data-dialog-root]');
    await expect(root, 'ProjectModal should render through ui/Dialog').toBeVisible();

    // Focus moved in (the trap moves it a frame after the root appears), background inert.
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-dialog-root]')))).toBe(true);
    expect(await page.evaluate(() => Boolean(document.getElementById('main')?.closest('[inert]')))).toBe(true);

    // Tab and Shift+Tab stay inside.
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-dialog-root]'))), key).toBe(true);
    }

    // The wheel scrolls the dialog, not the window.
    const scroller = root.locator('[data-dialog-scroller]').first();
    const scrollable = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
    if (scrollable) {
      const windowY = await page.evaluate(() => window.scrollY);
      const box = await scroller.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(windowY);
    }

    // A text selection dragged out of the panel and released on the backdrop keeps it open.
    const text = root.locator('[role="dialog"] p').first();
    const tb = await text.boundingBox();
    if (tb) {
      await page.mouse.move(tb.x + 4, tb.y + tb.height / 2);
      await page.mouse.down();
      await page.mouse.move(12, 12, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expect(root).toBeVisible();
    }

    // Escape closes it and releases the page.
    await page.keyboard.press('Escape');
    await expect(root).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(document.getElementById('main')?.closest('[inert]')))).toBe(false);
  });

  test('Escape returns focus to the opener', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer projects only');
    await page.goto('/');
    await page.locator('#projects').scrollIntoViewIfNeeded();
    const opener = page
      .locator(
        '#projects :is([aria-haspopup="dialog"], [role="button"][aria-label^="Open "], button[aria-label^="Open "], a[href*="project="])',
      )
      .first();
    test.skip((await opener.count()) === 0, 'no dialog opener found in #projects');
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-dialog-root]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    expect(await opener.evaluate((el) => el === document.activeElement)).toBe(true);
  });
});

test.describe('buttons (#22)', () => {
  test('every Button keeps a 44x44 hit area on a coarse pointer', async ({ page }, info) => {
    test.skip(!isTouch(info), 'coarse-pointer projects only');
    await page.goto('/');
    await scrollThrough(page);
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-button]'))
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
        .map((el) => ({ size: el.dataset.size, w: el.offsetWidth, h: el.offsetHeight, text: el.textContent?.trim().slice(0, 40) })),
    );
    test.skip(sizes.length === 0, 'no ui/Button rendered on / yet');
    const small = sizes.filter((s) => s.w < 44 || s.h < 44);
    expect(small, JSON.stringify(small)).toEqual([]);
  });

  test('external Buttons open safely in a new tab and announce it', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await page.goto('/');
    await scrollThrough(page);
    const links = page.locator('a[data-button][target="_blank"]');
    test.skip((await links.count()) === 0, 'no external ui/Button rendered on / yet');
    for (const link of await links.all()) {
      const rel = (await link.getAttribute('rel')) ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      const name = (await link.getAttribute('aria-label')) ?? (await link.textContent()) ?? '';
      expect(name).toMatch(/opens in new tab/);
    }
    // asChild never nests anchors.
    expect(await page.locator('a a').count()).toBe(0);
  });

  test('a status change reaches the live region (CopyButton)', async ({ page, context, browserName }, info) => {
    test.skip(width(info) !== 1440 || browserName !== 'chromium', 'one chromium viewport is enough');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await scrollThrough(page);
    const copy = page.locator('[data-copy-button]').first();
    test.skip((await copy.count()) === 0, 'no CopyButton rendered on / yet');
    await copy.scrollIntoViewIfNeeded();
    const live = copy.locator('[aria-live="polite"]');
    await expect(live).toHaveText('');
    await copy.click();
    await expect(live).not.toHaveText('');
    await expect(copy).toHaveAttribute('data-status', 'success');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    if (clip.includes('@')) expect(clip).toBe(profile.email);
  });
});

test.describe('lottie (#23)', () => {
  test('reduced motion fetches no Lottie JSON and no player chunk', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) !== 1440, 'one reduced-motion viewport is enough');
    const json: string[] = [];
    const playerChunks: string[] = [];
    page.on('request', (req) => {
      if (/\/lottie\/[^/?]+\.json/.test(req.url())) json.push(req.url());
    });
    page.on('response', async (res) => {
      if (res.request().resourceType() !== 'script') return;
      const body = await res.text().catch(() => '');
      if (body.includes('bodymovin')) playerChunks.push(res.url());
    });
    await page.goto('/');
    await scrollThrough(page);
    await page.waitForTimeout(500);
    expect(json).toEqual([]);
    expect(playerChunks).toEqual([]);
  });

  test('a looping icon pauses offscreen and recolours with the theme', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) !== 1440, 'one full-motion viewport is enough');
    await page.goto('/');
    const cue = page.locator('[data-lottie*="scroll"]').first();
    test.skip((await cue.count()) === 0, 'the hero scroll cue is not a LottieIcon');
    // The cue plays on hover (hero #60), so it only loops while the pointer is on it.
    await page.locator('#hero .hero-cue-button').hover();
    await expect(cue).toHaveAttribute('data-lottie-state', 'playing', { timeout: 10_000 });

    const paint = () =>
      cue.evaluate((el) =>
        Array.from(el.querySelectorAll('path'))
          .map((p) => `${getComputedStyle(p).fill}|${getComputedStyle(p).stroke}`)
          .join(','),
      );
    const before = await paint();
    const flipped = projectUse(info).colorScheme === 'light' ? 'dark' : 'light';
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), flipped);
    await expect.poll(paint, { timeout: 5000 }).not.toBe(before);

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    // Offscreen it pauses; the hover loop also stops once the pointer is no longer on it.
    await expect(cue).toHaveAttribute('data-lottie-state', /paused|stopped/, { timeout: 5000 });
  });

  test('a missing file renders the fallback', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) !== 1440, 'one full-motion viewport is enough');
    await page.route('**/lottie/scroll.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/');
    const cue = page.locator('[data-lottie*="scroll"]').first();
    test.skip((await cue.count()) === 0, 'the hero scroll cue is not a LottieIcon');
    await expect(cue).toHaveAttribute('data-lottie-phase', 'fallback', { timeout: 10_000 });
  });
});

test.describe('toast and tooltip (#24)', () => {
  test('the toast region is a polite live region above the dock', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await page.goto('/');
    const region = page.locator('[data-toast-region]');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // A direct child of <body>, so an open dialog never makes it inert.
    expect(await region.evaluate((el) => el.parentElement === document.body)).toBe(true);
  });

  test('a toast clears after 4s unless hovered', async ({ page, context, browserName }, info) => {
    test.skip(width(info) !== 1440 || browserName !== 'chromium', 'one chromium viewport is enough');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await scrollThrough(page);
    // The hero's copy button confirms inline; the About and Contact ones raise toasts.
    const copy = page.locator('#about [data-copy-button], #contact [data-copy-button]').first();
    test.skip((await copy.count()) === 0, 'no CopyButton rendered on / yet');
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    const toast = page.locator('[data-toast-region] [data-toast]').first();
    const appeared = await toast.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    );
    test.skip(!appeared, 'this CopyButton shows no toast');
    await expect(toast).toHaveCount(0, { timeout: 6000 });

    await copy.click();
    await expect(toast).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(5000);
    await expect(toast).toBeVisible();
  });

  test('a right-edge tooltip stays 8px inside a 360px viewport; touch never opens it', async ({ page }, info) => {
    test.skip(width(info) !== 360 && !isTouch(info), '360px and touch projects only');
    await page.goto('/');
    await scrollThrough(page);
    // The dock (right-most triggers) slides away while scrolling down; at the top it shows.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const triggers = page.locator('[aria-describedby$="-tip"]');
    test.skip((await triggers.count()) === 0, 'no Tooltip rendered on / yet');

    // The right-most visible trigger.
    const index = await triggers.evaluateAll((els) => {
      let best = -1;
      let right = -Infinity;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > right) {
          right = r.right;
          best = i;
        }
      });
      return best;
    });
    test.skip(index < 0, 'no visible Tooltip trigger');
    const trigger = triggers.nth(index);
    await trigger.scrollIntoViewIfNeeded();

    if (isTouch(info)) {
      await trigger.tap();
      await page.waitForTimeout(500);
      await expect(page.locator('[data-tooltip]')).toHaveCount(0);
      return;
    }
    await trigger.hover();
    const tip = page.locator('[data-tooltip]');
    await expect(tip).toBeVisible({ timeout: 2000 });
    const box = await tip.boundingBox();
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box!.x).toBeGreaterThanOrEqual(8 - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw - 8 + 0.5);
  });
});

test.describe('widgets (#26)', () => {
  test('the CV downloads as Oikantik-Basu-CV.pdf', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await page.goto('/');
    await scrollThrough(page);
    // The nav hides while scrolling down (translated offscreen, which :visible still
    // counts), so come back to the top where its CV link is on screen.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const link = page.locator('a[download="Oikantik-Basu-CV.pdf"]:visible').first();
    test.skip((await link.count()) === 0, 'no DownloadCvButton rendered on / yet');
    await link.scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe('Oikantik-Basu-CV.pdf');
  });

  test('social links all have accessible names', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 320, 'two viewports are enough');
    await page.goto('/');
    await scrollThrough(page);
    const links = page.locator('[data-social-links] a');
    test.skip((await links.count()) === 0, 'no SocialLinks rendered on / yet');
    const unnamed = await links.evaluateAll((els) =>
      els.filter((el) => !(el.getAttribute('aria-label') || el.textContent || '').trim()).map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });
});

test.describe('LocalTime in another time zone (#26)', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('hydrates without a mismatch and then shows the time', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    const errors = collectPageErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await scrollThrough(page);
    expect(errors.errors.filter((e) => /hydrat|did not match|server rendered/i.test(e))).toEqual([]);
    const clock = page.locator('[data-local-time]').first();
    if ((await clock.count()) > 0) await expect(clock).not.toHaveText('--:--');
  });
});

test.describe('intro phase (#16)', () => {
  test('a deep link skips the curtain', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await page.goto(`/?project=${FIRST_SLUG}`);
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
  });

  test('a case-study visit then / in the same session skips the curtain', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await page.goto(`/projects/${FIRST_SLUG}`);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
  });
});

test.describe('no-JS safety net (#11)', () => {
  test.use({ javaScriptEnabled: false });

  test('nothing marked data-reveal stays invisible', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto('/');
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-reveal]'))
        .filter((el) => getComputedStyle(el).opacity === '0')
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(hidden).toEqual([]);
  });
});
