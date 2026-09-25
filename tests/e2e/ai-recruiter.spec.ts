import type { Page, Request, Route, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import recruiterStore from '../../src/data/ai-generated/recruiter.json' with { type: 'json' };
import type { ExtractResponse, FitResponse, QuestionsResponse } from '../../src/lib/ai/fit';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { aiPost, assertSafeServer, countAiRequests, mockAiFallback, mockAiJson, mockAiStream } from './ai-mocks';
import { collectPageErrors, expect, test } from './helpers';

/*
 * Recruiter suite (#213-#229): entry points and fit:open, the no-AI keyword path,
 * extraction and editable chips, verified rows and gaps, years and logistics
 * from facts, top projects, the skills matrix, export and hand-offs, screening
 * questions, ?lens deep links, the custom brief, the timeline ask, the per-tab
 * cache, and keyboard and mobile behaviour. Every model route is mocked in the
 * browser; the one API-level check runs against the fake model.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string; hasTouch?: boolean };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const height = (info: TestInfo) => projectUse(info).viewport?.height ?? 800;
const isReduced = (info: TestInfo) => projectUse(info).reducedMotion === 'reduce';
const isDark = (info: TestInfo) => projectUse(info).colorScheme !== 'light';
/** Behaviour that doesn't depend on theme or motion runs on two widths in the dark theme with motion on. */
const core = (info: TestInfo) => (width(info) === 1440 || width(info) === 360) && isDark(info) && !isReduced(info);
const one = (info: TestInfo) => width(info) === 1440 && isDark(info) && !isReduced(info);

const LENS_COUNT = Object.keys((recruiterStore as { entries: Record<string, unknown> }).entries).length;

const JD = [
  'Applied AI Engineer',
  'We are hiring an engineer to build LLM agents with LangGraph and React front ends.',
  'Must have: 5+ years Python, vector databases and Kubernetes.',
  'Nice to have: LlamaIndex. Visa sponsorship available. Remote-first team.',
  'Apply to hiring.lead@acme-corp.com',
].join('\n');

const EXP0 = profile.experience[0];
const EXP0_LABEL = `${EXP0.company} · ${EXP0.role}`;

const EXTRACT_OK: ExtractResponse = {
  isJobDescription: true,
  language: 'en',
  title: 'Applied AI Engineer',
  requirements: [
    { text: 'LangGraph agents', kind: 'must', category: 'skill' },
    { text: 'Vector databases', kind: 'must', category: 'skill' },
    { text: 'Kubernetes', kind: 'must', category: 'skill' },
    { text: 'Python', kind: 'nice', category: 'skill' },
    { text: '5+ years Python', kind: 'must', category: 'experience' },
    { text: 'Visa sponsorship available', kind: 'nice', category: 'logistics' },
  ],
  redacted: 1,
};

const FIT_OK: FitResponse = {
  rows: [
    { requirement: 'LangGraph agents', kind: 'must', status: 'evidenced', evidence: [{ id: 'exp:0', quote: 'LangGraph', label: EXP0_LABEL, target: { kind: 'experience', index: 0 } }], source: 'ai' },
    {
      requirement: 'Vector databases',
      kind: 'must',
      status: 'evidenced',
      evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS', label: EXP0_LABEL, target: { kind: 'experience', index: 0 } }],
      synonym: 'Chroma',
      source: 'ai',
    },
    { requirement: 'Kubernetes', kind: 'must', status: 'not-listed', evidence: [], source: 'ai' },
    { requirement: 'Python', kind: 'nice', status: 'evidenced', evidence: [{ id: 'skills:data-science-ml', quote: 'Python', label: 'Skills · Data Science & ML', target: { kind: 'skill', name: 'Python' } }], source: 'ai' },
    // Cites an id the site cannot have: the client drops it (1 of 5 is under the 30% discard line).
    { requirement: 'Rust services', kind: 'nice', status: 'evidenced', evidence: [{ id: 'exp:9', quote: 'Rust' }], source: 'ai' },
  ],
  projects: [
    { slug: 'urbancare-ai', quote: 'AI-Native Clinical Ecosystem for Mechanistic Interpretability', id: 'project:urbancare-ai#tagline' },
    { slug: 'bruhworking-nexusflow', quote: 'Serverless Agent Swarm for Stateful Orchestration', id: 'project:bruhworking-nexusflow#tagline' },
    { slug: 'omni-lab', quote: 'Empirical AI Tutor with Three Specialized Agents', id: 'project:omni-lab#tagline' },
  ],
  rankedBy: 'embedding',
  dropped: 0,
  model: 'gemini-test',
};

/* ---- helpers ---- */

async function prepare(page: Page, opts: { notice?: boolean } = {}) {
  await page.addInitScript((keepNotice) => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
      if (!keepNotice) window.localStorage.setItem('ob-ai-notice', '1');
    } catch {
      /* storage blocked */
    }
  }, opts.notice === true);
}

