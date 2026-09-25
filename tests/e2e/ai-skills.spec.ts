import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import store from '../../src/data/ai-generated/skills.json' with { type: 'json' };
import { aiPost, assertSafeServer, mockAiFallback, mockAiJson } from './ai-mocks';
import { expect, test } from './helpers';

/*
 * ai-skills (#209-#212): where he has used a skill (deterministic evidence, a
 * review-gated summary, the reference provenance line, Ask scoped to the exact
 * skill name), Explain simply, the opt-in Gemini sentiment comparison with
 * verified spans, and the "Where lexicons break" gallery.
 *
 * The feature checks run at 320px under reduced motion (the 320x568 reduced
 * projects, in both themes); one check runs on every project. Model calls are
 * mocked in the browser, and the few that reach the server hit the fake model:
 * assertSafeServer runs before every test.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; hasTouch?: boolean; reducedMotion?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const at320Reduced = (info: TestInfo) => projectUse(info).viewport?.width === 320 && projectUse(info).reducedMotion === 'reduce';

type Entry = { reviewed: boolean; claimBearing: boolean; value: Record<string, unknown> };
const ENTRIES = (store as unknown as { entries: Record<string, Entry> }).entries;
const SKILL_NAMES = Object.values(profile.skills as Record<string, string[]>).flat();
// Local and preview builds show unreviewed drafts; a PW_BASE_URL run may be production.
const LOCAL_BUILD = !process.env.PW_BASE_URL;

const modal = (page: Page) => page.locator('[data-dialog-root] [data-skill-modal]');
const title = (page: Page) => page.locator('#skill-modal-title');

/** POSTs to /api/ai/* (optionally one route) from now on, mocked or not. */
function countAiPosts(page: Page, route?: string): () => number {
  let n = 0;
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.startsWith('/api/ai/') && (!route || path === `/api/ai/${route}`)) n += 1;
  });
  return () => n;
}

/** Every test that runs starts here: refuse a server that could reach the real API, then skip the intro. */
async function prepare(page: Page, request: APIRequestContext) {
  await assertSafeServer(request);
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
}

async function openSkill(page: Page, slug: string, name: string) {
  await page.goto(`/?skill=${slug}`);
  await expect(title(page)).toHaveText(name);
  await expect(modal(page)).toHaveAttribute('data-skill-modal', slug);
}

async function gotoSentiment(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  const box = page.getByRole('textbox', { name: 'Text to analyse' });
  await box.scrollIntoViewIfNeeded();
  return box;
}

