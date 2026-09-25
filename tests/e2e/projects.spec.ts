import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import projects from '../../src/data/projects.json' with { type: 'json' };
import { slugify } from '../../src/lib/slug';
import { matchesTech } from '../../src/lib/tech';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Projects package: data and slugs, self-hosted media, cards, filters on the URL,
 * the bento grid, the dialog (deep links, sharing, navigation, reading aids) and
 * the static case-study pages with their Open Graph images.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
/** One project of the matrix, for checks that do not depend on viewport, theme or motion. */
const once = (info: TestInfo) => width(info) === 1440 && !isLight(info) && !isReduced(info);
const desktop = (info: TestInfo) => width(info) >= 1024 && !isTouch(info);

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SLUGS = projects.map((p) => slugify(p.name));
const CASE_STUDIES = projects.filter((p) => 'problem' in p && 'solution' in p && p.problem && p.solution).map((p) => slugify(p.name));
const GEMINI = projects.filter((p) => matchesTech(p.techStack, 'Gemini')).length;
const FORBIDDEN_COPY = /\bOSS\b|Stack deps|min read|★\s*0/;

const cards = (page: Page) => page.locator('#projects [data-project-card]');
const dialog = (page: Page) => page.locator('[data-dialog-root] [role="dialog"]');

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function gotoProjects(page: Page, query = '') {
  await page.goto(`/${query}#projects`);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  await page.locator('#projects').scrollIntoViewIfNeeded();
}

/** Scrolls the grid through the viewport so every card has revealed. */
async function revealGrid(page: Page) {
  await page.evaluate(async () => {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const end = top + grid.offsetHeight;
    for (let y = top - window.innerHeight; y < end; y += window.innerHeight * 0.6) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo({ top, behavior: 'instant' });
  });
}

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

function folderBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  }
  return total;
}

test.beforeEach(async ({ page }) => {
  await skipIntro(page);
});

/* ---------------- #92 data and slugs ---------------- */

test.describe('project data (#92)', () => {
  test('ten unique slugs equal slugify(name), and the grid renders one card per project', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    expect(new Set(SLUGS).size).toBe(projects.length);
    for (const p of projects) expect((p as { slug?: string }).slug, p.name).toBe(slugify(p.name));

    await gotoProjects(page);
    await expect(cards(page)).toHaveCount(projects.length);
    const rendered = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-project-card')));
    expect([...rendered].sort()).toEqual([...SLUGS].sort());
    await expect(page.locator('#projects header')).toContainText('ten shipped projects');
  });
});

/* ---------------- #93 media ---------------- */

test.describe('self-hosted media (#93)', () => {
  test('stills and loops are local, small, and within the 3 MB budget', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    const raw = readFileSync(join(ROOT, 'src/data/projects.json'), 'utf8');
    expect(raw).not.toMatch(/user-attachments|opengraph\.githubassets/);
    const images = join(ROOT, 'public/images/projects');
    const videos = join(ROOT, 'public/videos/projects');
    expect(folderBytes(images) + folderBytes(videos)).toBeLessThanOrEqual(3 * 1024 * 1024);
    for (const p of projects as { slug: string; thumbnail: string; demoVideo?: string; fallbackThumbnail: string }[]) {
      expect(p.thumbnail).toBe(`/images/projects/${p.slug}/cover.webp`);
      expect(statSync(join(ROOT, 'public', p.thumbnail)).size, p.thumbnail).toBeLessThanOrEqual(80 * 1024);
      expect(statSync(join(ROOT, 'public', p.fallbackThumbnail)).isFile()).toBe(true);
      if (p.demoVideo) expect(statSync(join(ROOT, 'public', p.demoVideo)).size, p.demoVideo).toBeLessThanOrEqual(800 * 1024);
    }
    const served = await page.request.get((projects[0] as { thumbnail: string }).thumbnail);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('image/webp');
  });
});

/* ---------------- #94 ProjectImage ---------------- */

