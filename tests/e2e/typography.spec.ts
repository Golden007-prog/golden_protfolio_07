import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * Clash Display's space glyph is narrow (~0.155em), so small headings in it read
 * as one word ("AttentionIsAllYouNeed") unless index.css opens the word space.
 * The check is the space-to-letter width ratio: Satoshi body text sits near 0.55,
 * and anything under ~0.4 runs words together at 1x.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const oneProject = (info: TestInfo, w: number) =>
  projectUse(info).viewport?.width === w && !projectUse(info).hasTouch && projectUse(info).colorScheme !== 'light';

/** Width of the first space over the mean letter width, in the first text run with a space. */
async function spaceRatio(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (/\S \S/.test(t.textContent ?? '')) {
        node = t as Text;
        break;
      }
    }
    if (!node) return NaN;
    const text = node.textContent ?? '';
    const range = document.createRange();
    let space = NaN;
    const letters: number[] = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const w = range.getBoundingClientRect().width;
      if (text[i] === ' ' && Number.isNaN(space)) space = w;
      else if (/[a-z]/i.test(text[i])) letters.push(w);
    }
    return space / (letters.reduce((a, b) => a + b, 0) / letters.length);
  });
}

async function openHome(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.evaluate(() => document.fonts.ready);
}

test('small display headings keep a visible word space', async ({ page }, info) => {
  test.skip(!oneProject(info, 1440) && !oneProject(info, 375), 'one desktop and one phone project');
  await openHome(page);
  // Mirrors of the class lists that ran together: ReadingList h4, the recruiter
  // h3s, SentimentDemo/GitHubHeatmap h3, PhilosophySection h3, a ProjectCard
  // title (text inside a button) and a mono eyebrow that must stay untouched.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'type-probe';
    host.innerHTML = `
      <h4 data-probe="h4-sm" class="text-sm font-semibold leading-snug">Attention Is All You Need</h4>
      <h3 data-probe="h3-sm" class="text-sm font-semibold">Requirement by requirement</h3>
      <h3 data-probe="h3-lg" class="font-display text-lg font-semibold">Try it inline sentiment</h3>
      <h3 data-probe="h3-xl" class="font-display text-lg font-semibold md:text-xl">Ship the boring version first.</h3>
      <h3 data-probe="h3-btn" class="font-display text-xl font-semibold"><button type="button">TCS Stock Forecasting</button></h3>
      <h3 data-probe="h3-mono" class="font-mono text-eyebrow uppercase">Used in projects</h3>`;
    document.body.append(host);
  });
  for (const probe of ['h4-sm', 'h3-sm', 'h3-lg', 'h3-xl', 'h3-btn']) {
    expect.soft(await spaceRatio(page, `[data-probe="${probe}"]`), probe).toBeGreaterThanOrEqual(0.4);
  }
  const mono = await page.locator('[data-probe="h3-mono"]').evaluate((el) => getComputedStyle(el).wordSpacing);
  expect(mono).toBe('0px');
});

test('display-size section titles keep their tight set', async ({ page }, info) => {
  test.skip(!oneProject(info, 1440), 'desktop, where section titles are display size');
  await openHome(page);
  const h2 = page.locator('#projects h2').first();
  await expect(h2).toBeAttached();
  const { size, wordSpacing } = await h2.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), wordSpacing: cs.wordSpacing };
  });
  expect(size).toBeGreaterThanOrEqual(40);
  expect(wordSpacing).toBe('0px');
});
