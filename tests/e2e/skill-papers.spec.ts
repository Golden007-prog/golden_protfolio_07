import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

/*
 * Research papers in the skill dialog. The citations came from Gemini's free text,
 * which pointed titles at unrelated arXiv IDs and printed its own notes as authors;
 * they are now rebuilt from registry records (scripts/verify-skill-papers.mjs). These
 * are data checks, so one project runs them.
 */

const PROJECT = '1440x900-dark-motion';

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== PROJECT, `data checks run on ${PROJECT} only`);
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
});

const paperRow = (page: Page, title: string) => page.locator('[data-dialog-root] [data-skill-modal] a[href]', { hasText: title });

test('Mem0 under performance-tuning opens its own arXiv record, with its real authors', async ({ page }) => {
  await page.goto('/?skill=performance-tuning');
  const row = paperRow(page, 'Mem0: Building Production-Ready AI Agents');
  await expect(row).toHaveAttribute('href', 'https://arxiv.org/abs/2504.19413');
  await expect(row).toContainText('Prateek Chhikara');
});

test('Gemini 1.5 under the featured Gemini skill opens the Gemini 1.5 paper, not Gemma', async ({ page }) => {
  await page.goto('/?skill=gemini');
  const row = paperRow(page, 'Gemini 1.5: Unlocking multimodal understanding');
  await expect(row).toHaveAttribute('href', 'https://arxiv.org/abs/2403.05530');
});

test('a generator note in a write-up never renders as an author line', async ({ page }) => {
  await page.route('**/data/skills/multi-agent-orchestration.json', (route) =>
    route.fulfill({
      json: {
        name: 'Multi-agent orchestration',
        category: 'AI/ML',
        researchPapers: [
          {
            title: 'The Orchestration of Multi-Agent Systems',
            url: 'https://arxiv.org/abs/2601.13671',
            authors: 'Various (specific authors not highlighted in snippet)',
          },
          { title: 'A paper with real authors', url: 'https://arxiv.org/abs/2511.15755', authors: 'Philip Drammeh' },
        ],
      },
    }),
  );
  await page.goto('/?skill=multi-agent-orchestration');
  const noted = paperRow(page, 'The Orchestration of Multi-Agent Systems');
  await expect(noted).toBeVisible();
  await expect(noted).not.toContainText('snippet');
  await expect(paperRow(page, 'A paper with real authors')).toContainText('Philip Drammeh');
});
