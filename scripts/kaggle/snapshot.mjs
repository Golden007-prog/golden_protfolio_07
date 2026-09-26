#!/usr/bin/env node
/**
 * Refreshes src/lib/kaggle/snapshot.json from the live Kaggle API: the fallback the
 * site serves when no credentials are set or a live read fails.
 *
 *   node --env-file-if-exists=.env scripts/kaggle/snapshot.mjs            refresh; keep the old file on any failure
 *   node --env-file-if-exists=.env scripts/kaggle/snapshot.mjs --strict   exit 1 when it could not refresh
 *
 * Needs KAGGLE_API_TOKEN, or KAGGLE_USERNAME + KAGGLE_KEY, for @oikantikbasu007.
 * Without them it changes nothing and says so. It uses the same code as the site
 * (src/lib/kaggle/load.ts, loaded through Node's TypeScript type stripping), so
 * the same owner guard and public-only filters apply. Credentials are never
 * printed: output is counts and fixed failure reasons only. Hidden and low-vote
 * writeups are kept in the file; config.ts filters them when the site serves it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const OUT = new URL('src/lib/kaggle/snapshot.json', root);
const strict = process.argv.includes('--strict');

function log(msg) {
  console.log(`[kaggle-snapshot] ${msg}`);
}

async function main() {
  let load;
  let normalize;
  try {
    load = await import(new URL('src/lib/kaggle/load.ts', root).href);
    normalize = await import(new URL('src/lib/kaggle/normalize.ts', root).href);
  } catch (err) {
    log(`skipped: this Node (${process.version}) cannot load the TypeScript modules (${String(err?.message ?? err).split('\n')[0]})`);
    return strict ? 1 : 0;
  }

  if (!load.hasCredentials(process.env)) {
    log('no KAGGLE_API_TOKEN, or KAGGLE_USERNAME + KAGGLE_KEY, in the environment; snapshot.json left unchanged');
    return strict ? 1 : 0;
  }

  const previous = normalize.coerceSnapshot(JSON.parse(await readFile(OUT, 'utf8')));
  const { data, failures } = await load.loadKaggleData({
    env: process.env,
    snapshot: previous,
    now: new Date(),
    publicWithoutToken: false,
    select: false,
  });

  if (data.source !== 'live' || failures.length) {
    log(`not refreshed, keeping ${previous.fetchedAt || 'the existing file'}: ${failures.join('; ') || 'no live data'}`);
    return strict ? 1 : 0;
  }

  const next = { ...data, source: 'snapshot' };
  await writeFile(OUT, `${JSON.stringify(next, null, 2)}\n`);
  const ranked = [...next.active, ...next.past].filter((c) => c.userRank !== undefined).length;
  log(
    `wrote ${fileURLToPath(OUT)}: ${next.badges.length} badges, ${next.writeups.length} writeups, ` +
      `${next.active.length} active and ${next.past.length} past competitions (${ranked} with a rank)`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`failed: ${err?.name ?? 'error'}`);
    process.exit(strict ? 1 : 0);
  },
);