async function gotoHydrated(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Check fit against your JD' });

async function openFit(page: Page) {
  const trigger = page.locator('#about [data-fit-trigger]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('[data-fit-jd]')).toBeFocused();
}

async function submitJd(page: Page, jd = JD) {
  await page.locator('[data-fit-jd]').fill(jd);
  await page.locator('[data-fit-run]').click();
}

/** Presses Tab until the focused element matches `selector` (keyboard-only navigation). */
async function tabTo(page: Page, selector: string, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${selector}`);
}

/** jd-* requests only; GET /api/ai/health from AiNotice is not part of the check. */
function countJdRequests(page: Page): () => number {
  let n = 0;
  page.on('request', (req) => {
    if (/\/api\/ai\/jd-/.test(new URL(req.url()).pathname)) n += 1;
  });
  return () => n;
}

async function mockFit(page: Page, body: unknown, seen?: Request[]) {
  await page.route(/\/api\/ai\/jd-fit(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    seen?.push(route.request());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Loads the page and runs the full mocked AI path with 'Skip review' on. */
async function runAiCheck(page: Page) {
  await mockAiJson(page, 'jd-extract', EXTRACT_OK);
  await mockFit(page, FIT_OK);
  // Its callers never navigated before: the helper opened the sheet on about:blank.
  await gotoHydrated(page);
  await openFit(page);
  await page.locator('[data-fit-skip-review]').check();
  await submitJd(page);
  await expect(page.locator('[data-fit-results="done"]')).toBeVisible();
}

async function grantClipboard(page: Page, info: TestInfo) {
  const origin = new URL(info.project.use.baseURL ?? page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.beforeEach(async ({ request }) => {
  await assertSafeServer(request);
});

/* ---- #213 entry points, fit:open and the lazy shell ---- */

test.describe('entry points', () => {
  test('no /api/ai request on load; the trigger opens a sheet (phone) or modal with focus in the textarea and AiNotice first', async ({ page }, info) => {
    test.skip(!(width(info) === 320 || width(info) === 1440) || !isDark(info), '320 and 1440, dark');
    await prepare(page, { notice: true });
    const count = countAiRequests(page);
    await gotoHydrated(page);
    await page.locator('#about').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    expect(count(), 'requests on load').toBe(0);

    await openFit(page);
    await expect(page.locator('[data-dialog-root]')).toHaveAttribute('data-variant', width(info) < 640 ? 'sheet' : 'modal');
    await expect(sheet(page).locator('[data-ai-notice]')).toBeVisible();
    const box = await sheet(page).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width(info));
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    for (const sel of ['[data-fit-trigger]', '[data-pitch-trigger]']) {
      const b = await page.locator(`#about ${sel}`).boundingBox();
      expect(b!.height, sel).toBeGreaterThanOrEqual(44);
    }
  });

  test("a 'fit:open' queued before the trigger mounted opens the sheet with its JD", async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await page.addInitScript(() => {
      window.sessionStorage.setItem('ob-ai-pending', JSON.stringify({ fit: { req: { jd: 'Python and LangGraph' }, at: Date.now() } }));
    });
    await gotoHydrated(page);
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('[data-fit-jd]')).toHaveValue('Python and LangGraph');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    // A live event opens it again.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('ob:fit:open', { detail: { jd: 'React and Gemini' } })));
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('[data-fit-jd]')).toHaveValue('React and Gemini');
  });
});