test.describe('project images (#94)', () => {
  test('every still is visible at rest, with a srcset', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await gotoProjects(page);
    await revealGrid(page);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLImageElement>('#projects [data-project-card] img')).map((img) => {
              let opacity = 1;
              for (let el: Element | null = img; el && el.id !== 'projects'; el = el.parentElement) {
                opacity *= Number(getComputedStyle(el).opacity);
              }
              return { loaded: img.complete && img.naturalWidth > 0, opacity, srcset: Boolean(img.getAttribute('srcset')) };
            }),
          ),
        { timeout: 10_000 },
      )
      .toEqual(projects.map(() => ({ loaded: true, opacity: 1, srcset: true })));
  });

  test('a blocked still falls back to the generated artwork', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info), 'one desktop viewport per motion setting');
    await page.route(/cover\.[^&]*\.webp/, (route) => route.abort());
    await gotoProjects(page);
    const first = page.locator(`[data-project-media="${SLUGS[0]}"]`).first();
    await first.scrollIntoViewIfNeeded();
    await expect(first).toHaveAttribute('data-fallback', '');
    await expect.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('project-thumb');
  });

  test('Save-Data never downloads a demo loop', async ({ page }, info) => {
    test.skip(!desktop(info) || isReduced(info) || isLight(info), 'desktop full-motion only');
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true, effectiveType: '4g', addEventListener() {}, removeEventListener() {} },
      });
    });
    const videoRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/videos/projects/')) videoRequests.push(req.url());
    });
    await gotoProjects(page);
    const withVideo = (projects as { slug: string; demoVideo?: string }[]).filter((p) => p.demoVideo);
    for (const p of withVideo) {
      const card = page.locator(`[data-project-card="${p.slug}"]`);
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await page.waitForTimeout(400);
    }
    expect(videoRequests).toEqual([]);
  });

  test('hovering a card with a demo loop starts loading it', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info) || isLight(info), 'desktop full-motion only');
    const slug = (projects as { slug: string; demoVideo?: string }[]).find((p) => p.demoVideo)?.slug;
    test.skip(!slug, 'no project has a demo loop');
    await gotoProjects(page);
    const card = page.locator(`[data-project-card="${slug}"]`);
    await card.scrollIntoViewIfNeeded();
    // Playwright's Chromium has no H.264 decoder, so this checks the request, not playback.
    const loop = page.waitForRequest((req) => req.url().includes(`/videos/projects/${slug}/`));
    await card.hover();
    await loop;
    await expect(card.locator('video')).toHaveCount(1);
  });
});

/* ---------------- #95 card semantics ---------------- */

test.describe('cards (#95)', () => {
  test('no nested interactive content', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    await gotoProjects(page);
    await revealGrid(page);
    const violations = await runAxe(page, '#projects', ['nested-interactive']);
    test.skip(violations === null, 'axe-core is not installed');
    expect(violations).toEqual([]);
    // Belt and braces: no link or button inside another.
    const nested = await page.evaluate(
      () => document.querySelectorAll('#projects :is(a, button) :is(a, button), #projects [role="button"] :is(a, button)').length,
    );
    expect(nested).toBe(0);
  });

  test("Enter on 'Code' follows the link instead of opening the dialog", async ({ page, context }, info) => {
    test.skip(!desktop(info) || isLight(info), 'desktop, one theme');
    await context.route(/^https:\/\/github\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
    await gotoProjects(page);
    const code = cards(page).first().getByRole('link', { name: /^Code/ });
    await code.focus();
    const popup = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const tab = await popup;
    await expect.poll(() => tab.url()).toContain('github.com/Golden007-prog/');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
  });

  test('the card title is the dialog opener and Live demo text passes 4.5:1', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info), 'desktop, both themes');
    await gotoProjects(page);
    await expect(page.locator(`#project-open-${SLUGS[0]}`)).toHaveAttribute('aria-haspopup', 'dialog');
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const hex = (v: string) => v.trim();
      const toRgb = (h: string) => {
        const n = parseInt(h.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const a = toRgb(hex(css.getPropertyValue('--app-violet')));
      const b = toRgb(hex(css.getPropertyValue('--app-violet-bright')));
      const mix = a.map((v, i) => Math.round(v * 0.72 + b[i] * 0.28));
      return [`rgb(${a.join(',')})`, `rgb(${mix.join(',')})`];
    });
    for (const bg of ratios) expect(contrast('rgb(255,255,255)', bg), bg).toBeGreaterThanOrEqual(4.5);
  });

  test('card actions stay on one line at 1024', async ({ page }, info) => {
    test.skip(width(info) !== 1024, '1024 only');
    await gotoProjects(page);
    await revealGrid(page);
    const wrapped = await cards(page).evaluateAll((els) =>
      els
        .map((el) => {
          const links = Array.from(el.querySelectorAll<HTMLElement>('[data-button]'));
          const tops = new Set(links.map((l) => Math.round(l.getBoundingClientRect().top)));
          return { slug: el.getAttribute('data-project-card'), rows: tops.size };
        })
        .filter((r) => r.rows > 1),
    );
    expect(wrapped).toEqual([]);
  });

  test('card links and filter pills are at least 44px on a coarse pointer', async ({ page }, info) => {
    test.skip(!isTouch(info), 'coarse pointer only');
    await gotoProjects(page);
    await revealGrid(page);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#projects [data-button], #projects [aria-pressed]'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ text: el.textContent?.trim().slice(0, 30), w: el.offsetWidth, h: el.offsetHeight }))
        .filter((s) => s.w < 44 || s.h < 44),
    );
    expect(small).toEqual([]);
  });
});

