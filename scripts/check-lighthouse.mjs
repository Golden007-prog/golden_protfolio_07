#!/usr/bin/env node
/**
 * Checks the median of each metric across the Lighthouse JSON reports in a folder against
 * the budgets in src/lib/lighthouseBudget.ts.
 *
 *   node scripts/check-lighthouse.mjs                      # reads ./lighthouse/*.json
 *   node scripts/check-lighthouse.mjs --dir path/to/reports
 *   LIGHTHOUSE_ENFORCE=CLS node scripts/check-lighthouse.mjs
 *   node scripts/check-lighthouse.mjs --enforce none       # report only
 *
 * LIGHTHOUSE_ENFORCE (or --enforce, which wins) names the metrics whose miss fails the
 * run: comma-separated labels, 'all' or 'none'. Unset means all. A miss on any other
 * metric is printed, raised as a warning annotation on GitHub Actions and written to the
 * step summary, and the exit code stays 0.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluate, formatAnnotations, formatLines, formatSummary, parseEnforce } from '../src/lib/lighthouseBudget.ts';

function fail(message) {
  console.error(`\n✖ lighthouse budget: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let dir = resolve('lighthouse');
let enforceRaw = process.env.LIGHTHOUSE_ENFORCE;

for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const value = args[++i];
  if (flag === '--dir' && value) dir = resolve(value);
  else if (flag === '--enforce' && value !== undefined) enforceRaw = value;
  else fail(`Unknown or incomplete argument '${flag}'. Use --dir <folder> or --enforce <labels|all|none>.`);
}

let enforced;
try {
  enforced = parseEnforce(enforceRaw);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const reports = [];
if (existsSync(dir)) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      reports.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch (error) {
      console.warn(`▲ skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
if (reports.length === 0) console.warn(`▲ no Lighthouse reports in ${dir}`);

const result = evaluate(reports, enforced);

for (const line of formatLines(result)) console.log(line);

if (process.env.GITHUB_ACTIONS === 'true') {
  for (const line of formatAnnotations(result)) console.log(line);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatSummary(result));
  } catch (error) {
    console.warn(`▲ could not write the step summary: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(result.failed ? 1 : 0);