/* ---- #214 the no-key lexical path ---- */

test.describe('lexical-only path', () => {
  test('with the AI falling back, the keyword table and fact rows show and there is no error UI', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await mockAiFallback(page, 'quota');
    await gotoHydrated(page);
    await openFit(page);
    await submitJd(page);
    await expect(page.locator('[data-fit-results="lexical"]')).toBeVisible();
    const matrix = page.locator('[data-fit-matrix]');
    await expect(matrix).toContainText('Exact keyword matches (no AI)');
    await expect(matrix.locator('[data-fit-matrix-row="LangGraph"]')).toHaveCount(1);
    await expect(matrix.locator('[data-fit-matrix-row="ReAct"]')).toHaveCount(0);
    await expect(page.locator('[data-ai-error]')).toHaveCount(0);
    await expect(page.locator('[data-fit-fact="visa"]')).toContainText('Not stated on this site');
  });
});

/* ---- #215, #216 extraction, refusal and the chips ---- */

test.describe('extraction and chips', () => {
  test('keyboard only: remove a chip, add one, run; the match body reflects both edits', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    const seen: Request[] = [];
    await mockAiJson(page, 'jd-extract', EXTRACT_OK);
    await mockFit(page, FIT_OK, seen);
    await gotoHydrated(page);
    await openFit(page);
    await page.keyboard.insertText(JD);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('[data-fit-results="review"]')).toBeVisible();
    await expect(page.locator('[data-fit-chip]')).toHaveCount(6);

    await tabTo(page, '[data-fit-chip-toggle]');
    await page.keyboard.press('Backspace');
    await expect(page.locator('[data-fit-chip]')).toHaveCount(5);
    await tabTo(page, '[data-fit-add]');
    await page.keyboard.type('Rust services');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-fit-chip]')).toHaveCount(6);
    await tabTo(page, '[data-fit-match]');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-fit-results="done"]')).toBeVisible();

    const body = JSON.parse(seen[0].postData() ?? '{}') as { requirements: { text: string }[] };
    const texts = body.requirements.map((r) => r.text);
    expect(texts).not.toContain('LangGraph agents');
    expect(texts).toContain('Rust services');
    expect(texts).toHaveLength(6);
  });

  test("text that isn't a JD gets the refusal and a link to the assistant, and no match call", async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    const fitCalls = countJdRequests(page);
    await mockAiJson(page, 'jd-extract', { isJobDescription: false, message: "This doesn't look like a job description" });
    await gotoHydrated(page);
    await openFit(page);
    await page.locator('[data-fit-skip-review]').check();
    await submitJd(page, 'Dear Sam, lunch on Friday? Bring the slides.');
    await expect(page.locator('[data-fit-refused]')).toContainText("This doesn't look like a job description");
    await expect(page.locator('[data-fit-ask-assistant]')).toBeVisible();
    expect(fitCalls()).toBe(1);
  });

  test('a non-English JD shows the English gloss beside the original', async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await mockAiJson(page, 'jd-extract', {
      isJobDescription: true,
      language: 'de',
      title: 'KI-Ingenieur',
      requirements: [{ text: 'Erfahrung mit LangGraph', kind: 'must', category: 'skill', gloss: 'Experience with LangGraph' }],
      redacted: 0,
    } satisfies ExtractResponse);
    await gotoHydrated(page);
    await openFit(page);
    await submitJd(page, 'KI-Ingenieur\nErfahrung mit LangGraph');
    await expect(page.locator('[data-fit-chip]').first()).toContainText('Experience with LangGraph');
  });
});

/* ---- #217-#219 verified rows, gaps, years and logistics ---- */

