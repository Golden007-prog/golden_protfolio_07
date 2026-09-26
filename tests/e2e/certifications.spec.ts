import type { Page, TestInfo } from '@playwright/test';
import raw from '../../src/data/certifications.json' with { type: 'json' };
import { certificationCounts, certificationGroups, formatIssued, isAllowedCredentialUrl, issuers, parseCertifications } from '../../src/lib/certifications';
import { expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Certifications section: every credential from certifications.json with a safe,
 * named Verify link to the issuer's page, the issuer filter and both disclosures
 * by keyboard, the phone fold, the About fact, the palette jump, #certifications
 * deep links, no overflow at 320-1440, and reduced motion. Expectations are
 * computed from the data file, so nothing here pins a count.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isTouch = (info: TestInfo) => Boolean(projectUse(info).hasTouch);
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';

const DATA = parseCertifications(raw);
const COUNTS = certificationCounts(DATA);
const GROUPS = certificationGroups(DATA);
const FEATURED = GROUPS.find((g) => g.lead !== null)!;
/** The group long enough to fold on phones (Claude Academy). */
const FOLDING = GROUPS.find((g) => g.lead === null && g.items.length > 8)!;
const ISSUERS = issuers(DATA);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoHydrated(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
}

async function toSection(page: Page) {
  await gotoHydrated(page);
  await page.locator('#certifications').scrollIntoViewIfNeeded();
}

/** Scrolls through the section in steps so every scroll reveal fires. */
async function scrollThroughSection(page: Page) {
  await page.evaluate(async () => {
    const section = document.getElementById('certifications')!;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const step = Math.max(200, window.innerHeight * 0.6);
    for (let y = top - window.innerHeight; y < top + section.offsetHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
  });
}

const cards = (page: Page) => page.locator('#certifications [data-cert-card]');
const chip = (page: Page, value: string) => page.locator(`#certifications [data-issuer-chip="${value}"]`);

test.describe('certifications: content from the data', () => {
  test('the section renders every credential with a machine-readable date and a safe, named Verify link', async ({ page }, info) => {
    test.skip(![320, 1440].includes(width(info)) || isLight(info), '320 and 1440, one theme');
    await gotoHydrated(page);

    const section = page.locator('#certifications');
    await expect(section).toHaveAttribute('aria-labelledby', 'certifications-title');
    await expect(page.locator('#certifications-title')).toHaveCount(1);
    await expect(section.locator('header .sr-only').first()).toHaveText(/^\d\d \/ Certifications$/);
    await expect(cards(page)).toHaveCount(DATA.items.length);

    const rendered = await cards(page).evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute('data-cert-card')!;
        const link = el.querySelector<HTMLAnchorElement>(`[data-verify-link="${id}"]`);
        const titleId = el.getAttribute('aria-labelledby');
        return {
          id,
          domId: el.id,
          title: titleId ? (document.getElementById(titleId)?.textContent ?? '').trim() : '',
          times: Array.from(el.querySelectorAll('time')).map((t) => t.getAttribute('datetime')),
          href: link?.getAttribute('href') ?? null,
          target: link?.getAttribute('target') ?? null,
          rel: link?.getAttribute('rel') ?? '',
          label: link?.getAttribute('aria-label') ?? '',
        };
      }),
    );
    expect(new Set(rendered.map((r) => r.id)).size).toBe(DATA.items.length);
    for (const c of DATA.items) {
      const r = rendered.find((x) => x.id === c.id);
      expect(r, c.id).toBeTruthy();
      expect(r!.domId).toBe(`cert-${c.id}`);
      expect(r!.title).toBe(c.title);
      expect(r!.times, `${c.id} carries <time datetime>`).toContain(c.issued);
      expect(r!.href).toBe(c.url);
      expect(isAllowedCredentialUrl(r!.href!), `${c.id} links to its issuer`).toBe(true);
      expect(r!.target).toBe('_blank');
      expect(r!.rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
      expect(r!.label).toMatch(new RegExp(`^Verify ${escape(c.title)} on ${escape(c.platform)}`));
    }
  });

  test('the header counts come from the data', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info), 'one viewport');
    await toSection(page);
    await expect(page.locator('[data-cert-total] .sr-only').first()).toHaveText(String(COUNTS.total));
    await expect(page.locator('[data-cert-total]')).toContainText('verified credentials');
    await expect(page.locator('[data-cert-meta]')).toContainText(`From ${COUNTS.issuers} issuers on ${COUNTS.platforms} platforms`);
    await expect(page.locator(`[data-cert-meta] time[datetime="${DATA.verifiedAt}"]`)).toHaveText(formatIssued(DATA.verifiedAt));
    await expect(page.locator('#certifications [data-issuer-chip]')).toHaveCount(ISSUERS.length + 1);
    for (const issuer of ISSUERS) {
      const n = DATA.items.filter((c) => c.issuer === issuer).length;
      await expect(chip(page, issuer)).toContainText(issuer);
      await expect(chip(page, issuer)).toContainText(String(n));
    }
  });

  test('the About card states the verified count and links to the section', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info), '375 and 1440, one theme');
    await gotoHydrated(page);
    const fact = page.locator('#about [data-glance-certifications]');
    await expect(fact).toHaveAttribute('href', '#certifications');
    await expect(fact).toHaveText(`${COUNTS.total} verified credentials`);
    expect((await fact.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await fact.scrollIntoViewIfNeeded();
    await fact.click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#certifications');
    await expect(page.locator('#certifications-title')).toBeInViewport();
  });
});

