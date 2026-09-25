import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import { collectPageErrors, expect, expectNoHorizontalOverflow, getRenderCount, hasHardwareWebGL, test } from './helpers';

/*
 * Hero package (#51-#61): kicker, role ticker, canvas budget, intro timeline,
 * scroll exit, pointer parallax, responsive tiers, CTAs, scroll cue and media.
 * Most checks run on one or two projects of the matrix; the skip reasons say which.
 */

type ProjectUse = {
  viewport?: { width: number; height: number } | null;
  hasTouch?: boolean;
  reducedMotion?: string;
  colorScheme?: string;
};
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const height = (info: TestInfo) => projectUse(info).viewport?.height ?? 720;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
const isDesktopMotion = (info: TestInfo) => width(info) === 1440 && !isReduced(info) && !isTouch(info);

const ROLE_COUNT = 4;
const FIRST_ROLE = 'Gen AI & Data Science Engineer';

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

/** Loads '/' and waits for hydration with the intro settled. */
async function gotoHero(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 15_000 });
  await expect(page.locator('#hero')).toBeVisible();
}

/** Samples the minimum opacity of the name pieces on every frame from the first one. */
async function installNameOpacitySampler(page: Page, ms = 2500) {
  await page.addInitScript((duration) => {
    const w = window as Window & { __heroNameMin?: number; __heroNameFrames?: number };
    w.__heroNameMin = 1;
    w.__heroNameFrames = 0;
    const start = performance.now();
    // A replay would write an inline opacity below 1 even between two janky frames.
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.matches?.('#hero .hero-char') && el.style.opacity !== '') {
          w.__heroNameMin = Math.min(w.__heroNameMin ?? 1, Number(el.style.opacity));
        }
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['style'] });
    const tick = () => {
      const pieces = document.querySelectorAll('#hero .hero-char');
      if (pieces.length) {
        w.__heroNameFrames = (w.__heroNameFrames ?? 0) + 1;
        pieces.forEach((el) => {
          const o = Number(getComputedStyle(el).opacity);
          if (o < (w.__heroNameMin ?? 1)) w.__heroNameMin = o;
        });
      }
      if (performance.now() - start < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

/** Counts WebGL draw calls per canvas. */
async function installDrawCounter(page: Page) {
  await page.addInitScript(() => {
    const counts = new WeakMap<HTMLCanvasElement | OffscreenCanvas, number>();
    const w = window as Window & { __heroDraws?: () => number };
    w.__heroDraws = () => {
      const canvas = document.querySelector('[data-deferred3d="hero"] canvas');
      return canvas instanceof HTMLCanvasElement ? (counts.get(canvas) ?? 0) : -1;
    };
    const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of names) {
        const original = (proto as unknown as Record<string, unknown>)[name];
        if (typeof original !== 'function') continue;
        (proto as unknown as Record<string, unknown>)[name] = function (this: WebGLRenderingContext, ...args: unknown[]) {
          counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        };
      }
    }
  });
}

/** navigator.connection.saveData = true before the head bootstrap reads it. */
async function emulateSaveData(page: Page) {
  await page.addInitScript(() => {
    const connection = {
      saveData: true,
      effectiveType: '4g',
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get: () => connection });
  });
}

function parseRgb(value: string): [number, number, number] | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** translateY and opacity of an element, from its computed style. */
async function restState(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const m = cs.transform === 'none' ? null : new DOMMatrixReadOnly(cs.transform);
    return { ty: m ? m.m42 : 0, opacity: Number(cs.opacity), inline: (el as HTMLElement).style.transform };
  });
}

/** Hero elements that reach past the viewport's right edge (the clipped backdrop layer excepted). */
async function heroOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const hero = document.getElementById('hero');
    if (!hero) return ['#hero missing'];
    return Array.from(hero.querySelectorAll<HTMLElement>('*'))
      .filter((el) => !el.closest('.overflow-clip'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > vw + 1)
      .slice(0, 10)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')} right=${Math.round(r.right)}`);
  });
}

type WindowListener = { type: string; url: string; fromHeroCanvasChunk: boolean };