test.describe('verified rows', () => {
  test('rows, the band, gaps and fact rows; a nonexistent id is dropped; one summary is announced', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await runAiCheck(page);
    const rows = page.locator('[data-fit-row]');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('[data-fit-row]', { hasText: 'Rust services' })).toHaveCount(0);
    await expect(page.locator('[data-fit-row="not-listed"]')).toContainText('Kubernetes');
    await expect(page.locator('[data-fit-row="not-listed"]')).toContainText('Not listed on this site');
    await expect(page.locator('[data-fit-synonym]')).toContainText('mapped by AI');
    // Computed in code: 2+2+0+1 of 7, with a must-have missing.
    await expect(page.locator('[data-fit-band]')).toHaveAttribute('data-fit-band', 'Partial');
    await expect(page.locator('[data-fit-announcer]')).toHaveText('Partial match: 3 evidenced, 0 adjacent, 1 not listed.');

    const years = page.locator('[data-fit-fact="years"]');
    for (const e of profile.experience) await expect(years).toContainText(e.company);
    const yearsText = (await years.textContent()) ?? '';
    expect(yearsText).not.toContain('5 years');
    expect(yearsText).not.toMatch(/\b\d+\s*(?:years?|months?)\s+(?:in total|total|combined)\b/i);
    await expect(page.locator('[data-fit-fact="visa"]')).toContainText('Not stated on this site');
    await expect(page.locator('[data-fit-fact="visa"] [data-fit-ask-fact]')).toBeVisible();
  });

  test("an evidence chip closes the sheet and moves to that role; 'Ask about these gaps' prefills exactly the gaps", async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await runAiCheck(page);
    await page.locator('[data-fit-row="evidenced"] [data-fit-evidence="exp:0"]').first().click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('#experience [data-exp-index="0"]')).toHaveAttribute('data-ai-spotlight', '', { timeout: 5000 });

    await openFit(page);
    await page.locator('[data-fit-ask-gaps]').click();
    await expect(sheet(page)).toBeHidden();
    const message = page.locator('#contact textarea[name="message"]');
    await expect(message).toHaveValue(/- Kubernetes/);
    const listed = ((await message.inputValue()).match(/^- .+$/gm) ?? []).map((l) => l.slice(2));
    expect(listed).toEqual(['Kubernetes']);
  });

  test("more than 30% unverifiable: the keyword table stays with a 'couldn't verify' note", async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await mockAiJson(page, 'jd-extract', EXTRACT_OK);
    await mockFit(page, { ...FIT_OK, rows: FIT_OK.rows.map((r) => ({ ...r, evidence: [{ id: 'exp:9', quote: 'x' }] })) });
    await gotoHydrated(page);
    await openFit(page);
    await page.locator('[data-fit-skip-review]').check();
    await submitJd(page);
    await expect(page.locator('[data-fit-results="lexical"]')).toBeVisible();
    await expect(page.locator('[data-ai-error="unverified"]')).toContainText("Couldn't verify");
    await expect(page.locator('[data-fit-matrix-row="LangGraph"]')).toHaveCount(1);
  });
});

/* ---- #220, #221 top projects and the matrix ---- */

