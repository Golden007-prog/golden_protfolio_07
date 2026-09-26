import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import projects from '../../src/data/projects.json' with { type: 'json' };
import profile from '../../src/data/profile.json' with { type: 'json' };
import { slugify } from '../../src/lib/slug';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Platform smoke suite. The page checks run in every configured project (seven
 * viewports x two themes x motion on/off); the route, header and metadata checks
 * describe the build rather than a viewport, so they run in one project only.
 */

const CANONICAL = 'https://www.basuoikantik.in';
const CV_PATH = '/oikantik_basu_u.pdf';
// Mirrors hasCaseStudy in src/data/projects.ts: a case study needs a problem and a solution.
const CASE_STUDIES = projects
  .filter((p: { problem?: string; solution?: string }) => Boolean(p.problem && p.solution))
  .map((p) => `/projects/${slugify(p.name)}`);
const FIRST_CASE_STUDY = CASE_STUDIES[0] ?? `/projects/${slugify(projects[0].name)}`;

type ProjectUse = { viewport?: { width: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
/** Skip condition: checks that do not depend on viewport, theme or motion run in one representative project. */
const onlyPrimary = ({ viewport, colorScheme, reducedMotion }: { viewport: { width: number } | null; colorScheme: string | null; reducedMotion: string | null }) =>
  !(viewport?.width === 1440 && colorScheme === 'dark' && reducedMotion !== 'reduce');

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

/** Scrolls to the bottom in steps so lazily mounted sections render, then back to the top. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 300));
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

/** Rendered elements matching `selector` that are smaller than 44x44. */
async function undersized(page: Page, selector: string) {
  return page.$$eval(selector, (els) =>
    els
      .filter((el) => {
        const s = getComputedStyle(el);
        return el.getClientRects().length > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert],[aria-hidden="true"]');
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), what: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}` };
      })
      .filter((s) => s.w < 44 || s.h < 44),
  );
}

function pngSize(body: Buffer): { width: number; height: number } {
  expect(body.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

/** A same-origin path for an absolute site URL, so the check runs against the server under test. */
function localPath(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

async function expectOk(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect(res.status(), path).toBe(200);
  return res;
}

test.beforeEach(async ({ page }) => {
  await skipIntro(page);
});

test.describe('home page in every project', () => {
  test('loads without console errors, hydration warnings or horizontal overflow', async ({ page }) => {
    const { errors } = collectPageErrors(page);
    const hydrationWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && /hydrat|did not match|server rendered/i.test(msg.text())) hydrationWarnings.push(msg.text());
    });

    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await expectNoHorizontalOverflow(page);
    await scrollThrough(page);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(500);

    expect(errors, errors.join('\n')).toEqual([]);
    expect(hydrationWarnings, hydrationWarnings.join('\n')).toEqual([]);
  });

  test('the first Tab reaches the skip link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, href: el.getAttribute('href') } : null;
    });
    expect(focused).toEqual({ tag: 'A', href: '#main' });
    await expect(page.locator(':focus')).toBeVisible();
  });

  test('CTAs, the nav toggle and the dock keep a 44px hit area', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);

    // Buttons at size sm are 36px under a mouse by design (a 4px halo makes up the rest).
    const ctas = isTouch(info) ? '#main [data-button]' : '#main [data-button]:not([data-size="sm"])';
    expect(await undersized(page, `${ctas}, #site-nav button[aria-controls="mobile-menu"]`)).toEqual([]);

    await scrollThrough(page);
    const dock = page.locator('[data-dock]');
    if ((await dock.count()) > 0) expect(await undersized(page, '[data-dock] :is(a, button)')).toEqual([]);
  });

  test('after scrolling, nothing marked data-reveal is left invisible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await scrollThrough(page);
    await expect
      .poll(
        () =>
          page.$$eval('[data-reveal]', (els) =>
            els
              .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert],[hidden],[aria-hidden="true"]'))
              .filter((el) => getComputedStyle(el).opacity === '0')
              .map((el) => el.outerHTML.slice(0, 100)),
          ),
        { timeout: 6000 },
      )
      .toEqual([]);
  });

  test('the CV link downloads (the in-app-browser-safe path)', async ({ page }) => {
    await page.goto('/');
    await scrollThrough(page);
    const cvLinks = page.locator(`a[href="${CV_PATH}"], a[href="/cv"]`);
    test.skip((await cvLinks.count()) === 0, 'no CV link rendered on /');
    await expect(page.locator(`a[href="${CV_PATH}"][download]`).first()).toBeAttached();
  });
});

