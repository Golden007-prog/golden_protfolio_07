import type { TestInfo } from '@playwright/test';
import lottieWeb from 'lottie-web/package.json' with { type: 'json' };
import { expect, test } from './helpers';

/*
 * The Lottie player chunk carries lottie-web's light engine and nothing else.
 * lottie-react's index re-exports three players, each on its own lottie-web build,
 * and a namespace import('lottie-react') once shipped all three (745 kB, 18% run).
 * src/lib/lottie-player.test.ts holds the source side; this reads what a build serves.
 *
 * Markers that survive minification: each engine sets `.version = "<lottie-web version>"`
 * once (a property name, never mangled), and only the full and svg engines carry the
 * expression runtime, whose $bm_* helpers sit in an eval scope the minifier leaves
 * alone. Function names are no marker: the light build has no eval, so its
 * registerRenderer is mangled while the other two keep theirs.
 */

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; colorScheme?: string };

function isTheOneProject(info: TestInfo): boolean {
  const use = info.project.use as ProjectUse;
  return use.reducedMotion !== 'reduce' && use.viewport?.width === 1440 && use.colorScheme !== 'light';
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the home page loads one lottie-web engine, the light build', async ({ page }, info) => {
  test.skip(!isTheOneProject(info), 'one full-motion desktop project is enough');
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('ob-seen-loader-v2', '1');
    } catch {
      /* storage blocked */
    }
  });
  const scripts: Promise<string>[] = [];
  page.on('response', (res) => {
    if (res.request().resourceType() === 'script') scripts.push(res.text().catch(() => ''));
  });

  await page.goto('/');
  // The hero icons load with lazy='idle', so the player arrives once the main thread is idle.
  await expect(page.locator('#hero [data-lottie][data-lottie-phase="ready"]').first()).toBeAttached({ timeout: 15_000 });

  const player = (await Promise.all(scripts)).filter((body) => body.includes('bodymovin'));
  const count = (re: RegExp) => player.reduce((n, body) => n + (body.match(re)?.length ?? 0), 0);
  const engine = new RegExp(`\\.version\\s*=\\s*["']${escapeRegExp(lottieWeb.version)}["']`, 'g');
  expect(count(engine), 'lottie-web engines loaded').toBe(1);
  expect(count(/\$bm_mul\b/g), 'expression runtime (full or svg engine)').toBe(0);
});
