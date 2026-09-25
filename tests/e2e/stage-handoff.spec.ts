import type { Page, TestInfo } from '@playwright/test';
import { expect, hasHardwareWebGL, test } from './helpers';

/*
 * The 3D stages hand over from their fallback without an empty frame. Deferred3D
 * used to unmount the fallback the moment the canvas chunk resolved; the canvas then
 * drew nothing until R3F had measured it (and the sphere re-suspended once more on
 * its label font), so the whole skills stage blinked out for ~70-110ms, and the
 * contact poster left an empty box until the envelope faded in about a second later.
 * Also: the dark sphere's bloom lifted its whole transparent canvas into a lighter,
 * hard-edged square over the section.
 */

type ProjectUse = { viewport?: { width: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1440;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isDark = (info: TestInfo) => projectUse(info).colorScheme === 'dark';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
}

type Sampler = { samples: string[]; stop: boolean };

/**
 * Records, once per animation frame, what a stage shows: `probe` returns a state
 * name, 'blank' when neither the fallback nor a drawn canvas is on screen.
 */
async function startSampling(page: Page, probe: string) {
  await page.evaluate((src) => {
    const w = window as unknown as Window & { __stage?: Sampler };
    const read = new Function(`return (${src})();`) as () => string;
    const s: Sampler = { samples: [], stop: false };
    w.__stage = s;
    const loop = () => {
      s.samples.push(read());
      if (!s.stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, probe);
}

async function stopSampling(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as Window & { __stage?: Sampler };
    w.__stage!.stop = true;
    return w.__stage!.samples;
  });
}

/** Runs of equal samples, e.g. 'constellation x12 -> sphere x40'. */
const runs = (samples: string[]) =>
  samples
    .reduce<[string, number][]>((acc, s) => {
      const last = acc.at(-1);
      if (last && last[0] === s) last[1]++;
      else acc.push([s, 1]);
      return acc;
    }, [])
    .map(([s, n]) => `${s} x${n}`)
    .join(' -> ');

const SKILLS_PROBE = `() => {
  const stage = document.querySelector('#skills [data-deferred3d="skills"]');
  if (!stage) return 'missing';
  const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const sphere = stage.querySelector('.skills-sphere');
  if (sphere && shown(sphere) && (window.__skillSphere?.frames ?? 0) > 0) return 'sphere';
  const constellation = [...stage.querySelectorAll('[data-skills-mode="constellation"]')].some(shown);
  return constellation ? 'constellation' : 'blank';
}`;

const CONTACT_PROBE = `() => {
  const slot = document.querySelector('[data-deferred3d="contact"]');
  if (!slot) return 'missing';
  const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // The column fades in with the section (Reveal); until then nothing is meant to show.
  if (!shown(slot)) return 'unrevealed';
  const envelope = slot.querySelector('[data-contact-canvas][data-ready]');
  if (envelope && shown(envelope)) return 'envelope';
  const poster = [...slot.querySelectorAll('img')].some(shown);
  return poster ? 'poster' : 'blank';
}`;

test.describe('3D stages never flash an empty box on the handoff', () => {
  test('skills: the constellation stays until the sphere has drawn', async ({ page }, info) => {
    test.skip(isReduced(info), 'reduced motion keeps the constellation');
    await gotoHome(page);
    test.skip(!(await hasHardwareWebGL(page)), 'this browser does not get the WebGL sphere');
    await startSampling(page, SKILLS_PROBE);
    await page.evaluate(() => document.getElementById('skills')?.scrollIntoView());
    const drawn = await expect
      .poll(() => page.evaluate(() => (window.__skillSphere?.frames ?? 0) > 10), { timeout: 20_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    // Past the fade, so a late re-suspend would be caught too.
    await page.waitForTimeout(1200);
    const samples = await stopSampling(page);
    test.skip(!drawn, 'the sphere did not mount here (low-power heuristics)');
    expect(samples.filter((s) => s === 'blank'), runs(samples)).toEqual([]);
    expect(samples.at(-1)).toBe('sphere');
    await expect(page.locator('#skills [data-deferred3d="skills"] [data-skills-mode="constellation"]')).toHaveCount(0);
  });

  test('contact: the poster stays until the envelope is ready', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) < 1024, 'the envelope is a desktop, full-motion canvas');
    await gotoHome(page);
    test.skip(!(await hasHardwareWebGL(page)), 'this browser does not get the WebGL envelope');
    await startSampling(page, CONTACT_PROBE);
    await page.evaluate(() => document.getElementById('contact')?.scrollIntoView());
    const ready = await page
      .locator('[data-deferred3d="contact"] [data-contact-canvas][data-ready]')
      .waitFor({ state: 'attached', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1500);
    const samples = await stopSampling(page);
    test.skip(!ready, 'the envelope did not mount here');
    expect(samples.filter((s) => s === 'blank'), runs(samples)).toEqual([]);
    expect(samples.at(-1)).toBe('envelope');
  });
});

/** Mean luminance lift the canvas adds at points 6px inside its edges, and just outside it. */
async function canvasEdgeLift(page: Page, canvasSel: string) {
  const canvas = page.locator(canvasSel);
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = (await canvas.boundingBox())!;
  const pad = 20;
  const clip = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
  // A playing background video would change between the two shots.
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
  const on = await page.screenshot({ clip, animations: 'disabled' });
  await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
  const off = await page.screenshot({ clip, animations: 'disabled' });
  await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = ''));
  return page.evaluate(
    async ({ on, off, w, h, pad }) => {
      const decode = (b64: string) =>
        new Promise<{ data: Uint8ClampedArray; width: number }>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            resolve({ data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width });
          };
          img.src = `data:image/png;base64,${b64}`;
        });
      const [a, b] = await Promise.all([decode(on), decode(off)]);
      const scale = a.width / (w + 2 * pad);
      const lum = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => {
        const i = (Math.round(y * scale) * img.width + Math.round(x * scale)) * 4;
        return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      };
      const lift = (x: number, y: number) => {
        let d = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) d += lum(a, x + dx, y + dy) - lum(b, x + dx, y + dy);
        return Math.round((d / 25) * 10) / 10;
      };
      const [l, t, r, btm] = [pad + 6, pad + 6, pad + w - 7, pad + h - 7];
      return {
        inside: {
          topLeft: lift(l, t),
          topRight: lift(r, t),
          bottomLeft: lift(l, btm),
          bottomRight: lift(r, btm),
          left: lift(l, pad + h / 2),
          right: lift(r, pad + h / 2),
          top: lift(pad + w / 2, t),
          bottom: lift(pad + w / 2, btm),
        },
        outside: { left: lift(pad - 6, pad + h / 2), right: lift(pad + w + 5, pad + h / 2) },
      };
    },
    { on: on.toString('base64'), off: off.toString('base64'), w: box.width, h: box.height, pad },
  );
}

