import type { Page, TestInfo } from '@playwright/test';
import profile from '../../src/data/profile.json' with { type: 'json' };
import projects from '../../src/data/projects.json' with { type: 'json' };
import { ruleSpoken, spokenText } from '../../src/components/ai/concierge/spoken';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { answer, type AskData } from '../../src/utils/askme';
import { collectPageErrors, expect, test } from './helpers';

/*
 * What the concierge hands a screen reader. The conversation log is silent
 * (aria-live="off"): a live log reads each added bubble with every chip, link
 * and button in it. Each message's words are spoken once, as plain text, from
 * [data-ask-speak], after any status line from [data-ask-announce].
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string };
const projectUse = (info: TestInfo) => info.project.use as ProjectUse;
const width = (info: TestInfo) => projectUse(info).viewport?.width ?? 1280;
const primary = (info: TestInfo) => width(info) === 1440 && projectUse(info).colorScheme === 'dark' && projectUse(info).reducedMotion !== 'reduce';
const twoWidths = (info: TestInfo) => primary(info) || (width(info) === 320 && projectUse(info).colorScheme === 'dark');

const DATA: AskData = { profile, projects };
const OPEN = 'What kind of problems does he seem most curious about?';
const EXP0 = profile.experience[0];
const SRC_EXP = { id: 'exp:0', label: `Experience · ${EXP0.company}`, cls: 'self' as const, target: { kind: 'experience' as const, index: 0 } };
const SRC_UC = { id: 'project:urbancare-ai#solution', label: 'UrbanCare AI · Solution', cls: 'self' as const, target: { kind: 'project' as const, slug: 'urbancare-ai' } };
// Names that belong to a bubble's controls and badges; none of them is part of an answer.
const CONTROLS = /Source \d|Copy as Markdown|Helpful|This is wrong|Regenerate|Show the quick answer|How it works|Privacy|Show in Projects|on GitHub|From the site's data/;

function frames(deltas: string[]): AiFrame[] {
  const cited = [...new Set(deltas.join('').match(/\[c:([^\]]+)\]/g)?.map((m) => m.slice(3, -1)) ?? [])];
  return [
    { type: 'meta', model: 'gemini-test', feature: 'ask', sources: [SRC_EXP, SRC_UC], mode: 'lexical' },
    ...deltas.map((text): AiFrame => ({ type: 'delta', text })),
    { type: 'done', finishReason: 'STOP', cited, dropped: 0, degraded: false },
  ];
}

async function routeAsk(page: Page, reply: AiFrame[]) {
  await page.route(/\/api\/ai\/ask(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'cache-control': 'no-store, no-transform' },
      body: `${reply.map((f) => JSON.stringify(f)).join('\n')}\n`,
    });
  });
}

/**
 * Records, in order, the text each live-region change hands a screen reader: the
 * whole region when it is atomic, else the added nodes. A button or link counts
 * by its aria-label, as it is read. The nearest aria-live decides, so "off" silences.
 */