test.describe('projects and matrix', () => {
  test('three project cards with reasons; Show in Projects opens the project', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await runAiCheck(page);
    const cards = page.locator('[data-fit-project]');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('AI-Native Clinical Ecosystem');
    await page.evaluate(() => {
      const w = window as Window & { __opened?: string[] };
      w.__opened = [];
      window.addEventListener('ob:project:open', (e) => w.__opened!.push((e as CustomEvent<{ slug: string }>).detail.slug));
    });
    await cards.first().getByRole('button', { name: 'Show in Projects' }).click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual(['urbancare-ai']);
  });

  test('the matrix has scoped headers, a mapped-by-AI row, and scrolls in its own wrapper', async ({ page }, info) => {
    test.skip(!(width(info) === 320 || width(info) === 1440) || !isDark(info) || isReduced(info), '320 and 1440');
    await prepare(page);
    await runAiCheck(page);
    const matrix = page.locator('[data-fit-matrix]');
    await expect(matrix.locator('th[scope="col"]')).toHaveCount(5);
    expect(await matrix.locator('th[scope="row"]').count()).toBeGreaterThan(0);
    await expect(matrix.locator('[data-fit-matrix-row="Chroma"][data-mapped="ai"]')).toContainText('mapped by AI');
    const wrapper = matrix.locator('[data-fit-matrix-scroll]');
    expect(await wrapper.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    expect(await wrapper.evaluate((el) => el.querySelector('section') === null && el.closest('main section[id]') === null)).toBe(true);
    // Nothing else in the sheet is wider than the sheet. Clipped content doesn't count:
    // text inside an .sr-only live region (a 1px clipped box) and Button's hover shine,
    // which sweeps past the button's edge inside its overflow-clip layer.
    const overflow = await sheet(page).evaluate((panel) => {
      const limit = panel.getBoundingClientRect().right + 1;
      return Array.from(panel.querySelectorAll('*'))
        .filter(
          (el) =>
            !el.closest('[data-fit-matrix-scroll]') &&
            !el.closest('.sr-only') &&
            !el.closest('[data-button] > [aria-hidden="true"]') &&
            el.getBoundingClientRect().right > limit,
        )
        .map((el) => el.tagName)
        .slice(0, 5);
    });
    expect(overflow).toEqual([]);
  });
});

/* ---- #222, #223 export and hand-offs ---- */

test.describe('export and hand-offs', () => {
  test('Copy as Markdown carries the disclosure and /cv; print shows the table without the chrome', async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await grantClipboard(page, info);
    await runAiCheck(page);
    await page.locator('[data-fit-export]').getByRole('button', { name: 'Copy as Markdown' }).click();
    const md = await clipboard(page);
    expect(md).toContain('AI-generated');
    expect(md).toMatch(/https:\/\/www\.basuoikantik\.in\/cv/);
    expect(md).toContain('Checked against site data built');

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-fit-table]')).toBeVisible();
    await expect(page.locator('#site-nav')).toBeHidden();
    await expect(page.locator('[data-dock]')).toBeHidden();
    await expect(page.locator('[data-fit-export]')).toBeHidden();
    await info.attach('fit-report-print.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.emulateMedia({ media: 'screen' });
  });

  test('with the AI down all three hand-offs work: prefill <=2000 chars, short blurb <=280, the URL gains only ?tech', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await grantClipboard(page, info);
    await mockAiFallback(page, 'no-key');
    await gotoHydrated(page);
    await openFit(page);
    await submitJd(page);
    await expect(page.locator('[data-fit-results="lexical"]')).toBeVisible();

    await page.locator('[data-fit-blurb]').getByRole('button', { name: 'Copy short blurb' }).click();
    const short = await clipboard(page);
    expect(short.length).toBeGreaterThan(0);
    expect(short.length).toBeLessThanOrEqual(280);
    expect(short).toContain('basuoikantik.in');

    await page.locator('[data-fit-reach-out]').click();
    await expect(sheet(page)).toBeHidden();
    const message = page.locator('#contact textarea[name="message"]');
    await expect(message).toHaveValue(/fit check/);
    expect((await message.inputValue()).length).toBeLessThanOrEqual(2000);
    await expect(page.locator('#contact [name="subject"]')).toHaveValue('Portfolio inquiry: Applied AI Engineer');

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await openFit(page);
    const before = new URL(page.url()).searchParams;
    expect([...before.keys()]).toEqual([]);
    await page.evaluate(() => {
      const w = window as Window & { __focused?: string[] };
      w.__focused = [];
      window.addEventListener('ob:skill:focus', (e) => w.__focused!.push((e as CustomEvent<{ name: string }>).detail.name));
    });
    await page.locator('[data-fit-show-matches]').click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => [...new URL(page.url()).searchParams.keys()], { timeout: 5000 }).toEqual(['tech']);
    expect(await page.evaluate(() => (window as Window & { __focused?: string[] }).__focused?.length ?? 0)).toBeGreaterThan(0);
  });
});

