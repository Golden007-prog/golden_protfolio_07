#!/usr/bin/env node
/**
 * Fails when a route's first-load JavaScript (uncompressed bytes, as `next build`
 * records it in .next/diagnostics/route-bundle-stats.json) is over its absolute budget.
 *
 *   npm run budget                       # after `npm run build`
 *   npm run budget -- --budget /=900000  # override one route for this run
 *   npm run budget -- --stats path/to/route-bundle-stats.json
 *
 * Budgets are absolute on purpose: a relative "no more than +5%" check lets a
 * page grow forever in small steps. Lower them as the page gets lighter.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// '/' was 1,237,317 bytes in the foundation build of 2026-09-25; the skills split should
// remove about 340 kB. Lower this to the integrated size plus a small margin.
const BUDGETS = {
  '/': 950_000,
};

const args = process.argv.slice(2);
let statsPath = resolve('.next/diagnostics/route-bundle-stats.json');
const budgets = { ...BUDGETS };

for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const value = args[++i];
  if (flag === '--stats' && value) {
    statsPath = resolve(value);
  } else if (flag === '--budget' && value) {
    const eq = value.lastIndexOf('=');
    const route = value.slice(0, eq);
    const bytes = Number(value.slice(eq + 1));
    if (eq <= 0 || !Number.isFinite(bytes) || bytes <= 0) fail(`--budget expects route=bytes, e.g. --budget /=900000 (got '${value}')`);
    budgets[route] = bytes;
  } else {
    fail(`Unknown or incomplete argument '${flag}'. Use --budget <route>=<bytes> or --stats <file>.`);
  }
}

function fail(message) {
  console.error(`\n✖ bundle budget: ${message}\n`);
  process.exit(1);
}

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

if (!existsSync(statsPath)) {
  fail(`${statsPath} not found. Run \`npm run build\` first; Next writes it at the end of every build.`);
}

/** @type {{ route: string; firstLoadUncompressedJsBytes: number }[]} */
let rows;
try {
  rows = JSON.parse(readFileSync(statsPath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('expected an array of routes');
} catch (err) {
  fail(`could not read ${statsPath}: ${err instanceof Error ? err.message : err}`);
}

const byRoute = new Map(rows.map((r) => [r.route, r.firstLoadUncompressedJsBytes]));
const failures = [];

console.log('\nFirst-load JS per route (uncompressed)\n');
const width = Math.max(...rows.map((r) => r.route.length), 5);
for (const { route, firstLoadUncompressedJsBytes: bytes } of rows) {
  const budget = budgets[route];
  const status = budget === undefined ? '' : bytes <= budget ? `ok (budget ${kb(budget)})` : `OVER by ${kb(bytes - budget)} (budget ${kb(budget)})`;
  console.log(`  ${route.padEnd(width)}  ${kb(bytes).padStart(10)}  ${status}`);
  if (budget !== undefined && bytes > budget) failures.push({ route, bytes, budget });
}

for (const route of Object.keys(budgets)) {
  if (!byRoute.has(route)) failures.push({ route, missing: true });
}

if (failures.length > 0) {
  const lines = failures.map((f) =>
    f.missing
      ? `  ${f.route}: has a budget but is not in the build output (renamed or removed?)`
      : `  ${f.route}: ${f.bytes.toLocaleString('en-US')} bytes > ${f.budget.toLocaleString('en-US')} budget (+${(f.bytes - f.budget).toLocaleString('en-US')})`,
  );
  fail(`${failures.length} route(s) over budget:\n${lines.join('\n')}\n\n  Split or lazy-load what the route does not need for first paint, or raise the budget in scripts/check-bundle-budget.mjs with a reason.`);
}

console.log('\n✔ bundle budget: every budgeted route is within its limit.\n');
