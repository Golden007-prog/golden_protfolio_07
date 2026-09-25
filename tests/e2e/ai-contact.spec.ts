import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import { DRAFT_LENGTHS, DRAFT_SESSION_CAP } from '../../src/lib/ai/draft';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { assertSafeServer, countAiRequests, mockAiFallback } from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Package "ai-contact" (#230-#235): the contact:prefill contract, "Help me write
 * this" (streamed draft, autosave, never sending, tone, length, Undo, the
 * template fallback and the session cap), "Check my message", dictation and the
 * disclosure. Everything runs at 320px under reduced motion, with every AI
 * request mocked in the browser; assertSafeServer runs first regardless.
 */

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const inScope = (info: TestInfo) => projectUse(info).viewport?.width === 320 && projectUse(info).reducedMotion === 'reduce';

const DRAFT = 'Hi Oikantik,\n\nI am hiring an LLM engineer for a remote role at [your company]. Could we talk about [timeline]?\n\nThanks,\n[your name]';
const FORMAL = 'Dear Oikantik,\n\nI am writing from [your company] regarding a remote LLM engineering role. Would you be available to discuss it?\n\nKind regards,\n[your name]';
const LONG_CHAT =
  'Hi Oikantik, I am hiring an LLM engineer for a remote role at [your company] and would love to talk about it soon.\nIt is a good fit for your RAG work and I can share more on a call whenever suits you.';

/** A draft stream the way the route writes it: meta, the text in a few deltas, done. */
function draftFrames(text: string): AiFrame[] {
  const cut = [0, Math.floor(text.length / 3), Math.floor((2 * text.length) / 3), text.length];
  const deltas: AiFrame[] = cut.slice(1).map((end, i) => ({ type: 'delta', text: text.slice(cut[i], end) }));
  return [
    { type: 'meta', model: 'gemini-test', feature: 'draft', sources: [], mode: 'full' },
    ...deltas,
    { type: 'done', finishReason: 'STOP', cited: [], dropped: 0, degraded: false },
  ];
}

type DraftBody = { mode: 'draft'; notes: string; intent: string; tone: string; length: string } | { mode: 'check'; message: string };

/**
 * One mock for POST /api/ai/draft that answers each mode: an NDJSON draft (chosen
 * from the request) or the check's JSON. Returns the request bodies it saw.
 */
async function mockDraftRoute(
  page: Page,
  opts: { draft?: (body: Extract<DraftBody, { mode: 'draft' }>) => string; check?: unknown; checkDelayMs?: number },
): Promise<DraftBody[]> {
  const bodies: DraftBody[] = [];
  await page.route(/\/api\/ai\/draft(?:\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = req.postDataJSON() as DraftBody;
    bodies.push(body);
    if (body.mode === 'check') {
      if (opts.checkDelayMs) await new Promise((r) => setTimeout(r, opts.checkDelayMs));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.check ?? { mode: 'fallback', reason: 'upstream' }) });
    }
    const text = opts.draft?.(body) ?? DRAFT;
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'cache-control': 'no-store, no-transform', 'x-ai-model': 'gemini-test' },
      body: draftFrames(text).map((f) => JSON.stringify(f)).join('\n') + '\n',
    });
  });
  return bodies;
}

/** Counts requests to the mail relay. The AI features must never cause one. */
function watchSends(page: Page): () => number {
  let n = 0;
  page.on('request', (req) => {
    if (/formsubmit\.co/.test(req.url())) n += 1;
  });
  return () => n;
}

const savedDraft = (page: Page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(window.localStorage.getItem('ob-contact-draft') ?? 'null') as { message?: string; subject?: string | null } | null;
    } catch {
      return null;
    }
  });

async function gotoContact(page: Page) {
  await page.goto('/#contact');
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/);
  const toggle = page.locator('#contact [data-draft-toggle]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
}

async function openHelper(page: Page) {
  await page.locator('#contact [data-draft-toggle]').click();
  const panel = page.locator('#contact [data-draft-panel]');
  await expect(panel).toBeVisible();
  return panel;
}

const message = (page: Page) => page.locator('#contact textarea[name="message"]');

