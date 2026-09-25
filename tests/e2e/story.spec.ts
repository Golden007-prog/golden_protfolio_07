import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import reading from '../../src/data/reading.json' with { type: 'json' };
import { techFamily } from '../../src/lib/tech';
import { collectPageErrors, expect, test } from './helpers';

/*
 * Story package: About (at-a-glance, contact block, stats, scrubbed bio), the
 * Experience timeline, Education, Principles, the reading list and the footer.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';

const HYDRATION_ERROR = /#418|#423|#425|hydrat|did not match|server rendered/i;
const HEATMAP_REQUEST = /\/api\/(github|leetcode)\b|github-contributions-api|leetcode-stats-api|alfa-leetcode-api/;
const EXPECTED_MASTERS = (() => {
  const degree = profile.education.find((e) => /master/i.test(e.degree));
  if (!degree?.end) return null;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return degree.end > current ? degree : null;
})();

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

/** Scrolls to the bottom in steps so lazily mounted blocks render. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 60));
    }
  });
}

async function gotoHydrated(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
}

/** WCAG contrast ratio of two 'rgb(a)(...)' strings (alpha ignored). */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

async function runAxe(page: Page, selector: string, rules: string[]) {
  let axePath: string;
  try {
    axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  } catch {
    return null;
  }
  await page.addScriptTag({ path: axePath });
  return page.evaluate(
    async ({ sel, ids }) => {
      const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown }[] }[] }> } }).axe;
      const res = await axe.run(sel, { runOnly: { type: 'rule', values: ids } });
      return res.violations.map((v) => `${v.id}: ${JSON.stringify(v.nodes.map((n) => n.target))}`);
    },
    { sel: selector, ids: rules },
  );
}

test.beforeEach(async ({ page }) => {
  await skipIntro(page);
});

test('nothing in the story sections is wider than the viewport', async ({ page }, info) => {
  test.skip(width(info) > 400 && width(info) !== 768, 'phone widths and 768 only');
  await gotoHydrated(page);
  await scrollThrough(page);
  await page.waitForTimeout(500);
  const offenders = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('#about *, #experience *, #philosophy *, #site-footer *'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 0.5) return false;
        // Content inside a scroller or a clipping box (a heatmap strip, the name marquee) cannot widen the page.
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= vw + 0.5) return false;
        }
        return true;
      })
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')}`);
  });
  expect(offenders).toEqual([]);
});

test('touch targets in the footer and About contact block are at least 44px on a coarse pointer', async ({ page }, info) => {
  test.skip(!isTouch(info), 'coarse-pointer projects only');
  await gotoHydrated(page);
  await scrollThrough(page);
  const small = await page
    .locator('#site-footer a, #site-footer button, #about [data-contact-block] a, #experience [data-skill-chip], #experience button[aria-controls]')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ text: el.textContent?.trim().slice(0, 30), h: (el as HTMLElement).offsetHeight }))
        .filter((s) => s.h < 44),
    );
  expect(small).toEqual([]);
});

/* ---------------- Footer (#62) ---------------- */