test.describe('certifications: interaction', () => {
  test('issuer chips are a radiogroup: arrows, Home and End filter the cards', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info), '375 and 1440, one theme');
    await toSection(page);
    const all = chip(page, 'all');
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await all.focus();

    const order = ['all', ...ISSUERS];
    await page.keyboard.press('ArrowRight');
    await expect(chip(page, order[1])).toBeFocused();
    await expect(chip(page, order[1])).toHaveAttribute('aria-checked', 'true');
    await expect(all).toHaveAttribute('tabindex', '-1');
    const first = DATA.items.filter((c) => c.issuer === order[1]);
    await expect(page.locator('#certifications [data-cert-card]:not([data-cert-featured])')).toHaveCount(first.length);
    const shownIssuers = await cards(page).evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-issuer')))]);
    expect(shownIssuers).toEqual([order[1]]);

    await page.keyboard.press('End');
    const last = order[order.length - 1];
    await expect(chip(page, last)).toBeFocused();
    await expect(cards(page)).toHaveCount(DATA.items.filter((c) => c.issuer === last).length);
    await expect(page.locator('[data-cert-status]')).toHaveText(new RegExp(`^Showing \\d+ credentials? from ${escape(last)}$`));
    // Every card left in view is actually visible (no card stuck mid-exit or unrevealed).
    for (const card of await cards(page).all()) await expect(card).toBeVisible();

    await page.keyboard.press('Home');
    await expect(all).toBeFocused();
    await expect(cards(page)).toHaveCount(DATA.items.length);
  });

  test('the featured certificate opens to its courses by keyboard, in the order it lists them', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info), '375 and 1440, one theme');
    await toSection(page);
    const featured = page.locator(`#cert-${FEATURED.lead!.id}`);
    await expect(featured).toHaveAttribute('data-cert-featured', '');
    const toggle = featured.locator('[data-cert-courses-toggle]');
    const region = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toHaveAttribute('inert', '');

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region).not.toHaveAttribute('inert', '');
    const titles = await region.locator('h4').allTextContents();
    expect(titles.map((t) => t.trim())).toEqual(FEATURED.lead!.includes);
    for (const c of FEATURED.items) {
      const link = page.getByRole('link', { name: new RegExp(`^Verify ${escape(c.title)} on ${escape(c.platform)}`) });
      await expect(link).toBeVisible();
    }

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toHaveAttribute('inert', '');
  });

  test('on phones the long group folds to its first row; Show all opens it and moves focus to the first new card', async ({ page }, info) => {
    test.skip(isLight(info), 'one theme');
    await toSection(page);
    const group = page.locator(`[data-cert-group="${FOLDING.id}"]`);
    const toggle = group.locator(`[data-cert-collapse-toggle="${FOLDING.id}"]`);
    const groupCards = group.locator('[data-cert-card]');
    await expect(groupCards).toHaveCount(FOLDING.items.length);

    if (width(info) >= 640) {
      await expect(toggle).toBeHidden();
      for (const card of await groupCards.all()) await expect(card).toBeVisible();
      return;
    }
    const row = width(info) < 480 ? 1 : 2;
    const visible = async () => (await groupCards.evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).length));
    expect(await visible()).toBe(row);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText(`Show all ${FOLDING.items.length}`);
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(visible).toBe(FOLDING.items.length);
    await expect(page.locator(`[data-verify-link="${FOLDING.items[row].id}"]`)).toBeFocused();

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(visible).toBe(row);
  });

  test('the palette finds a credential and reveals it, opening what folds it away', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info) || isTouch(info), '375 and 1440 with a keyboard, one theme');
    await gotoHydrated(page);
    await expect(page.locator('html')).toHaveAttribute('data-intro', 'seen');
    // The last card of the folding group: hidden on phones until the fold opens.
    const target = FOLDING.items[FOLDING.items.length - 1];
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: /Search sections/ });
    await expect(input).toBeFocused({ timeout: 10_000 });
    await input.fill(target.title);
    const option = page.locator(`[data-item-id="cert:${target.id}"]`);
    await expect(option).toBeVisible();
    await option.click();
    const card = page.locator(`#cert-${target.id}`);
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport();
    await expect(page.locator(`[data-verify-link="${target.id}"]`)).toBeFocused();
  });

  test('the sparkle player mounts on first hover of Verify, and never under reduced motion', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isTouch(info) || isLight(info), 'desktop mouse, one theme');
    const sparkle: string[] = [];
    page.on('request', (req) => {
      if (/\/lottie\/sparkle\.json/.test(req.url())) sparkle.push(req.url());
    });
    await toSection(page);
    await scrollThroughSection(page);
    const link = page.locator(`[data-verify-link="${FEATURED.lead!.id}"]`);
    await link.scrollIntoViewIfNeeded();
    await expect(page.locator('#certifications [data-lottie="sparkle"]')).toHaveCount(0);
    await link.hover();
    if (isReduced(info)) {
      await page.waitForTimeout(500);
      await expect(page.locator('#certifications [data-lottie="sparkle"]')).toHaveCount(0);
      expect(sparkle).toEqual([]);
    } else {
      await expect(link.locator('[data-lottie="sparkle"]')).toHaveCount(1);
    }
  });
});

