import type { Page, Request, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import { collectPageErrors, expect, test } from './helpers';

/*
 * Package "contact": live-data routes, heatmaps, the contact form, the floating
 * dock, AskMeBot, the ambient sound toggle and the latest-push pill (#105-#118).
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
const oneProject = (info: TestInfo) => width(info) === 1440 && !isReduced(info) && !isLight(info);

// Hosts the browser must never call for live data: only our own /api routes may.
const THIRD_PARTY_LIVE = /api\.github\.com|github-contributions-api|leetcode\.com\/graphql|alfa-leetcode-api|leetcode-stats-api/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoSection(page: Page, id: string) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
}

/**
 * Scrolls step by step so LazyMount and IntersectionObserver consumers run. A list
 * ('a, b') is an order of preference, not a document-order match: it keeps stepping
 * down until the first selector exists (lazy content mounts only when near), then
 * settles on the first one found.
 */
async function scrollTo(page: Page, selector: string) {
  await page.evaluate(async (sel) => {
    const options = sel.split(',').map((s) => s.trim());
    // Two frames, so IntersectionObserver has reported and LazyMount has committed
    // before the next step (a bare timeout can outrun both on a busy machine).
    const pause = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));
    const bottom = () => document.documentElement.scrollHeight - window.innerHeight;
    while (!document.querySelector(options[0]) && window.scrollY < bottom() - 1) {
      window.scrollTo({ top: window.scrollY + window.innerHeight * 0.7, behavior: 'instant' });
      await pause();
    }
    const target = options.map((s) => document.querySelector(s)).find(Boolean);
    if (!target) return;
    const goal = target.getBoundingClientRect().top + window.scrollY - 120;
    for (let y = window.scrollY; y < goal; y += window.innerHeight * 0.7) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo({ top: goal, behavior: 'instant' });
  }, selector);
}

async function waitForDock(page: Page) {
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');
  return dock;
}

test.describe('live-data routes (#105)', () => {
  test('GET /api/leetcode returns solves, from LeetCode or the snapshot', async ({ request }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    const res = await request.get('/api/leetcode');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.totalSolved).toBe('number');
    expect(body.totalSolved).toBeGreaterThan(0);
    expect(body.easy + body.medium + body.hard).toBeLessThanOrEqual(body.totalSolved);
    expect(typeof body.calendar).toBe('object');
    expect(body.username).toBe(new URL(profile.links.leetcode).pathname.split('/').filter(Boolean).pop());
  });

  test('GET /api/github returns contributions and the latest push link', async ({ request }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    const res = await request.get('/api/github');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.contributions.days)).toBe(true);
    expect(body.contributions.days.length).toBeGreaterThan(300);
    expect(body.latestPush?.url).toMatch(/^https:\/\/github\.com\//);
  });

  test('the widgets make no third-party browser requests', async ({ page }, info) => {
    test.skip(width(info) < 1024, 'desktop projects only');
    const offenders: string[] = [];
    page.on('request', (req: Request) => {
      if (THIRD_PARTY_LIVE.test(req.url())) offenders.push(req.url());
    });
    await page.goto('/');
    await scrollTo(page, '[data-heatmap="leetcode"], #experience');
    await expect(page.locator('[data-heatmap="github"]')).toHaveAttribute('data-state', /ready|error/, { timeout: 20_000 });
    await expect(page.locator('[data-heatmap="leetcode"]')).toHaveAttribute('data-state', /ready|error/, { timeout: 20_000 });
    expect(offenders).toEqual([]);
  });
});