/**
 * The page's own window listeners (Playwright's injected helpers have no URL), each
 * marked when it was registered from the lazy HeroCanvas chunk (the one that names the GLB).
 */
async function windowListeners(cdp: CDPSession): Promise<WindowListener[]> {
  const urls = new Map<string, string>();
  const onParsed = (e: { scriptId: string; url: string }) => urls.set(e.scriptId, e.url);
  cdp.on('Debugger.scriptParsed', onParsed);
  await cdp.send('Debugger.enable');
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
  const heroChunk = new Map<string, boolean>();
  const out: WindowListener[] = [];
  for (const l of listeners) {
    const url = urls.get(l.scriptId);
    if (!url) continue;
    if (!heroChunk.has(l.scriptId)) {
      const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: l.scriptId });
      heroChunk.set(l.scriptId, scriptSource.includes('hero-character.glb'));
    }
    out.push({ type: l.type, url, fromHeroCanvasChunk: heroChunk.get(l.scriptId)! });
  }
  cdp.off('Debugger.scriptParsed', onParsed);
  await cdp.send('Debugger.disable');
  return out;
}

function tally(listeners: WindowListener[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of listeners) counts[l.type] = (counts[l.type] ?? 0) + 1;
  return counts;
}

test.beforeEach(async ({ page }, info) => {
  // Only the first-visit tests see the intro curtain.
  if (!info.titlePath.some((t) => t.startsWith('first visit'))) await skipIntro(page);
});