async function recordSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __speech?: string[] };
    w.__speech = [];
    const LIVE_ROLES = ['status', 'alert', 'log'];
    const liveRoot = (n: Node): Element | null => {
      for (let el: Element | null = n instanceof Element ? n : n.parentElement; el; el = el.parentElement) {
        const live = el.getAttribute('aria-live');
        if (live) return live === 'off' ? null : el;
        if (LIVE_ROLES.includes(el.getAttribute('role') ?? '')) return el;
      }
      return null;
    };
    const read = (n: Node): string => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
      if (!(n instanceof Element) || n.getAttribute('aria-hidden') === 'true') return '';
      const label = n.getAttribute('aria-label');
      if (label && n.matches('button, a')) return ` ${label} `;
      return [...n.childNodes].map(read).join('');
    };
    const atomic = (el: Element) => el.getAttribute('aria-atomic') === 'true' || ['status', 'alert'].includes(el.getAttribute('role') ?? '');
    const push = (s: string) => {
      const t = s.replace(/\s+/g, ' ').trim();
      if (t) w.__speech?.push(t);
    };
    new MutationObserver((records) => {
      const whole = new Set<Element>();
      for (const r of records) {
        const root = liveRoot(r.target);
        if (!root || root.closest('[aria-hidden="true"]')) continue;
        if (atomic(root)) whole.add(root);
        else if (r.type === 'childList') r.addedNodes.forEach((n) => push(read(n)));
        else push(read(r.target));
      }
      whole.forEach((el) => push([...el.childNodes].map(read).join('')));
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

const speech = (page: Page) => page.evaluate(() => (window as Window & { __speech?: string[] }).__speech ?? []);

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
  const launcher = page.locator('[data-ask-launcher]');
  await launcher.focus();
  await launcher.click();
  const input = chat(page).locator('input').first();
  await expect(input).toBeVisible();
  return input;
}

const chat = (page: Page) => page.locator('[data-ask-panel], [data-ask-sheet]').first();

async function ask(input: ReturnType<Page['locator']>, q: string) {
  await input.fill(q);
  await input.press('Enter');
}

const SKIP = 'layout-independent: desktop and the smallest phone';

test('a finished AI answer is spoken once as plain text: no citation labels, no controls, the disclosure once', async ({ page }, info) => {
  test.skip(!twoWidths(info), SKIP);
  const { errors } = collectPageErrors(page);
  await recordSpeech(page);
  await routeAsk(page, frames([`His first listed role is ${EXP0.role} at ${EXP0.company} [c:exp:0]. `, 'UrbanCare AI uses MedGemma [c:project:urbancare-ai#solution].']));
  const input = await openChat(page);
  await ask(input, OPEN);

  const log = chat(page).locator('[role="log"]');
  await expect(log.locator('[data-ask-answer="ai"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(log).toHaveAttribute('aria-live', 'off');
  // The bubble still carries its chips and actions for anyone who goes to them.
  await expect(log.locator('button.ai-cite')).toHaveCount(2);
  await expect(log.getByRole('button', { name: 'Copy as Markdown' })).toHaveCount(1);

  const phrase = `His first listed role is ${EXP0.role} at ${EXP0.company}.`;
  await expect(page.locator('[data-ask-speak]')).toHaveText(`AI-generated, may be wrong. ${phrase} UrbanCare AI uses MedGemma.`);

  await page.waitForTimeout(800);
  const said = await speech(page);
  expect(said.filter((s) => s.includes(phrase)), 'the answer is spoken exactly once').toHaveLength(1);
  expect(said.filter((s) => CONTROLS.test(s)), 'nothing spoken names a control or a source chip').toEqual([]);
  expect(said.join(' ').split('may be wrong').length - 1, 'the AI disclosure is spoken once').toBe(1);
  expect(errors).toEqual([]);
});

test('a quick answer is spoken as plain text, without its project cards or links', async ({ page }, info) => {
  test.skip(!twoWidths(info), SKIP);
  const { errors } = collectPageErrors(page);
  await recordSpeech(page);
  const q = 'Which projects use Gemini?';
  const rule = answer(q, DATA);
  expect(rule.projects.length, 'the rule answer shows project cards').toBeGreaterThan(0);
  const input = await openChat(page);
  await ask(input, q);

  await expect(chat(page).locator(`[role="log"] [data-ask-answer="${rule.intent}"]`)).toHaveCount(1, { timeout: 3000 });
  const expected = spokenText(ruleSpoken({ text: rule.text, intent: rule.intent }));
  expect(expected).not.toContain('**');
  await expect(page.locator('[data-ask-speak]')).toHaveText(expected);

  await page.waitForTimeout(500);
  const said = await speech(page);
  expect(said.filter((s) => s === expected)).toHaveLength(1);
  expect(said.filter((s) => CONTROLS.test(s))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a quick answer standing in for an AI one: the status line first, then why, then the answer', async ({ page }, info) => {
  test.skip(!twoWidths(info), SKIP);
  await recordSpeech(page);
  await routeAsk(page, frames(['He likes many things.']));
  const input = await openChat(page);
  await ask(input, OPEN);

  await expect(chat(page).locator('[data-ask-answer="fallback"][data-note="uncited"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('[data-ask-announce]')).toHaveText('Quick answer shown instead');
  const why = "The AI answer couldn't be tied to this site's content, so here is the quick answer instead.";
  const rule = answer(OPEN, DATA);
  const expected = `${why} ${spokenText(ruleSpoken({ text: rule.text, intent: rule.intent }))}`;
  await expect(page.locator('[data-ask-speak]')).toHaveText(expected);

  const said = await speech(page);
  const status = said.indexOf('Quick answer shown instead');
  expect(status).toBeGreaterThanOrEqual(0);
  expect(said.indexOf(expected)).toBeGreaterThan(status);
  expect(said.filter((s) => CONTROLS.test(s))).toEqual([]);
});