test.describe('heatmaps (#106, #107)', () => {
  test('no layout shift when the data lands, newest week in view, few animated nodes', async ({ page }, info) => {
    test.skip(isTouch(info) && width(info) > 400, 'phones and desktops cover it');
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/github', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/');
    await scrollTo(page, '[data-heatmap="github"], #experience');
    const card = page.locator('[data-heatmap="github"]');
    await expect(card).toHaveAttribute('data-state', 'loading', { timeout: 15_000 });
    const before = await card.evaluate((el) => el.getBoundingClientRect().height);
    release();
    await expect(card).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    const after = await card.evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);

    const scroller = card.locator('.cg-scroller');
    const view = await scroller.evaluate((el) => {
      const cells = el.querySelectorAll('[data-i]');
      const last = cells[cells.length - 1].getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { lastRight: last.right, boxRight: box.right, boxLeft: box.left, animated: el.querySelectorAll('[style*="transform"]').length };
    });
    expect(view.lastRight).toBeLessThanOrEqual(view.boxRight + 1);
    expect(view.lastRight).toBeGreaterThan(view.boxLeft);
    expect(view.animated).toBeLessThan(60);
  });

  test('empty days stay visible in the light theme', async ({ page }, info) => {
    test.skip(!isLight(info) || width(info) !== 1440, 'light desktop only');
    await page.goto('/');
    await scrollTo(page, '[data-heatmap="github"], #experience');
    const cell = page.locator('[data-heatmap] [data-level="0"][data-i]').first();
    await expect(cell).toBeVisible({ timeout: 20_000 });
    const style = await cell.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow }));
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.shadow).not.toBe('none');
  });

  test('arrow keys move a day cursor and announce each day', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'keyboard desktop projects only');
    await page.goto('/');
    await scrollTo(page, '[data-heatmap="github"], #experience');
    const grid = page.locator('[data-heatmap="github"] [data-heat-grid]');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await expect(grid).toHaveAttribute('role', 'img');
    await expect(grid).toHaveAttribute('aria-label', /contributions? in the last year/);
    await grid.focus();
    await page.keyboard.press('ArrowLeft');
    const live = page.locator('[data-heatmap="github"] [data-heat-live]');
    await expect(live).toHaveText(/^[\d,]+ contributions? · (Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{1,2} \w{3} \d{4}$/);
    const first = await live.textContent();
    await page.keyboard.press('ArrowUp');
    await expect(live).not.toHaveText(first ?? '');
    await expect(page.locator('[data-heatmap="github"] [data-heat-tip]')).not.toHaveAttribute('data-hidden', '');
  });

  test('the LeetCode donut adds up to totalSolved and says all-time', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two widths are enough');
    await page.goto('/');
    await scrollTo(page, '[data-heatmap="leetcode"], #experience');
    const card = page.locator('[data-heatmap="leetcode"]');
    await expect(card).toHaveAttribute('data-state', /ready|error/, { timeout: 20_000 });
    test.skip((await card.getAttribute('data-state')) === 'error', 'LeetCode route unavailable in this environment');
    const total = Number(await card.locator('[data-leetcode-total]').getAttribute('data-leetcode-total'));
    const parts = await card.locator('[data-segment]').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-count'))));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    await expect(card).toContainText('solved all-time');
  });
});

test.describe('contact canvas (#108)', () => {
  test('no envelope model is requested at the top of the page', async ({ page }) => {
    const glb: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('holo-envelope.glb')) glb.push(req.url());
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.waitForTimeout(2500);
    expect(glb).toEqual([]);
  });

  test('reduced motion shows the poster instead of a canvas', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) < 1024, 'reduced desktop only');
    await gotoSection(page, 'contact');
    const slot = page.locator('[data-deferred3d="contact"]');
    await expect(slot).toHaveAttribute('data-state', 'fallback');
    await expect(slot.locator('img')).toBeVisible();
    await expect(slot.locator('canvas')).toHaveCount(0);
  });
});

test.describe('contact form (#110, #111)', () => {
  test('an invalid email is flagged on blur and described', async ({ page }) => {
    await gotoSection(page, 'contact');
    const email = page.locator('#contact input[name="email"]');
    await email.fill('not-an-email');
    await email.blur();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy!.split(' ')[0]}"]`)).toContainText('email');
    await expect(page.locator('#contact textarea[name="message"]')).toHaveAttribute('aria-describedby', /count/);
    await expect(page.locator('#contact input[name="name"]')).toHaveAttribute('autocomplete', 'name');
  });

  test('an offline submit shows friendly copy in the status region', async ({ page, context }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two widths are enough');
    await gotoSection(page, 'contact');
    await page.locator('#contact input[name="name"]').fill('Playwright');
    await page.locator('#contact input[name="email"]').fill('pw@example.com');
    await page.locator('#contact textarea[name="message"]').fill('Hello from the contact spec.');
    const status = page.locator('#contact [data-contact-status]');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('');
    await context.setOffline(true);
    await page.locator('#contact [data-contact-submit]').click();
    await expect(status).toHaveText(/offline|connection|email me directly/i, { timeout: 16_000 });
    await expect(status).not.toContainText(/Failed to fetch|TypeError/);
    await expect(page.locator('#contact [data-mailto-fallback]')).toHaveAttribute('href', /^mailto:/);
    await context.setOffline(false);
  });

  test('a reload restores the draft, and Clear removes it', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two widths are enough');
    await gotoSection(page, 'contact');
    await page.locator('#contact textarea[name="message"]').fill('A saved draft message.');
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await expect(page.locator('#contact textarea[name="message"]')).toHaveValue('A saved draft message.');
    await expect(page.locator('#contact [data-draft-restored]')).toBeVisible();
    await page.locator('#contact [data-draft-restored] button').click();
    await expect(page.locator('#contact textarea[name="message"]')).toHaveValue('');
  });

  test('tel link has no spaces, kicker reads 06 / Contact, every link is named', async ({ page }) => {
    await gotoSection(page, 'contact');
    const tel = await page.locator('#contact a[href^="tel:"]').first().getAttribute('href');
    expect(tel).toBe('tel:+917001124396');
    await expect(page.locator('#contact header')).toContainText('06 / Contact');
    const unnamed = await page.locator('#contact a').evaluateAll((links) =>
      links
        .filter((a) => a.getClientRects().length > 0)
        .filter((a) => !(a.getAttribute('aria-label') || a.textContent || '').trim())
        .map((a) => a.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
    for (const name of ['GitHub', 'LinkedIn', 'LeetCode']) {
      await expect(page.locator(`#contact a[aria-label^="${name}"]`)).toHaveCount(1);
    }
  });

  test('intent chips toggle aria-pressed', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    await gotoSection(page, 'contact');
    const chip = page.locator('#contact [data-intent="research"]');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('contact border (#112)', () => {
  test('draws with scroll on desktop and is static on lite devices', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isReduced(info), 'desktop motion projects only');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const border = page.locator('#contact [data-contact-border]');
    const lite = await page.evaluate(() => document.documentElement.hasAttribute('data-lite'));
    await scrollTo(page, '#contact');
    if (lite) {
      await expect(border).toHaveAttribute('data-static', '');
      return;
    }
    const sweepAt = () => border.evaluate((el) => getComputedStyle(el).getPropertyValue('--contact-sweep').trim());
    await page.evaluate(() => {
      const el = document.getElementById('contact')!;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.8, behavior: 'instant' });
    });
    await page.waitForTimeout(400);
    const early = parseFloat(await sweepAt());
    await page.evaluate(() => {
      const el = document.getElementById('contact')!;
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: r.top + window.scrollY + r.height / 2 - window.innerHeight / 2, behavior: 'instant' });
    });
    await page.waitForTimeout(400);
    const late = parseFloat(await sweepAt());
    expect(late).toBeGreaterThan(early);
  });
});