test.describe('footer', () => {
  for (const days of [2, 40]) {
    test(`hydrates without a mismatch with the clock ${days} days ahead`, async ({ page }, info) => {
      test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
      const errors = collectPageErrors(page);
      await page.clock.setSystemTime(Date.now() + days * 86_400_000);
      await gotoHydrated(page);
      await scrollThrough(page);
      await page.waitForTimeout(300);
      expect(errors.errors.filter((e) => HYDRATION_ERROR.test(e))).toEqual([]);
      const stamp = page.locator('#site-footer [data-build-stamp]');
      await expect(stamp).not.toContainText(/Launched|days ago/);
      await expect(stamp.locator('time[datetime]')).toHaveCount(1);
    });
  }

  test('has the landmark id, a sitemap for this route and safe external links', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await gotoHydrated(page);
    const footer = page.locator('footer#site-footer');
    await expect(footer).toHaveCount(1);
    const hrefs = await footer.locator('nav a').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toEqual(['#about', '#skills', '#projects', '#experience', '#philosophy', '#contact']);
    for (const link of await footer.locator('a[target="_blank"]').all()) {
      expect(await link.getAttribute('rel')).toContain('noopener');
      expect(await link.textContent()).toContain('(opens in new tab)');
    }
    const commit = footer.locator('a[href*="/commit/"]');
    if ((await commit.count()) > 0) {
      await expect(commit).toHaveAttribute('href', /^https:\/\/github\.com\/Golden007-prog\/golden_protfolio_07\/commit\/[0-9a-f]{7,40}$/);
    }
    // No dim alpha text or white-alpha classes left.
    const classes = await footer.evaluate((el) => Array.from(el.querySelectorAll('*')).map((n) => n.getAttribute('class') ?? '').join(' '));
    expect(classes).not.toMatch(/\/70\b|(bg|border|text)-(white|black)\//);
  });

  test('every footer link is clickable at 360 when scrolled to the end', async ({ page }, info) => {
    test.skip(width(info) !== 360, '360px projects only');
    await gotoHydrated(page);
    await scrollThrough(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(400);
    const targets = page.locator('#site-footer a, #site-footer button');
    const n = await targets.count();
    expect(n).toBeGreaterThan(10);
    const blocked: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = targets.nth(i);
      await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(250);
      const hit = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === node || node.contains(top) ? null : `${node.textContent?.trim()} covered by ${top?.tagName}.${top?.className}`;
      });
      if (hit) blocked.push(hit);
    }
    expect(blocked).toEqual([]);
  });

  test('the name marquee is one static row when motion is paused', async ({ page }, info) => {
    test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 360), 'reduced-motion projects only');
    await gotoHydrated(page);
    const marquee = page.locator('#site-footer [data-footer-marquee]');
    await expect(marquee).toHaveAttribute('aria-hidden', 'true');
    expect(await marquee.locator('[inert]').count()).toBe(0);
    expect(await marquee.locator(':scope > div').evaluate((el) => getComputedStyle(el).flexWrap)).toBe('wrap');
  });

  test('the reduce-motion switch flips the site-wide setting', async ({ page }, info) => {
    test.skip(isReduced(info) || width(info) !== 1440, 'one full-motion viewport is enough');
    await gotoHydrated(page);
    const sw = page.locator('#site-footer [data-footer-motion-switch]');
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  });
});

/* ---------------- About (#63-#66) ---------------- */