test.describe('certifications: layout, motion and deep links', () => {
  test('no horizontal overflow, filtered or opened', async ({ page }, info) => {
    test.skip(![320, 375, 768, 1440].includes(width(info)), '320, 375, 768 and 1440');
    await toSection(page);
    await scrollThroughSection(page);
    await expectNoHorizontalOverflow(page);

    await page.locator(`#cert-${FEATURED.lead!.id} [data-cert-courses-toggle]`).click();
    await expect(page.locator(`#cert-${FEATURED.lead!.id} [data-cert-courses-toggle]`)).toHaveAttribute('aria-expanded', 'true');
    const fold = page.locator(`[data-cert-collapse-toggle="${FOLDING.id}"]`);
    if (await fold.isVisible()) await fold.click();
    await page.waitForTimeout(600);
    await expectNoHorizontalOverflow(page);

    // The longest issuer name as the filter.
    const longest = [...ISSUERS].sort((a, b) => b.length - a.length)[0];
    await chip(page, longest).click();
    await expect(chip(page, longest)).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(400);
    await expectNoHorizontalOverflow(page);

    // Nothing in the section is narrower than a 44px target where it is a control.
    const small = await page.locator('#certifications').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('a[href], button'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const before = getComputedStyle(el, '::before');
          // Button sm draws a 4px invisible halo under a mouse.
          const halo = before.content !== 'none' && before.position === 'absolute' ? 8 : 0;
          return { name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '', h: r.height + halo, w: r.width + halo };
        })
        .filter((b) => b.h < 44 || b.w < 44),
    );
    expect(small).toEqual([]);
  });

  test('every reveal settles visible; under reduced motion without scrolling at all', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info), '375 and 1440, one theme');
    await gotoHydrated(page);
    if (isReduced(info)) {
      await page.evaluate(() => document.getElementById('certifications')!.scrollIntoView({ behavior: 'instant' }));
    } else {
      await scrollThroughSection(page);
    }
    await page.waitForTimeout(isReduced(info) ? 300 : 1200);
    const hidden = await page.locator('#certifications').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
        .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))
        .filter((el) => Number(getComputedStyle(el).opacity) < 0.99)
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(hidden).toEqual([]);
    if (isReduced(info)) {
      await expect(page.locator('[data-cert-total] [aria-hidden="true"]').first()).toHaveText(String(COUNTS.total));
    }
  });

  test('#certifications lands on the section; the nav marks it from 800px', async ({ page }, info) => {
    test.skip(![375, 768, 1440].includes(width(info)) || isLight(info), '375, 768 and 1440, one theme');
    await gotoHydrated(page, '/#certifications');
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById('certifications')!.getBoundingClientRect().top)), { timeout: 10_000 })
      .toBeLessThanOrEqual(160);
    const top = await page.evaluate(() => document.getElementById('certifications')!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(-4);
    const navLink = page.locator('#site-nav a[href="#certifications"]');
    if (width(info) >= 800) {
      await expect(navLink).toBeVisible();
      await expect(navLink).toHaveAttribute('aria-current', 'location');
    } else {
      await expect(navLink).toBeHidden();
    }
  });
});
