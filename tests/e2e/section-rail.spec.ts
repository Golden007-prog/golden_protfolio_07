import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * Chapter rail geometry (#43). The rail sits in the right gutter: each link box is
 * just the 44px tick, labels are out of flow, and a label that shows without hover
 * or focus never covers the content column. Before the fix the invisible labels
 * widened every link to ~100px, so the rail drew over the right edge of the cards
 * at 1024-1536 and took clicks meant for inputs and project cards.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
}

async function scrollToSection(page: Page, id: string) {
  await page.evaluate((i) => {
    const top = document.getElementById(i)!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + 50, behavior: 'instant' });
  }, id);
  await expect(page.locator(`[data-section-rail] a[href="#${id}"]`)).toHaveAttribute('aria-current', 'location');
  // Label opacity and tick scale are 300-500ms transitions (instant under reduce).
  await page.waitForTimeout(600);
}

/** Rail boxes against the right edge of SectionWrapper's content column. */
async function railGeometry(page: Page) {
  return page.evaluate(() => {
    const column = document.querySelector('#about > div')!.getBoundingClientRect().right;
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-rail] a')].map((a) => {
      const box = a.getBoundingClientRect();
      const label = a.querySelector<HTMLElement>('[data-rail-label]')!;
      return {
        name: a.getAttribute('aria-label'),
        active: a.getAttribute('aria-current') === 'location',
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        labelLeft: label.getBoundingClientRect().left,
        labelOpacity: Number(getComputedStyle(label).opacity),
      };
    });
    // What a pointer just inside the column's right edge would hit, down the rail's height.
    const railHits: number[] = [];
    const top = Math.min(...links.map((l) => l.top));
    const bottom = Math.max(...links.map((l) => l.bottom));
    for (let y = Math.ceil(top); y < bottom; y += 4) {
      for (const dx of [1, 8, 30]) {
        if (document.elementFromPoint(column - dx, y)?.closest('[data-section-rail]')) railHits.push(y);
      }
    }
    return { column, links, railHits };
  });
}

test.describe('chapter rail geometry (#43)', () => {
  test('the rail stays in the gutter and never covers the content column', async ({ page }, info) => {
    test.skip(width(info) < 1024, 'the rail is hidden below 1024px');
    await open(page);
    if (!isTouch(info)) await page.mouse.move(1, 1);
    const ids = await page.locator('[data-section-rail] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.slice(1)));
    expect(ids.length).toBe(6);

    for (const id of ids) {
      await scrollToSection(page, id);
      await expect(page.locator('[data-section-rail]')).toBeVisible();
      const { column, links, railHits } = await railGeometry(page);
      const rights = links.map((l) => l.right);
      expect(Math.max(...rights) - Math.min(...rights), `ticks right-aligned at #${id}`).toBeLessThanOrEqual(0.5);
      for (const l of links) {
        expect(l.width, `${l.name} link box is only the tick`).toBeLessThanOrEqual(44.5);
        expect(l.left, `${l.name} link box clears the column at #${id}`).toBeGreaterThanOrEqual(column);
        if (l.labelOpacity > 0.01) {
          expect(l.labelLeft, `visible '${l.name}' label clears the column at #${id}`).toBeGreaterThanOrEqual(column);
        }
      }
      expect(railHits, `rail takes no clicks inside the column at #${id}`).toEqual([]);
    }
  });

  test('a click at a field edge beside the rail reaches the field', async ({ page }, info) => {
    test.skip(width(info) < 1024 || isTouch(info), 'desktop pointer with the rail showing');
    await open(page);
    await scrollToSection(page, 'skills');
    const search = page.locator('#skills input[type="search"]');
    await search.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(300);
    const box = (await search.boundingBox())!;
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
    await expect(search).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(40);
  });

  test('labels show on hover and focus; the active one stays up only where the gutter holds it', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isTouch(info), 'one desktop viewport is enough');
    await open(page);
    await page.mouse.move(1, 1);
    await scrollToSection(page, 'experience');

    const activeLabel = page.locator('[data-section-rail] a[aria-current="location"] [data-rail-label]');
    await expect(activeLabel).toHaveCSS('opacity', '0');

    const other = page.locator('[data-section-rail] a[href="#skills"]');
    await other.hover();
    await expect(other.locator('[data-rail-label]')).toHaveCSS('opacity', '1');
    await page.mouse.move(1, 1);
    await expect(other.locator('[data-rail-label]')).toHaveCSS('opacity', '0');

    await other.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(other).toBeFocused();
    await expect(other.locator('[data-rail-label]')).toHaveCSS('opacity', '1');
    await other.blur();

    await page.setViewportSize({ width: 1920, height: 1080 });
    await scrollToSection(page, 'experience');
    await expect(activeLabel).toHaveCSS('opacity', '1');
    const { column, links } = await railGeometry(page);
    const active = links.find((l) => l.active)!;
    expect(active.labelLeft).toBeGreaterThanOrEqual(column);
  });
});
