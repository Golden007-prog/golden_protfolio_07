#!/usr/bin/env node
// Requests every citation link the skill pages ship (official docs, research papers
// and any sources the index build keeps) and reports the dead ones.
//   fail: 404, 410, DNS and connection errors (on both attempts)
//   warn: 403 and 202 (bot walls, queued pages), other 4xx/5xx, timeouts, redirect loops
// Exits 1 when anything failed, so it can gate CI.
//
//   node scripts/check-skill-links.mjs          (npm run skills:links)

import { collectShippedUrls } from './build-skill-index.mjs';

const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
// An honest agent first. Google's devsite answers browser user agents with an
// endless oauth2authorize redirect when there is no cookie jar, while some
// publishers wall anything that is not a browser, so the browser UA is the retry.
const AGENTS = [
  'skill-link-checker/1.0 (+https://www.basuoikantik.in)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
];

const FAIL_STATUS = new Set([404, 410]);
const CONNECTION_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

async function probe(url, agent) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': agent, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
    });
    // Headers are all that matter; don't download PDFs.
    await res.body?.cancel().catch(() => {});
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    const code = err?.cause?.code ?? err?.code ?? (err?.name === 'TimeoutError' ? 'TIMEOUT' : err?.name);
    return { error: String(code ?? err?.message ?? err) };
  }
}

function classify(result) {
  if (result.error) return CONNECTION_CODES.has(result.error) ? 'fail' : 'warn';
  if (FAIL_STATUS.has(result.status)) return 'fail';
  if (result.status >= 200 && result.status < 300 && result.status !== 202) return 'ok';
  return 'warn';
}

const RANK = { ok: 0, warn: 1, fail: 2 };

/** The best of up to two attempts, so a transient reset or a bot wall alone never fails a link. */
async function check(url) {
  let best = null;
  for (const agent of AGENTS) {
    const result = await probe(url, agent);
    if (!best || RANK[classify(result)] < RANK[classify(best)]) best = result;
    if (classify(best) === 'ok') break;
  }
  return best;
}

async function main() {
  const entries = collectShippedUrls();
  const byUrl = new Map();
  for (const e of entries) {
    const list = byUrl.get(e.url) ?? [];
    list.push(e.where);
    byUrl.set(e.url, list);
  }
  const urls = [...byUrl.keys()];
  console.log(`Checking ${urls.length} unique links (${entries.length} citations)…`);

  const results = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        results.set(url, await check(url));
      }
    }),
  );

  let failed = 0;
  let warned = 0;
  for (const url of urls) {
    const r = results.get(url);
    const verdict = classify(r);
    if (verdict === 'ok') continue;
    const what = r.error ?? `HTTP ${r.status}`;
    const where = byUrl.get(url).join('; ');
    if (verdict === 'fail') {
      failed++;
      console.log(`FAIL  ${what}  ${url}\n      ${where}`);
    } else {
      warned++;
      console.log(`warn  ${what}  ${url}\n      ${where}`);
    }
  }
  console.log(`\n${urls.length - failed - warned} ok, ${warned} warnings, ${failed} failures`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