/* ---- #224 screening questions ---- */

test.describe('screening questions', () => {
  test('an unknown id or an unsupported number is dropped; Copy all copies the rest', async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await grantClipboard(page, info);
    const kept = 'What made you pick LangGraph for the multi-agent work?';
    await mockAiJson(page, 'jd-questions', {
      questions: [
        { question: kept, id: 'exp:0', label: EXP0_LABEL },
        { question: 'How did you get 97% retrieval accuracy?', id: 'exp:0', label: EXP0_LABEL },
        { question: 'Tell me about the Kubernetes cluster you ran.', id: 'exp:9', label: 'x' },
      ],
    } satisfies QuestionsResponse);
    await runAiCheck(page);
    await page.locator('[data-fit-questions-run]').click();
    await expect(page.locator('[data-fit-question]')).toHaveCount(1);
    await expect(page.locator('[data-fit-question]')).toContainText(kept);
    await page.locator('[data-fit-questions]').getByRole('button', { name: 'Copy all' }).click();
    expect(await clipboard(page)).toBe(`1. ${kept}`);
  });
});

/* ---- #225 lenses and ?lens links ---- */

test.describe('lens pitches', () => {
  test('/?lens=llm-agents opens the pitch without the intro loader and makes no request; an unknown lens is ignored', async ({ page }, info) => {
    test.skip(LENS_COUNT === 0, 'no lens entries generated (npm run ai:generate)');
    test.skip(Boolean(process.env.PW_BASE_URL), 'a deployed build may hide unreviewed lenses (production flag)');
    test.skip(!(width(info) === 320 || width(info) === 1440) || !isDark(info), '320 and 1440, dark');
    const count = countAiRequests(page);
    await page.goto('/?lens=llm-agents');
    expect(await page.evaluate(() => document.documentElement.dataset.intro)).toBe('seen');
    const pitch = page.locator('[data-lens-pitch="llm-agents"]');
    await expect(pitch).toBeVisible({ timeout: 15_000 });
    await expect(pitch.locator('[data-lens-text="plain"]')).not.toBeEmpty();
    await expect(pitch.locator('[data-lens-provenance]')).not.toBeEmpty();
    // Arrow keys move between the versions.
    await pitch.locator('[data-segmented="audience"] [role="radio"][aria-checked="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(pitch.locator('[data-lens-text="manager"]')).toBeVisible();
    expect(count(), 'the pitch is precomputed').toBe(0);
    await page.keyboard.press('Escape');
    await expect(pitch).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.has('lens')).toBe(false);

    await page.goto('/?lens=nope');
    await expect(page.locator('html')).toHaveClass(/\bhydrated\b/, { timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-lens-pitch]')).toHaveCount(0);
  });

  test('chips cover only the lenses the store backs; the 30-second pitch button opens one', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    test.skip(Boolean(process.env.PW_BASE_URL), 'a deployed build may hide unreviewed lenses (production flag)');
    await prepare(page);
    await gotoHydrated(page);
    await page.locator('#about [data-at-a-glance]').scrollIntoViewIfNeeded();
    await expect(page.locator('#about [data-lens-chip]')).toHaveCount(LENS_COUNT, { timeout: 10_000 });
    await page.locator('#about [data-pitch-trigger]').click();
    await expect(page.locator('[data-lens-pitch]')).toBeVisible();
  });
});

/* ---- #226 the custom brief ---- */