/* ---------------- #96 filters ---------------- */

test.describe('filters (#96)', () => {
  test(`?tech=Gemini shows ${GEMINI} and announces it`, async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await gotoProjects(page, '?tech=Gemini');
    await expect(cards(page)).toHaveCount(GEMINI);
    await expect(page.locator('[data-projects-status]')).toHaveText(`${GEMINI} projects`);
    await expect(page.locator('[aria-label="Filter by technology"] [aria-pressed="true"]')).toContainText('Gemini');
  });

  test('search keeps the hash, and Clear restores every project', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await gotoProjects(page);
    const search = page.locator('#projects input[type="search"]');
    await search.fill('voice');
    await expect.poll(() => page.url()).toContain('q=voice');
    expect(page.url()).toContain('#projects');
    await expect(cards(page)).toHaveCount(projects.filter((p) => /voice/i.test([p.name, p.tagline, ...p.techStack, ...p.topics].join(' '))).length);

    await search.fill('zzzz-no-such-project');
    await expect(page.locator('[data-projects-empty]')).toBeVisible();
    await expect(page.locator('[data-projects-status]')).toHaveText('0 projects');
    await page.locator('[data-projects-empty]').getByRole('button', { name: 'Clear filters' }).click();
    await expect(cards(page)).toHaveCount(projects.length);
    await expect.poll(() => page.url()).not.toContain('q=');
    expect(page.url()).toContain('#projects');
  });

  test('category pills are a named group with aria-pressed and a 4.5:1 active state', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info), 'desktop, both themes');
    await gotoProjects(page);
    const group = page.getByRole('group', { name: 'Filter by category' });
    const ds = group.getByRole('button', { name: /^Data Science/ });
    await ds.click();
    await expect(ds).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.url()).toContain('cat=Data');
    await expect(cards(page)).toHaveCount(projects.filter((p) => p.category === 'Data Science').length);
    const [fg, bg] = await ds.evaluate((el) => {
      const pill = el.querySelector('span[aria-hidden="true"]');
      return [getComputedStyle(el).color, pill ? getComputedStyle(pill).backgroundColor : 'rgb(0,0,0)'];
    });
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

/* ---------------- #97 bento ---------------- */