test.describe('kicker (#51)', () => {
  test('the prerendered HTML has no greeting and takes availability from data', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info) || isLight(info), 'one project is enough');
    const html = await (await page.request.get('/')).text();
    expect(html).not.toMatch(/midnight oil|Good (morning|afternoon|evening)|Late-night browsing/);
    expect(html).toContain(profile.availability.status);
    const source = readFileSync(path.join(process.cwd(), 'src/components/hero/HeroSection.tsx'), 'utf8');
    expect(source).not.toContain('Available for hire');
  });

  test.describe('in New York', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('hydrates without a mismatch', async ({ page }, info) => {
      test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
      const { errors } = collectPageErrors(page);
      await gotoHero(page);
      await page.waitForTimeout(500);
      expect(errors.filter((e) => /hydrat|Minified React error #(418|419|422|423|425)/i.test(e))).toEqual([]);
      await expect(page.locator('#hero [data-local-time]')).not.toHaveText('--:--');
    });
  });

  test('labels are at least 11px and 4.5:1 against the page', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoHero(page);
    const samples = await page.evaluate(() => {
      const bg = getComputedStyle(document.documentElement).backgroundColor;
      return Array.from(document.querySelectorAll<HTMLElement>('#hero [data-hero-kicker-item] *'))
        .filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()))
        .map((el) => {
          const cs = getComputedStyle(el);
          return { text: el.textContent?.trim().slice(0, 40), color: cs.color, size: parseFloat(cs.fontSize), bg };
        });
    });
    expect(samples.length).toBeGreaterThan(1);
    for (const s of samples) {
      const fg = parseRgb(s.color);
      const bg = parseRgb(s.bg);
      expect(fg && bg, `${s.text}: ${s.color} on ${s.bg}`).toBeTruthy();
      expect(s.size, `${s.text} font size`).toBeGreaterThanOrEqual(11);
      expect(contrast(fg!, bg!), `${s.text}: ${s.color} on ${s.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('reduced motion: the wave is a static hand and wave.json is never fetched', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) !== 1440, 'one reduced-motion project is enough');
    const fetched: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/lottie/wave.json')) fetched.push(req.url());
    });
    await gotoHero(page);
    await page.waitForTimeout(3000);
    const wave = page.locator('#hero [data-lottie="wave"]');
    if (await wave.count()) await expect(wave).toHaveAttribute('data-lottie-phase', 'fallback');
    expect(fetched).toEqual([]);
  });
});

test.describe('role ticker (#52)', () => {
  test('the hero and its canvas do not re-render while idle', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(60_000);
    await gotoHero(page);
    await expect(page.locator('#hero[data-hero-ready]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(6000);
    const hero = await getRenderCount(page, 'HeroSection');
    test.skip(hero === null, 'render counting is compiled out (build with NEXT_PUBLIC_RENDER_COUNT=1)');
    // A slow GPU (or software GL in CI) may still be stepping the canvas down a
    // performance tier; each step is one legitimate HeroCanvas render.
    await page.evaluate(() => {
      const w = window as Window & { __heroTierSteps?: number };
      w.__heroTierSteps = 0;
      const host = document.querySelector('[data-hero-canvas]');
      if (host) new MutationObserver(() => (w.__heroTierSteps = (w.__heroTierSteps ?? 0) + 1)).observe(host, { attributes: true, attributeFilter: ['data-tier'] });
    });
    const canvas = (await getRenderCount(page, 'HeroCanvas')) ?? 0;
    await page.waitForTimeout(10_000);
    const steps = await page.evaluate(() => (window as Window & { __heroTierSteps?: number }).__heroTierSteps ?? 0);
    expect(await getRenderCount(page, 'HeroSection')).toBe(hero);
    expect(((await getRenderCount(page, 'HeroCanvas')) ?? 0) - canvas).toBe(steps);
  });

  test('the role decodes on screen and stops offscreen', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(45_000);
    await gotoHero(page);
    const text = page.locator('#hero [data-role-text]');
    const first = await text.textContent();
    // One 3.2s cycle; generous because software GL in CI can starve the main thread for seconds.
    await expect.poll(() => text.textContent(), { timeout: 15_000 }).not.toBe(first);

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(1200);
    const parked = await text.textContent();
    await page.waitForTimeout(4500);
    expect(await text.textContent()).toBe(parked);
  });

  test('reduced motion: the line is static and screen readers get every role', async ({ page }, info) => {
    test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 360), 'two reduced-motion projects');
    await gotoHero(page);
    const text = page.locator('#hero [data-role-text]');
    await expect(text).toHaveText(FIRST_ROLE);
    await page.waitForTimeout(4500);
    await expect(text).toHaveText(FIRST_ROLE);
    await expect(page.locator('#hero [data-role-ticker] ul.sr-only li')).toHaveCount(ROLE_COUNT);
  });
});

test.describe('canvas (#53, #54)', () => {
  test('reduced motion fetches no three.js chunk and no model', async ({ page }, info) => {
    test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 360), 'two reduced-motion projects');
    const models: string[] = [];
    const threeChunks: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('hero-character.glb')) models.push(req.url());
    });
    page.on('response', async (res) => {
      if (res.request().resourceType() !== 'script') return;
      const body = await res.text().catch(() => '');
      if (body.includes('WebGLRenderer')) threeChunks.push(res.url());
    });
    await gotoHero(page);
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 0.8, behavior: 'instant' }));
    await page.waitForTimeout(1500);
    expect(models).toEqual([]);
    await expect(page.locator('[data-deferred3d="hero"]')).toHaveAttribute('data-state', 'fallback');
    await expect(page.locator('[data-deferred3d="hero"] canvas')).toHaveCount(0);
    expect(threeChunks, 'scripts carrying three.js under reduced motion').toEqual([]);
  });

  test.describe('with Save-Data', () => {
    test('the hero stays on its fallback and reports ready within 3s', async ({ page }, info) => {
      test.skip(!isDesktopMotion(info), 'one desktop project is enough');
      await emulateSaveData(page);
      const models: string[] = [];
      const threeChunks: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('hero-character.glb')) models.push(req.url());
      });
      page.on('response', async (res) => {
        if (res.request().resourceType() !== 'script') return;
        const body = await res.text().catch(() => '');
        if (body.includes('WebGLRenderer')) threeChunks.push(res.url());
      });
      await page.goto('/', { waitUntil: 'commit' });
      await page.waitForFunction(
        () => {
          const w = window as Window & { __heroReadyAt?: number };
          if (document.querySelector('#hero[data-hero-ready]')) w.__heroReadyAt ??= performance.now();
          return w.__heroReadyAt !== undefined;
        },
        null,
        { polling: 'raf', timeout: 10_000 },
      );
      const at = await page.evaluate(() => (window as Window & { __heroReadyAt?: number }).__heroReadyAt ?? Infinity);
      expect(at).toBeLessThan(3000);
      await page.waitForTimeout(1000);
      await expect(page.locator('[data-deferred3d="hero"]')).toHaveAttribute('data-state', 'fallback');
      expect(models).toEqual([]);
      expect(threeChunks, 'scripts carrying three.js with Save-Data on').toEqual([]);
    });
  });

  test('the live canvas has no shadow map and stops drawing once scrolled away', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(60_000);
    await installDrawCounter(page);
    await gotoHero(page);
    test.skip(!(await hasHardwareWebGL(page)), 'software WebGL here, so the hero serves its still and has no live canvas');
    const host = page.locator('[data-hero-canvas]');
    await expect(host).toHaveAttribute('data-ready', '', { timeout: 30_000 });
    await expect(host).toHaveAttribute('data-shadow-map', 'off');

    const draws = () => page.evaluate(() => (window as Window & { __heroDraws?: () => number }).__heroDraws?.() ?? -1);
    const d0 = await draws();
    await page.waitForTimeout(800);
    expect(await draws()).toBeGreaterThan(d0);

    await page.evaluate(() => {
      const skills = document.getElementById('skills');
      window.scrollTo({ top: skills ? skills.getBoundingClientRect().top + window.scrollY : window.innerHeight * 3, behavior: 'instant' });
    });
    await page.waitForTimeout(1500);
    const d1 = await draws();
    await page.waitForTimeout(1500);
    expect(await draws()).toBe(d1);
  });

  test('leaving the page for a case study leaves no window listeners behind', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    test.setTimeout(90_000);
    await gotoHero(page);
    const link = page.locator('a[href^="/projects/"]').first();
    test.skip((await link.count()) === 0, 'no in-app link from / to a case study yet');
    test.skip(!(await hasHardwareWebGL(page)), 'software WebGL here, so the hero serves its still and has no live canvas');
    const canvasReady = () => expect(page.locator('[data-hero-canvas]')).toHaveAttribute('data-ready', '', { timeout: 30_000 });
    await canvasReady();
    const href = (await link.getAttribute('href'))!;
    const cdp = await page.context().newCDPSession(page);
    // A DOM click: Playwright's own actionability checks add a window mousemove listener.
    const leave = async () => {
      await page.locator(`a[href="${href}"]`).first().evaluate((a) => (a as HTMLAnchorElement).click());
      await page.waitForURL(`**${href}`);
      await expect(page.locator('#hero')).toHaveCount(0);
      await page.waitForTimeout(1500);
      return windowListeners(cdp);
    };

    const first = await leave();
    // The old module-scope mousemove/scroll listeners lived in this chunk and were never removed.
    expect(first.filter((l) => l.fromHeroCanvasChunk).map((l) => l.type)).toEqual([]);

    // A second mount/unmount must not add anything (GSAP's one-time globals stay constant).
    await page.goBack();
    await expect(page.locator('#hero')).toBeVisible();
    await canvasReady();
    await page.waitForTimeout(1500);
    const second = await leave();
    expect(tally(second)).toEqual(tally(first));
  });
});

test.describe('intro (#55)', () => {
  test.describe('first visit', () => {
    test('the name reveals after the curtain', async ({ page }, info) => {
      test.skip(!isDesktopMotion(info), 'one desktop project is enough');
      // Style mutations are recorded as GSAP writes them, however janky the frames are.
      await page.addInitScript(() => {
        const w = window as Window & { __heroSeen?: boolean; __heroMinAfterSeen?: number };
        w.__heroMinAfterSeen = 1;
        new MutationObserver((records) => {
          for (const r of records) {
            const el = r.target as HTMLElement;
            if (r.attributeName === 'data-intro' && el === document.documentElement && el.getAttribute('data-intro') === 'seen') {
              w.__heroSeen = true;
            } else if (w.__heroSeen && r.attributeName === 'style' && el.matches?.('.hero-first .hero-char') && el.style.opacity !== '') {
              w.__heroMinAfterSeen = Math.min(w.__heroMinAfterSeen ?? 1, Number(el.style.opacity));
            }
          }
          // Init scripts run before <html> is parsed, so watch the document itself.
        }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-intro', 'style'] });
      });
      await page.goto('/');
      const intro = await page.locator('html').getAttribute('data-intro');
      test.skip(intro !== 'pending' && intro !== 'playing', `no curtain on this load (data-intro=${intro})`);
      await expect(page.locator('#hero')).toHaveAttribute('data-intro', 'play');
      await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 15_000 });
      await page.waitForTimeout(2500);
      const min = await page.evaluate(() => (window as Window & { __heroMinAfterSeen?: number }).__heroMinAfterSeen);
      expect(min, 'the letters animate in after the curtain instead of already being there').toBeLessThan(0.5);
      const finals = await page.locator('#hero .hero-char').evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
      expect(finals.every((o) => o === '1')).toBe(true);
    });
  });

  test('returning visit: the name is visible from the first frame and never replays', async ({ page }, info) => {
    test.skip(isReduced(info) || (width(info) !== 1440 && width(info) !== 360), 'two full-motion projects');
    await installNameOpacitySampler(page);
    await gotoHero(page);
    await page.waitForTimeout(2600);
    const { min, frames } = await page.evaluate(() => {
      const w = window as Window & { __heroNameMin?: number; __heroNameFrames?: number };
      return { min: w.__heroNameMin, frames: w.__heroNameFrames };
    });
    expect(frames).toBeGreaterThan(0);
    expect(min).toBe(1);
    await expect(page.locator('#hero')).not.toHaveAttribute('data-intro', 'play');
  });

  test('reduced motion: the final state is there immediately', async ({ page }, info) => {
    test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 360), 'two reduced-motion projects');
    await installNameOpacitySampler(page);
    await gotoHero(page);
    await page.waitForTimeout(2600);
    expect(await page.evaluate(() => (window as Window & { __heroNameMin?: number }).__heroNameMin)).toBe(1);
    const rows = await page
      .locator('#hero .hero-intro')
      .evaluateAll((els) => els.map((el) => ({ o: getComputedStyle(el).opacity, t: (el as HTMLElement).style.transform })));
    for (const r of rows) {
      expect(r.o).toBe('1');
      expect(r.t).toBe('');
    }
  });

  test('the h1 is named Oikantik Basu', async ({ page }, info) => {
    test.skip(isLight(info) || isReduced(info), 'one theme and motion setting per viewport');
    await gotoHero(page);
    await expect(page.getByRole('heading', { level: 1, name: profile.name, exact: true })).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('scroll exit (#56)', () => {
  test.describe('first visit', () => {
    test('scrolling during the reveal leaves Basu. at rest back at the top', async ({ page }, info) => {
      test.skip(!isDesktopMotion(info), 'one desktop project is enough');
      test.setTimeout(60_000);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 15_000 });
      await page.mouse.move(700, 450);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(120);
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(120);
      }
      await page.mouse.wheel(0, -5000);
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.waitForTimeout(1800);

      const last = await restState(page, '#hero [data-hero-exit="last"]');
      expect(Math.abs(last.ty)).toBeLessThan(1);
      expect(last.opacity).toBe(1);
      expect(Number(await page.locator('#hero .hero-last').evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
      await expect(page.locator('.pin-spacer')).toHaveCount(0);
    });
  });

  test('the exit scrub lifts the name and dims Basu. without pinning', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    await gotoHero(page);
    await page.evaluate(() => window.scrollTo({ top: Math.round(window.innerHeight * 0.5), behavior: 'instant' }));
    await page.waitForTimeout(1500);
    const last = await restState(page, '#hero [data-hero-exit="last"]');
    const first = await restState(page, '#hero [data-hero-exit="first"]');
    expect(last.ty).toBeLessThan(-10);
    expect(last.opacity).toBeLessThan(0.9);
    expect(first.ty).toBeLessThan(0);
    expect(first.ty).toBeGreaterThan(last.ty);
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
  });

  test('reduced motion: no scrub', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) !== 1440, 'one reduced-motion project is enough');
    await gotoHero(page);
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
    await page.waitForTimeout(1000);
    for (const which of ['kicker', 'first', 'last']) {
      const s = await restState(page, `#hero [data-hero-exit="${which}"]`);
      expect(s.inline).toBe('');
      expect(s.opacity).toBe(1);
    }
  });
});

