import { readFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import projects from '../../src/data/projects.json' with { type: 'json' };
import { slugify } from '../../src/lib/slug';
import { collectPageErrors, expect, expectNoHorizontalOverflow, getRenderCount, test } from './helpers';

/*
 * Shell package (#34-#50): intro curtain, App cleanup, server entry and idle
 * widgets, section sheets, theme, nav, mobile menu, active section and hash,
 * back to top, command palette, cursor, bokeh, Konami, subpage header and the
 * motion pause control.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';
const desktopPointer = (info: TestInfo) => width(info) >= 1024 && !isTouch(info);

const URBANCARE = slugify(projects[0].name);

async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function hydrated(page: Page) {
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
}

async function scrollToY(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(300);
}

async function sectionTop(page: Page, id: string) {
  return page.evaluate((i) => document.getElementById(i)?.getBoundingClientRect().top ?? NaN, id);
}

test.beforeEach(async ({ page }, info) => {
  if (!info.titlePath.some((t) => t.startsWith('intro curtain'))) await skipIntro(page);
});

/* ---------------- #34 / #35 intro ---------------- */

test.describe('intro curtain (#34, #35)', () => {
  test('a first visit ends on its own, within the cap, with one h1 and the hero visible', async ({ page }, info) => {
    test.skip(isReduced(info), 'reduced motion never shows the curtain');
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto('/');
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen', { timeout: 6000 });
    const elapsed = await page.evaluate(() => Date.now() - (window.__navStart ?? performance.timeOrigin));
    // 1400ms cap + the 750ms exit + fonts; generous for CI but far below the old 2.8s + click.
    expect(elapsed).toBeLessThan(5000);
    await expect(page.locator('[data-intro-curtain]')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#hero h1')).toBeVisible();
  });

  test('the curtain covers content from the first paint and blocks wheel scrolling', async ({ page }, info) => {
    test.skip(isReduced(info) || !desktopPointer(info), 'desktop motion projects only');
    // Hold the intro open: no fonts promise resolves and the cap is far away.
    await page.addInitScript(() => {
      Object.defineProperty(window, '__navStart', { configurable: true, get: () => Date.now() + 60_000, set: () => {} });
    });
    await page.goto('/');
    await expect(page.locator('[data-intro-curtain]')).toBeVisible();
    await hydrated(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });

  test('loader text reads at 4.5:1 or better in the light theme', async ({ page }, info) => {
    test.skip(isReduced(info) || !isLight(info) || width(info) !== 1440, 'light, motion, 1440 only');
    await page.addInitScript(() => {
      Object.defineProperty(window, '__navStart', { configurable: true, get: () => Date.now() + 60_000, set: () => {} });
    });
    await page.goto('/');
    await expect(page.locator('[data-intro-curtain]')).toBeVisible();
    const ratios = await page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
          const s = Number(v) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bg = lum(getComputedStyle(document.documentElement).getPropertyValue('--app-bg-base').trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`));
      return Array.from(document.querySelectorAll('.intro-title [data-word], [data-intro-curtain] [data-button]')).map((el) => {
        const fg = lum(getComputedStyle(el).color);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
    });
    expect(ratios.length).toBeGreaterThan(0);
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
  });

  test('a returning session gets no curtain', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    await page.addInitScript(() => window.sessionStorage.setItem('ob-seen-loader-v2', '1'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
    await expect(page.locator('[data-intro-curtain]')).toBeHidden();
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('no curtain shows and the nav and page are readable', async ({ page }, info) => {
      test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
      await page.goto('/');
      await expect(page.locator('.intro-curtain')).toBeHidden();
      await expect(page.locator('#site-nav')).toBeVisible();
      expect(await page.locator('#site-nav').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expect(page.locator('#hero h1')).toBeVisible();
    });
  });
});

/* ---------------- #36 App cleanup ---------------- */

test.describe('app shell (#36, #37)', () => {
  test('the page entry is a server component and main is a focus target', async ({ page }, info) => {
    test.skip(width(info) !== 1440, 'one viewport is enough');
    const source = readFileSync(new URL('../../app/page.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/['"]use client['"]/);
    await page.goto('/');
    await expect(page.locator('main#main')).toHaveAttribute('tabindex', '-1');
  });

  test('the tab title never changes while hidden, and no pointer vars are written', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'desktop pointer projects only');
    await page.goto('/');
    await hydrated(page);
    const title = await page.title();
    await page.mouse.move(300, 300);
    await page.mouse.move(600, 420);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3500);
    expect(await page.title()).toBe(title);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--mouse-x'))).toBe('');
    expect(await page.locator('.click-ripple').count()).toBe(0);
  });

  test('the Skills column pins at 112px', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await page.goto('/');
    await hydrated(page);
    // By computed style: the column is sticky through a responsive class (lg:sticky),
    // which a '.sticky' selector never matches.
    const found = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('#skills *')).find((e) => getComputedStyle(e).position === 'sticky');
      el?.setAttribute('data-pw-sticky', '');
      return Boolean(el);
    });
    test.skip(!found, 'no sticky column in the skills section');
    const sticky = page.locator('#skills [data-pw-sticky]');
    const skillsTop = await page.evaluate(() => document.getElementById('skills')!.getBoundingClientRect().top + window.scrollY);
    await scrollToY(page, skillsTop + 400);
    const top = await sticky.evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top - 112)).toBeLessThanOrEqual(2);
  });

  test("the first chunks for '/' carry no palette or Konami code; the idle widgets mount cleanly", async ({ page, request }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info), 'one viewport is enough');
    const errors = collectPageErrors(page);
    // The first chunks are the ones the server's HTML names. Read from the live DOM after
    // 'load', the list could already hold a chunk the idle mount fetched (the Konami code).
    const html = await (await request.get('/')).text();
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((src) => !src.includes('/_vercel/'));
    expect(srcs.length).toBeGreaterThan(0);
    const initial = await Promise.all(srcs.map(async (src) => (await request.get(src)).text()));
    await page.goto('/');
    for (const body of initial) {
      expect(body).not.toContain('Search sections, projects, skills');
      expect(body).not.toContain('Dev mode unlocked');
    }
    await hydrated(page);
    if (!isLight(info)) await expect(page.locator('[data-bokeh]')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('[data-dock]')).toHaveCount(1, { timeout: 8000 });
    expect(errors.errors).toEqual([]);
  });
});

/* ---------------- #38 section sheets ---------------- */

test.describe('section sheets (#38)', () => {
  test('About rises over the hero with a rounded clip on desktop, static otherwise', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && !(width(info) === 1024 && isTouch(info)), '1440 and the coarse 1024 project');
    await page.goto('/');
    await hydrated(page);
    const sheet = page.locator('[data-section-sheet]').filter({ has: page.locator('#about') });
    const aboutTop = await page.evaluate(() => document.getElementById('about')!.getBoundingClientRect().top + window.scrollY);
    await scrollToY(page, aboutTop - 500);
    const clip = await sheet.evaluate((el) => getComputedStyle(el).clipPath);
    const lite = await page.evaluate(() => document.documentElement.hasAttribute('data-lite'));
    if (isReduced(info) || lite) expect(clip).toBe('none');
    else expect(clip).toContain('inset');
    await scrollToY(page, aboutTop + 50);
    expect(await sheet.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
  });

  test('no horizontal overflow at phone widths', async ({ page }, info) => {
    test.skip(width(info) > 375, 'phones only');
    await page.goto('/');
    await hydrated(page);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await expectNoHorizontalOverflow(page);
  });
});

/* ---------------- #39 / #40 theme ---------------- */

test.describe('theme (#39, #40)', () => {
  test('a light reload never writes data-theme=dark', async ({ page }, info) => {
    test.skip(!isLight(info) || width(info) !== 1440, 'light 1440 only');
    await page.addInitScript(() => {
      const writes: string[] = [];
      (window as Window & { __darkWrites?: string[] }).__darkWrites = writes;
      new MutationObserver((records) => {
        for (const r of records) {
          if ((r.target as Element).getAttribute('data-theme') === 'dark') writes.push('dark');
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
    await page.goto('/');
    await hydrated(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as Window & { __darkWrites?: string[] }).__darkWrites)).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('a rapid double toggle leaves no unhandled rejection and every theme-color meta follows', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'desktop pointer projects only');
    await page.addInitScript(() => {
      const w = window as Window & { __rejections?: string[] };
      w.__rejections = [];
      window.addEventListener('unhandledrejection', (e) => w.__rejections!.push(String(e.reason)));
    });
    await page.goto('/');
    await hydrated(page);
    const toggle = page.locator('#site-nav [data-theme-button]');
    await toggle.click();
    await toggle.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as Window & { __rejections?: string[] }).__rejections)).toEqual([]);
    const { metas, bg } = await page.evaluate(() => ({
      metas: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute('content')?.toUpperCase()),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-base').trim().toUpperCase(),
    }));
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) expect(m).toBe(bg);
  });

  test('the toggle has a static name, a truthful aria-pressed and 44px', async ({ page }, info) => {
    await page.goto('/');
    await hydrated(page);
    const toggle = page.locator('#site-nav [data-theme-button]');
    await expect(toggle).toHaveAccessibleName('Dark theme');
    await expect(toggle).toHaveAttribute('aria-pressed', isLight(info) ? 'false' : 'true');
    const box = await toggle.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', isLight(info) ? 'true' : 'false');
    await expect(toggle).toHaveAccessibleName('Dark theme');
  });

  test('the toggle icon is a moon-sized crescent in dark and a rayed sun in light', async ({ page }) => {
    await page.goto('/');
    await hydrated(page);
    const toggle = page.locator('#site-nav [data-theme-button]');
    // The disk spans 18 of the 24 viewBox units as a moon and 10 as a sun; the old 10-unit
    // moon under a 9-unit bite painted only a hairline arc.
    const read = () =>
      toggle.evaluate((el) => {
        const svg = el.querySelector('svg.theme-icon')!.getBoundingClientRect();
        const disk = el.querySelector('.theme-icon-disk')!.getBoundingClientRect();
        const rays = Number(getComputedStyle(el.querySelector('.theme-icon-rays')!).opacity);
        return `${document.documentElement.dataset.theme}:${(disk.width / svg.width).toFixed(2)}:${rays}`;
      });
    const expected = (theme: string | undefined) => (theme === 'light' ? 'light:0.42:1' : 'dark:0.75:0');
    const first = await page.locator('html').getAttribute('data-theme');
    await expect.poll(read).toBe(expected(first ?? 'dark'));
    await toggle.click();
    await expect.poll(read).toBe(expected(first === 'light' ? 'dark' : 'light'));
  });

  test('the caret opens a Dark/Light/System radiogroup; right-click keeps the native menu', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'desktop pointer projects only');
    await page.goto('/');
    await hydrated(page);
    await page.evaluate(() => {
      const w = window as Window & { __ctxPrevented?: boolean };
      window.addEventListener('contextmenu', (e) => {
        w.__ctxPrevented = e.defaultPrevented;
      });
    });
    await page.locator('#site-nav [data-theme-button]').click({ button: 'right' });
    expect(await page.evaluate(() => (window as Window & { __ctxPrevented?: boolean }).__ctxPrevented)).toBe(false);
    await page.keyboard.press('Escape');

    const caret = page.getByRole('button', { name: 'Theme options' }).first();
    await caret.click();
    const group = page.getByRole('radiogroup', { name: 'Theme' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await page.keyboard.press('End');
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    await expect(caret).toBeFocused();
  });

  test('T toggles the theme', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'keyboard desktop only');
    await page.goto('/');
    await hydrated(page);
    const before = await page.locator('html').getAttribute('data-theme');
    await page.keyboard.press('t');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
  });
});

/* ---------------- #41 nav ---------------- */

test.describe('navbar (#41)', () => {
  test('links, aria-current, Resume and the 44px menu button', async ({ page }, info) => {
    await page.goto('/');
    await hydrated(page);
    const nav = page.locator('#site-nav');
    await expect(nav.getByRole('link', { name: 'Oikantik Basu, home' })).toBeVisible();
    await expect(nav.locator('[data-cv-download]:visible')).toHaveCount(1);
    if (width(info) < 768) {
      const burger = nav.getByRole('button', { name: 'Menu' });
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await expect(burger).toHaveAttribute('aria-controls', 'mobile-menu');
      const box = await burger.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(nav.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '#projects');
      const top = await page.evaluate(() => document.getElementById('experience')!.getBoundingClientRect().top + window.scrollY);
      await scrollToY(page, top + 100);
      await expect(nav.getByRole('link', { name: 'Experience' })).toHaveAttribute('aria-current', 'location');
    }
  });

  test('scrolling does not re-render the nav', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'desktop only');
    await page.goto('/');
    await hydrated(page);
    await page.waitForTimeout(500);
    const before = await getRenderCount(page, 'Navbar');
    test.skip(before === null, 'render counting is compiled out of this build');
    await page.mouse.move(700, 500);
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, i < 10 ? 250 : -250);
      await page.waitForTimeout(200);
    }
    expect(await getRenderCount(page, 'Navbar')).toBe(before);
  });
});

/* ---------------- #42 mobile menu ---------------- */

test.describe('mobile menu (#42)', () => {
  test('traps focus, inerts the dock, keeps 44px controls and returns focus to the burger', async ({ page }, info) => {
    test.skip(width(info) >= 768, 'phone widths only');
    await page.goto('/');
    await hydrated(page);
    const burger = page.locator('#site-nav').getByRole('button', { name: 'Menu' });
    await burger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Site menu' });
    await expect(dialog).toBeVisible();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    // The trap arms once the opening frame has painted (Dialog deferTrap), then focuses Close.
    await expect(dialog.getByRole('button', { name: 'Close menu' })).toBeFocused();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    const dockInert = await page.evaluate(() => {
      const dock = document.querySelector('[data-dock]');
      return dock ? dock.closest('[inert]') !== null : null;
    });
    if (dockInert !== null) expect(dockInert).toBe(true);
    const small = await dialog.evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('a[href], button'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ el: el.getAttribute('aria-label') ?? el.textContent?.trim(), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el }) => el),
    );
    expect(small).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(burger).toBeFocused();
  });

  test('widening from 744 to 1024 closes the menu and frees the page', async ({ page }, info) => {
    test.skip(width(info) !== 768 || isTouch(info), 'the 768 project only');
    await page.setViewportSize({ width: 744, height: 1000 });
    await page.goto('/');
    await hydrated(page);
    await page.locator('#site-nav').getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Site menu' })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 1000 });
    await expect(page.getByRole('dialog', { name: 'Site menu' })).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-scroll-lock', '');
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(y0);
  });
});

/* ---------------- #43 active section and hash ---------------- */

test.describe('active section and hash (#43)', () => {
  test('scrolling mirrors the section into the hash without new history entries', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await page.goto('/');
    await hydrated(page);
    const length = await page.evaluate(() => history.length);
    const top = await page.evaluate(() => document.getElementById('projects')!.getBoundingClientRect().top + window.scrollY);
    await scrollToY(page, top + 50);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#projects');
    expect(await page.evaluate(() => history.length)).toBe(length);
  });

  // ?skill would open the skill dialog (skills owns it), and the hash rightly holds
  // still under a modal; ?q is a plain grid filter, so it isolates the hash sync.
  test('search params survive the hash sync', async ({ page }, info) => {
    test.skip(width(info) !== 1440, '1440 only');
    await page.goto('/?q=rag#skills');
    await hydrated(page);
    const top = await page.evaluate(() => document.getElementById('experience')!.getBoundingClientRect().top + window.scrollY);
    await scrollToY(page, top + 50);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#experience');
    expect(await page.evaluate(() => new URLSearchParams(location.search).get('q'))).toBe('rag');
  });

  test('/#experience lands on Experience', async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto('/#experience');
    await hydrated(page);
    await page.waitForTimeout(1200);
    const top = await sectionTop(page, 'experience');
    expect(Math.abs(top - 88)).toBeLessThanOrEqual(6);
  });

  test('the chapter rail shows only at 1024 and up, after the hero', async ({ page }, info) => {
    await page.goto('/');
    await hydrated(page);
    const rail = page.locator('[data-section-rail]');
    await expect(rail).toBeHidden();
    const top = await page.evaluate(() => document.getElementById('skills')!.getBoundingClientRect().top + window.scrollY);
    await scrollToY(page, top + 50);
    if (width(info) < 1024) await expect(rail).toBeHidden();
    else await expect(rail).toBeVisible();
  });
});

/* ---------------- #44 back to top ---------------- */

test.describe('back to top (#44)', () => {
  test('appears after the hero, returns to the top and focuses #main', async ({ page }, info) => {
    await page.goto('/');
    await hydrated(page);
    // Not getByRole: the footer has its own 'Back to top' control, always in the DOM.
    const button = page.locator('[data-back-to-top]');
    await expect(button).toHaveCount(0);
    const h = await page.evaluate(() => window.innerHeight);
    await scrollToY(page, h * 2);
    await expect(button).toBeVisible();
    if (width(info) <= 375) {
      const overlaps = await page.evaluate(() => {
        const b = document.querySelector('[data-back-to-top]')!.getBoundingClientRect();
        const hit = (r: DOMRect) => !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom);
        return Array.from(document.querySelectorAll('[data-dock] *, [data-toast-region] > *'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0 && hit(r)).length;
      });
      expect(overlaps).toBe(0);
    }
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeLessThan(2);
    await expect(page.locator('#main')).toBeFocused();
  });
});

/* ---------------- #45 palette and shortcuts ---------------- */

test.describe('command palette (#45)', () => {
  test("Ctrl+K, 'urban', Enter opens UrbanCare at Projects; Esc restores focus", async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'keyboard desktop only');
    await page.goto('/');
    await hydrated(page);
    await page.evaluate(() => {
      const w = window as Window & { __opened?: string[] };
      w.__opened = [];
      window.addEventListener('ob:project:open', (e) => w.__opened!.push((e as CustomEvent<{ slug: string }>).detail.slug));
    });
    const trigger = page.locator('[data-palette-trigger]');
    await trigger.click();
    const input = page.getByRole('combobox');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-command-palette]')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('ControlOrMeta+k');
    await expect(input).toBeFocused();
    await input.fill('urban');
    await expect(page.getByRole('option').first()).toContainText('UrbanCare');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual([URBANCARE]);
    await expect.poll(() => sectionTop(page, 'projects'), { timeout: 5000 }).toBeLessThan(200);
    // The palette is still animating out (it also lists UrbanCare), so name the modal.
    await expect(page.locator('[data-dialog-root][data-variant="modal"]').filter({ hasText: 'UrbanCare' })).toBeVisible();
  });

  test("'/' types into a textarea, '?' opens the shortcuts, and the single-key switch silences both", async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'keyboard desktop only');
    await page.goto('/');
    await hydrated(page);
    const textarea = page.locator('#contact textarea').first();
    if ((await textarea.count()) > 0) {
      await textarea.scrollIntoViewIfNeeded();
      await textarea.click();
      await page.keyboard.type('a/b');
      await expect(textarea).toHaveValue(/a\/b/);
      await expect(page.locator('[data-command-palette]')).toHaveCount(0);
      await textarea.blur();
    }
    await page.keyboard.press('Shift+Slash');
    await expect(page.locator('[data-shortcuts]')).toBeVisible();
    const toggle = page.getByRole('switch', { name: 'Single-key shortcuts' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-shortcuts]')).toHaveCount(0);
    await page.keyboard.press('/');
    await page.keyboard.press('Shift+Slash');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-command-palette]')).toHaveCount(0);
    await expect(page.locator('[data-shortcuts]')).toHaveCount(0);
  });
});

/* ---------------- #46 cursor ---------------- */

test.describe('comet cursor (#46)', () => {
  test('touch never renders it', async ({ page }, info) => {
    test.skip(!isTouch(info), 'touch projects only');
    await page.goto('/');
    await hydrated(page);
    await page.waitForTimeout(800);
    await expect(page.locator('.comet-canvas')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/has-custom-cursor/);
  });

  test('idles its loop, labels [data-cursor] targets and yields to text fields', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'fine pointer projects only');
    await page.goto('/');
    await hydrated(page);
    const head = page.locator('[data-comet]');
    if (isReduced(info)) {
      await expect(head).toHaveCount(0);
      return;
    }
    // The cursor is a lazy chunk; moves made before it mounts are not its to see.
    await expect(head).toHaveCount(1, { timeout: 10_000 });
    await page.mouse.move(200, 200);
    await page.mouse.move(420, 360, { steps: 8 });
    await expect(page.locator('html')).toHaveClass(/has-custom-cursor/);
    await expect(head).toHaveAttribute('data-running', '');
    await page.waitForTimeout(2000);
    await expect(head).not.toHaveAttribute('data-running', '');

    const view = page.locator('[data-cursor="view"]').first();
    if ((await view.count()) > 0) {
      await view.scrollIntoViewIfNeeded();
      await view.hover();
      await expect(head).toHaveAttribute('data-mode', 'view');
    }
    const field = page.locator('#contact input, #contact textarea').first();
    if ((await field.count()) > 0) {
      await field.scrollIntoViewIfNeeded();
      await field.hover();
      await expect(head).toHaveAttribute('data-mode', 'hide');
      expect(await field.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('none');
    }
  });
});

/* ---------------- #47 bokeh / #48 Konami ---------------- */

test.describe('bokeh and Konami (#47, #48)', () => {
  test('orbs are hidden in light and pause once the hero is gone', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info), '1440 motion only');
    const errors = collectPageErrors(page);
    await page.goto('/');
    await hydrated(page);
    const bokeh = page.locator('[data-bokeh]');
    await expect(bokeh).toHaveCount(1, { timeout: 8000 });
    if (isLight(info)) {
      await expect(bokeh).toBeHidden();
    } else {
      const h = await page.evaluate(() => window.innerHeight);
      await scrollToY(page, h * 2);
      const states = await bokeh.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => a.playState));
      expect(states.length).toBeGreaterThan(0);
      for (const s of states) expect(s).toBe('paused');
    }
    expect(errors.errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });

  test('the Konami panel opens once, stays stable, and closes on Escape', async ({ page }, info) => {
    test.skip(!desktopPointer(info), 'keyboard desktop only');
    await page.goto('/');
    await hydrated(page);
    await page.waitForTimeout(3500); // idle mount
    const renders = await getRenderCount(page, 'Konami');
    await page.keyboard.type('hello');
    if (renders !== null) expect(await getRenderCount(page, 'Konami')).toBe(renders);
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
      await page.keyboard.press(key);
    }
    const panel = page.locator('[data-konami]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    await page.keyboard.press('x');
    await page.waitForTimeout(200);
    expect(await panel.innerText()).toBe(text);
    const close = panel.getByRole('button', { name: 'Close developer note' });
    // Measured once the panel's entrance scale has settled.
    await expect.poll(async () => (await close.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });
});

/* ---------------- #49 subpage header ---------------- */

test.describe('subpage header (#49)', () => {
  test("'All projects' lands on /#projects with no curtain", async ({ page }, info) => {
    test.skip(width(info) !== 1440 && width(info) !== 375, 'two viewports are enough');
    await page.goto(`/projects/${URBANCARE}`);
    const header = page.locator('header#site-nav');
    await expect(header).toBeVisible();
    const back = header.getByRole('link', { name: 'All projects' });
    await expect(back).toHaveAttribute('href', '/#projects');
    await back.click();
    await expect(page).toHaveURL(/\/#projects$/);
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
    await expect.poll(() => sectionTop(page, 'projects'), { timeout: 6000 }).toBeLessThan(140);
  });
});

/* ---------------- #50 motion pause ---------------- */

test.describe('motion pause (#50)', () => {
  test('pausing stops every loop at once and survives a reload', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isReduced(info), '1440 motion only');
    await page.goto('/');
    await hydrated(page);
    const toggle = page.locator('#site-nav [data-motion-toggle]');
    await expect(toggle).toHaveAccessibleName('Pause motion');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-motion-paused', '');
    await page.waitForTimeout(600);
    const looping = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length,
    );
    expect(looping).toBe(0);
    await page.reload();
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion-paused', '');
    await expect(page.locator('#site-nav [data-motion-toggle]')).toHaveAttribute('aria-pressed', 'true');
  });
});
