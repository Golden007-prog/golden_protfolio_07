#!/usr/bin/env node
/**
 * Writes src/data/live-snapshot.json: the last known good GitHub and LeetCode data
 * that /api/github and /api/leetcode serve (flagged stale) when the upstream APIs
 * fail. Run before `next build` so the fallback is never older than the deploy.
 *
 *   node scripts/snapshot-live-data.mjs            refresh; keep old parts that fail
 *   node scripts/snapshot-live-data.mjs --strict   exit 1 if anything failed
 *
 * It never fails a build by default: whatever cannot be fetched keeps its previous
 * snapshot. The fetchers live in src/lib/live-data.ts and are loaded through Node's
 * TypeScript type stripping (Node 22.18+); older Node keeps the committed file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const OUT = new URL('src/data/live-snapshot.json', root);
const strict = process.argv.includes('--strict');

function log(msg) {
  console.log(`[live-snapshot] ${msg}`);
}

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  let lib;
  let stats;
  try {
    lib = await import(new URL('src/lib/live-data.ts', root).href);
    stats = await import(new URL('src/utils/contributionStats.ts', root).href);
  } catch (err) {
    log(`skipped: this Node (${process.version}) cannot load the TypeScript fetchers (${err.message.split('\n')[0]})`);
    return strict ? 1 : 0;
  }

  const profile = await readJson(new URL('src/data/profile.json', root), null);
  if (!profile?.links) {
    log('skipped: src/data/profile.json has no links');
    return strict ? 1 : 0;
  }
  const previous = await readJson(OUT, { generatedAt: null, github: null, leetcode: null });
  const githubUser = stats.usernameFromUrl(profile.links.github);
  const leetcodeUser = stats.usernameFromUrl(profile.links.leetcode);

  const [contributions, latestPush, leetcode] = await Promise.all([
    lib.fetchContributions(githubUser),
    lib.fetchLatestPush(githubUser, process.env.GITHUB_TOKEN || undefined),
    lib.fetchLeetCode(leetcodeUser),
  ]);

  const failed = [];
  if (!contributions) failed.push('GitHub contributions');
  if (latestPush === undefined) failed.push('GitHub latest push');
  if (!leetcode) failed.push('LeetCode');

  const github =
    contributions || latestPush !== undefined
      ? {
          contributions: contributions ?? previous.github?.contributions ?? { total: 0, days: [] },
          latestPush: latestPush === undefined ? (previous.github?.latestPush ?? null) : latestPush,
        }
      : previous.github;

  if (failed.length === 3) {
    log(`nothing fetched (${failed.join(', ')}); keeping ${previous.generatedAt ?? 'the empty snapshot'}`);
    return strict ? 1 : 0;
  }

  const next = {
    generatedAt: new Date().toISOString(),
    github,
    leetcode: leetcode ?? previous.leetcode,
  };
  await writeFile(OUT, `${JSON.stringify(next, null, 2)}\n`);
  log(
    `wrote ${fileURLToPath(OUT)}: ${next.github?.contributions.total ?? 0} contributions, ` +
      `latest push ${next.github?.latestPush?.repo ?? 'none'}, ${next.leetcode?.totalSolved ?? 0} LeetCode solved` +
      (failed.length ? ` (kept previous: ${failed.join(', ')})` : ''),
  );
  return failed.length && strict ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`failed: ${err?.stack ?? err}`);
    process.exit(strict ? 1 : 0);
  },
);