test.describe('other routes in every project', () => {
  test('the first case study renders', async ({ page }) => {
    const { errors } = collectPageErrors(page);
    const res = await page.goto(FIRST_CASE_STUDY);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('#site-nav')).toBeAttached();
    await expectNoHorizontalOverflow(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an unknown path renders the branded 404', async ({ page }) => {
    const res = await page.goto('/does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText(/doesn.t exist/i);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('#main a[href="/"]').first()).toBeVisible();
    await expect(page.locator('#site-nav')).toBeAttached();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('content stays visible and no curtain covers it', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('.intro-curtain')).toBeHidden();
    const hidden = await page.$$eval('#main [data-reveal]', (els) =>
      els.filter((el) => getComputedStyle(el).opacity === '0').map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(hidden).toEqual([]);
  });
});

test.describe('document head and fonts', () => {
  test.skip(onlyPrimary, 'build-level check');

  test('one theme-color, the bootstrap attributes before hydration, no Google Fonts', async ({ page, request }) => {
    const html = await (await request.get('/')).text();
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('api.fontshare.com');

    // Snapshot <html> when <body> first appears: after the head bootstrap, before any hydration.
    await page.addInitScript(() => {
      const w = window as Window & { __htmlAtBody?: { className: string; intro: string | null; motion: string | null; theme: string | null } };
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        const d = document.documentElement;
        w.__htmlAtBody = { className: d.className, intro: d.getAttribute('data-intro'), motion: d.getAttribute('data-motion'), theme: d.getAttribute('data-theme') };
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    const early = await page.evaluate(() => (window as Window & { __htmlAtBody?: { className: string; intro: string | null; motion: string | null } }).__htmlAtBody);
    expect(early?.className).toMatch(/\bjs\b/);
    expect(early?.className).not.toMatch(/\bhydrated\b/);
    expect(early?.intro).toMatch(/^(pending|seen)$/);
    expect(early?.motion).toMatch(/^(reduced|full)$/);

    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    await expect(page.locator('meta[name="color-scheme"]')).toHaveCount(1);
  });

  test('the h1 renders in Clash Display and mono text in JetBrains Mono', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const h1 = await page.locator('h1').first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(h1).toMatch(/clash/i);
    const mono = page.locator('.font-mono').first();
    test.skip((await mono.count()) === 0, 'no .font-mono element on /');
    expect(await mono.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/jetbrains/i);
  });

  test('title, description and canonical come from the profile', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    expect(title).toContain(profile.name);
    expect(title).toContain(profile.headline.split('|')[0].trim());
    for (const text of [title, description]) {
      if (!/graduate/i.test(JSON.stringify(profile))) expect(text).not.toMatch(/graduate/i);
      if (!/ML Engineer/i.test(JSON.stringify(profile))) expect(text).not.toMatch(/ML Engineer/i);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', CANONICAL);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', CANONICAL);
  });

  test('JSON-LD parses and describes the person, the site and every project', async ({ page }) => {
    await page.goto('/');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const graph = blocks.flatMap((b) => {
      const data = JSON.parse(b);
      return data['@graph'] ?? [data];
    });
    const person = graph.find((n) => n['@type'] === 'Person');
    expect(person?.name).toBe(profile.name);
    expect(person?.address?.addressLocality).toBe(profile.location.split(',')[0]);
    expect(person?.sameAs).toContain(profile.links.github);
    expect(graph.find((n) => n['@type'] === 'WebSite')?.url).toBe(CANONICAL);
    expect(graph.find((n) => n['@type'] === 'ItemList')?.itemListElement).toHaveLength(projects.length);
  });

  test('print media gives a light, single-column page with link targets', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ media: 'print' });
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(body).toBe('rgb(255, 255, 255)');
    const nav = page.locator('#site-nav');
    if ((await nav.count()) > 0) await expect(nav).toBeHidden();
    const link = page.locator('#main a[href^="http"]').first();
    if ((await link.count()) > 0) {
      // Chrome reports the specified value, attr() and all.
      const after = await link.evaluate((el) => getComputedStyle(el, '::after').content);
      expect(after).toMatch(/attr\(href\)|https?:/);
    }
  });
});