test.describe('bento grid (#97)', () => {
  test('no holes at 1440', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await gotoProjects(page);
    await revealGrid(page);
    const report = await page.evaluate(() => {
      // Layout offsets, not client rects: reveal and layout transforms must not skew the rows.
      const grid = document.getElementById('projects-grid')!;
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      const col = (grid.clientWidth - gap * 5) / 6;
      const items = Array.from(grid.children as HTMLCollectionOf<HTMLElement>).map((li) => ({
        left: li.offsetLeft,
        top: li.offsetTop,
        width: li.offsetWidth,
        bottom: li.offsetTop + li.offsetHeight,
      }));
      const tops = [...new Set(items.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
      const cells = new Set<string>();
      for (const r of items) {
        const c0 = Math.round(r.left / (col + gap));
        const span = Math.round((r.width + gap) / (col + gap));
        const r0 = tops.indexOf(Math.round(r.top));
        const r1 = tops.findIndex((t) => t >= Math.round(r.bottom)) - 1;
        const last = r1 < 0 ? tops.length - 1 : r1;
        for (let row = r0; row <= last; row++) for (let c = c0; c < c0 + span; c++) cells.add(`${row}:${c}`);
      }
      const missing: string[] = [];
      for (let row = 0; row < tops.length; row++) for (let c = 0; c < 6; c++) if (!cells.has(`${row}:${c}`)) missing.push(`${row}:${c}`);
      return { rows: tops.length, missing };
    });
    expect(report.missing).toEqual([]);
  });

  test('the lead card spans the full width at 768', async ({ page }, info) => {
    test.skip(width(info) !== 768, '768 only');
    await gotoProjects(page);
    const [gridWidth, leadWidth] = await page.evaluate(() => {
      const grid = document.getElementById('projects-grid')!;
      return [grid.getBoundingClientRect().width, (grid.firstElementChild as HTMLElement).getBoundingClientRect().width];
    });
    expect(Math.abs(gridWidth - leadWidth)).toBeLessThanOrEqual(2);
  });

  test('no horizontal overflow at 320, grid or dialog', async ({ page }, info) => {
    test.skip(width(info) !== 320, '320 only');
    await gotoProjects(page);
    await revealGrid(page);
    await expectNoHorizontalOverflow(page);
    await page.goto(`/?project=${SLUGS[0]}`);
    await expect(dialog(page)).toBeVisible();
    const overflow = await dialog(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/* ---------------- #98 dialog ---------------- */

test.describe('project dialog (#98)', () => {
  test('Escape returns focus to the card button', async ({ page }, info) => {
    test.skip(!desktop(info), 'desktop pointer only');
    await gotoProjects(page);
    const opener = page.locator(`#project-open-${SLUGS[3]}`);
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('aria-labelledby', `project-dialog-title-${SLUGS[3]}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`project-open-${SLUGS[3]}`);
  });

  test('a dialog opened from a link hands focus to its card on close', async ({ page }, info) => {
    test.skip(!desktop(info) || isLight(info), 'desktop, one theme');
    await page.goto(`/?project=${SLUGS[1]}`);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`project-open-${SLUGS[1]}`);
  });
});

/* ---------------- #99 content integrity ---------------- */

test.describe('dialog and case-study copy (#99)', () => {
  test('no OSS, Stack deps, read-time or zero-star claims', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    test.setTimeout(120_000);
    for (const slug of SLUGS) {
      await page.goto(`/?project=${slug}`);
      await expect(dialog(page)).toBeVisible();
      const text = await dialog(page).innerText();
      expect(text, slug).not.toMatch(FORBIDDEN_COPY);
      await expect(dialog(page)).toContainText('Source on GitHub');
      await expect(dialog(page)).toContainText('Technologies');
    }
    for (const slug of CASE_STUDIES) {
      const res = await page.request.get(`/projects/${slug}`);
      expect(res.status(), slug).toBe(200);
      const html = await res.text();
      expect(html.replace(/<script[\s\S]*?<\/script>/g, ''), slug).not.toMatch(FORBIDDEN_COPY);
    }
  });
});

/* ---------------- #100 deep links ---------------- */

test.describe('deep links (#100)', () => {
  test('/?project=urbancare opens without the curtain and settles on the full slug', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 360, 'two viewports are enough');
    const errors = collectPageErrors(page);
    await page.goto('/?project=urbancare');
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
    await expect(page.locator('#project-dialog-title-urbancare-ai')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe('urbancare-ai');
    expect(errors.errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });

  test('opening pushes history, so Back closes the dialog', async ({ page }, info) => {
    test.skip(!desktop(info), 'desktop pointer only');
    await gotoProjects(page);
    await page.locator(`#project-open-${SLUGS[2]}`).click();
    await expect(dialog(page)).toBeVisible();
    const y = await page.evaluate(() => window.scrollY);
    expect(new URL(page.url()).searchParams.get('project')).toBe(SLUGS[2]);
    await page.goBack();
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('project')).toBeNull();
    // The grid stays where it was instead of jumping to a stale restored offset.
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(2);
  });

  test('Copy link puts a ?project= URL on the clipboard', async ({ page, context }, info) => {
    test.skip(!once(info), 'one project is enough');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/?project=${SLUGS[0]}`);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog(page).getByRole('button', { name: /Link copied/ })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`?project=${SLUGS[0]}`);
  });

  test("a 'project:open' event opens the dialog", async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await gotoProjects(page);
    await page.evaluate((slug) => window.dispatchEvent(new CustomEvent('ob:project:open', { detail: { slug } })), SLUGS[4]);
    await expect(page.locator(`#project-dialog-title-${SLUGS[4]}`)).toBeVisible();
  });
});

/* ---------------- #101 navigation ---------------- */

test.describe('dialog navigation (#101)', () => {
  test('arrow keys step through the filtered list only', async ({ page }, info) => {
    test.skip(!desktop(info), 'desktop pointer only');
    const ds = projects.filter((p) => p.category === 'Data Science').map((p) => slugify(p.name));
    await page.goto(`/?cat=Data+Science&project=${ds[0]}#projects`);
    await expect(dialog(page)).toBeVisible();
    const counter = page.locator('[data-project-counter]');
    await expect(counter).toHaveText(`01 / ${String(ds.length).padStart(2, '0')}`);
    const seen: string[] = [];
    for (let i = 0; i < ds.length; i++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => new URL(page.url()).searchParams.get('project')).not.toBe(seen.at(-1) ?? ds[0]);
      seen.push(new URL(page.url()).searchParams.get('project')!);
    }
    expect(seen.every((s) => ds.includes(s))).toBe(true);
    expect(seen.at(-1)).toBe(ds[0]);
  });

  test('under reduced motion the hero does not travel', async ({ page }, info) => {
    test.skip(!isReduced(info) || !desktop(info), 'reduced-motion desktop only');
    await gotoProjects(page);
    await page.locator(`#project-open-${SLUGS[0]}`).click();
    const hero = dialog(page).locator('[data-project-media]').first();
    await expect(hero).toBeVisible();
    const a = await hero.boundingBox();
    await page.waitForTimeout(200);
    const b = await hero.boundingBox();
    expect(a).toEqual(b);
  });
});

/* ---------------- #102 reading aids ---------------- */

test.describe('reading aids (#102)', () => {
  test('the table of contents lists exactly the sections present', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    for (const slug of [SLUGS[0], SLUGS[8]]) {
      await page.goto(`/?project=${slug}`);
      await expect(dialog(page)).toBeVisible();
      const toc = await dialog(page).locator('[data-project-toc] li').allInnerTexts();
      const sections = await dialog(page).locator('[data-case-study] [data-section]').count();
      expect(toc.length, slug).toBe(sections);
      await expect(dialog(page).locator('[data-project-progress]')).toHaveCount(1);
    }
  });

  test("'More with XGBoost' closes the dialog and filters the grid", async ({ page }, info) => {
    test.skip(!desktop(info) || isLight(info), 'desktop, one theme');
    const withXgb = projects.filter((p) => matchesTech(p.techStack, 'XGBoost'));
    const slug = slugify(withXgb[0].name);
    await page.goto(`/?project=${slug}`);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: `More with XGBoost (${withXgb.length})` }).click();
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('tech')).toBe('XGBoost');
    await expect(cards(page)).toHaveCount(withXgb.length);
  });
});

/* ---------------- #103 case-study pages ---------------- */

test.describe('case-study pages (#103)', () => {
  test('only real case studies have pages, each with valid JSON-LD', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    for (const slug of SLUGS) {
      const res = await page.request.get(`/projects/${slug}`);
      expect(res.status(), slug).toBe(CASE_STUDIES.includes(slug) ? 200 : 404);
    }
    await page.goto(`/projects/${CASE_STUDIES[0]}`);
    await expect(page.locator('h1')).toHaveText(projects.find((p) => slugify(p.name) === CASE_STUDIES[0])!.name);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}');
    expect(ld['@type']).toBe('SoftwareSourceCode');
    expect(ld.codeRepository).toMatch(/^https:\/\/github\.com\//);
    const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(og).toContain(`/projects/${CASE_STUDIES[0]}/opengraph-image`);
  });

  test('renders without hydration errors and the TOC links land on their sections', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    const errors = collectPageErrors(page);
    await page.goto(`/projects/${CASE_STUDIES[1]}`);
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    const link = page.locator('[data-project-toc] a').last();
    const target = (await link.getAttribute('href'))!.slice(1);
    await link.click();
    await expect.poll(() => page.evaluate((id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top), target)).toBeLessThan(200);
    expect(errors.errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });
});

/* ---------------- #104 Open Graph images ---------------- */

test.describe('Open Graph images (#104)', () => {
  test('each case study serves a 1200x630 PNG', async ({ page }, info) => {
    test.skip(!once(info), 'one project is enough');
    for (const slug of CASE_STUDIES) {
      const res = await page.request.get(`/projects/${slug}/opengraph-image`);
      expect(res.status(), slug).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
      const png = await res.body();
      expect(png.readUInt32BE(16), `${slug} width`).toBe(1200);
      expect(png.readUInt32BE(20), `${slug} height`).toBe(630);
    }
  });
});
