import { expect, test as base, type Page } from '@playwright/test';

/**
 * Requests that are expected to fail outside Vercel or in CI: Vercel Analytics and
 * Speed Insights (/_vercel/*) and the formsubmit.co contact relay.
 */
export const EXPECTED_THIRD_PARTY_FAILURES: readonly RegExp[] = [/\/_vercel\//, /formsubmit\.co/];

export function isExpectedFailure(url: string): boolean {
  return EXPECTED_THIRD_PARTY_FAILURES.some((re) => re.test(url));
}

/**
 * Collects console errors, page errors and failed requests, minus the allowlist.
 * Call before page.goto; read `.errors` at the end of the test. `allow` adds
 * patterns for this test only, such as the 'Failed to load resource ... 429' line
 * Chromium logs when a test mocks a WAF-style non-JSON 429.
 */
export function collectPageErrors(page: Page, opts: { allow?: readonly RegExp[] } = {}): { errors: string[] } {
  const errors: string[] = [];
  const allowed = (text: string) => opts.allow?.some((re) => re.test(text)) ?? false;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location().url ?? '';
    if (isExpectedFailure(url) || isExpectedFailure(msg.text()) || allowed(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (isExpectedFailure(req.url())) return;
    // Aborted media/prefetch requests are normal when a page navigates or unmounts.
    if (req.failure()?.errorText.includes('ERR_ABORTED')) return;
    errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
  });
  return { errors };
}

/**
 * Sets the site theme ('theme' in localStorage, read by the head bootstrap).
 * Before the first goto it applies to every load; on an open page it reloads.
 */
export async function setTheme(page: Page, theme: 'dark' | 'light' | 'system'): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {
      /* storage blocked */
    }
  }, theme);
  if (page.url().startsWith('http')) await page.reload();
}

/** Emulates the OS reduced-motion setting; the motion store follows it live, no reload. */
export async function emulateReducedMotion(page: Page, reduce = true): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
}

/**
 * window.__renders[name] from useRenderCount, or null when counting is compiled out.
 * Counting runs under `next dev` or a build made with NEXT_PUBLIC_RENDER_COUNT=1.
 */
export async function getRenderCount(page: Page, name: string): Promise<number | null> {
  return page.evaluate((n) => window.__renders?.[n] ?? null, name);
}

/**
 * Records every WebGL context the page creates. Call before page.goto (the `test`
 * export below does this automatically) for an exact liveWebglContexts count.
 */
export async function installWebglCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & { __webglContexts?: Set<WebGLRenderingContext | WebGL2RenderingContext> };
    if (w.__webglContexts) return;
    const contexts = new Set<WebGLRenderingContext | WebGL2RenderingContext>();
    w.__webglContexts = contexts;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
        contexts.add(ctx as WebGLRenderingContext);
      }
      return ctx;
    } as typeof original;
  });
}

/**
 * Live WebGL contexts: attached to a connected canvas and not lost. Falls back to
 * counting three.js canvases when installWebglCounter was not called.
 */
export async function liveWebglContexts(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __webglContexts?: Set<WebGLRenderingContext | WebGL2RenderingContext> };
    if (w.__webglContexts) {
      let live = 0;
      w.__webglContexts.forEach((gl) => {
        const canvas = gl.canvas;
        if (canvas instanceof HTMLCanvasElement && canvas.isConnected && !gl.isContextLost()) live++;
      });
      return live;
    }
    return document.querySelectorAll('canvas[data-engine^="three.js"]').length;
  });
}

/**
 * True when WebGL runs on a GPU. On software rasterisers (headless CI's SwiftShader)
 * useDeviceCapability withholds heavy 3D, so the scenes show their stills instead.
 * Keep the pattern in step with SOFTWARE_RENDERER in src/hooks/useDeviceCapability.ts.
 */
export async function hasHardwareWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  });
}

/** Fails with the offending elements when anything widens the page past the viewport. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const offenders: string[] = [];
    if (overflow > 0) {
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)}`);
        if (offenders.length >= 10) break;
      }
    }
    return { overflow, offenders };
  });
  expect(report.overflow, `horizontal overflow; widest offenders:\n${report.offenders.join('\n')}`).toBeLessThanOrEqual(0);
}

/** @playwright/test's `test` with the WebGL counter installed before every page load. */
export const test = base.extend<{ webglCounter: void }>({
  webglCounter: [
    async ({ page }, use) => {
      await installWebglCounter(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
