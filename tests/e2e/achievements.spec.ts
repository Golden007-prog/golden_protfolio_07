import type { Page, TestInfo } from '@playwright/test';
import raw from '../../src/data/achievements.json' with { type: 'json' };
import profile from '../../src/data/profile.json' with { type: 'json' };
import { ACHIEVEMENT_KIND_LABEL, allAchievements, parseAchievements } from '../../src/lib/achievements';
import { expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Experience additions: the 'Hackathons & launches' block (from achievements.json)
 * and the timeline's new roles, newest first, with the earlier WordPress roles
 * folded under an 'Earlier work' disclosure. Expectations come from the data.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isLight = (info: TestInfo) => projectUse(info).colorScheme === 'light';

const ITEMS = allAchievements(parseAchievements(raw));
const EARLIER = profile.experience.filter((e) => 'earlier' in e && e.earlier === true);
const CURRENT = profile.experience.filter((e) => !('earlier' in e && e.earlier === true));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

async function gotoHydrated(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
}

const isCoreforge = (href: string) => {
  try {
    return new URL(href).hostname === 'goldensdmat.in';
  } catch {
    return false;
  }
};
/**
 * goldensdmat.in links go through cfUrl(), which adds UTM tags and maps '/' to
 * '/welcome', so they compare by host; every other link compares as written.
 */
const linkKey = (href: string) => (isCoreforge(href) ? 'goldensdmat.in' : href);

const block = (page: Page) => page.locator('#experience [data-achievements]');

test.describe('hackathons & launches', () => {
  test('every entry from the data, newest first, with its date, organisers, kind and safe links', async ({ page }, info) => {
    test.skip(![320, 1440].includes(width(info)) || isLight(info), '320 and 1440, one theme');
    await gotoHydrated(page);
    await block(page).scrollIntoViewIfNeeded();
    await expect(block(page)).toHaveAttribute('aria-labelledby', 'achievements-title');
    await expect(page.locator('#achievements-title')).toHaveText('Hackathons & launches');

    const entries = block(page).locator('[data-achievement]');
    await expect(entries).toHaveCount(ITEMS.length);
    expect(await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-achievement')))).toEqual(ITEMS.map((a) => a.id));

    for (const [i, a] of ITEMS.entries()) {
      const entry = entries.nth(i);
      await expect(entry.locator(`[id="${await entry.getAttribute('aria-labelledby')}"]`)).toHaveText(a.title);
      await expect(entry.locator(`time[datetime="${a.date}"]`)).toHaveCount(1);
      await expect(entry.locator('[data-achievement-kind]')).toHaveText(ACHIEVEMENT_KIND_LABEL[a.kind]);
      for (const org of a.organizers ?? []) await expect(entry).toContainText(org);
      const links = await entry.locator('[data-achievement-link]').evaluateAll((els) =>
        els.map((el) => ({ href: el.getAttribute('href'), target: el.getAttribute('target'), rel: el.getAttribute('rel') ?? '' })),
      );
      // goldensdmat.in links carry CoreForge's UTM tags and keep the referrer (coreforge.spec.ts).
      expect(links.map((l) => linkKey(l.href ?? ''))).toEqual(a.links.map((l) => linkKey(l.url)));
      for (const l of links) {
        expect(l.href).toMatch(/^https:\/\//);
        expect(l.target).toBe('_blank');
        expect(l.rel.split(/\s+/)).toContain('noopener');
        if (isCoreforge(l.href ?? '')) expect(new URL(l.href ?? '').searchParams.get('utm_source')).toBe('basuoikantik.in');
        else expect(l.rel.split(/\s+/)).toContain('noreferrer');
      }
    }
  });

  test('no metrics and no names: no percentages, and a team reads only as its size', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info), 'one viewport');
    await gotoHydrated(page);
    const text = (await block(page).textContent()) ?? '';
    expect(text).not.toMatch(/%/);
    await expect(block(page).locator('[data-metric-chip]')).toHaveCount(0);
    const teams = await block(page).locator('[data-achievement-team]').allTextContents();
    expect(teams.map((t) => t.trim())).toEqual(ITEMS.filter((a) => a.team).map((a) => `T${a.team!.slice(1)}`));
  });

  test("an entry's Open project button opens that project's dialog", async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info), 'one viewport');
    const withProject = ITEMS.find((a) => a.project)!;
    await gotoHydrated(page);
    const button = block(page).locator(`[data-achievement-project="${withProject.project}"]`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.locator('[data-dialog-root] [role="dialog"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('project'))).toBe(withProject.project);
  });

  test('no horizontal overflow at 320 and 375', async ({ page }, info) => {
    test.skip(![320, 375].includes(width(info)), 'phones');
    await gotoHydrated(page);
    await block(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(isReduced(info) ? 200 : 900);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('experience: new roles and earlier work', () => {
  test('current roles run newest start first; the earlier ones sit folded under Earlier work', async ({ page }, info) => {
    test.skip(![375, 1440].includes(width(info)) || isLight(info), '375 and 1440, one theme');
    await gotoHydrated(page);
    const timeline = page.locator('#experience [data-timeline]');
    await expect(timeline.locator('article[data-role-card]')).toHaveCount(profile.experience.length);

    const starts = await timeline.locator(':scope > ol > li article[data-role-card]').evaluateAll((els) =>
      els.map((el) => el.querySelector('time')?.getAttribute('datetime') ?? ''),
    );
    expect(starts).toEqual(CURRENT.map((e) => e.start).sort((a, b) => b.localeCompare(a)));

    const toggle = timeline.locator('[data-earlier-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Earlier work');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const region = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    await expect(region).toHaveAttribute('inert', '');
    await expect(region.locator('article[data-role-card]')).toHaveCount(EARLIER.length);

    await toggle.scrollIntoViewIfNeeded();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region).not.toHaveAttribute('inert', '');
    for (const e of EARLIER) await expect(region.getByRole('heading', { name: e.role, exact: true })).toBeVisible();
  });

  test('an empty location shows no pin; a venture links to its site', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info), 'one viewport');
    await gotoHydrated(page);
    for (const [i, e] of profile.experience.entries()) {
      const card = page.locator(`#experience [data-exp-index="${i}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.locator('svg.lucide-map-pin')).toHaveCount(e.location ? 1 : 0);
      const url = 'url' in e ? (e.url as string | undefined) : undefined;
      if (url) {
        const site = card.locator('[data-role-site]');
        const href = (await site.getAttribute('href')) ?? '';
        expect(linkKey(href)).toBe(linkKey(url));
        await expect(site).toHaveAttribute('target', '_blank');
        await expect(site).toHaveAttribute('rel', /noopener/);
      } else {
        await expect(card.locator('[data-role-site]')).toHaveCount(0);
      }
    }
  });

  test('an AI spotlight on an earlier role opens the group', async ({ page }, info) => {
    test.skip(width(info) !== 1440 || isLight(info) || EARLIER.length === 0, 'one viewport');
    await gotoHydrated(page);
    const index = profile.experience.findIndex((e) => 'earlier' in e && e.earlier === true);
    const toggle = page.locator('#experience [data-earlier-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate((i) => document.querySelector(`#experience [data-exp-index="${i}"]`)!.setAttribute('data-ai-spotlight', ''), index);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#experience [data-exp-index="${index}"]`)).toBeInViewport({ timeout: 5_000 });
  });

  test('the timeline has no horizontal overflow at 320 with Earlier work open', async ({ page }, info) => {
    test.skip(width(info) !== 320, '320 only');
    await gotoHydrated(page);
    const toggle = page.locator('#experience [data-earlier-toggle]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(600);
    await expectNoHorizontalOverflow(page);
  });
});
