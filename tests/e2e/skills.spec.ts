import { createRequire } from 'node:module';
import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import { expect, hasHardwareWebGL, liveWebglContexts, test } from './helpers';

/*
 * Skills package (#75-#91): pills and tooltip, the on-demand skill modal, the
 * sphere / constellation stage, filters and search, the sentiment demo and the
 * tools strip. Checks that need a particular pointer, width or motion setting
 * skip with the reason on the other projects.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';

const ALL_SKILLS = Object.values(profile.skills as Record<string, string[]>).flat();
const GEMINI_PROJECTS = 6;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoSkills(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.locator('#skills').scrollIntoViewIfNeeded();
}

const modal = (page: Page) => page.locator('[data-dialog-root] [data-skill-modal]');
const modalTitle = (page: Page) => page.locator('#skill-modal-title');
const counterText = (i: number, n: number) => new RegExp(`^Skill ${i}\\s*/\\s*of ${n}$`);

test.describe('skill pills and tooltip (#75)', () => {
  test('the tooltip stays inside a 360px viewport', async ({ page }, info) => {
    test.skip(width(info) !== 360 || isTouch(info), '360px mouse projects only');
    await gotoSkills(page);
    const pills = page.locator('#skills [data-skill-pill]');
    const count = await pills.count();
    expect(count).toBeGreaterThan(0);
    // The pill nearest the right edge is the worst case for a centred bubble.
    const index = await pills.evaluateAll((els) => {
      let best = 0;
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
    const pill = pills.nth(index);
    await pill.scrollIntoViewIfNeeded();
    await pill.hover();
    const tip = page.locator('[data-tooltip]');
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await expect(tip).not.toContainText('<b>');
  });

  test('a touch tap opens the modal with no tooltip', async ({ page }, info) => {
    test.skip(!isTouch(info), 'touch projects only');
    await gotoSkills(page);
    const pill = page.locator('#skills [data-skill-pill]').first();
    await pill.scrollIntoViewIfNeeded();
    await expect(pill).toHaveAttribute('aria-haspopup', 'dialog');
    await pill.tap();
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('[data-tooltip]')).toHaveCount(0);
  });
});

test.describe('skill modal (#76, #78, #82, #84, #85)', () => {
  test('/?skill=rag opens RAG, loads its write-up on demand and keeps ?skill', async ({ page }) => {
    const detail = page.waitForResponse((r) => r.url().endsWith('/data/skills/rag.json'));
    await page.goto('/?skill=rag');
    await expect(modalTitle(page)).toHaveText('RAG');
    expect((await detail).status()).toBe(200);
    await expect(page.locator('[data-dialog-root] [role="dialog"]')).toContainText('Purpose');
    await expect(page.locator('[data-dialog-root] [data-skill-modal]')).toHaveCount(1);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    await expect.poll(() => new URL(page.url()).searchParams.get('skill')).toBe('rag');
  });

  test('a failed write-up offers a retry that recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/data/skills/gemini.json', (route) => (fail ? route.abort() : route.continue()));
    await page.goto('/?skill=gemini');
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.locator('[data-dialog-root] [role="dialog"]')).toContainText('Purpose');
  });

  test("'Used in projects' lists the 6 Gemini projects from projects.json", async ({ page }) => {
    await page.goto('/?skill=gemini');
    const used = page.locator('[data-skill-projects] li');
    await expect(used).toHaveCount(GEMINI_PROJECTS);
    const names = await used.locator('p.font-semibold').allTextContents();
    for (const n of names) expect(projects.map((p) => p.name)).toContain(n);
  });

  test("emit('skill:open') opens exactly one modal", async ({ page }) => {
    await gotoSkills(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('ob:skill:open', { detail: { name: 'RAG' } })));
    await expect(modalTitle(page)).toHaveText('RAG');
    await expect(page.locator('[data-skill-modal]')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get('skill')).toBe('rag');
  });

  test('the wheel scrolls the modal, Escape returns focus to the pill, and axe finds no dialog issues', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer projects only');
    await gotoSkills(page);
    const pill = page.locator('#skills [data-skill-pill="rag"]');
    await pill.scrollIntoViewIfNeeded();
    await pill.click();
    await expect(modalTitle(page)).toHaveText('RAG');
    await expect(page.locator('[data-dialog-root] [role="dialog"]')).toContainText('Purpose');

    const scroller = page.locator('[data-dialog-root] [data-dialog-scroller]').first();
    const windowY = await page.evaluate(() => window.scrollY);
    const box = await scroller.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(windowY);

    const require = createRequire(import.meta.url);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (el: Element, o: object) => Promise<{ violations: { id: string }[] }> } }).axe;
      const root = document.querySelector('[data-dialog-root]')!;
      const result = await axe.run(root, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return result.violations.map((v) => v.id);
    });
    expect(violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    await expect.poll(() => pill.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  test('arrows page through the active filter only, with a counter', async ({ page }, info) => {
    test.skip(isTouch(info), 'keyboard projects only');
    await gotoSkills(page);
    const category = 'Agentic AI';
    const inCategory = (profile.skills as Record<string, string[]>)[category];
    await page.locator('#skills [role="radio"]', { hasText: category }).click();
    // Pills leaving the previous filter still match while they animate out.
    await expect(page.locator('#skills [data-skill-pill]')).toHaveCount(inCategory.length);
    const first = page.locator('#skills [data-skill-pill]').first();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    // Visually '1 / 9'; screen readers get 'Skill 1 of 9' from sr-only words in between.
    await expect(page.locator('[data-skill-counter]')).toHaveText(counterText(1, inCategory.length));
    for (let i = 0; i < inCategory.length + 1; i++) {
      await page.keyboard.press('ArrowRight');
      const title = (await modalTitle(page).textContent())?.trim() ?? '';
      expect(inCategory).toContain(title);
    }
    await expect(page.locator('[data-skill-counter]')).toHaveText(counterText(2, inCategory.length));
  });

  test('reduced motion: the modal opens without a layout morph', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) < 1024 || isTouch(info), 'reduced-motion desktop projects only');
    await gotoSkills(page);
    const pill = page.locator('#skills [data-skill-pill]').first();
    await pill.scrollIntoViewIfNeeded();
    await pill.click();
    const panel = page.locator('[data-dialog-root] [role="dialog"]');
    await expect(panel).toBeVisible();
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
  });
});

test.describe('stage: sphere or constellation (#77, #79, #80, #81, #91)', () => {
  test('reduced motion shows the constellation and never creates a WebGL context', async ({ page }, info) => {
    test.skip(!isReduced(info), 'reduced-motion projects only');
    const three: string[] = [];
    page.on('request', (r) => {
      if (/SkillSphere|three/i.test(r.url()) && r.resourceType() === 'script') three.push(r.url());
    });
    await gotoSkills(page);
    const stage = page.locator('#skills [data-deferred3d="skills"]');
    await stage.scrollIntoViewIfNeeded();
    await expect(stage.locator('[data-skills-mode="constellation"]')).toBeVisible();
    await page.waitForTimeout(800);
    expect(await liveWebglContexts(page)).toBe(0);
    const box = await stage.boundingBox();
    expect(box!.height).toBeGreaterThan(200);
  });

  test('with WebGL unavailable the constellation shows (no empty box)', async ({ page }, info) => {
    test.skip(isReduced(info), 'motion projects only');
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) return null;
        return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof original;
    });
    await gotoSkills(page);
    const stage = page.locator('#skills [data-deferred3d="skills"]');
    await stage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await expect(stage.locator('[data-skills-mode="constellation"]')).toBeVisible();
    expect(await stage.locator('[data-node]').count()).toBeGreaterThan(0);
  });

  test('constellation labels come from profile.skills and never clip the viewport', async ({ page }, info) => {
    test.skip(!isReduced(info), 'the constellation is guaranteed under reduced motion');
    await gotoSkills(page);
    const nodes = page.locator('#skills [data-skills-mode="constellation"] [data-node]');
    await nodes.first().scrollIntoViewIfNeeded();
    const report = await nodes.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute('aria-label') ?? '', left: r.left, right: r.right, w: r.width, h: r.height };
      }),
    );
    const vw = width(info);
    for (const n of report) {
      expect(ALL_SKILLS).toContain(n.label.split(', ')[0]);
      expect(n.left, n.label).toBeGreaterThanOrEqual(0);
      expect(n.right, n.label).toBeLessThanOrEqual(vw);
      expect(n.w).toBeGreaterThanOrEqual(44);
      expect(n.h).toBeGreaterThanOrEqual(44);
    }
  });

  test('the sphere uses no CDN font, draws at most 5 calls a frame and stops offscreen', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) < 1024 || isTouch(info), 'desktop full-motion projects only');
    const cdn: string[] = [];
    page.on('request', (r) => {
      if (/cdn\.jsdelivr\.net/.test(r.url())) cdn.push(r.url());
    });
    await gotoSkills(page);
    const stage = page.locator('#skills [data-deferred3d="skills"]');
    await stage.scrollIntoViewIfNeeded();
    const live = await stage
      .locator('[data-skills-mode="sphere"]')
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!live, 'this browser did not mount the WebGL sphere (software GL or low-power heuristics)');
    await expect.poll(() => page.evaluate(() => window.__skillSphere?.frames ?? 0), { timeout: 15000 }).toBeGreaterThan(5);
    const calls = await page.evaluate(() => window.__skillSphere?.drawCalls ?? 99);
    expect(calls).toBeLessThanOrEqual(5);
    expect(cdn).toEqual([]);

    // Scroll far away: the frame loop stops.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(800);
    const a = await page.evaluate(() => window.__skillSphere?.frames ?? 0);
    await page.waitForTimeout(800);
    const b = await page.evaluate(() => window.__skillSphere?.frames ?? 0);
    expect(b - a).toBeLessThanOrEqual(1);
  });

  test('a vertical swipe over the stage belongs to the page', async ({ page }, info) => {
    test.skip(!isTouch(info) || isReduced(info), 'touch full-motion projects only');
    await gotoSkills(page);
    const sphere = page.locator('#skills [data-skills-mode="sphere"]');
    const live = await sphere
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!live, 'the WebGL sphere did not mount here');
    expect(await sphere.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });

  test('keyboard: arrows move between nodes, the live region names the node, Enter opens it', async ({ page }, info) => {
    test.skip(isTouch(info), 'keyboard projects only');
    await gotoSkills(page);
    const stage = page.locator('#skills [data-deferred3d="skills"]');
    await stage.scrollIntoViewIfNeeded();
    // Let the stage settle: with full motion and a GPU the sphere replaces the
    // constellation (at any width), and a node focused before the swap is gone.
    if (!isReduced(info) && (await hasHardwareWebGL(page))) {
      await stage.locator('[data-skills-mode="sphere"]').waitFor({ timeout: 15000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    const first = stage.locator('[data-node-list] [data-node][tabindex="0"]').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    expect(focusedLabel).toMatch(/, /);
    const [name, category] = focusedLabel.split(', ');
    await expect(page.locator('[data-skills-selection]')).toHaveText(`${name} selected, ${category}`);
    await page.keyboard.press('Enter');
    await expect(modalTitle(page)).toHaveText(name);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
  });
});

test.describe('filters and search (#87)', () => {
  test("searching 'vector' shows only matches and announces the count", async ({ page }) => {
    await gotoSkills(page);
    const search = page.getByRole('searchbox', { name: 'Search skills' });
    await search.scrollIntoViewIfNeeded();
    await search.fill('vector');
    const pills = page.locator('#skills [data-skill-pill]');
    const count = page.locator('[data-skills-count]');
    await expect(count).toContainText('vector');
    // Pills that no longer match still match the selector while they animate out,
    // so wait for the list to settle on the announced number.
    const announced = Number((await count.textContent())?.match(/\d+/)?.[0] ?? NaN);
    await expect(pills).toHaveCount(announced);
    const slugs = await pills.evaluateAll((els) => els.map((el) => el.getAttribute('data-skill-pill')));
    expect(slugs).toContain('vectorization');
    expect(slugs.length).toBeLessThan(ALL_SKILLS.length);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(pills).toHaveCount(ALL_SKILLS.length);
  });

  test('coarse pointer: every interactive element in #skills is at least 44x44', async ({ page }, info) => {
    test.skip(!isTouch(info), 'coarse-pointer projects only');
    await gotoSkills(page);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#skills :is(a[href], button, input, textarea, [role="radio"])'))
        .filter((el) => el.getClientRects().length > 0 && !el.closest('.sr-only') && getComputedStyle(el).visibility !== 'hidden')
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), what: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) };
        })
        .filter((s) => s.w < 44 || s.h < 44),
    );
    expect(small, JSON.stringify(small)).toEqual([]);
  });
});

test.describe('sentiment demo (#86)', () => {
  test('negation scores correctly and the result is announced', async ({ page }) => {
    await gotoSkills(page);
    const box = page.getByRole('textbox', { name: 'Text to analyse' });
    await box.scrollIntoViewIfNeeded();
    await box.fill("I don't love it");
    await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'negative');
    await expect(page.locator('[data-sentiment-live]')).toContainText('Sentiment negative');
    await box.fill("It isn't slow");
    await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'positive');
    await box.fill('');
    await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'idle');
  });

  test('the textarea is at least 16px on phones (no iOS zoom)', async ({ page }, info) => {
    test.skip(width(info) >= 768, 'below md only');
    await gotoSkills(page);
    const size = await page
      .getByRole('textbox', { name: 'Text to analyse' })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe('tools strip (#89)', () => {
  test('values are never truncated; paused motion shows a static grid', async ({ page }, info) => {
    test.skip(width(info) !== 1024 && width(info) !== 1440, 'desktop widths only');
    await page.goto('/');
    const strip = page.locator('[data-tools-strip]');
    await strip.scrollIntoViewIfNeeded();
    if (isReduced(info)) await expect(strip.locator('[data-tools-static]')).toBeVisible();
    const clipped = await strip.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('p')).filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent),
    );
    expect(clipped).toEqual([]);
  });
});
