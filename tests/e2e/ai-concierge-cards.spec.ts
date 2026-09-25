import type { Locator, Page, TestInfo } from '@playwright/test';
import type { AiFrame } from '../../src/lib/ai/protocol';
import { assertSafeServer, mockAiFallback } from './ai-mocks';
import { collectPageErrors, expect, test } from './helpers';

/*
 * Project cards inside a concierge answer at 320px. A card's nowrap title used to
 * set the width of the cards' grid track ('Bruhworking — NexusFlow' is about 175px
 * of text), so at 320 to about 350px every card ran past the bubble's border and
 * the log panned sideways. Both bubble kinds render cards: an AI answer citing
 * projects, and the rule answer.
 */

type ProjectUse = { viewport?: { width: number } | null; reducedMotion?: string };
const use = (info: TestInfo) => info.project.use as ProjectUse;

const PROJECT_SOURCES = [
  { id: 'project:urbancare-ai#summary', label: 'UrbanCare AI · Summary', slug: 'urbancare-ai' },
  { id: 'project:bruhworking-nexusflow#summary', label: 'Bruhworking — NexusFlow · Summary', slug: 'bruhworking-nexusflow' },
  { id: 'project:vyapar-gyan#summary', label: 'Vyapar-Gyan · Summary', slug: 'vyapar-gyan' },
];

const AI_ANSWER: AiFrame[] = [
  {
    type: 'meta',
    model: 'gemini-test',
    feature: 'ask',
    sources: PROJECT_SOURCES.map((s) => ({ id: s.id, label: s.label, cls: 'self' as const, target: { kind: 'project' as const, slug: s.slug } })),
    retrieval: [],
    mode: 'lexical',
  },
  { type: 'delta', text: `UrbanCare AI runs on Gemini [c:${PROJECT_SOURCES[0].id}]. ` },
  { type: 'delta', text: `NexusFlow uses Gemini too [c:${PROJECT_SOURCES[1].id}]. ` },
  { type: 'delta', text: `So does Vyapar-Gyan [c:${PROJECT_SOURCES[2].id}].` },
  { type: 'done', finishReason: 'STOP', cited: PROJECT_SOURCES.map((s) => s.id), dropped: 0, degraded: false },
];

async function openChat(page: Page): Promise<Locator> {
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
  // On the shortest phones the dock stays tucked at the top of the page; focus brings it back.
  const launcher = page.locator('[data-ask-launcher]');
  await launcher.focus();
  await launcher.click();
  const input = page.locator('[data-ask-panel], [data-ask-sheet]').first().locator('input').first();
  await expect(input).toBeVisible();
  return input;
}

/** How far any card crosses its bubble's border, and how far the log pans sideways. */
function measure(answer: Locator) {
  return answer.evaluate((el) => {
    const bubble = (el.firstElementChild as HTMLElement).getBoundingClientRect();
    const cards = [...el.querySelectorAll<HTMLElement>('[data-ask-project]')].map((c) => c.getBoundingClientRect());
    const log = el.closest<HTMLElement>('[data-ask-log]');
    return {
      cards: cards.length,
      overflow: Math.max(0, ...cards.map((c) => c.right - bubble.right), ...cards.map((c) => bubble.left - c.left)),
      pan: log ? log.scrollWidth - log.clientWidth : 0,
    };
  });
}

test.beforeEach(async ({ request }, info) => {
  test.skip(use(info).viewport?.width !== 320 || use(info).reducedMotion === 'reduce', '320px layout, one motion setting');
  await assertSafeServer(request);
});

test('320px: project cards in an AI answer stay inside the bubble and the log does not pan', async ({ page }) => {
  const { errors } = collectPageErrors(page);
  await page.route(/\/api\/ai\/ask(?:\?.*)?$/, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          headers: { 'cache-control': 'no-store, no-transform', 'x-ai-model': 'gemini-test' },
          body: `${AI_ANSWER.map((f) => JSON.stringify(f)).join('\n')}\n`,
        })
      : route.fallback(),
  );
  const input = await openChat(page);
  await input.fill('What kind of problems does he seem most curious about?');
  await input.press('Enter');
  const answer = page.locator('[data-ask-log] [data-ask-answer="ai"][data-status="done"]').last();
  await expect(answer.locator('[data-ask-project]')).toHaveCount(3, { timeout: 10_000 });
  const m = await measure(answer);
  expect(m.overflow, 'cards cross the bubble border by').toBeLessThanOrEqual(0.5);
  expect(m.pan, 'the log pans sideways by').toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('320px: project cards in a rule answer stay inside the bubble and the log does not pan', async ({ page }) => {
  const { errors } = collectPageErrors(page);
  await mockAiFallback(page, 'low-relevance');
  const input = await openChat(page);
  await input.fill('Which of his projects use Gemini and what did he build with it?');
  await input.press('Enter');
  const answer = page.locator('[data-ask-log] [data-source="rules"]').filter({ has: page.locator('[data-ask-project]') }).last();
  await expect(answer.locator('[data-ask-project]').first()).toBeVisible({ timeout: 10_000 });
  const m = await measure(answer);
  expect(m.cards).toBeGreaterThan(0);
  expect(m.overflow, 'cards cross the bubble border by').toBeLessThanOrEqual(0.5);
  expect(m.pan, 'the log pans sideways by').toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