test.describe('custom brief', () => {
  test('only verified claims render; a discard shows the nearest preset lens', async ({ page }, info) => {
    test.skip(!one(info), 'one project');
    await prepare(page);
    await mockAiJson(page, 'brief', {
      claims: [
        { text: 'He builds multi-agent systems on LangGraph.', evidence: [{ id: 'exp:0', quote: 'LangGraph', label: EXP0_LABEL, target: { kind: 'experience', index: 0 } }] },
        { text: 'He tuned Chroma and FAISS retrieval.', evidence: [{ id: 'exp:0', quote: 'Chroma/FAISS', label: EXP0_LABEL, target: { kind: 'experience', index: 0 } }] },
        { text: 'He ran RLHF evaluations of GPT and Claude outputs.', evidence: [{ id: 'exp:1', quote: 'RLHF evaluations' }] },
        { text: 'He led a Kubernetes platform team.', evidence: [{ id: 'exp:9', quote: 'Kubernetes' }] },
      ],
      projects: ['urbancare-ai'],
      dropped: 0,
      model: 'gemini-test',
    });
    await gotoHydrated(page);
    await page.locator('#about [data-pitch-trigger]').scrollIntoViewIfNeeded();
    await page.locator('#about [data-pitch-trigger]').click();
    await page.locator('[data-role-brief-toggle]').click();
    const input = page.locator('[data-role-brief-input]');
    await expect(input).toHaveAttribute('maxlength', '80');
    await input.fill('Applied AI engineer, agents');
    await page.locator('[data-role-brief-run]').click();
    await expect(page.locator('[data-role-brief-claim]')).toHaveCount(3);
    await expect(page.locator('[data-role-brief-result]')).not.toContainText('Kubernetes');
  });

  test('a discarded brief shows the nearest preset lens', async ({ page }, info) => {
    test.skip(LENS_COUNT === 0 || Boolean(process.env.PW_BASE_URL), 'needs lens entries a local build shows');
    test.skip(!one(info), 'one project');
    await prepare(page);
    await mockAiFallback(page, 'unverified');
    await gotoHydrated(page);
    await page.locator('#about [data-pitch-trigger]').scrollIntoViewIfNeeded();
    await page.locator('#about [data-pitch-trigger]').click();
    await page.locator('[data-role-brief-toggle]').click();
    await page.locator('[data-role-brief-input]').fill('Data Analyst');
    await page.locator('[data-role-brief-run]').click();
    await expect(page.locator('[data-role-brief-fallback]')).toBeVisible();
    await expect(page.locator('[data-lens-pitch="data-science"]')).toBeVisible();
  });

  test('the server caps the title at 80 characters (fake model)', async ({ request }, info) => {
    test.skip(!one(info), 'an API check');
    const res = await aiPost(request, 'brief', { title: 'x'.repeat(81) });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ mode: 'fallback', reason: 'too-long' });
    // The other recruiter routes exist and refuse cheaply too.
    for (const path of ['jd-extract', 'jd-fit', 'jd-questions']) {
      const bad = await aiPost(request, path, { nope: true });
      expect(await bad.json(), path).toEqual({ mode: 'fallback', reason: 'bad-request' });
    }
  });
});

/* ---- #227 ask about this role ---- */

test.describe('timeline ask', () => {
  test('every card carries its anchor; the 44px link scopes the assistant to that role', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    const asked: string[] = [];
    await mockAiStream(page, 'ask', [
      { type: 'meta', model: 'gemini-test', feature: 'ask', sources: [], mode: 'lexical' },
      { type: 'delta', text: 'A scoped answer.' },
      { type: 'done', finishReason: 'STOP', cited: [], dropped: 0, degraded: false },
    ] satisfies AiFrame[]);
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/ai/ask') asked.push(req.postData() ?? '');
    });
    await gotoHydrated(page);
    const cards = page.locator('#experience article[data-role-card]');
    await expect(cards).toHaveCount(profile.experience.length);
    for (let i = 0; i < profile.experience.length; i++) await expect(cards.nth(i)).toHaveAttribute('data-exp-index', String(i));

    await page.evaluate(() => {
      const w = window as Window & { __asks?: unknown[] };
      w.__asks = [];
      window.addEventListener('ob:ask:open', (e) => w.__asks!.push((e as CustomEvent).detail));
    });
    const mindrift = page.locator('#experience [data-exp-index="1"]');
    const toggle = mindrift.locator('[data-ask-role-toggle]');
    await toggle.scrollIntoViewIfNeeded();
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(mindrift.locator('[data-ask-role-starter]')).toHaveCount(3);
    await mindrift.locator('[data-ask-role-starter]').first().click();
    const detail = (await page.evaluate(() => (window as Window & { __asks?: unknown[] }).__asks?.[0])) as { scope?: { experience?: number }; send?: boolean };
    expect(detail?.scope).toEqual({ experience: 1 });
    expect(detail?.send).toBe(true);
    // End to end through the assistant (ai-concierge consumes ask:open).
    await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect((JSON.parse(asked[0]) as { scope?: unknown }).scope).toEqual({ experience: 1 });
  });
});

