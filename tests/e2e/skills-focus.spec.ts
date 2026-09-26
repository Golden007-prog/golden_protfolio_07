import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { Page, TestInfo } from '@playwright/test';
import { expect, hasHardwareWebGL, test } from './helpers';

/*
 * Keyboard focus across the skills stage's swaps. Deferred3D replaces the
 * constellation with a Suspense copy of it, then the sphere; the sphere can
 * re-suspend (hidden with display:none behind another copy); touch releases it
 * again. Each swap used to drop focus to <body>, and a dialog opened from a node
 * that was swapped out handed focus back to nothing.
 */

type ProjectUse = { viewport?: { width: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
/** DOM-only checks: one project is enough. */
const isReferenceProject = (info: TestInfo) =>
  projectUse(info).viewport?.width === 1440 && !isTouch(info) && !isReduced(info) && projectUse(info).colorScheme === 'dark';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

const CARRY_JS = stripTypeScriptTypes(
  readFileSync(new URL('../../src/components/shared/focusCarry.ts', import.meta.url), 'utf8'),
).replace(/^export /gm, '');

// The page's swaps, each one task like a React commit: `replace` swaps the list
// for a fresh one, `suspend` hides it behind a copy (Suspense re-suspending),
// `resume` undoes that, `empty` leaves no twin at all.
const STAGE_OPS = `
  const LIST = '<li><button data-node="x">X</button></li><li><button data-node="y" tabindex="-1">Y</button></li>';
  const stage = document.getElementById('stage');
  const make = (id) => Object.assign(document.createElement('ul'), { id, innerHTML: LIST });
  stage.append(make('a'));
  window.stageOps = {
    replace: (id) => stage.replaceChildren(make(id)),
    suspend: () => {
      stage.firstElementChild.style.setProperty('display', 'none', 'important');
      stage.append(make('copy'));
    },
    resume: () => {
      stage.lastElementChild.remove();
      stage.firstElementChild.style.removeProperty('display');
    },
    empty: () => stage.replaceChildren(document.createElement('p')),
  };
  carryFocus(stage, 'data-node');`;

type StageOp = 'replace' | 'suspend' | 'resume' | 'empty';

async function mountStage(page: Page) {
  test.skip(!isReferenceProject(test.info()), 'DOM-only; runs on the 1440 dark motion project');
  await page.setContent(`
    <button id="before">before</button>
    <div id="stage"></div>
    <button id="after">after</button>
    <div id="blank" style="height:200px"></div>`);
  await page.addScriptTag({ content: `${CARRY_JS}\n${STAGE_OPS}` });
  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#a [data-node="x"]')).toBeFocused();
}

/** Runs one swap and reports where focus is on the next frame: '<list id>:<node>', an element id, or BODY. */
function commit(page: Page, op: StageOp, arg?: string): Promise<string> {
  return page.evaluate(
    async ({ op, arg }) => {
      (window as unknown as { stageOps: Record<string, (a?: string) => void> }).stageOps[op](arg);
      await new Promise(requestAnimationFrame);
      const a = document.activeElement;
      if (!a || a === document.body) return 'BODY';
      const node = a.getAttribute('data-node');
      return node ? `${a.closest('ul')?.id}:${node}` : a.id;
    },
    { op, arg },
  );
}

test.describe('carryFocus (synthetic swaps)', () => {
  test('a removed control hands focus to its twin in the same commit', async ({ page }) => {
    await mountStage(page);
    expect(await commit(page, 'replace', 'b')).toBe('b:x');
    expect(await commit(page, 'replace', 'c')).toBe('c:x');
  });

  test('a control hidden with display:none (a re-suspend) hands focus to the shown copy, and back', async ({ page }) => {
    await mountStage(page);
    expect(await commit(page, 'suspend')).toBe('copy:x');
    expect(await commit(page, 'resume')).toBe('a:x');
  });

  test('never pulls focus back once it has left the stage', async ({ page }) => {
    await mountStage(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('#after')).toBeFocused();
    expect(await commit(page, 'replace', 'b')).toBe('after');
  });

  test('a click on nothing lets go, so a later swap leaves focus alone', async ({ page }) => {
    await mountStage(page);
    const blank = (await page.locator('#blank').boundingBox())!;
    await page.mouse.click(blank.x + 20, blank.y + 20);
    await page.waitForTimeout(50);
    expect(await commit(page, 'replace', 'b')).toBe('BODY');
  });

  test('with no twin it gives up instead of grabbing a later one', async ({ page }) => {
    await mountStage(page);
    expect(await commit(page, 'empty')).toBe('BODY');
    expect(await commit(page, 'replace', 'b')).toBe('BODY');
  });
});

/** Where focus is: '<data-node>@<stage mode>', another element's tag, or BODY. */
function focusState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    const node = a.getAttribute('data-node');
    return node ? `${node}@${a.closest('[data-skills-mode]')?.getAttribute('data-skills-mode')}` : a.tagName;
  });
}