test('the dark sphere adds no light at the edges of its canvas (no bloom square)', async ({ page }, info) => {
  test.skip(isReduced(info) || !isDark(info) || width(info) < 1024 || Boolean(projectUse(info).hasTouch), 'the bloom runs in dark theme, full motion');
  await gotoHome(page);
  test.skip(!(await hasHardwareWebGL(page)), 'this browser does not get the WebGL sphere');
  await page.evaluate(() => document.getElementById('skills')?.scrollIntoView());
  const drawn = await expect
    .poll(() => page.evaluate(() => (window.__skillSphere?.frames ?? 0) > 20), { timeout: 20_000 })
    .toBe(true)
    .then(() => true)
    .catch(() => false);
  test.skip(!drawn, 'the sphere did not mount here (low-power heuristics)');
  // The constellation has handed over (and faded out) before the shots.
  await expect(page.locator('#skills [data-skills-mode="constellation"]')).toHaveCount(0, { timeout: 5000 });
  const report = await canvasEdgeLift(page, '#skills .skills-sphere canvas');
  const text = JSON.stringify(report);
  for (const v of [...Object.values(report.inside), ...Object.values(report.outside)]) expect(Number.isFinite(v), text).toBe(true);
  // The shots are comparable: nothing outside the canvas changed between them.
  for (const v of Object.values(report.outside)) expect(Math.abs(v), text).toBeLessThanOrEqual(1);
  // With postprocessing's 8 mip levels the corners rose by ~16-36 and the edges by ~25-30.
  for (const v of Object.values(report.inside)) expect(v, text).toBeLessThanOrEqual(3);
});
