import type { Page, TestInfo } from '@playwright/test';
import { expect, hasHardwareWebGL, test } from './helpers';

/*
 * Main-thread cost of overlays and of the hero's first WebGL frame:
 * the phone menu restyles the page for `inert` only after the tap has painted,
 * the hero canvas stops drawing under an open dialog, and the hero model's first
 * frame never waits on a shader link (the PMREM GGX filter used to block ~0.4 s).
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isDesktopMotion = (info: TestInfo) => width(info) === 1440 && !isReduced(info) && !isTouch(info);

function skipIntroScript() {
  try {
    window.sessionStorage.setItem('ob-seen-loader-v2', '1');
  } catch {
    /* storage blocked */
  }
}

async function hydrated(page: Page) {
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
}

/** Counts WebGL draw calls made for the hero canvas. */
function drawCounterScript() {
  const counts = new WeakMap<HTMLCanvasElement | OffscreenCanvas, number>();
  const w = window as Window & { __heroDraws?: () => number };
  w.__heroDraws = () => {
    const canvas = document.querySelector('[data-hero-canvas] canvas');
    return canvas instanceof HTMLCanvasElement ? (counts.get(canvas) ?? 0) : -1;
  };
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = (proto as unknown as Record<string, unknown>)[name];
      if (typeof original !== 'function') continue;
      (proto as unknown as Record<string, unknown>)[name] = function (this: WebGLRenderingContext, ...args: unknown[]) {
        counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
  }
}

/**
 * The longest single wait on a program or shader status query, per SHADER_NAME. Such
 * a query blocks until the driver finishes linking, so a long one is a synchronous link.
 */
function linkWaitScript() {
  const names = new WeakMap<object, string>();
  const longest: Record<string, number> = {};
  (window as Window & { __linkWait?: Record<string, number> }).__linkWait = longest;
  const note = (key: object, ms: number) => {
    const name = names.get(key) ?? '?';
    longest[name] = Math.max(longest[name] ?? 0, Math.round(ms));
  };
  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype] as unknown as Record<string, unknown>[]) {
    const source = proto.shaderSource as (this: unknown, shader: object, src: string) => void;
    proto.shaderSource = function (this: unknown, shader: object, src: string) {
      const match = /#define SHADER_NAME (\S+)/.exec(src);
      if (match) names.set(shader, match[1]);
      return source.call(this, shader, src);
    };
    const attach = proto.attachShader as (this: unknown, program: object, shader: object) => void;
    proto.attachShader = function (this: unknown, program: object, shader: object) {
      const name = names.get(shader);
      if (name) names.set(program, name);
      return attach.call(this, program, shader);
    };
    for (const fn of ['getProgramParameter', 'getProgramInfoLog', 'getShaderParameter', 'getShaderInfoLog']) {
      const original = proto[fn] as (this: unknown, obj: object, ...rest: unknown[]) => unknown;
      proto[fn] = function (this: unknown, obj: object, ...rest: unknown[]) {
        const t = performance.now();
        const result = original.call(this, obj, ...rest);
        note(obj, performance.now() - t);
        return result;
      };
    }
  }
}

test.describe('phone menu', () => {
  test('paints its first frame before the page restyles for inert, when opening and when closing', async ({ page }, info) => {
    test.skip(width(info) >= 768, 'phone widths only');
    await page.addInitScript(skipIntroScript);
    // What the first frame after each click sees: a capture listener's rAF runs ahead of Dialog's.
    await page.addInitScript(() => {
      const w = window as Window & { __tapFrames?: { inert: number; focus: string | null }[] };
      w.__tapFrames = [];
      addEventListener(
        'click',
        () =>
          requestAnimationFrame(() => {
            w.__tapFrames!.push({
              inert: document.querySelectorAll('body > [inert]').length,
              focus: document.activeElement?.getAttribute('aria-label') ?? null,
            });
          }),
        true,
      );
    });
    await page.goto('/');
    await hydrated(page);
    const takeFrame = () =>
      page.evaluate(() => (window as Window & { __tapFrames?: { inert: number; focus: string | null }[] }).__tapFrames!.splice(0)[0]);
    const inertCount = () => page.evaluate(() => document.querySelectorAll('body > [inert]').length);

    const burger = page.locator('#site-nav').getByRole('button', { name: 'Menu' });
    const dialog = page.getByRole('dialog', { name: 'Site menu' });
    const close = dialog.getByRole('button', { name: 'Close menu' });

    await burger.click();
    await expect(close).toBeFocused();
    await expect.poll(inertCount).toBeGreaterThan(0);
    expect(await takeFrame(), 'first frame after opening: page not inert yet, focus still on the burger').toEqual({
      inert: 0,
      focus: 'Menu',
    });

    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(burger).toBeFocused();
    await expect.poll(inertCount).toBe(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-scroll-lock', '');
    const closing = await takeFrame();
    expect(closing.inert, 'first frame after closing: the page is released after it paints').toBeGreaterThan(0);
    expect(closing.focus).toBe('Close menu');
  });
});

test.describe('hero canvas', () => {
  test('stops drawing while a dialog covers it and resumes after', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(60_000);
    await page.addInitScript(skipIntroScript);
    await page.addInitScript(drawCounterScript);
    await page.goto('/');
    await hydrated(page);
    test.skip(!(await hasHardwareWebGL(page)), 'software WebGL here, so the hero serves its still and has no live canvas');
    await expect(page.locator('[data-hero-canvas]')).toHaveAttribute('data-ready', '', { timeout: 30_000 });
    const draws = () => page.evaluate(() => (window as Window & { __heroDraws?: () => number }).__heroDraws?.() ?? -1);

    const d0 = await draws();
    await page.waitForTimeout(800);
    expect(await draws()).toBeGreaterThan(d0);

    await page.locator('[data-palette-trigger]').click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.waitForTimeout(600);
    const d1 = await draws();
    await page.waitForTimeout(1200);
    expect(await draws(), 'no draws under the open palette').toBe(d1);

    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    const d2 = await draws();
    await page.waitForTimeout(800);
    expect(await draws(), 'drawing again once it closes').toBeGreaterThan(d2);
  });

  test("the model's first frame links no shader on the main thread (cold GPU cache)", async ({ playwright }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(90_000);
    // A browser of its own: a fresh profile has an empty GPU program cache, as a first visit does.
    const browser = await playwright.chromium.launch({ args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: info.project.use.baseURL });
      const page = await context.newPage();
      await page.addInitScript(skipIntroScript);
      await page.addInitScript(linkWaitScript);
      await page.goto('/');
      await hydrated(page);
      test.skip(!(await hasHardwareWebGL(page)), 'software WebGL here, so the hero serves its still and has no live canvas');
      await expect(page.locator('[data-hero-canvas]')).toHaveAttribute('data-ready', '', { timeout: 30_000 });
      await page.waitForTimeout(500);
      const waits = await page.evaluate(() => ({ ...(window as Window & { __linkWait?: Record<string, number> }).__linkWait }));
      await test.info().attach('longest link wait per program (ms)', { body: JSON.stringify(waits, null, 2), contentType: 'application/json' });
      // Both run when the model first meets the baked environment; the GGX filter alone took 0.3-0.7 s cold.
      expect(waits.PMREMGGXConvolution, 'the PMREM GGX program was linked (renamed in three?)').toBeDefined();
      expect(waits.PMREMGGXConvolution).toBeLessThan(50);
      expect(waits.CubemapToCubeUV ?? 0).toBeLessThan(50);
    } finally {
      await browser.close();
    }
  });
});