test.beforeEach(async ({ page, request }, info) => {
  test.skip(!inScope(info), '320px under reduced motion');
  await assertSafeServer(request);
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

test.describe('prefill contract (#230)', () => {
  test('a hand-off appends once and never replaces a typed subject', async ({ page }) => {
    await gotoContact(page);
    const field = message(page);
    const subject = page.locator('#contact input[name="subject"]');
    await field.fill('My own words.');
    await subject.fill('Typed subject');
    const prefill = (detail: { message?: string; subject?: string }) =>
      page.evaluate((d) => window.dispatchEvent(new CustomEvent('ob:contact:prefill', { detail: d })), detail);

    await prefill({ message: 'About UrbanCare AI.', subject: 'Hand-off subject' });
    await expect(field).toHaveValue('My own words.\n\nAbout UrbanCare AI.');
    await prefill({ message: 'About UrbanCare AI.', subject: 'Another subject' });
    await expect(field).toHaveValue('My own words.\n\nAbout UrbanCare AI.');
    await expect(subject).toHaveValue('Typed subject');

    await subject.fill('');
    await prefill({ subject: 'Hand-off subject' });
    await expect(subject).toHaveValue('Hand-off subject');
    await expect.poll(async () => (await savedDraft(page))?.subject).toBe('Hand-off subject');
  });
});

test.describe('Help me write this (#231, #232)', () => {
  test('a streamed draft fills the message, autosaves, discloses and never sends', async ({ page }) => {
    const sends = watchSends(page);
    const lottie: string[] = [];
    page.on('request', (r) => {
      if (/\/lottie\/[^/]+\.json/.test(r.url())) lottie.push(r.url());
    });
    const { errors } = collectPageErrors(page);
    const aiRequests = countAiRequests(page);
    const bodies = await mockDraftRoute(page, {});
    await gotoContact(page);

    const before = aiRequests();
    const panel = await openHelper(page);
    await expect(panel.locator('[data-draft-privacy]')).toHaveText('Your notes are sent to Google Gemini to draft this.');
    await panel.locator('[data-draft-notes]').fill('hiring an LLM engineer, remote');
    expect(aiRequests(), 'opening the helper and typing notes calls nothing').toBe(before);

    await panel.locator('[data-draft-generate]').click();
    await expect(message(page)).toHaveValue(DRAFT);
    expect(bodies).toEqual([{ mode: 'draft', notes: 'hiring an LLM engineer, remote', intent: 'general', tone: 'warm', length: 'note' }]);

    const disclosure = panel.locator('[data-ai-disclosure]');
    await expect(disclosure).toContainText('AI-generated');
    await expect(disclosure.locator('a[href="/ai#how"]')).toHaveCount(1);
    await expect(disclosure.locator('a[href="/ai#privacy"]')).toHaveCount(1);
    await expect(page.locator('#contact [data-draft-status]')).toContainText('Draft added to your message');
    await expect(message(page)).not.toHaveAttribute('readonly', '');

    await expect.poll(async () => (await savedDraft(page))?.message).toBe(DRAFT);
    await page.waitForTimeout(500);
    expect(sends(), 'drafting never sends').toBe(0);
    expect(lottie, 'no Lottie JSON under reduced motion').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('tone and length chips regenerate; Undo restores the exact earlier text; one-line stays in its cap', async ({ page }) => {
    const sends = watchSends(page);
    const bodies = await mockDraftRoute(page, {
      draft: (body) => (body.length === 'chat' ? LONG_CHAT : body.tone === 'formal' ? FORMAL : DRAFT),
    });
    await gotoContact(page);
    const original = 'Original text,  typed by me.\n';
    await message(page).fill(original);

    const panel = await openHelper(page);
    await panel.locator('[data-draft-notes]').fill('remote LLM role');
    await panel.locator('[data-draft-generate]').click();
    await expect(message(page)).toHaveValue(DRAFT);

    const formal = panel.locator('[data-draft-tone="formal"]');
    await expect(formal).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.locator('[data-draft-tone="warm"]')).toHaveAttribute('aria-pressed', 'true');
    await formal.click();
    await expect(formal).toHaveAttribute('aria-pressed', 'true');
    await expect(message(page)).toHaveValue(FORMAL);
    expect(bodies.at(-1)).toMatchObject({ mode: 'draft', tone: 'formal', length: 'note' });

    for (const chip of await panel.locator('[data-draft-tone], [data-draft-length]').all()) {
      const box = (await chip.boundingBox())!;
      expect(box.height, 'chips are 44px tall').toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    const undo = panel.locator('[data-draft-undo]');
    await undo.click();
    await expect(message(page)).toHaveValue(DRAFT);
    await undo.click();
    await expect(message(page)).toHaveValue(original);
    await expect(undo).toHaveCount(0);
    await expect(page.locator('#contact [data-draft-status]')).toContainText('Draft undone');

    await panel.locator('[data-draft-length="chat"]').click();
    await expect(panel.locator('[data-draft-length="chat"]')).toHaveAttribute('aria-pressed', 'true');
    await panel.locator('[data-draft-generate]').click();
    await expect(message(page)).not.toHaveValue(original);
    const oneLine = await message(page).inputValue();
    expect(oneLine.length).toBeLessThanOrEqual(DRAFT_LENGTHS.chat.maxChars);
    expect(oneLine).not.toContain('\n');
    expect(oneLine.startsWith('Hi Oikantik, I am hiring an LLM engineer')).toBe(true);
    await expect(panel.locator('[data-draft-count]')).toContainText(`/ ${DRAFT_LENGTHS.chat.maxChars}`);
    expect(sends()).toBe(0);
  });

  test('without the AI a template stands in, and Undo takes it back', async ({ page }) => {
    await mockAiFallback(page, 'no-key');
    await gotoContact(page);
    await message(page).fill('Before the template.');
    const panel = await openHelper(page);
    await panel.locator('[data-draft-notes]').fill('need help with a RAG pipeline');
    await panel.locator('[data-draft-generate]').click();
    await expect(panel.locator('[data-ai-error="no-key"]')).toBeVisible();
    await expect(message(page)).toHaveValue('Before the template.');

    await panel.locator('[data-draft-template]').click();
    await expect(message(page)).toHaveValue(/^Hi Oikantik,[\s\S]*Need help with a RAG pipeline\.[\s\S]*\[your name\]$/);
    await expect(panel.locator('[data-draft-source="template"]')).toBeVisible();
    await panel.locator('[data-draft-undo]').click();
    await expect(message(page)).toHaveValue('Before the template.');
  });

  test(`after ${DRAFT_SESSION_CAP} drafts this visit the AI button rests and the template remains`, async ({ page }) => {
    await page.addInitScript((cap) => {
      try {
        window.sessionStorage.setItem('ob-ai-draft-count', String(cap));
      } catch {
        /* storage blocked */
      }
    }, DRAFT_SESSION_CAP);
    const bodies = await mockDraftRoute(page, {});
    await gotoContact(page);
    const panel = await openHelper(page);
    await expect(panel.locator('[data-draft-generate]')).toBeDisabled();
    await expect(panel.locator('[data-draft-left]')).toContainText(`used this visit's ${DRAFT_SESSION_CAP}`);
    await panel.locator('[data-draft-template]').click();
    await expect(message(page)).toHaveValue(/Oikantik/);
    expect(bodies).toEqual([]);
  });
});

test.describe('Check my message (#233)', () => {
  test('renders the checklist, a topic chip and the availability answer; Send anyway submits', async ({ page, context }) => {
    const bodies = await mockDraftRoute(page, {
      check: { mode: 'check', missing: ['role', 'timeline'], suggestedIntent: 'fulltime', question: 'availability' },
    });
    await gotoContact(page);
    await page.locator('#contact input[name="name"]').fill('Playwright');
    await page.locator('#contact input[name="email"]').fill('pw@example.com');
    await message(page).fill('Are you open to remote work?');
    await page.locator('#contact [data-check-run]').click();

    const result = page.locator('#contact [data-check-result="ai"]');
    await expect(result).toBeVisible();
    expect(bodies).toEqual([{ mode: 'check', message: 'Are you open to remote work?' }]);
    await expect(result.locator('[data-check-item]')).toHaveCount(2);
    await expect(result.locator('[data-check-item="role"]')).toBeVisible();
    await expect(result.locator('[data-check-item="timeline"]')).toBeVisible();
    await expect(result.locator('[data-check-open-to]')).toHaveText(profile.availability.openTo);
    await expect(result.locator('[data-ai-disclosure]')).toContainText('AI-generated');
    await expect(page.locator('#contact [data-check-status]')).toContainText('already answers');

    const chip = result.locator('[data-check-intent="fulltime"]');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#contact [data-intent="fulltime"]')).toHaveAttribute('aria-pressed', 'true');

    // Offline, so the submit handler runs to its end without reaching the relay.
    await context.setOffline(true);
    await result.locator('[data-check-send]').click();
    await expect(page.locator('#contact [data-contact-status]')).toHaveText(/offline/i);
    await context.setOffline(false);

    // A changed message hides the old result.
    await message(page).fill('Are you open to remote work? Also, a contract role.');
    await expect(result).toHaveCount(0);
  });

  test('submit works while the check is pending, and a failed check falls back to keywords', async ({ page, context }) => {
    await mockDraftRoute(page, { check: { mode: 'fallback', reason: 'upstream' }, checkDelayMs: 1500 });
    await gotoContact(page);
    await page.locator('#contact input[name="name"]').fill('Playwright');
    await page.locator('#contact input[name="email"]').fill('pw@example.com');
    await message(page).fill('We are hiring for a full-time ML engineer position.');
    await page.locator('#contact [data-check-run]').click();
    await expect(page.locator('#contact [data-check-run]')).toHaveAttribute('aria-busy', 'true');

    await context.setOffline(true);
    await page.locator('#contact [data-contact-submit]').click();
    await expect(page.locator('#contact [data-contact-status]')).toHaveText(/offline/i);
    await context.setOffline(false);

    const rules = page.locator('#contact [data-check-result="rules"]');
    await expect(rules).toBeVisible({ timeout: 10_000 });
    await expect(rules.locator('[data-check-rules]')).toContainText('not AI');
    await expect(rules.locator('[data-check-item="timeline"]')).toBeVisible();
  });
});

test.describe('dictation (#234)', () => {
  test('a stubbed recogniser appends to the message, which stays editable and unsent', async ({ page }) => {
    const sends = watchSends(page);
    await page.addInitScript(() => {
      type Handler = ((e: unknown) => void) | null;
      class FakeRecognition {
        lang = '';
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onresult: Handler = null;
        onerror: Handler = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => {
            this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'dictated words' } }] });
            this.onend?.();
          }, 50);
        }
        stop() {
          this.onend?.();
        }
        abort() {}
      }
      const w = window as unknown as Record<string, unknown>;
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    });
    await gotoContact(page);
    await message(page).fill('Typed first.');
    await page.locator('#contact button[data-ai-voice]').click();
    await expect(message(page)).toHaveValue('Typed first. dictated words');
    await message(page).press('End');
    await message(page).pressSequentially(' More.');
    await expect(message(page)).toHaveValue('Typed first. dictated words More.');
    await page.waitForTimeout(300);
    expect(sends()).toBe(0);
  });

  test('without the Speech API there is no dictation button', async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        Object.defineProperty(window, key, { value: undefined, configurable: true, writable: true });
      }
    });
    await gotoContact(page);
    await expect(page.locator('#contact [data-draft-toggle]')).toBeVisible();
    await expect(page.locator('#contact [data-ai-voice]')).toHaveCount(0);
  });

  test('the page allows the microphone for this origin only', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['permissions-policy'] ?? '').toContain('microphone=(self)');
  });
});

