import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import { expect, hasHardwareWebGL, test } from './helpers';

/*
 * Contact section fit: the email and phone rows show their whole values at every
 * width, and the 3D envelope fits its canvas and compiles its shaders before its
 * first frame instead of freezing the scroll into the section.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
// The canvas mounts only for desktop pointers with motion allowed.
const canvasProject = (info: TestInfo) => width(info) >= 1024 && !isTouch(info) && !isReduced(info);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoContact(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.locator('#contact').scrollIntoViewIfNeeded();
}

/** Brings the envelope's slot to the middle of the screen, so its frameloop runs. */
async function centreCanvas(page: Page) {
  await page.locator('[data-deferred3d="contact"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-deferred3d="contact"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: r.top + window.scrollY + r.height / 2 - window.innerHeight / 2, behavior: 'instant' });
  });
}

/** Waits for the envelope to finish warming up; false when this machine keeps the poster. */
async function envelopeReady(page: Page): Promise<boolean> {
  if (!(await hasHardwareWebGL(page))) return false;
  await centreCanvas(page);
  const slot = page.locator('[data-deferred3d="contact"]');
  const live = await expect
    .poll(() => slot.getAttribute('data-state'), { timeout: 15_000 })
    .toBe('live')
    .then(() => true)
    .catch(() => false);
  if (!live) return false;
  await expect(page.locator('[data-contact-canvas]')).toHaveAttribute('data-ready', '', { timeout: 30_000 });
  return true;
}

/**
 * Reads the canvas's drawing buffer straight after R3F draws a frame. The envelope
 * is opaque on a transparent canvas, so alpha marks where it is. Over a few frames,
 * as the first read can land before R3F's draw and see a cleared buffer.
 */
async function envelopeCoverage(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-contact-canvas] canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl) return null;
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    let edge = 0;
    let covered = 0;
    await frame();
    for (let i = 0; i < 6; i++) {
      await frame();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let solid = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = px[(y * w + x) * 4 + 3];
          if (a > 200) solid++;
          if ((x < 2 || x >= w - 2) && a > edge) edge = a;
        }
      }
      covered = Math.max(covered, solid / (w * h));
    }
    return { edge, covered };
  });
}

test.describe('contact rows', () => {
  test('the email and phone show in full, never cut to an ellipsis', async ({ page }, info) => {
    await gotoContact(page);
    const widths = width(info) === 1440 && !isReduced(info) && !isLight(info) ? [320, 360, 640, 768, 1024, 1100, 1180, 1280, 1440] : [width(info)];
    for (const w of widths) {
      if (w !== width(info)) await page.setViewportSize({ width: w, height: 900 });
      const values = page.locator('#contact [data-contact-value]');
      await expect(values).toHaveCount(2);
      const rows = await values.evaluateAll((els) =>
        els.map((el) => ({
          text: el.textContent,
          clipped: el.scrollWidth > el.clientWidth + 1,
          lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
        })),
      );
      expect(rows.map((r) => r.text), `values at ${w}px`).toEqual([profile.email, profile.phone]);
      for (const row of rows) {
        expect(row.clipped, `${row.text} clipped at ${w}px`).toBe(false);
        expect(row.lines, `${row.text} wrapped onto ${row.lines} lines at ${w}px`).toBeLessThanOrEqual(2);
      }
    }
  });
});

test.describe('contact envelope', () => {
  test('the envelope stays inside its canvas at every desktop width', async ({ page }, info) => {
    test.skip(!canvasProject(info), 'desktop motion projects only');
    await gotoContact(page);
    test.skip(!(await envelopeReady(page)), 'no hardware WebGL: the poster shows instead');
    for (const w of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await centreCanvas(page);
      await page.waitForTimeout(400);
      const seen = await envelopeCoverage(page);
      expect(seen, 'canvas readable').not.toBeNull();
      expect(seen!.covered, `envelope drawn at ${w}px`).toBeGreaterThan(0.1);
      expect(seen!.edge, `envelope reaches the canvas side at ${w}px`).toBeLessThanOrEqual(8);
    }
  });

  test('its shaders link in the background before the first frame', async ({ page }, info) => {
    test.skip(!canvasProject(info), 'desktop motion projects only');
    // Records, per program on the envelope's context, whether it had reported a
    // finished link (KHR_parallel_shader_compile) before three.js first queried it,
    // the query that waits on the main thread.
    await page.addInitScript(() => {
      const COMPLETION_STATUS_KHR = 0x91b1;
      const P = WebGL2RenderingContext.prototype;
      const onEnvelope = (gl: WebGL2RenderingContext) => gl.canvas instanceof HTMLCanvasElement && Boolean(gl.canvas.closest('[data-contact-canvas]'));
      const shaderNames = new WeakMap<WebGLShader, string>();
      const programNames = new WeakMap<WebGLProgram, string>();
      const linked = new WeakSet<WebGLProgram>();
      const queried = new WeakSet<WebGLProgram>();
      const firstUse: { name: string; linked: boolean }[] = [];
      (window as Window & { __envelopePrograms?: typeof firstUse }).__envelopePrograms = firstUse;
      const note = (program: WebGLProgram) => {
        if (queried.has(program)) return;
        queried.add(program);
        firstUse.push({ name: programNames.get(program) ?? '?', linked: linked.has(program) });
      };
      const shaderSource = P.shaderSource;
      P.shaderSource = function (shader, source) {
        const name = /#define SHADER_NAME (\S+)/.exec(source)?.[1] ?? /#define SHADER_TYPE (\S+)/.exec(source)?.[1] ?? '?';
        shaderNames.set(shader, name);
        return shaderSource.call(this, shader, source);
      };
      const attachShader = P.attachShader;
      P.attachShader = function (program, shader) {
        if (!programNames.has(program)) programNames.set(program, shaderNames.get(shader) ?? '?');
        return attachShader.call(this, program, shader);
      };
      const getProgramParameter = P.getProgramParameter;
      P.getProgramParameter = function (program, pname) {
        const result = getProgramParameter.call(this, program, pname);
        if (onEnvelope(this)) {
          if (pname === COMPLETION_STATUS_KHR) {
            if (result) linked.add(program);
          } else note(program);
        }
        return result;
      };
      const getProgramInfoLog = P.getProgramInfoLog;
      P.getProgramInfoLog = function (program) {
        if (onEnvelope(this)) note(program);
        return getProgramInfoLog.call(this, program);
      };
    });
    await gotoContact(page);
    test.skip(!(await envelopeReady(page)), 'no hardware WebGL: the poster shows instead');
    const parallel = await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('[data-contact-canvas] canvas')?.getContext('webgl2')?.getExtension('KHR_parallel_shader_compile') != null,
    );
    test.skip(!parallel, 'without KHR_parallel_shader_compile every link blocks');
    // A few drawn frames, so every program the scene uses has been queried.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));

    const programs = await page.evaluate(() => (window as Window & { __envelopePrograms?: { name: string; linked: boolean }[] }).__envelopePrograms ?? []);
    // The GGX pre-filter for the environment and the envelope's material are the slow
    // links (0.1-0.7s each); post-processing's small programs may still link on use.
    const heavy = programs.filter((p) => p.name === 'PMREMGGXConvolution' || p.name === 'MeshStandardMaterial');
    expect(heavy.map((p) => p.name).sort(), JSON.stringify(programs)).toEqual(['MeshStandardMaterial', 'PMREMGGXConvolution']);
    for (const p of heavy) expect(p.linked, `${p.name} was first queried before it had linked`).toBe(true);
  });
});