test.describe('skills stage keeps keyboard focus across the swap', () => {
  test("Tab from About's last control lands on a node and focus never drops to <body>", async ({ page }, info) => {
    test.skip(isReduced(info), 'reduced motion keeps the constellation, so nothing swaps');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const gl = await hasHardwareWebGL(page);
    // About's last control: the Kaggle strip's link when that section has data, else Save contact.
    const stripMore = page.locator('#about [data-kaggle-strip-more]');
    const save = page.locator('#about a', { hasText: 'Save contact' }).first();
    await save.scrollIntoViewIfNeeded();
    // The strip is a next/dynamic chunk; give it a moment to attach before choosing.
    await stripMore.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const last = (await stripMore.count()) > 0 ? stripMore.first() : save;
    await last.scrollIntoViewIfNeeded();
    await last.focus();

    // One sample per frame, so a <body> that ever reaches the screen is caught.
    await page.evaluate(() => {
      const w = window as Window & { __focusSamples?: string[]; __focusStop?: boolean };
      w.__focusSamples = [];
      w.__focusStop = false;
      const loop = () => {
        const a = document.activeElement;
        const node = a?.getAttribute('data-node');
        const s = !a || a === document.body ? 'BODY' : node ? `${node}@${a.closest('[data-skills-mode]')?.getAttribute('data-skills-mode')}` : a.tagName;
        if (w.__focusSamples!.at(-1) !== s) w.__focusSamples!.push(s);
        if (!w.__focusStop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.keyboard.press('Tab');
    const first = await focusState(page);
    expect(first, "the first Tab after About's last control reaches a stage node").toMatch(/^[\w-]+@(constellation|sphere)$/);
    const slug = first.split('@')[0];

    const stage = page.locator('#skills [data-deferred3d="skills"]');
    if (gl) await stage.locator('[data-skills-mode="sphere"]').waitFor({ timeout: 15_000 }).catch(() => {});
    // Past the sphere's re-suspend on first load.
    await page.waitForTimeout(1500);
    const samples = await page.evaluate(() => {
      const w = window as Window & { __focusSamples?: string[]; __focusStop?: boolean };
      w.__focusStop = true;
      return w.__focusSamples ?? [];
    });
    // Sampling started on About's last control, so any BODY came after the Tab.
    expect(samples, samples.join(' -> ')).not.toContain('BODY');
    expect(await focusState(page)).toMatch(new RegExp(`^${slug}@`));

    await page.keyboard.press('ArrowRight');
    const next = await focusState(page);
    expect(next).toMatch(/^[\w-]+@(sphere|constellation)$/);
    expect(next.split('@')[0]).not.toBe(slug);
  });

  test('a dialog opened from the loading constellation hands focus back to the same node on the sphere', async ({ page }, info) => {
    test.skip(isReduced(info) || isTouch(info), 'needs the sphere swap and a keyboard');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    test.skip(!(await hasHardwareWebGL(page)), 'this browser does not get the WebGL sphere');
    // The dialog's chunk is warmed at idle; let it land before holding back the sphere's.
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 5000 })));
    await page.waitForLoadState('networkidle');
    await page.route('**/_next/static/chunks/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.continue();
    });

    const stage = page.locator('#skills [data-deferred3d="skills"]');
    await stage.scrollIntoViewIfNeeded();
    // Granted, but the chunk is held: the Suspense copy of the constellation stands in.
    await expect(stage).toHaveAttribute('data-state', 'live');
    const node = stage.locator('[data-skills-mode="constellation"] [data-node][tabindex="0"]');
    await node.focus();
    const slug = await node.getAttribute('data-node');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-dialog-root] [data-skill-modal]')).toBeVisible({ timeout: 15_000 });

    // The sphere arrives behind the dialog and takes the opener with it.
    await expect(stage.locator('[data-skills-mode="sphere"]')).toBeVisible({ timeout: 20_000 });
    await expect(stage.locator('[data-skills-mode="constellation"]')).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    await expect.poll(() => focusState(page)).toBe(`${slug}@sphere`);
  });
});
