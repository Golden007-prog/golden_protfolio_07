import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import type { AiFallback, AiFrame, AskRequest } from '../../src/lib/ai/protocol';
import { STARTERS } from '../../src/utils/askme';
import { assertSafeServer, countAiRequests, mockAiFallback } from './ai-mocks';
import { collectPageErrors, expect, expectNoHorizontalOverflow, test } from './helpers';

/*
 * Package "ai-concierge" (#177-#191): the rule-first AskMeBot with its AI path.
 * Every AI answer here is mocked in the browser; the real route runs in
 * ai-server.spec against the fake model. Also the floating dock stepping aside
 * for the on-screen keyboard.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string; hasTouch?: boolean };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isPhone = (info: TestInfo) => width(info) < 640;
const primary = (info: TestInfo) => width(info) === 1440 && projectUse(info).colorScheme === 'dark' && !isReduced(info);
/** Desktop and the smallest phone: enough for the flows that don't depend on layout. */
const twoWidths = (info: TestInfo) => primary(info) || (width(info) === 320 && projectUse(info).colorScheme === 'dark');

const OPEN = 'What kind of problems does he seem most curious about?';
const EXP0 = profile.experience[0];
const SRC_UC = { id: 'project:urbancare-ai#solution', label: 'UrbanCare AI · Solution', cls: 'self' as const, target: { kind: 'project' as const, slug: 'urbancare-ai' } };
const SRC_EXP = { id: 'exp:0', label: `Experience · ${EXP0.company}`, cls: 'self' as const, target: { kind: 'experience' as const, index: 0 } };
const SRC_OMNI = { id: 'project:omni-lab#summary', label: 'Omni-Lab · Summary', cls: 'self' as const, target: { kind: 'project' as const, slug: 'omni-lab' } };

function frames(deltas: string[], done: Partial<Extract<AiFrame, { type: 'done' }>> = {}, meta: Partial<Extract<AiFrame, { type: 'meta' }>> = {}): AiFrame[] {
  const cited = [...new Set(deltas.join('').match(/\[c:([^\]]+)\]/g)?.map((m) => m.slice(3, -1)) ?? [])];
  return [
    {
      type: 'meta',
      model: 'gemini-test',
      feature: 'ask',
      sources: [SRC_UC, SRC_EXP, SRC_OMNI],
      retrieval: [
        { id: SRC_UC.id, bm25: 0.61, cosine: null, rank: 1, score: 0.0164 },
        { id: 'reading:2', bm25: 0.22, cosine: null, rank: 2, score: 0.0161 },
      ],
      mode: 'lexical',
      ...meta,
    },
    ...deltas.map((text): AiFrame => ({ type: 'delta', text })),
    { type: 'done', finishReason: 'STOP', cited: cited.filter((id) => [SRC_UC.id, SRC_EXP.id, SRC_OMNI.id].includes(id)), dropped: 0, degraded: false, usage: { input: 900, output: 60, thoughts: 12 }, ...done },
  ];
}

const ANSWER = frames([`His first listed role is ${EXP0.role} at ${EXP0.company} [c:exp:0]. `, 'UrbanCare AI uses MedGemma [c:project:urbancare-ai#solution][c:fake].']);

/** Answers POST /api/ai/ask per request body; returns the bodies the page sent. */
async function routeAsk(page: Page, reply: AiFrame[] | ((body: AskRequest) => AiFrame[] | AiFallback)): Promise<AskRequest[]> {
  const bodies: AskRequest[] = [];
  await page.route(/\/api\/ai\/ask(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as AskRequest;
    bodies.push(body);
    const out = typeof reply === 'function' ? reply(body) : reply;
    if (!Array.isArray(out)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'cache-control': 'no-store, no-transform', 'x-ai-model': 'gemini-test' },
      body: `${out.map((f) => JSON.stringify(f)).join('\n')}\n`,
    });
  });
  return bodies;
}