test.describe('AskMeBot (#113, #114, #115)', () => {
  test('desktop panel: labelled dialog, 16px input, wheel scrolls the log, Esc returns focus', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer projects only');
    await page.goto('/');
    await waitForDock(page);
    const launcher = page.locator('[data-ask-launcher]');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await launcher.click();
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('[data-ask-panel]');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(launcher).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
    await expect(panel.locator('[data-ask-subtitle]')).toHaveText("Answers from this site's data · AI-assisted for open questions");
    // The log is silent (its bubbles hold buttons and links); each answer's words are spoken from [data-ask-speak].
    await expect(panel.locator('[role="log"]')).toHaveAttribute('aria-live', 'off');
    await expect(panel.locator('[data-ask-speak]')).toHaveAttribute('aria-live', 'polite');
    const input = panel.locator('input');
    await expect(input).toHaveAccessibleName('Ask a question');
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

    for (let i = 0; i < 4; i++) {
      await input.fill('Which projects use Gemini?');
      await input.press('Enter');
      await expect(panel.locator('[data-ask-answer="skill"]')).toHaveCount(i + 1, { timeout: 3000 });
    }
    const log = panel.locator('[data-ask-log]');
    await log.evaluate((el) => (el.scrollTop = 0));
    const windowY = await page.evaluate(() => window.scrollY);
    const box = (await log.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(windowY);

    await input.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await launcher.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  test('phones get a bottom sheet that stays clear of the nav', async ({ page }, info) => {
    test.skip(width(info) >= 640, 'phone projects only');
    await page.goto('/');
    await waitForDock(page);
    // At 320x568 the dock stays tucked over the hero's calls to action; focus brings it back.
    await page.locator('[data-ask-launcher]').focus();
    await page.locator('[data-ask-launcher]').click();
    const sheet = page.locator('[data-dialog-root] [role="dialog"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-ask-sheet]')).toHaveCount(1);
    const top = (await sheet.boundingBox())!.y;
    const navBottom = await page.evaluate(() => {
      const nav = document.getElementById('site-nav');
      return nav ? nav.getBoundingClientRect().bottom : 88;
    });
    expect(top).toBeGreaterThanOrEqual(navBottom - 1);
    const input = sheet.locator('input');
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('UrbanCare answers with its card; the handoff pre-fills the message', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two widths are enough');
    await page.goto('/');
    await waitForDock(page);
    await page.locator('[data-ask-launcher]').click();
    const input = page.locator('[data-ask-panel] input, [data-ask-sheet] input').first();
    await input.fill('Tell me about UrbanCare');
    await input.press('Enter');
    const card = page.locator('[data-ask-project="urbancare-ai"]');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card).toContainText('Show in Projects');
    if (isReduced(info)) await expect(page.locator('[data-ask-typing]')).toHaveCount(0);
    await page.locator('[data-ask-handoff]').last().click();
    await expect(page.locator('#contact textarea[name="message"]')).toHaveValue(/UrbanCare AI/, { timeout: 5000 });
    await expect(page.locator('#contact textarea[name="message"]')).toBeFocused();
  });

  test('"Show in Projects" opens the project', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    await page.goto('/');
    await waitForDock(page);
    await page.locator('[data-ask-launcher]').click();
    const input = page.locator('[data-ask-panel] input');
    await input.fill('Tell me about UrbanCare');
    await input.press('Enter');
    await page.locator('[data-ask-project="urbancare-ai"] button', { hasText: 'Show in Projects' }).click();
    await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get('project')), { timeout: 5000 }).toBe('urbancare-ai');
  });
});