/* ---- #213 the per-tab cache ---- */

test.describe('cache', () => {
  test('the same JD twice sends nothing the second time; after Clear my data it sends one', async ({ page }, info) => {
    test.skip(!core(info), 'two widths are enough');
    await prepare(page);
    await mockAiJson(page, 'jd-extract', EXTRACT_OK);
    const count = countJdRequests(page);
    await gotoHydrated(page);
    await openFit(page);
    await submitJd(page);
    await expect(page.locator('[data-fit-results="review"]')).toBeVisible();
    expect(count()).toBe(1);
    await submitJd(page);
    await expect(page.locator('[data-fit-results="review"]')).toBeVisible();
    await page.waitForTimeout(300);
    expect(count()).toBe(1);
    await page.locator('[data-fit-clear]').click();
    await expect(page.locator('[data-fit-jd]')).toHaveValue('');
    await submitJd(page);
    await expect(page.locator('[data-fit-results="review"]')).toBeVisible();
    expect(count()).toBe(2);
  });
});

/* ---- #228 keyboard, mobile and loading states ---- */

test.describe('keyboard and mobile', () => {
  test('320x568, reduced motion: Tab runs input then Run; Esc aborts the request, one summary is announced, CLS stays 0 while loading', async ({ page }, info) => {
    test.skip(!(width(info) === 320 && height(info) === 568 && isReduced(info)), '320x568 with reduced motion');
    const errors = collectPageErrors(page, { allow: [/jd-extract/, /ERR_ABORTED|aborted/i] });
    await prepare(page);
    await page.addInitScript(() => {
      const w = window as Window & { __fitCls?: number; __fitSaid?: string[] };
      w.__fitCls = 0;
      w.__fitSaid = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput && document.querySelector('[data-fit-results="extracting"]')) w.__fitCls! += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new MutationObserver(() => {
        const text = document.querySelector('[data-fit-announcer]')?.textContent?.trim();
        if (text && w.__fitSaid![w.__fitSaid!.length - 1] !== text) w.__fitSaid!.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const aborted: string[] = [];
    page.on('requestfailed', (req) => {
      if (/\/api\/ai\/jd-extract/.test(req.url())) aborted.push(req.failure()?.errorText ?? 'failed');
    });
    await page.route(/\/api\/ai\/jd-extract(?:\?.*)?$/, async (route: Route) => {
      await new Promise((r) => setTimeout(r, 8000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXTRACT_OK) }).catch(() => {});
    });
    await gotoHydrated(page);
    await openFit(page);
    await page.keyboard.insertText(JD);
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-fit-run]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('[data-fit-results="extracting"]')).toBeVisible();
    await expect(page.locator('[data-fit-results]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-ai-thinking]')).toContainText('Reading the JD');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as Window & { __fitCls?: number }).__fitCls)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-fit-results="lexical"]')).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    await expect.poll(() => aborted.length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const said = await page.evaluate(() => (window as Window & { __fitSaid?: string[] }).__fitSaid);
    expect(said).toHaveLength(1);
    expect(said![0]).toMatch(/^Check stopped\. \d+ exact keyword match/);

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('#about [data-fit-trigger]')).toBeFocused();
    expect(errors.errors.filter((e) => !/jd-extract/.test(e))).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