/** A stream that really arrives over time (route.fulfill sends one piece): window.fetch is replaced for /api/ai/ask. */
async function slowAsk(page: Page, sentences = 30, gapMs = 350) {
  const all = frames(Array.from({ length: sentences }, (_, i) => `Sentence ${String.fromCharCode(97 + (i % 26))} of a long answer [c:exp:0]. `));
  await page.addInitScript(
    ({ list, gap }) => {
      const w = window as Window & { __askBodies?: unknown[] };
      const native = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('/api/ai/ask')) return native(input, init);
        (w.__askBodies ??= []).push(JSON.parse(String(init?.body ?? '{}')));
        const enc = new TextEncoder();
        const signal = init?.signal;
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(c) {
            if (signal?.aborted || i >= list.length) {
              c.close();
              return;
            }
            await new Promise((r) => setTimeout(r, i === 0 ? 30 : gap));
            c.enqueue(enc.encode(`${JSON.stringify(list[i++])}\n`));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
      };
    },
    { list: all, gap: gapMs },
  );
}

async function openChat(page: Page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');
  await page.locator('[data-ask-launcher]').click();
  const input = chat(page).locator('input').first();
  await expect(input).toBeVisible();
  return input;
}

const chat = (page: Page) => page.locator('[data-ask-panel], [data-ask-sheet]').first();

async function ask(input: ReturnType<Page['locator']>, q: string) {
  await input.fill(q);
  await input.press('Enter');
}

/** POSTs to /api/ai/ask only (GET /api/ai/health may follow an AI answer). */
function countAsks(page: Page): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/ai/ask') n += 1;
  });
  return () => n;
}

test.beforeEach(async ({ request }) => {
  await assertSafeServer(request);
});

/* ---- #178 rule first, source labels ---- */

