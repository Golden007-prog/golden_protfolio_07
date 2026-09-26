#!/usr/bin/env node
// Opens every credential in src/data/certifications.json in a fresh, logged-out
// browser and checks that the issuer's public page shows his name and the title.
//   fail: the url is not an allowed credential link, the page ends up on another
//         host (a login wall), it answers 4xx/5xx, or the name or the title is
//         missing after one retry
// The title check is by words (60% of the title's words of four letters or more),
// because issuer pages restyle punctuation ('pK–12', '&'). Exits 1 when anything
// failed, so it can gate CI. Needs the Playwright Chromium build
// (npx playwright install chromium).
//
//   node scripts/verify-credentials.mjs                  every credential
//   node scripts/verify-credentials.mjs claude-101 ...   only these ids
//   node scripts/verify-credentials.mjs --json out.json  also write the results

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { isAllowedCredentialUrl, parseCertifications } from '../src/lib/certifications.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/data/certifications.json');
const NAME = /oikantik\s+basu/i;
const CONCURRENCY = 4;
const NAV_TIMEOUT_MS = 45_000;
// Issuer pages render client-side; wait this long for the name to appear.
const RENDER_TIMEOUT_MS = 15_000;
const TITLE_SHARE = 0.6;

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1));

function titleWords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 3);
}

function titleShown(title, text) {
  const words = titleWords(title);
  if (words.length === 0) return text.toLowerCase().includes(title.toLowerCase());
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w)).length / words.length >= TITLE_SHARE;
}

async function check(page, cert) {
  const res = await page.goto(cert.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const status = res ? res.status() : 0;
  await page
    .waitForFunction((source) => new RegExp(source, 'i').test(document.body?.innerText ?? ''), NAME.source, { timeout: RENDER_TIMEOUT_MS })
    .catch(() => {});
  const text = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ');
  const finalUrl = page.url();
  const problems = [];
  if (status >= 400) problems.push(`HTTP ${status}`);
  if (!isAllowedCredentialUrl(finalUrl)) problems.push(`ended on ${new URL(finalUrl).host} (login wall?)`);
  if (!NAME.test(text)) problems.push('name not shown');
  if (!titleShown(cert.title, text)) problems.push('title not shown');
  return { status, finalUrl, problems };
}

async function main() {
  const { items } = parseCertifications(JSON.parse(await readFile(DATA, 'utf8')));
  const unknown = only.filter((id) => !items.some((c) => c.id === id));
  if (unknown.length) throw new Error(`no credential with id ${unknown.join(', ')}`);
  const queue = items.filter((c) => only.length === 0 || only.includes(c.id));

  const results = [];
  for (const c of queue) {
    if (!isAllowedCredentialUrl(c.url)) results.push({ id: c.id, title: c.title, url: c.url, ok: false, problems: ['not an allowed credential link'] });
  }
  const pending = queue.filter((c) => isAllowedCredentialUrl(c.url));

  const browser = await chromium.launch();
  // A new context has no cookies or storage: exactly what a logged-out visitor sees.
  const context = await browser.newContext();
  async function worker() {
    const page = await context.newPage();
    for (let c = pending.shift(); c; c = pending.shift()) {
      let outcome;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          outcome = await check(page, c);
        } catch (err) {
          outcome = { status: 0, finalUrl: '', problems: [err instanceof Error ? err.message.split('\n')[0] : String(err)] };
        }
        if (outcome.problems.length === 0) break;
      }
      const ok = outcome.problems.length === 0;
      results.push({ id: c.id, title: c.title, url: c.url, status: outcome.status, ok, problems: outcome.problems });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.issuer} | ${c.title}${ok ? '' : `: ${outcome.problems.join('; ')}`}`);
    }
    await page.close();
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} credentials show his name and the title, logged out.`);
  if (jsonPath) await writeFile(jsonPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