test.describe('about', () => {
  test('contact block: no overlap, a dialer link, 44px targets and a vCard link', async ({ page }, info) => {
    test.skip(width(info) > 390, 'phone widths only');
    await gotoHydrated(page);
    const email = page.locator('#about [data-contact-email]');
    const phone = page.locator('#about [data-contact-phone]');
    await email.scrollIntoViewIfNeeded();
    // Measure once the reveal's translate has settled; mid-flight a fractional
    // offset reads 44px as 43.9998 in floating point.
    await expect
      .poll(
        () =>
          phone.evaluate((el) => {
            for (let n = el.parentElement; n; n = n.parentElement) {
              const t = getComputedStyle(n).transform;
              if (t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)') return false;
            }
            return true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    const [a, b] = [await email.boundingBox(), await phone.boundingBox()];
    expect(a && b).toBeTruthy();
    const overlapX = Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x);
    const overlapY = Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y);
    expect(overlapX <= 0 || overlapY <= 0, 'email and phone overlap').toBe(true);
    expect(a!.height).toBeGreaterThanOrEqual(44);
    expect(b!.height).toBeGreaterThanOrEqual(44);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(a!.x + a!.width).toBeLessThanOrEqual(vw);
    await expect(phone).toHaveAttribute('href', 'tel:+917001124396');
    const vcard = page.locator('#about a[href="/contact.vcf"]');
    await expect(vcard).toHaveAttribute('download', '');
    await expect(page.locator('#about [data-copy-button]')).toHaveCount(2);
  });

  test('the vCard route serves a card', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    const res = await page.request.get('/contact.vcf');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('BEGIN:VCARD');
  });

  test("'Currently' is at least 4.5:1 in the light theme", async ({ page }, info) => {
    test.skip(!isLight(info), 'light projects only');
    await gotoHydrated(page);
    const label = page.locator('#about [data-currently]');
    await label.scrollIntoViewIfNeeded();
    const { fg, page: bg } = await label.evaluate((el) => ({
      fg: getComputedStyle(el).color,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    // The glass card sits between white and the page cream; check both ends.
    expect(contrast(fg, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('AboutSection.tsx carries no availability literals', async ({}, info) => {
    test.skip(width(info) !== 1440 || isLight(info) || isReduced(info), 'a static check; one project is enough');
    const source = readFileSync(new URL('../../src/components/about/AboutSection.tsx', import.meta.url), 'utf8');
    for (const literal of [...Object.values(profile.availability), 'Available for hire', 'Open to', 'AI Engineer']) {
      expect(source, literal).not.toContain(literal);
    }
  });

  test('at a glance: first in About, within a scroll, built from the data', async ({ page }, info) => {
    test.skip(width(info) !== 375 && width(info) !== 1440, 'two viewports are enough');
    await gotoHydrated(page);
    const glance = page.locator('#about [data-at-a-glance]');
    const gap = await glance.evaluate((el) => {
      const about = document.getElementById('about')!;
      return el.getBoundingClientRect().top - about.getBoundingClientRect().top;
    });
    const vh = await page.evaluate(() => window.innerHeight);
    expect(gap).toBeLessThan(vh);
    await expect(glance).toContainText(profile.availability.status);
    await expect(glance).toContainText(profile.availability.openTo);
    await expect(glance).toContainText(profile.availability.focus);
    await expect(glance).toContainText(profile.headline.split('|')[0].trim());
    await expect(glance).toContainText('Current program');
    if (EXPECTED_MASTERS) await expect(glance).toContainText('Expected Feb 2027');
    await expect(glance.locator('a[download="Oikantik-Basu-CV.pdf"]')).toHaveCount(1);
    await expect(glance.locator('a[href^="mailto:"]')).toHaveCount(1);
  });

  test('stat labels fit their cards', async ({ page }, info) => {
    test.skip(width(info) !== 768 && width(info) !== 320, '768 and 320 only');
    await gotoHydrated(page);
    const overflow = await page.locator('#about [data-stat-label]').evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    );
    expect(overflow).toEqual([]);
  });

  test('scrubbed bio: read once, never below 0.6, plain text on touch', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && !isTouch(info), '1440 and touch projects only');
    await gotoHydrated(page);
    const readable = await page.locator('#about').evaluate((root, about) => {
      const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
      return Array.from(root.querySelectorAll('p')).filter(
        (p) => norm(p.textContent) === about && !p.closest('[aria-hidden="true"]'),
      ).length;
    }, profile.about.replace(/\s+/g, ' ').trim());
    expect(readable).toBe(1);

    const words = page.locator('#about [data-scrub-word]');
    if (isTouch(info) || isReduced(info)) {
      await expect(words).toHaveCount(0);
      return;
    }
    await expect(words.first()).toBeAttached();
    await page.locator('#about [data-scrub]').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(600);
    const opacities = await words.evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).opacity)));
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.6 - 0.001);
  });
});

test.describe('about without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the server HTML holds the real counts, never 0+', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto('/');
    const about = page.locator('#about');
    expect(await about.textContent()).not.toMatch(/(^|\D)0\+/);
    const expected: Record<string, number> = {
      'Public projects': projects.length,
      'Skills listed': new Set(Object.values(profile.skills).flat()).size,
      'Skill domains': Object.keys(profile.skills).length,
      'Technologies in projects': new Set(projects.flatMap((p) => p.techStack.map(techFamily))).size,
    };
    const shown = await about.locator('[data-stat-label]').evaluateAll((labels) =>
      labels.map((label) => {
        const card = label.parentElement!;
        return [label.textContent?.trim() ?? '', card.querySelector('.sr-only')?.textContent?.trim() ?? ''];
      }),
    );
    expect(Object.fromEntries(shown.map(([k, v]) => [k, Number(v)]))).toEqual(expected);
  });
});