test.describe('pointer parallax (#57)', () => {
  test('desktop: the layers drift by different amounts with no :root writes', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    await gotoHero(page);
    const rootStyle = () => page.evaluate(() => document.documentElement.getAttribute('style') ?? '');
    const before = await rootStyle();
    await page.mouse.move(80, 450);
    await page.mouse.move(1360, 300, { steps: 12 });
    await page.waitForTimeout(900);
    const shifts = await page.locator('#hero [data-depth]').evaluateAll((els) =>
      els.map((el) => {
        const t = (el as HTMLElement).style.transform;
        const m = t.match(/translate3d\(([-\d.]+)px/);
        return m ? Math.abs(Number(m[1])) : 0;
      }),
    );
    const distinct = new Set(shifts.filter((s) => s > 0.5).map((s) => s.toFixed(1)));
    expect(distinct.size, `layer shifts ${shifts.join(', ')}`).toBeGreaterThanOrEqual(3);
    expect(await rootStyle(), 'no custom properties written to :root while the pointer moves').toBe(before);
  });

  test('touch or reduced motion: nothing drifts', async ({ page }, info) => {
    test.skip(!(isTouch(info) && width(info) === 1024) && !(isReduced(info) && width(info) === 1440), 'touch and reduced desktop');
    await gotoHero(page);
    if (isTouch(info)) {
      await page.touchscreen.tap(200, 300);
      await page.touchscreen.tap(700, 400);
    } else {
      await page.mouse.move(80, 450);
      await page.mouse.move(1360, 300, { steps: 12 });
    }
    await page.waitForTimeout(700);
    const transforms = await page.locator('#hero [data-depth]').evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform));
    expect(transforms.every((t) => t === '')).toBe(true);
  });
});

