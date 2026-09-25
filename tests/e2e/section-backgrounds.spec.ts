import { expect, test } from './helpers';

/*
 * A section's background layers (videos, images, gradients) fill the whole section,
 * gutters included. Passed as children, they were laid out in SectionWrapper's
 * 1440px content column, so at 1440 the dark Contact video ran from x=96 to 1329 with
 * a hard vertical seam and a black gutter beside it (233px each side at 1920).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

for (const id of ['skills', 'contact'] as const) {
  test(`#${id}: every background layer spans the whole section`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.evaluate((sectionId) => document.getElementById(sectionId)?.scrollIntoView(), id);
    const report = await page.evaluate((sectionId) => {
      const section = document.getElementById(sectionId)!;
      const s = section.getBoundingClientRect();
      // The layers are the section's absolute -z-10 elements; only the active theme's are shown.
      return [...section.querySelectorAll<HTMLElement>('*')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          return cs.position === 'absolute' && cs.zIndex === '-10' && el.checkVisibility();
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            layer: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 4).join('.')}`,
            off: Math.max(Math.abs(r.left - s.left), Math.abs(s.right - r.right), Math.abs(r.top - s.top), Math.abs(s.bottom - r.bottom)),
          };
        });
    }, id);
    expect(report.length, 'the section has background layers').toBeGreaterThan(0);
    for (const { layer, off } of report) expect(off, layer).toBeLessThanOrEqual(1);
  });
}