test.describe('metadata routes and headers', () => {
  test.skip(onlyPrimary, 'build-level check');

  test('robots.txt allows everything and points at the sitemap', async ({ request }) => {
    const body = await (await expectOk(request, '/robots.txt')).text();
    expect(body).toMatch(/User-Agent: \*/i);
    expect(body).toMatch(/Allow: \/\s/);
    expect(body).toContain(`Sitemap: ${CANONICAL}/sitemap.xml`);
  });

  test('sitemap.xml lists home, each case study, the venture page, the CV and /ai, and every URL returns 200', async ({ request }) => {
    const xml = await (await expectOk(request, '/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls).toHaveLength(4 + CASE_STUDIES.length);
    expect(urls).toContain(CANONICAL);
    expect(urls).toContain(`${CANONICAL}${CV_PATH}`);
    expect(urls).toContain(`${CANONICAL}/ai`);
    expect(urls).toContain(`${CANONICAL}/ventures/coreforge`);
    for (const path of CASE_STUDIES) expect(urls).toContain(`${CANONICAL}${path}`);
    for (const url of urls) {
      expect(url.startsWith(CANONICAL), url).toBe(true);
      await expectOk(request, localPath(url));
    }
    expect(xml).toContain('<lastmod>');
  });

  test('the web manifest is valid and its icons load', async ({ request, page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = await (await expectOk(request, href!)).json();
    expect(manifest.name).toContain(profile.name);
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#060609');
    expect(manifest.theme_color).toBe('#060609');
    for (const icon of manifest.icons) {
      const res = await expectOk(request, icon.src);
      expect(res.headers()['content-type']).toContain(icon.type);
    }
  });

  test('Open Graph and Twitter cards are 1200x630 PNGs', async ({ request, page }) => {
    await page.goto('/');
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const url = await page.locator(selector).first().getAttribute('content');
      expect(url, selector).toMatch(new RegExp(`^${CANONICAL.replace(/\./g, '\\.')}/`));
      const res = await expectOk(request, localPath(url!));
      expect(res.headers()['content-type']).toBe('image/png');
      expect(pngSize(await res.body())).toEqual({ width: 1200, height: 630 });
    }
    await expect(page.locator('meta[property="og:image:width"]').first()).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[property="og:image:alt"]').first()).toHaveAttribute('content', new RegExp(profile.name));
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  });

  test('the icon is the SVG mark and the apple-touch-icon is a 180px PNG', async ({ request, page }) => {
    await page.goto('/');
    const icon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
    expect((await expectOk(request, icon!)).headers()['content-type']).toContain('image/svg+xml');
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    const res = await expectOk(request, apple!);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(pngSize(await res.body())).toEqual({ width: 180, height: 180 });
  });

  test('/contact.vcf is a vCard attachment', async ({ request }) => {
    const res = await expectOk(request, '/contact.vcf');
    expect(res.headers()['content-type']).toMatch(/^text\/vcard/);
    expect(res.headers()['content-disposition']).toContain('filename="oikantik-basu.vcf"');
    const body = await res.text();
    expect(body.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(body).toContain(`\r\nFN:${profile.name}\r\n`);
    expect(body).toMatch(/\r\nTEL;TYPE=CELL:\+\d+\r\n/);
  });

  test('security headers, with HSTS scoped to this host', async ({ request }) => {
    const headers = (await expectOk(request, '/')).headers();
    expect(headers['strict-transport-security']).toBe('max-age=63072000');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('the case study is its own canonical', async ({ page }) => {
    const res = await page.goto(FIRST_CASE_STUDY);
    expect(res?.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${CANONICAL}${FIRST_CASE_STUDY}`);
  });

  test('outside Vercel, no /_vercel/* script is requested', async ({ page }) => {
    test.skip(Boolean(process.env.PW_BASE_URL), 'a deployed target may legitimately load Vercel scripts');
    const vercel: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/_vercel/')) vercel.push(req.url());
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
    await page.waitForTimeout(1000);
    expect(vercel).toEqual([]);
  });
});