test.describe('ai-skills at 320px, reduced motion', () => {
  test.beforeEach(async ({ page, request }, info) => {
    test.skip(!at320Reduced(info), 'feature checks run on the 320x568 reduced-motion projects');
    await prepare(page, request);
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.describe('where he has used a skill (#209)', () => {
    test('Gemini: the six projects, a gated summary with provenance, and no AI request', async ({ page }) => {
      const posts = countAiPosts(page);
      await openSkill(page, 'gemini', 'Gemini');
      const usage = modal(page).locator('[data-skill-usage="gemini"]');
      await expect(usage).toBeVisible();
      await expect(usage.locator('[data-skill-projects] li')).toHaveCount(6);
      await expect(usage.locator('[data-skill-no-projects]')).toHaveCount(0);

      const entry = ENTRIES['summary:gemini'];
      const summary = usage.locator('[data-skill-summary]');
      if (entry?.reviewed) {
        await expect(summary).toHaveAttribute('data-review', 'reviewed');
        await expect(summary.locator('[data-provenance]')).toHaveText('AI-written · reviewed by Oikantik');
      } else if (entry && LOCAL_BUILD) {
        // Drafts show only where the build flag allows them, labelled as drafts.
        await expect(summary).toHaveAttribute('data-review', 'draft');
        await expect(summary.locator('[data-provenance]')).toHaveText('Draft · not yet reviewed');
        await expect(summary).toContainText(String(entry.value.text));
      }
      if (entry && (entry.reviewed || LOCAL_BUILD)) await expect(summary.locator('[data-ai-disclosure]')).toContainText('AI-generated · may be wrong');
      expect(posts()).toBe(0);
    });

    test('a skill no project lists shows the rule copy, no summary, and makes no request', async ({ page }) => {
      const name = 'Tableau';
      // Guard the fixture: no project's stack names it.
      expect(projects.some((p) => p.techStack.some((t) => t.toLowerCase().includes(name.toLowerCase())))).toBe(false);
      expect(ENTRIES['summary:tableau']).toBeUndefined();
      const posts = countAiPosts(page);
      await openSkill(page, 'tableau', name);
      const usage = modal(page).locator('[data-skill-usage="tableau"]');
      await expect(usage.locator('[data-skill-no-projects]')).toHaveText(`No project on this site lists ${name}.`);
      await expect(usage.locator('[data-skill-projects]')).toHaveCount(0);
      await expect(usage.locator('[data-skill-summary]')).toHaveCount(0);
      await expect(usage.locator('[data-skill-experience]')).toHaveCount(0);
      expect(posts()).toBe(0);
    });

    test('ReAct: role lines name it verbatim and Ask opens the assistant scoped to "ReAct", not "React"', async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __askOpen: unknown[] };
        w.__askOpen = [];
        window.addEventListener('ob:ask:open', (e) => w.__askOpen.push((e as CustomEvent).detail));
      });
      await openSkill(page, 'react', 'ReAct');
      const roles = modal(page).locator('[data-skill-experience]');
      await expect(roles).toContainText('ReAct');
      await expect(roles.locator('q').first()).toContainText('ReAct');

      await modal(page).getByRole('button', { name: 'Ask how he uses ReAct' }).click();
      await expect(page.locator('[data-dialog-root] [data-skill-modal]')).toHaveCount(0);
      const detail = await page.waitForFunction(() => (window as unknown as { __askOpen: unknown[] }).__askOpen[0]).then((h) => h.jsonValue());
      expect(detail).toMatchObject({ scope: { skill: 'ReAct' }, send: true });
      expect(JSON.stringify(detail)).not.toContain('"React"');
    });

    test('the concierge request carries scope.skill "ReAct" (mocked)', async ({ page }) => {
      const bodies: unknown[] = [];
      await page.route(/\/api\/ai\/ask(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        bodies.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'fallback', reason: 'quota' }) });
      });
      await openSkill(page, 'react', 'ReAct');
      await modal(page).getByRole('button', { name: 'Ask how he uses ReAct' }).click();
      const until = Date.now() + 10_000;
      while (!bodies.length && Date.now() < until) await page.waitForTimeout(250);
      // The concierge package consumes ask:open; until it is in the build nothing is sent.
      test.skip(!bodies.length, 'no /api/ai/ask request: the concierge did not consume ask:open in this build');
      expect(bodies[0]).toMatchObject({ scope: { skill: 'ReAct' } });
    });

    test('the reference provenance line appears for every skill', async ({ page }) => {
      await openSkill(page, 'langchain', 'LangChain');
      const seen = new Set<string>();
      for (let i = 0; i < SKILL_NAMES.length; i++) {
        const name = (await title(page).textContent())?.trim() ?? '';
        seen.add(name);
        await expect(modal(page).locator('[data-skill-provenance]')).toHaveText(
          'Reference text generated with Gemini + Google Search; it describes the technology, not Oikantik’s use of it.',
        );
        await modal(page).getByRole('button', { name: /^Next skill: / }).click();
        await expect(title(page)).not.toHaveText(name);
      }
      expect([...seen].sort()).toEqual([...SKILL_NAMES].sort());
    });

    test('when the store chunk cannot load, the evidence block still works and nothing AI shows', async ({ page }) => {
      await page.route('**/_next/static/chunks/**', async (route) => {
        const res = await route.fetch();
        const body = await res.text();
        if (body.includes('explain:rag') && body.includes('summary:rag')) return route.abort();
        return route.fulfill({ response: res, body });
      });
      await openSkill(page, 'rag', 'RAG');
      const usage = modal(page).locator('[data-skill-usage="rag"]');
      await expect(usage.locator('[data-skill-experience]')).toContainText('RAG');
      await expect(usage.locator('[data-skill-no-projects]')).toBeVisible();
      await page.waitForTimeout(500);
      await expect(usage.locator('[data-skill-summary]')).toHaveCount(0);
      await expect(modal(page).locator('[data-skill-explain-toggle]')).toHaveCount(0);
    });
  });

  test.describe('explain simply (#210)', () => {
    test('a 44px aria-pressed toggle shows three sentences labelled as about the technology', async ({ page }) => {
      const posts = countAiPosts(page);
      await openSkill(page, 'rag', 'RAG');
      const toggle = modal(page).locator('[data-skill-explain-toggle]');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      const box = await toggle.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      await expect(modal(page).locator('[data-skill-explain]')).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const panel = modal(page).locator('[data-skill-explain]');
      await expect(panel.locator('li')).toHaveCount(3);
      await expect(panel.locator('[data-skill-explain-scope]')).toHaveText('About the technology, not about Oikantik’s experience');
      const entry = ENTRIES['explain:rag'];
      await expect(panel.locator('[data-provenance]')).toHaveText(entry.reviewed ? 'AI-written · reviewed by Oikantik' : "AI-written from this site's content");
      await expect(panel.locator('[data-ai-disclosure]')).toBeVisible();
      for (const s of entry.value.sentences as string[]) await expect(panel).toContainText(s);

      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(modal(page).locator('[data-skill-explain]')).toHaveCount(0);
      expect(posts()).toBe(0);
    });
  });

  test.describe('sentiment: compare with Gemini (#211)', () => {
    const TEXT = 'Oh great, another outage.';
    const VERDICT = {
      label: 'negative',
      score: -0.8,
      rationale: 'Sarcasm: "great" is ironic about an outage.',
      aspects: [
        { text: 'Oh great', start: 0, end: 8, polarity: 'negative' },
        { text: 'another outage', start: 10, end: 24, polarity: 'negative' },
        // Not in the text: the page must not mark it.
        { text: 'terrible', start: 3, end: 11, polarity: 'negative' },
      ],
      model: 'gemini-test',
      dropped: 0,
    };

    test('nothing is sent until the click; then the verdict, verified spans and one announcement', async ({ page }) => {
      const posts = countAiPosts(page);
      const bodies: unknown[] = [];
      page.on('request', (req) => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/ai/sentiment') bodies.push(req.postDataJSON());
      });
      await mockAiJson(page, 'sentiment', VERDICT);
      const box = await gotoSentiment(page);
      await box.fill('Meeting went okay.');
      await page.getByRole('button', { name: 'Example 2' }).click();
      await box.fill(TEXT);
      await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'positive');
      await page.waitForTimeout(800);
      expect(posts()).toBe(0);

      await page.evaluate(() => {
        const el = document.querySelector('[data-sentiment-ai-live]')!;
        const w = window as unknown as { __aiLive: string[] };
        w.__aiLive = [];
        new MutationObserver(() => w.__aiLive.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true });
      });
      const compare = page.locator('[data-sentiment-compare-button]');
      await compare.click();
      await expect(page.locator('[data-sentiment-gemini="negative"]')).toBeVisible();
      expect(bodies).toEqual([{ text: TEXT }]);

      const card = page.locator('[data-sentiment-gemini]');
      await expect(card.locator('[data-agreement]')).toHaveAttribute('data-agreement', 'disagree');
      await expect(card.locator('mark')).toHaveCount(2);
      await expect(card.locator('mark').nth(0)).toContainText('Oh great');
      await expect(card.locator('mark').nth(1)).toContainText('another outage');
      await expect(card).not.toContainText('terrible');
      await expect(card.locator('[data-ai-disclosure]')).toContainText('gemini-test');
      await expect(card.locator('[data-ai-disclosure]')).toContainText("1 phrase Gemini named wasn't in your text");
      // The lexicon's own result is still on the page, and still the default.
      await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'positive');

      const live = page.locator('[data-sentiment-ai-live]');
      await expect(live).toHaveText('Gemini: negative, score -0.80. Disagrees with the lexicon.');
      // A second click on the same text is answered from the tab's cache: no request, no second announcement.
      await compare.click();
      await page.waitForTimeout(1500);
      expect(bodies).toHaveLength(1);
      expect(await page.evaluate(() => (window as unknown as { __aiLive: string[] }).__aiLive)).toEqual([
        'Gemini: negative, score -0.80. Disagrees with the lexicon.',
      ]);

      // Editing the text sets the verdict aside: it belonged to the old text.
      await box.fill(`${TEXT} Again.`);
      await expect(page.locator('[data-sentiment-gemini]')).toHaveCount(0);
    });

    test('a quota fallback keeps the lexicon verdict as the answer', async ({ page }) => {
      await mockAiFallback(page, 'quota');
      const box = await gotoSentiment(page);
      await box.fill(TEXT);
      await page.locator('[data-sentiment-compare-button]').click();
      const error = page.locator('[data-sentiment-compare] [data-ai-error="quota"]');
      await expect(error).toBeVisible();
      await expect(error).toContainText('The lexicon’s verdict above still stands.');
      await expect(page.locator('[data-sentiment-gemini]')).toHaveCount(0);
      await expect(page.locator('[data-sentiment-label]')).toHaveAttribute('data-sentiment-label', 'positive');
    });

    test('text over 280 characters cannot be sent', async ({ page }) => {
      const posts = countAiPosts(page);
      const box = await gotoSentiment(page);
      await box.fill('good '.repeat(57));
      await expect(page.locator('[data-sentiment-compare-button]')).toBeDisabled();
      await expect(page.locator('[data-sentiment-compare]')).toContainText('Gemini compares up to 280 characters; this text has 285.');
      expect(posts()).toBe(0);
    });

    test('the route checks spans against the text: relocated when present, dropped when not (fake model)', async ({ request }) => {
      // The fake model names the phrase 'fake' at offset 0 with a 'negative, -1' verdict.
      const found = await aiPost(request, 'sentiment', { text: 'This fake review is terrible' });
      expect(found.status()).toBe(200);
      expect(await found.json()).toMatchObject({
        label: 'negative',
        score: -1,
        aspects: [{ text: 'fake', start: 5, end: 9, polarity: 'negative' }],
        dropped: 0,
      });

      const missing = await aiPost(request, 'sentiment', { text: 'Nothing here matches' });
      expect(await missing.json()).toMatchObject({ label: 'negative', aspects: [], dropped: 1 });

      const inside = await aiPost(request, 'sentiment', { text: 'Unfakeable claims' });
      expect(await inside.json()).toMatchObject({ aspects: [], dropped: 1 });

      const long = await aiPost(request, 'sentiment', { text: 'x'.repeat(281) });
      expect(await long.json()).toEqual({ mode: 'fallback', reason: 'too-long' });
      const blank = await aiPost(request, 'sentiment', { text: '   ' });
      expect(await blank.json()).toEqual({ mode: 'fallback', reason: 'bad-request' });
    });
  });

  test.describe('where lexicons break (#211)', () => {
    const galleryKeys = Object.keys(ENTRIES)
      .filter((k) => k.startsWith('gallery:'))
      .sort();

    test('prev/next by keyboard, three readings per example, and no request', async ({ page }) => {
      test.skip(galleryKeys.length === 0, 'the gallery has not been generated (npm run ai:generate)');
      const posts = countAiPosts(page);
      await gotoSentiment(page);
      const toggle = page.locator('[data-lexicon-gallery-toggle]');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const gallery = page.locator('[data-lexicon-gallery]');
      const example = gallery.locator('[data-gallery-example]');
      await expect(example).toHaveAttribute('data-gallery-example', galleryKeys[0]);
      await expect(gallery.locator('[data-gallery-counter]')).toHaveText(new RegExp(`^Example 1\\s*/\\s*of ${galleryKeys.length}$`));
      await expect(example.locator('[data-verdict-label]')).toHaveCount(3);
      const first = ENTRIES[galleryKeys[0]].value;
      // Marked spans carry an sr-only '(negative)' for screen readers; compare the sentence without it.
      const sentence = await example.locator('.ai-span-text').evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.sr-only').forEach((n) => n.remove());
        return copy.textContent;
      });
      expect(sentence).toBe(String(first.text));
      await expect(example.locator('[data-gallery-note]')).toContainText('Why the lexicon slips');

      const next = gallery.locator('[data-gallery-next]');
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(example).toHaveAttribute('data-gallery-example', galleryKeys[1]);
      await page.keyboard.press('Space');
      await expect(example).toHaveAttribute('data-gallery-example', galleryKeys[2 % galleryKeys.length]);
      const prev = gallery.locator('[data-gallery-prev]');
      await prev.focus();
      await page.keyboard.press('Enter');
      await expect(example).toHaveAttribute('data-gallery-example', galleryKeys[1]);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(example).toHaveAttribute('data-gallery-example', galleryKeys[galleryKeys.length - 1]);
      for (const btn of [prev, next]) {
        const box = await btn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(gallery.locator('[data-ai-disclosure]')).toBeVisible();

      // Try it: the example moves into the demo's textarea, still with no request.
      await gallery.locator('[data-gallery-try]').click();
      const box = page.getByRole('textbox', { name: 'Text to analyse' });
      await expect(box).toHaveValue(String(ENTRIES[galleryKeys[galleryKeys.length - 1]].value.text));
      await expect(box).toBeFocused();
      expect(posts()).toBe(0);
    });
  });
});

test.describe('ai-skills on every project', () => {
  test.beforeEach(async ({ page, request }) => {
    await prepare(page, request);
  });

  test('the usage panel and the compare button fit the viewport', async ({ page }) => {
    const posts = countAiPosts(page);
    await openSkill(page, 'rag', 'RAG');
    const usage = modal(page).locator('[data-skill-usage="rag"]');
    await expect(usage).toBeVisible();
    const overflow = await modal(page).evaluate((el) => {
      const scroller = el.closest('[data-dialog-scroller]') ?? el;
      return scroller.scrollWidth - scroller.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(modal(page).locator('[data-skill-explain-toggle]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog-root]')).toHaveCount(0);

    const box = page.getByRole('textbox', { name: 'Text to analyse' });
    await box.scrollIntoViewIfNeeded();
    const button = page.locator('[data-sentiment-compare-button]');
    await expect(button).toBeVisible();
    const rect = await button.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(vw);
    expect(posts()).toBe(0);
  });
});