test.describe('320px layout (#235)', () => {
  test('44px targets, no horizontal overflow, and room to scroll Send above the dock', async ({ page }) => {
    await mockDraftRoute(page, { check: { mode: 'check', missing: ['timeline'], suggestedIntent: 'research', question: 'none' } });
    await gotoContact(page);
    await message(page).fill('I would like to collaborate on research.');
    const panel = await openHelper(page);
    await panel.locator('[data-draft-generate]').click();
    await expect(message(page)).toHaveValue(DRAFT);
    await page.locator('#contact [data-check-run]').click();
    await expect(page.locator('#contact [data-check-result]')).toBeVisible();

    const small = await page.$$eval(
      '#contact [data-draft-toggle], #contact [data-draft-panel] button, #contact [data-draft-panel] a, #contact [data-message-check] button, #contact [data-message-check] a, #contact button[data-ai-voice]',
      (els) =>
        els
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), what: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) };
          })
          .filter((s) => s.w < 44 || s.h < 44),
    );
    expect(small, 'contact AI targets under 44px').toEqual([]);
    await expectNoHorizontalOverflow(page);

    const room = await page.locator('#contact [data-contact-shell]').evaluate((el) => {
      const root = getComputedStyle(document.documentElement);
      const dock = parseFloat(root.getPropertyValue('--dock-height')) || 56;
      return { pad: parseFloat(getComputedStyle(el).paddingBottom), dock };
    });
    expect(room.pad).toBeGreaterThanOrEqual(room.dock + 24);
  });
});