test.describe('rule-first hybrid (#178, #189)', () => {
  test('a deterministic intent answers from rules with no AI request; every bubble carries data-source', async ({ page }) => {
    const aiRequests = countAiRequests(page);
    const input = await openChat(page);
    await expect(chat(page).locator('[data-ask-subtitle]')).toHaveText("Answers from this site's data · AI-assisted for open questions");
    await expect(input).toHaveAttribute('maxlength', '500');
    await ask(input, 'Which projects use Gemini?');
    await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1, { timeout: 3000 });
    await page.waitForTimeout(400);
    expect(aiRequests()).toBe(0);
    const answers = chat(page).locator('[data-ask-answer]');
    const n = await answers.count();
    for (let i = 0; i < n; i++) await expect(answers.nth(i)).toHaveAttribute('data-source', /^(rules|ai|cache)$/);
    await expect(chat(page).locator('[data-ask-answer="skill"] [data-source="rules"]')).toHaveText(/From the site's data/);
  });

  test('an open-ended question sends exactly one request and renders an AI bubble', async ({ page }) => {
    await routeAsk(page, ANSWER);
    const asks = countAsks(page);
    const input = await openChat(page);
    await ask(input, OPEN);
    await expect(chat(page).locator('[data-ask-answer="ai"][data-source="ai"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(300);
    expect(asks()).toBe(1);
  });

  test('with an empty store the four static starters render unchanged', async ({ page }, info) => {
    test.skip(!twoWidths(info), 'layout-independent');
    await openChat(page);
    const starters = chat(page).locator('[data-ask-starters] button');
    const texts = await starters.allTextContents();
    expect(texts.slice(0, STARTERS.length)).toEqual([...STARTERS]);
  });
});

/* ---- #179 streamed answers with verified chips ---- */

test.describe('streamed answers (#179, #187, #188)', () => {
  test('one chip for a listed source, none for [c:fake]; the chip opens the project; disclosure and details', async ({ page }, info) => {
    const { errors } = collectPageErrors(page);
    await routeAsk(page, ANSWER);
    const input = await openChat(page);
    await ask(input, OPEN);
    const bubble = chat(page).locator('[data-ask-answer="ai"]').first();
    await expect(bubble).toBeVisible({ timeout: 10_000 });
    await expect(bubble.locator('button.ai-cite[data-cite-id="project:urbancare-ai#solution"]')).toHaveCount(1);
    await expect(bubble.locator('[data-cite-id="fake"], [data-cite-id="c:fake"]')).toHaveCount(0);
    await expect(bubble).not.toContainText('[c:');
    const disclosure = bubble.locator('[data-ai-disclosure]');
    await disclosure.scrollIntoViewIfNeeded();
    await expect(disclosure).toBeVisible();

    const details = bubble.locator('[data-ask-details]');
    await details.locator('summary').click();
    await expect(details.locator('th[scope="col"]')).toHaveCount(5);
    expect(await details.locator('th[scope="row"]').count()).toBeGreaterThan(0);
    await expect(details.locator('tr[data-use="cited"]')).toHaveCount(1);
    await expect(details.locator('tr[data-use="dropped"]')).toHaveCount(1);

    if (!twoWidths(info)) {
      expect(errors).toEqual([]);
      return;
    }
    await bubble.locator('button.ai-cite[data-cite-id="project:urbancare-ai#solution"]').click();
    await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get('project')), { timeout: 5000 }).toBe('urbancare-ai');
    expect(errors).toEqual([]);
  });

  test('a degraded answer shows the note with the rule answer below it', async ({ page }) => {
    await routeAsk(page, frames([`His first listed role is at ${EXP0.company} [c:exp:0].`], { degraded: true, dropped: 2 }));
    const input = await openChat(page);
    await ask(input, OPEN);
    const degraded = chat(page).locator('[data-ask-answer="ai"] [data-ask-degraded]');
    await expect(degraded).toBeVisible({ timeout: 10_000 });
    await expect(degraded).toContainText("Some statements couldn't be checked against the site and were removed");
    await expect(degraded).toContainText("I didn't catch that");
  });

  test('an answer with no surviving citation is replaced by the rule answer', async ({ page }, info) => {
    test.skip(!twoWidths(info), 'layout-independent');
    await routeAsk(page, frames(['He likes many things.']));
    const input = await openChat(page);
    await ask(input, OPEN);
    await expect(chat(page).locator('[data-ask-answer="fallback"][data-note="uncited"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(0);
    await expect(page.locator('[data-ask-announce]')).toHaveText('Quick answer shown instead');
  });

  test('a canary-shaped string never reaches the DOM', async ({ page }, info) => {
    test.skip(!twoWidths(info), 'layout-independent');
    const leak = 'cnry-0123456789abcdef';
    await routeAsk(
      page,
      frames([`The marker is ${leak} [c:exp:0].`], {}, { sources: [{ ...SRC_EXP, label: `Sneaky ${leak}` }], retrieval: [{ id: 'exp:0', bm25: 0.5, cosine: null, rank: 1, score: 0.01 }] }),
    );
    const input = await openChat(page);
    await ask(input, OPEN);
    await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(1, { timeout: 10_000 });
    await chat(page).locator('[data-ask-details] summary').click();
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain('cnry-');
  });

  test('Copy as Markdown has numbered sources, a site URL and the AI line; feedback and "This is wrong"', async ({ page, context }, info) => {
    test.skip(!primary(info), 'clipboard: one desktop project');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await routeAsk(page, ANSWER);
    const formsubmit: string[] = [];
    page.on('request', (r) => {
      if (/formsubmit\.co/.test(r.url())) formsubmit.push(r.url());
    });
    const input = await openChat(page);
    await ask(input, OPEN);
    const bubble = chat(page).locator('[data-ask-answer="ai"]').first();
    await bubble.getByRole('button', { name: 'Copy as Markdown' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('[1]');
    expect(clip).toMatch(/https:\/\/www\.basuoikantik\.in\//);
    expect(clip).toContain('AI-generated');
    expect(clip).not.toContain('[c:');

    // exact: a substring match also finds 'Not helpful'.
    await bubble.getByRole('button', { name: 'Helpful', exact: true }).click();
    await expect(bubble.getByRole('button', { name: 'Helpful', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(bubble.getByRole('button', { name: 'Not helpful' })).toBeDisabled();

    await bubble.getByRole('button', { name: 'This is wrong' }).click();
    const message = page.locator('#contact textarea[name="message"]');
    await expect(message).toHaveValue(new RegExp(OPEN.replace(/[?]/g, '\\?')), { timeout: 5000 });
    await expect(message).toHaveValue(/His first listed role/);
    expect(formsubmit).toEqual([]);
  });

  test('Show the quick answer reuses the rule answer at no cost', async ({ page }, info) => {
    test.skip(!twoWidths(info), 'layout-independent');
    await routeAsk(page, ANSWER);
    const asks = countAsks(page);
    const input = await openChat(page);
    await ask(input, OPEN);
    const bubble = chat(page).locator('[data-ask-answer="ai"]').first();
    await bubble.locator('[data-ask-quick]').click();
    await expect(bubble.locator('[data-ask-quick-answer]')).toContainText("I didn't catch that");
    expect(asks()).toBe(1);
  });
});

/* ---- #180 follow-ups ---- */

test('follow-ups: grounded ones only, after the log in reading order, sent rule-first (#180)', async ({ page }, info) => {
  test.skip(!twoWidths(info), 'layout-independent');
  await routeAsk(page, frames(ANSWER.filter((f) => f.type === 'delta').map((f) => (f as { text: string }).text), { followUps: ['Which projects use LangGraph?', 'What did he build with a Kubernetes cluster at Meta?'] }));
  const asks = countAsks(page);
  const input = await openChat(page);
  await ask(input, OPEN);
  const chips = chat(page).locator('[data-ai-prompts] button');
  await expect(chips).toHaveCount(1, { timeout: 10_000 });
  await expect(chips).toHaveText('Which projects use LangGraph?');
  const order = await page.evaluate(() => {
    const log = document.querySelector('[data-ask-log]');
    const chip = document.querySelector('[data-ai-prompts] button');
    const field = document.querySelector('[data-ask-panel] input, [data-ask-sheet] input');
    return Boolean(log && chip && field && log.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING && chip.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await chips.first().focus();
  await page.keyboard.press('Enter');
  await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1, { timeout: 3000 });
  expect(asks()).toBe(1);
});

/* ---- #181 tools ---- */

test('a mocked openProject("omni-lab") opens the dialog; Undo removes ?project (#181)', async ({ page }, info) => {
  test.skip(!twoWidths(info) && width(info) !== 1024, 'desktop, touch tablet and the smallest phone');
  await routeAsk(page, [
    ...frames(['Opening Omni-Lab for you [c:project:omni-lab#summary].']).slice(0, -1),
    { type: 'tool', call: { name: 'openProject', args: { slug: 'omni-lab' } } },
    { type: 'done', finishReason: 'STOP', cited: ['project:omni-lab#summary'], dropped: 0, degraded: false },
  ]);
  const input = await openChat(page);
  await ask(input, OPEN);
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get('project')), { timeout: 8000 }).toBe('omni-lab');
  if (isPhone(info)) await expect(page.locator('[data-ask-sheet]')).toHaveCount(0);
  const undo = page.locator('[data-toast-region]').getByRole('button', { name: 'Undo' });
  await undo.click();
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get('project')), { timeout: 5000 }).toBeNull();
});

test('an invalid tool call is ignored (#181)', async ({ page }, info) => {
  test.skip(!primary(info), 'one project');
  await routeAsk(page, [
    ...frames(['Opening that for you [c:project:omni-lab#summary].']).slice(0, -1),
    { type: 'tool', call: { name: 'openProject', args: { slug: 'not-a-project' } } },
    { type: 'done', finishReason: 'STOP', cited: ['project:omni-lab#summary'], dropped: 0, degraded: false },
  ]);
  const input = await openChat(page);
  await ask(input, OPEN);
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => new URL(location.href).searchParams.get('project'))).toBeNull();
  await expect(chat(page).locator('[data-ask-step]')).toHaveCount(0);
});

/* ---- #182 scope ---- */

test('a request queued before the dock loaded opens the panel with its scope chip, and the body carries the scope (#182)', async ({ page }, info) => {
  test.skip(!twoWidths(info) && width(info) !== 768, 'three widths');
  const bodies = await routeAsk(page, ANSWER);
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
      window.sessionStorage.setItem('ob-ai-pending', JSON.stringify({ ask: { req: { scope: { project: 'omni-lab' }, question: 'What stack?' }, at: Date.now() } }));
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  const scope = chat(page).locator('[data-ask-scope]');
  await expect(scope).toHaveText(/About: Omni-Lab/, { timeout: 20_000 });
  const input = chat(page).locator('input').first();
  await expect(input).toHaveValue('What stack?');
  await input.press('Enter');
  await expect.poll(() => bodies.length, { timeout: 8000 }).toBe(1);
  expect(bodies[0].scope).toEqual({ project: 'omni-lab' });

  await chat(page).locator('[data-ask-scope-clear]').click();
  await expect(chat(page).locator('[data-ask-scope]')).toHaveCount(0);
});

/* ---- #183 session memory ---- */

test('the thread survives closing and reloading; requests carry only the visitor questions; New chat empties it (#183)', async ({ page }, info) => {
  test.skip(!twoWidths(info), 'layout-independent');
  const bodies = await routeAsk(page, ANSWER);
  let input = await openChat(page);
  await ask(input, 'Which projects use Gemini?');
  await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1, { timeout: 3000 });
  await ask(input, OPEN);
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(1, { timeout: 10_000 });
  await ask(input, 'Why does UrbanCare AI use MedGemma, in his own words?');
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(2, { timeout: 10_000 });

  expect(bodies).toHaveLength(2);
  expect(bodies[0].history).toEqual(['Which projects use Gemini?']);
  expect(bodies[1].history).toEqual(['Which projects use Gemini?', OPEN]);
  expect(bodies[1].prevCited).toEqual(['exp:0', 'project:urbancare-ai#solution']);
  const sent = JSON.stringify(bodies);
  expect(sent).not.toContain('His first listed role');
  expect(sent).not.toContain('is one of my listed skills');

  await page.keyboard.press('Escape');
  await expect(chat(page)).toHaveCount(0);
  await page.locator('[data-ask-launcher]').click();
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('[data-dock]')).not.toHaveAttribute('data-pre-intro', '', { timeout: 15_000 });
  await page.locator('[data-ask-launcher]').click();
  await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1);
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(2);

  await chat(page).getByRole('button', { name: 'New chat' }).click();
  await expect(chat(page).locator('[data-ask-answer]')).toHaveCount(1);
  await expect(chat(page).locator('[data-ask-answer="greeting"]')).toHaveCount(1);
  input = chat(page).locator('input').first();
  await expect(input).toBeVisible();
});

test('"Write to Oikantik with these questions" pre-fills only the visitor questions and posts nothing (#188)', async ({ page }, info) => {
  test.skip(!twoWidths(info), 'layout-independent');
  const formsubmit: string[] = [];
  page.on('request', (r) => {
    if (/formsubmit\.co/.test(r.url())) formsubmit.push(r.url());
  });
  const input = await openChat(page);
  await ask(input, 'Which projects use Gemini?');
  await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1, { timeout: 3000 });
  await ask(input, 'What tech do you use?');
  await expect(chat(page).locator('[data-ask-answer="stack"]')).toHaveCount(1, { timeout: 3000 });
  await chat(page).locator('[data-ask-handoff-all]').click();
  await expect(page.locator('#contact textarea[name="message"]')).toHaveValue('- Which projects use Gemini?\n- What tech do you use?', { timeout: 5000 });
  expect(formsubmit).toEqual([]);
});