/* ---------------- Experience (#67-#72) ---------------- */

test.describe('experience', () => {
  test('kickers read 01 / About, 04 / Experience and 05 / Principles', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await gotoHydrated(page);
    await expect(page.locator('#about header .sr-only').first()).toHaveText('01 / About');
    await expect(page.locator('#experience header .sr-only').first()).toHaveText('04 / Experience');
    await expect(page.locator('#philosophy header .sr-only').first()).toHaveText('05 / Principles');
  });

  test('roles are an ordered list of articles with machine-readable dates', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoHydrated(page);
    const cards = page.locator('#experience ol > li article[data-role-card]');
    await expect(cards).toHaveCount(profile.experience.length);
    for (const [i, exp] of profile.experience.entries()) {
      const card = cards.nth(i);
      await expect(card.locator(`time[datetime="${exp.start}"]`)).toHaveCount(1);
      if (exp.end) await expect(card.locator(`time[datetime="${exp.end}"]`)).toHaveCount(1);
      const labelledBy = await card.getAttribute('aria-labelledby');
      await expect(page.locator(`[id="${labelledBy}"]`)).toHaveText(exp.role);
    }
    await expect(page.locator('#experience [data-present-badge]')).toHaveCount(profile.experience.filter((e) => e.end === null).length);
    await expect(page.locator('#experience [data-present-badge]').first()).toContainText('Present');
    // Every aria-controls points at an element that exists.
    const dangling = await page.locator('#experience [aria-controls]').evaluateAll((els) =>
      els.filter((el) => !document.getElementById(el.getAttribute('aria-controls')!)).map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(dangling).toEqual([]);
    const toggle = cards.first().locator('button[aria-controls]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`)).toContainText(profile.experience[0].description.slice(0, 40));
  });

  test('reduced motion: Present shows a static dot and no Lottie is fetched', async ({ page }, info) => {
    test.skip(!isReduced(info) || width(info) !== 1440, 'one reduced-motion viewport is enough');
    const json: string[] = [];
    page.on('request', (req) => {
      if (/\/lottie\/(dots|calendar)\.json/.test(req.url())) json.push(req.url());
    });
    await gotoHydrated(page);
    await scrollThrough(page);
    await page.waitForTimeout(500);
    expect(json).toEqual([]);
    for (const icon of await page.locator('#experience [data-present-badge] [data-lottie]').all()) {
      await expect(icon).toHaveAttribute('data-lottie-phase', 'fallback');
    }
    await expect(page.locator('#experience [data-education] [data-lottie]')).toHaveAttribute('data-lottie-phase', 'fallback');
  });

  test('every node sits on the spine', async ({ page }, info) => {
    test.skip(![360, 768, 1440].includes(width(info)), '360, 768 and 1440 only');
    await gotoHydrated(page);
    await scrollThrough(page);
    const offsets = await page.locator('#experience [data-timeline]').evaluate((root) => {
      const fill = root.querySelector('[data-spine-fill]')!.getBoundingClientRect();
      const spine = fill.left + fill.width / 2;
      return Array.from(root.querySelectorAll('[data-spine-node]')).map((n) => {
        const r = n.getBoundingClientRect();
        return r.left + r.width / 2 - spine;
      });
    });
    expect(offsets.length).toBe(profile.experience.length);
    for (const d of offsets) expect(Math.abs(d)).toBeLessThanOrEqual(0.5);
  });

  test('the spine is full and every node lit on lite devices and under reduced motion', async ({ page }, info) => {
    test.skip(!isTouch(info) && !isReduced(info), 'touch or reduced projects only');
    await gotoHydrated(page);
    const timeline = page.locator('#experience [data-timeline]');
    await expect(timeline).toHaveAttribute('data-spine-mode', 'static');
    expect(await timeline.locator('[data-spine-fill]').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const nodes = timeline.locator('[data-spine-node]');
    const lit = await nodes.evaluateAll((els) => els.filter((el) => el.hasAttribute('data-lit')).length);
    expect(lit).toBe(await nodes.count());
  });

  test('chips fit at 320 and name only skills that occur verbatim', async ({ page }, info) => {
    test.skip(width(info) !== 320 && width(info) !== 1440, '320 and 1440 only');
    await gotoHydrated(page);
    const cards = page.locator('#experience article[data-role-card]');
    for (const [i, exp] of profile.experience.entries()) {
      const card = cards.nth(i);
      const box = (await card.boundingBox())!;
      for (const chip of await card.locator('[data-metric-chip], [data-skill-chip]').all()) {
        const c = (await chip.boundingBox())!;
        expect(c.x).toBeGreaterThanOrEqual(box.x - 0.5);
        expect(c.x + c.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      }
      for (const term of await card.locator('[data-skill-chip]').evaluateAll((els) => els.map((el) => el.getAttribute('data-skill-chip')!))) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(exp.description), `${term} in ${exp.company}`).toBe(true);
      }
    }
  });

  test('a skill chip focuses that skill and scrolls to Skills', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isTouch(info), 'one desktop viewport is enough');
    await gotoHydrated(page);
    await page.evaluate(() => {
      const w = window as Window & { __skillFocus?: string[] };
      w.__skillFocus = [];
      window.addEventListener('ob:skill:focus', (e) => w.__skillFocus!.push((e as CustomEvent<{ name: string }>).detail.name));
    });
    const chip = page.locator('#experience [data-skill-chip]').first();
    await chip.scrollIntoViewIfNeeded();
    const term = await chip.getAttribute('data-skill-chip');
    await chip.click();
    expect(await page.evaluate(() => (window as Window & { __skillFocus?: string[] }).__skillFocus)).toEqual([term]);
    await expect.poll(() => page.locator('#skills').evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 5000 }).toBeLessThan(200);
  });

  test('dividers stay visible in the light theme', async ({ page }, info) => {
    test.skip(!isLight(info) || width(info) !== 1440, 'one light viewport is enough');
    await gotoHydrated(page);
    const colors = await page
      .locator('#experience article[data-role-card] ul[aria-label="In numbers"]')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopColor));
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) {
      const [r, g, b, a = 1] = (c.match(/[\d.]+/g) ?? []).map(Number);
      expect(a).toBeGreaterThan(0.04);
      expect(Math.max(r, g, b)).toBeLessThan(128); // a dark hairline on cream, not a white one
    }
  });

  test('axe: no list, ARIA or nested-interactive violations', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoHydrated(page);
    await scrollThrough(page);
    const violations = await runAxe(page, '#experience', [
      'list',
      'listitem',
      'aria-allowed-attr',
      'aria-valid-attr-value',
      'aria-required-children',
      'aria-required-parent',
      'nested-interactive',
      'button-name',
      'link-name',
    ]);
    test.skip(violations === null, 'axe-core is not installed');
    expect(violations).toEqual([]);
  });

  test('the heatmaps fetch nothing until scrolled near', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    const seen: string[] = [];
    page.on('request', (req) => {
      if (HEATMAP_REQUEST.test(req.url())) seen.push(req.url());
    });
    await gotoHydrated(page);
    await page.waitForTimeout(1500);
    expect(seen).toEqual([]);
    await page.locator('#experience [data-education]').evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await expect.poll(() => seen.length, { timeout: 8000 }).toBeGreaterThan(0);
  });

  test('the Experience section shifts less than 0.05 while scrolled through', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await page.addInitScript(() => {
      const w = window as Window & { __storyCls?: number };
      w.__storyCls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[]) {
          if (entry.hadRecentInput) continue;
          const inside = entry.sources?.some((s) => s.node instanceof Element && s.node.closest('#experience'));
          if (inside) w.__storyCls! += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await gotoHydrated(page);
    await scrollThrough(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as Window & { __storyCls?: number }).__storyCls)).toBeLessThan(0.05);
  });

  test('education reads its expected date from the data', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 320, 'two viewports are enough');
    test.skip(!EXPECTED_MASTERS, 'the degree has finished');
    await gotoHydrated(page);
    const edu = page.locator('#experience [data-education]');
    await expect(edu).toContainText('Expected Feb 2027');
    await expect(edu).toContainText('CGPA: 8.22');
    await expect(edu.locator('time[datetime="2027-02"]')).toHaveCount(1);
  });
});