test.describe('responsive tiers (#58)', () => {
  test.describe('landscape phone', () => {
    test.use({ viewport: { width: 740, height: 360 } });

    test('740x360: nothing clips and nothing sits under the nav', async ({ page }, info) => {
      test.skip(width(info) !== 1440 || isLight(info), 'one override per motion setting');
      await gotoHero(page);
      const report = await page.evaluate(() => {
        const hero = document.getElementById('hero')!;
        const heroRect = hero.getBoundingClientRect();
        const nav = document.getElementById('site-nav');
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
        const kicker = hero.querySelector('[data-hero-exit="kicker"]')!.getBoundingClientRect();
        const targets = Array.from(hero.querySelectorAll<HTMLElement>('h1, .hero-ctas a, .hero-ctas button, [data-social-links] a'));
        const outside = targets
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.bottom > heroRect.bottom + 1 || r.right > heroRect.right + 1)
          .map(({ el }) => el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label'));
        const cs = getComputedStyle(hero);
        return {
          navBottom,
          kickerTop: kicker.top,
          outside,
          overflow: `${cs.overflowX}/${cs.overflowY}`,
          cue: getComputedStyle(hero.querySelector('[data-hero-cue]')!).display,
        };
      });
      expect(report.kickerTop).toBeGreaterThanOrEqual(report.navBottom);
      expect(report.outside).toEqual([]);
      expect(report.overflow).toBe('visible/visible');
      expect(report.cue).toBe('none');
      expect(await heroOverflow(page)).toEqual([]);
    });
  });

  test('the primary CTA is above the fold', async ({ page }, info) => {
    test.skip(![320, 360, 375].includes(width(info)), 'phone viewports');
    await gotoHero(page);
    const box = await page.locator('#hero .hero-ctas a').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(height(info));
  });

  test('no horizontal scroll', async ({ page }, info) => {
    test.skip(width(info) !== 320 && width(info) !== 768, 'narrowest phone and the tablet column');
    await gotoHero(page);
    expect(await heroOverflow(page)).toEqual([]);
    // Page-wide too; a failure here names the widest offenders, which may sit outside the hero.
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('CTAs (#59)', () => {
  test('every hero control is at least 44px', async ({ page }, info) => {
    test.skip(isLight(info) || isReduced(info), 'one theme and motion setting per viewport');
    await gotoHero(page);
    const small = await page.locator('#hero a, #hero button').evaluateAll((els) =>
      els
        .filter((el) => {
          const cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
        })
        .map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height < 44 || r.width < 44)
        .map(({ label, r }) => `${label}: ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
    expect(small).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

    test('Get in touch opens mail with a subject', async ({ page }, info) => {
      test.skip(width(info) !== 1440 || isLight(info) || isReduced(info), 'one override is enough');
      await gotoHero(page);
      await expect(page.locator('#hero [data-hero-contact]')).toHaveAttribute('href', /^mailto:[^?]+\?subject=.+/);
    });
  });

  test('desktop: Get in touch scrolls to #contact', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info), 'one desktop project is enough');
    await gotoHero(page);
    await expect(page.locator('#hero [data-hero-contact]')).toHaveAttribute('href', '#contact');
  });

  test('the social links are visible without scrolling at 360', async ({ page }, info) => {
    test.skip(width(info) !== 360, '360 projects');
    await gotoHero(page);
    const links = page.locator('#hero [data-social-links] a');
    await expect(links).toHaveCount(3);
    for (const box of await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(740);
    }
  });
});

test.describe('scroll cue (#60)', () => {
  test('visible in both themes, Enter scrolls to About, hidden after scrolling', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isTouch(info), 'desktop projects');
    await gotoHero(page);
    const cue = page.getByRole('button', { name: 'Scroll to About' });
    await expect(cue).toBeVisible();
    await page.waitForTimeout(1600);

    const colours = await cue.evaluate((el) => ({
      color: getComputedStyle(el).color,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      paints: Array.from(el.querySelectorAll('path')).flatMap((p) => [getComputedStyle(p).fill, getComputedStyle(p).stroke]),
    }));
    expect(contrast(parseRgb(colours.color)!, parseRgb(colours.bg)!)).toBeGreaterThanOrEqual(3);
    if (isLight(info)) expect(colours.paints).not.toContain('rgb(226, 246, 253)');

    await cue.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.getElementById('about')?.getBoundingClientRect().top ?? 9999), { timeout: 6000 })
      .toBeLessThan(160);
    // Once hidden it leaves the accessibility tree, so the role locator no longer matches it.
    const button = page.locator('#hero .hero-cue-button');
    await expect(button).toHaveAttribute('data-hidden', '');
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
  });
});

test.describe('media (#61)', () => {
  test('no Skills artwork in the hero; poster and still within budget', async ({ page }, info) => {
    test.skip(!isDesktopMotion(info) || isLight(info), 'one project is enough');
    const dir = path.join(process.cwd(), 'src/components/hero');
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toContain('skills-bg');
    }
    expect(statSync(path.join(process.cwd(), 'public/images/hero-poster.webp')).size).toBeLessThanOrEqual(80 * 1024);
    expect(statSync(path.join(process.cwd(), 'public/images/hero-still.webp')).size).toBeLessThanOrEqual(120 * 1024);
    await gotoHero(page);
    await expect(page.locator('#hero [poster*="hero-poster"], #hero img[src*="hero-poster"]').first()).toBeAttached();
  });

  test('at 360 under reduced motion the hero shows the model still', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) !== 360, '360 reduced-motion projects');
    await gotoHero(page);
    const still = page.locator('#hero [data-deferred3d="hero"] img');
    await expect(still).toBeVisible();
    await expect.poll(() => still.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const box = await still.boundingBox();
    expect(box && box.width > 100 && box.height > 100).toBe(true);
  });
});