/* ---- #184 Stop, Esc ---- */

test('Stop keeps the partial text; Esc stops first, then closes and returns focus to the launcher (#184, #190)', async ({ page }, info) => {
  test.skip(!twoWidths(info) && width(info) !== 1024, 'desktop, touch tablet and the smallest phone');
  await slowAsk(page);
  const input = await openChat(page);
  await ask(input, OPEN);
  const live = chat(page).locator('[data-ask-live] [data-ask-answer="ai"]');
  await expect(live).toContainText('Sentence a', { timeout: 10_000 });
  await expect(chat(page).locator('[data-ask-log]')).toHaveAttribute('aria-busy', 'true');
  await expect(chat(page).getByRole('button', { name: 'Stop' })).toBeVisible();

  await input.focus();
  await page.keyboard.press('Escape');
  const stopped = chat(page).locator('[data-ask-answer="ai"][data-status="stopped"]');
  await expect(stopped).toHaveCount(1, { timeout: 5000 });
  await expect(stopped).toContainText('Sentence a');
  await expect(chat(page)).toHaveCount(1);
  await expect(page.locator('[data-ask-announce]')).toHaveText('Stopped');
  await expect(chat(page).locator('[data-ask-log]')).not.toHaveAttribute('aria-busy', 'true');

  await chat(page).locator('input').first().focus();
  await page.keyboard.press('Escape');
  await expect(chat(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-ask-launcher') ?? false)).toBe(true);
});

test('the launcher stays visible while an answer streams with the panel closed (#185)', async ({ page }, info) => {
  test.skip(!primary(info), 'one desktop project');
  await slowAsk(page, 40, 400);
  const input = await openChat(page);
  await ask(input, OPEN);
  await expect(chat(page).locator('[data-ask-live]')).toContainText('Sentence a', { timeout: 10_000 });
  await chat(page).getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.locator('[data-ask-launcher]')).toHaveAttribute('data-busy', '');
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
  await expect(page.locator('[data-dock]')).not.toHaveAttribute('data-hidden', '');
});

/* ---- #185 degraded states and the circuit breaker ---- */

test('two quota fallbacks open the circuit: a third question sends nothing and shows the resting copy (#185)', async ({ page }, info) => {
  const { errors } = collectPageErrors(page);
  await mockAiFallback(page, 'quota');
  const asks = countAsks(page);
  const input = await openChat(page);
  const questions = [OPEN, 'Why does he like agentic AI so much?', 'What makes his approach to RAG different?'];
  for (const [i, q] of questions.entries()) {
    await ask(input, q);
    await expect(chat(page).locator('[data-note="resting"]')).toHaveCount(i + 1, { timeout: 10_000 });
  }
  expect(asks()).toBe(2);
  await expect(chat(page).locator('[data-note="resting"]').last()).toContainText('AI is resting for today, quick answers still work.');
  await expect(chat(page).locator('[data-ask-status="resting"]')).toHaveCount(1);
  if (width(info) === 320) await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('low-relevance says nothing on the site covers it and offers the handoff (#185)', async ({ page }, info) => {
  test.skip(!twoWidths(info), 'layout-independent');
  await mockAiFallback(page, 'low-relevance');
  const input = await openChat(page);
  await ask(input, "What's his salary?");
  const note = chat(page).locator('[data-note="nothing"]');
  await expect(note).toContainText('Nothing on this site covers that.', { timeout: 10_000 });
  await note.locator('[data-ask-handoff]').click();
  await expect(page.locator('#contact textarea[name="message"]')).toHaveValue(/What's his salary\?/, { timeout: 5000 });
});

/* ---- #186 language ---- */

test('an answer in Hindi gets lang="hi" and a Show in English toggle; an unknown tag is ignored (#186)', async ({ page }, info) => {
  test.skip(!twoWidths(info), 'layout-independent');
  const bodies = await routeAsk(page, (body) =>
    body.lang === 'hi'
      ? frames(['UrbanCare AI में MedGemma का उपयोग होता है [c:project:urbancare-ai#solution]।'], { lang: 'hi', alt: { en: 'UrbanCare AI uses MedGemma [c:project:urbancare-ai#solution].' } })
      : frames(['UrbanCare AI uses MedGemma [c:project:urbancare-ai#solution].'], { lang: 'xx' }),
  );
  const input = await openChat(page);
  await ask(input, 'UrbanCare AI में उन्होंने क्या बनाया?');
  const hindi = chat(page).locator('[data-ask-answer="ai"]').first();
  await expect(hindi.locator('[lang="hi"]')).toHaveCount(1, { timeout: 10_000 });
  expect(bodies[0].lang).toBe('hi');
  await hindi.locator('[data-ask-english]').click();
  await expect(hindi.locator('[lang="hi"]')).toHaveCount(0);
  await expect(hindi).toContainText('UrbanCare AI uses MedGemma');

  await ask(chat(page).locator('input').first(), OPEN);
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(2, { timeout: 10_000 });
  await expect(chat(page).locator('[lang="xx"]')).toHaveCount(0);
});

/* ---- #190 reduced motion, 320px, the keyboard ---- */

test('under reduced motion an AI answer fetches no Lottie JSON (#190)', async ({ page }, info) => {
  test.skip(!isReduced(info) || (width(info) !== 1440 && width(info) !== 320), 'reduced-motion projects at two widths');
  const lottie: string[] = [];
  page.on('request', (r) => {
    if (/\/lottie\/[^/]+\.json/.test(r.url())) lottie.push(r.url());
  });
  await routeAsk(page, ANSWER);
  const input = await openChat(page);
  await ask(input, OPEN);
  await expect(chat(page).locator('[data-ask-answer="ai"]')).toHaveCount(1, { timeout: 10_000 });
  await ask(input, 'Which projects use Gemini?');
  await expect(chat(page).locator('[data-ask-answer="skill"]')).toHaveCount(1, { timeout: 3000 });
  await page.waitForTimeout(500);
  expect(lottie).toEqual([]);
});

test('320x568: the sheet keeps the field in view with the keyboard up, with no overflow or console errors (#191)', async ({ page }, info) => {
  test.skip(width(info) !== 320, '320px projects');
  const { errors } = collectPageErrors(page);
  await routeAsk(page, ANSWER);
  const input = await openChat(page);
  await ask(input, OPEN);
  await expect(chat(page).locator('[data-ask-answer="ai"] [data-ai-disclosure]')).toHaveCount(1, { timeout: 10_000 });
  await input.focus();
  // An on-screen keyboard shrinks the visual viewport; a shorter viewport stands in for it.
  await page.setViewportSize({ width: 320, height: 300 });
  await page.waitForTimeout(400);
  const box = await chat(page).locator('input').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(300 + 1);
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(errors).toEqual([]);
});

/* ---- the floating dock and the on-screen keyboard ---- */

test('375x812: with the contact Email field focused, the dock does not cover it, and it returns on blur', async ({ page }, info) => {
  test.skip(width(info) !== 375, '375px projects');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/');
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveCount(1, { timeout: 15_000 });
  await expect(dock).not.toHaveAttribute('data-pre-intro', '');

  await page.locator('#contact').scrollIntoViewIfNeeded();
  const email = page.locator('#contact input[name="email"]');
  await email.scrollIntoViewIfNeeded();
  // Park the field where the dock sits: the bottom of the screen.
  await email.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollBy({ top: r.bottom - (window.innerHeight - 40), behavior: 'instant' });
  });
  await email.focus();
  await expect(dock).toHaveAttribute('data-typing', '');
  await expect(dock).toHaveAttribute('data-hidden', '');
  const inner = dock.locator('.dock-inner');
  await inner.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));

  const overlap = await page.evaluate(() => {
    const field = document.querySelector<HTMLElement>('#contact input[name="email"]')!;
    const f = field.getBoundingClientRect();
    const d = document.querySelector<HTMLElement>('[data-dock] .dock-inner')!.getBoundingClientRect();
    const boxes = f.left < d.right && d.left < f.right && f.top < d.bottom && d.top < f.bottom;
    const points = [
      [f.left + 4, f.top + f.height / 2],
      [f.left + f.width / 2, f.top + f.height / 2],
      [f.right - 4, f.top + f.height / 2],
    ];
    const hit = points.some(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-dock]'));
    return { boxes, hit };
  });
  expect(overlap.hit, 'the dock took a click meant for the Email field').toBe(false);
  expect(overlap.boxes, 'the dock overlaps the focused Email field').toBe(false);

  await email.blur();
  await expect(dock).not.toHaveAttribute('data-typing', '');
  await expect(dock).not.toHaveAttribute('data-hidden', '');
});