test.describe('ambient sound (#116)', () => {
  test('on, off, on within 900ms leaves it playing', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      const made: AudioContext[] = [];
      (window as Window & { __audio?: AudioContext[] }).__audio = made;
      window.AudioContext = class extends Native {
        constructor(opts?: AudioContextOptions) {
          super(opts);
          made.push(this);
        }
      };
    });
    await page.goto('/');
    await waitForDock(page);
    const toggle = page.locator('[data-sound-toggle]');
    await toggle.click();
    await toggle.click();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const list = (window as Window & { __audio?: AudioContext[] }).__audio ?? [];
      return { count: list.length, state: list[0]?.state };
    });
    expect(state.count).toBe(1);
    expect(state.state).toBe('running');
    await expect(toggle).toHaveAccessibleName('Ambient sound');
  });

  test('blocked storage does not crash the page', async ({ page }, info) => {
    test.skip(!oneProject(info), 'one project is enough');
    await page.addInitScript(() => {
      const deny = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: deny, configurable: true });
      Object.defineProperty(window, 'sessionStorage', { get: deny, configurable: true });
    });
    const errors = collectPageErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await expect(page.locator('#contact')).toHaveCount(1);
    expect(errors.errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
  });
});

test.describe('floating dock (#117) and latest push (#118)', () => {
  test('at the end of the page the dock covers no footer link', async ({ page }, info) => {
    test.skip(width(info) > 400, 'phone widths only');
    await page.goto('/');
    await waitForDock(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(600);
    const blocked = await page.evaluate(() => {
      const footer = document.getElementById('site-footer') ?? document.querySelector('footer');
      if (!footer) return ['no footer'];
      return Array.from(footer.querySelectorAll<HTMLElement>('a, button'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
        })
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          // This package answers for the dock; other fixed UI (BackToTop) has its own spec.
          return Boolean(hit?.closest('[data-dock]'));
        })
        .map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName);
    });
    expect(blocked).toEqual([]);
  });

  test('sits at the safe-area clearance on z-dock, below the nav', async ({ page }, info) => {
    test.skip(!oneProject(info) && width(info) !== 360, 'two widths are enough');
    await page.goto('/');
    const dock = await waitForDock(page);
    const s = await dock.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, z: cs.zIndex, bottom: parseFloat(cs.bottom) };
    });
    expect(s.position).toBe('fixed');
    expect(s.z).toBe('45');
    expect(s.bottom).toBeGreaterThanOrEqual(24);
  });

  test('a toast never overlaps the dock', async ({ page, context }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two widths are enough');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const dock = await waitForDock(page);
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.locator('#contact [data-copy-button]').first().click();
    const toast = page.locator('[data-toast]').first();
    await expect(toast).toBeVisible();
    // A lifted dock steps aside when a toast arrives; judge where it settles, not mid-fade.
    await page.waitForTimeout(100);
    await dock.locator('.dock-inner').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const [a, b] = [await toast.boundingBox(), await dock.locator('.dock-inner').boundingBox()];
    if (a && b && (await dock.locator('.dock-inner').evaluate((el) => getComputedStyle(el).opacity !== '0'))) {
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
  });

  test('the push pill waits for the hero, ticks relative time and nests nothing', async ({ page }, info) => {
    test.skip(width(info) < 360 || (!oneProject(info) && width(info) !== 375), 'two widths are enough');
    await page.goto('/');
    await waitForDock(page);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-live-status]')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    const pill = page.locator('[data-live-status]');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    // The dock slides away while scrolling down and returns on any upward scroll.
    await page.evaluate(() => window.scrollBy({ top: -60, behavior: 'instant' }));
    await expect(page.locator('[data-dock]')).not.toHaveAttribute('data-hidden', '');
    await expect(pill.locator('a')).toContainText(/(just now|\d+[mhd] ago|\d{1,2} \w{3})/);
    expect(await pill.locator('a button, a a').count()).toBe(0);
    await pill.getByRole('button', { name: 'Dismiss latest push' }).click();
    await expect(pill).toHaveCount(0);
  });
});