/* ---------------- Principles (#73) ---------------- */

test.describe('principles', () => {
  test('a sticky deck at 1440 with a fine pointer, a grid elsewhere', async ({ page }, info) => {
    test.skip(![1440, 1024, 768].includes(width(info)), '1440, 1024 and 768 only');
    await gotoHydrated(page);
    const deck = page.locator('#philosophy .story-deck');
    const items = deck.locator(':scope > li');
    await expect(items).toHaveCount(6);
    const positions = await items.evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
    const display = await deck.evaluate((el) => getComputedStyle(el).display);
    if (width(info) === 1440 && !isTouch(info) && !isReduced(info)) {
      expect(positions.every((p) => p === 'sticky')).toBe(true);
      expect(display).toBe('block');
    } else {
      expect(positions.every((p) => p !== 'sticky')).toBe(true);
      expect(display).toBe('grid');
    }
    // DOM order is the reading and tab order: 01..06.
    const numbers = await items.evaluateAll((els) => els.map((el) => el.querySelector('span')?.textContent?.trim()));
    expect(numbers).toEqual(['01', '02', '03', '04', '05', '06']);
  });
});

/* ---------------- Reading list (#74) ---------------- */

test.describe('reading list', () => {
  test('cards size to their content on phones', async ({ page }, info) => {
    test.skip(width(info) >= 768, 'phone widths only');
    await gotoHydrated(page);
    const grid = page.locator('#experience [data-reading-grid]');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridAutoRows)).toBe('auto');
  });

  test('filters are pressed toggles with counts', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoHydrated(page);
    const list = page.locator('#experience [data-reading-list]');
    await list.scrollIntoViewIfNeeded();
    const rag = list.getByRole('button', { name: /^RAG/ });
    await rag.click();
    await expect(rag).toHaveAttribute('aria-pressed', 'true');
    await expect(list.locator('[data-reading-item]')).toHaveCount(reading.filter((r) => r.tag === 'RAG').length);
    await rag.click();
    await list.getByRole('button', { name: /^Books/ }).click();
    await expect(list.locator('[data-reading-item]')).toHaveCount(reading.filter((r) => r.kind === 'book').length);
    // Every new-tab link says so.
    for (const link of await list.locator('a[target="_blank"]').all()) {
      expect(await link.textContent()).toContain('(opens in new tab)');
    }
  });

  test('copy citation matches reading.json exactly', async ({ page, context, browserName }, info) => {
    test.skip(width(info) !== 1440 || browserName !== 'chromium', 'one chromium viewport is enough');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoHydrated(page);
    const first = page.locator('#experience [data-reading-item]').first();
    await first.scrollIntoViewIfNeeded();
    await first.locator('[data-copy-button]').click();
    const r = reading[0];
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${r.authors} (${r.year}). ${r.title}. ${r.url}`);
    const badges = await page.locator('#experience [data-reading-item]').allTextContents();
    expect(badges.filter((t) => /arXiv:\d{4}\.\d{4,5}/.test(t)).length).toBe(reading.filter((x) => /arxiv\.org/.test(x.url)).length);
  });

  test('axe: no nested interactive controls', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoHydrated(page);
    expect(await page.locator('[data-reading-list] :is(a, button) :is(a, button)').count()).toBe(0);
    const violations = await runAxe(page, '[data-reading-list]', ['nested-interactive', 'list', 'listitem', 'aria-allowed-attr', 'button-name', 'link-name']);
    test.skip(violations === null, 'axe-core is not installed');
    expect(violations).toEqual([]);
  });
});
