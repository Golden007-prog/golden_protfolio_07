import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  BUDGETS,
  escapeData,
  escapeProperty,
  evaluate,
  formatAnnotations,
  formatLines,
  formatSummary,
  median,
  parseEnforce,
  type LighthouseReport,
} from './lighthouseBudget.ts';

const CHECK = fileURLToPath(new URL('../../scripts/check-lighthouse.mjs', import.meta.url));
const CI_YML = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));

function report(lcp: number | undefined, cls: number | undefined, tbt: number | undefined, score = 0.42): LighthouseReport {
  const audits: LighthouseReport['audits'] = {};
  if (lcp !== undefined) audits['largest-contentful-paint'] = { numericValue: lcp };
  if (cls !== undefined) audits['cumulative-layout-shift'] = { numericValue: cls };
  if (tbt !== undefined) audits['total-blocking-time'] = { numericValue: tbt };
  return { audits, categories: { performance: { score } } };
}

// Mobile Lighthouse 13.5.0 replays of the CI step against the 2026-09-25 build, run on a
// Windows dev box rather than a GitHub runner. The first set had hardware WebGL, so the
// three.js hero loaded; the second used --disable-gpu, closer to a GPU-less runner.
// Update these when the home page's numbers change.
const BASELINES: Record<string, LighthouseReport[]> = {
  'gpu host': [report(7203, 0.00052, 2417, 0.41), report(6131, 0.00052, 3293, 0.42), report(6129, 0.00052, 2760, 0.43)],
  'no gpu': [report(5508, 0.00047, 1217, 0.51), report(7145, 0.000033, 1155, 0.47), report(7006, 0.000033, 1121, 0.49)],
};

function ciEnforce(): string {
  const matches = [...readFileSync(CI_YML, 'utf8').matchAll(/^\s*LIGHTHOUSE_ENFORCE:\s*(.*?)\s*$/gm)];
  assert.equal(matches.length, 1, 'ci.yml sets LIGHTHOUSE_ENFORCE exactly once');
  return matches[0][1].replace(/^(['"])(.*)\1$/, '$2');
}

test('median takes the middle value, averages the middle two, and leaves its input alone', () => {
  const input = [3, 1, 2];
  assert.equal(median(input), 2);
  assert.deepEqual(input, [3, 1, 2]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
});

test('parseEnforce: unset means all, none means report-only, labels are case-insensitive', () => {
  const all = ['CLS', 'LCP', 'TBT'];
  assert.deepEqual([...parseEnforce(undefined)].sort(), all);
  assert.deepEqual([...parseEnforce('  ')].sort(), all);
  assert.deepEqual([...parseEnforce('ALL')].sort(), all);
  assert.deepEqual([...parseEnforce('none')], []);
  assert.deepEqual([...parseEnforce('cls')], ['CLS']);
  assert.deepEqual([...parseEnforce('CLS, tbt')].sort(), ['CLS', 'TBT']);
  assert.deepEqual([...parseEnforce('lcp tbt')].sort(), ['LCP', 'TBT']);
});

test('parseEnforce rejects an unknown label instead of silently dropping a gate', () => {
  assert.throws(() => parseEnforce('CSL'), /Unknown Lighthouse metric 'CSL'/);
  assert.throws(() => parseEnforce('CLS,FCP'), /'FCP'/);
});

test('evaluate: an enforced miss fails, a report-only miss warns, a pass passes', () => {
  const reports = [report(6000, 0.001, 2500), report(6200, 0.002, 2700), report(7000, 0.001, 3000)];

  const strict = evaluate(reports, parseEnforce('all'));
  assert.equal(strict.failed, true);
  assert.deepEqual(
    strict.metrics.map((m) => [m.label, m.status]),
    [
      ['LCP', 'fail'],
      ['CLS', 'pass'],
      ['TBT', 'fail'],
    ],
  );

  const relaxed = evaluate(reports, parseEnforce('CLS'));
  assert.equal(relaxed.failed, false);
  assert.deepEqual(
    relaxed.metrics.map((m) => [m.label, m.status, m.median, m.runs]),
    [
      ['LCP', 'warn', 6200, 3],
      ['CLS', 'pass', 0.001, 3],
      ['TBT', 'warn', 2700, 3],
    ],
  );
  assert.deepEqual(relaxed.scores, [42, 42, 42]);
});

test('evaluate: a regression on an enforced metric still fails when others are report-only', () => {
  const reports = [report(6000, 0.25, 2500), report(6000, 0.3, 2500), report(6000, 0.2, 2500)];
  const e = evaluate(reports, parseEnforce('CLS'));
  assert.equal(e.failed, true);
  assert.equal(e.metrics.find((m) => m.label === 'CLS')?.status, 'fail');
});

test('evaluate: a metric with no value fails when enforced and warns when report-only', () => {
  const crashed: LighthouseReport = { runtimeError: { code: 'NO_FCP', message: 'no paint' }, audits: {} };
  const e = evaluate([crashed, report(undefined, 0.01, Number.NaN)], parseEnforce('CLS,TBT'));
  const byLabel = Object.fromEntries(e.metrics.map((m) => [m.label, m]));
  assert.equal(byLabel.LCP.status, 'warn');
  assert.equal(byLabel.LCP.median, null);
  assert.equal(byLabel.TBT.status, 'fail', 'NaN is not a measurement');
  assert.equal(byLabel.CLS.status, 'pass');
  assert.equal(byLabel.CLS.runs, 1);
  assert.deepEqual(e.runtimeErrors, ['NO_FCP']);
  assert.equal(e.failed, true);

  assert.equal(evaluate([], parseEnforce('CLS')).failed, true, 'no reports at all cannot pass an enforced gate');
  assert.equal(evaluate([], parseEnforce('none')).failed, false);
});

test('formatters name the gate, the median and the limit', () => {
  const e = evaluate([report(6131, 0.0005, 2760)], parseEnforce('CLS'));
  assert.deepEqual(formatLines(e), [
    '▲ LCP 6131 ms (median of 1); limit 2500 ms [report-only]',
    '✔ CLS 0.001 (median of 1); limit 0.1',
    '▲ TBT 2760 ms (median of 1); limit 300 ms [report-only]',
    'Performance scores: 42',
  ]);
  assert.deepEqual(formatAnnotations(e), [
    '::warning title=Lighthouse LCP::LCP median 6131 ms is over the 2500 ms budget (report-only)',
    '::warning title=Lighthouse TBT::TBT median 2760 ms is over the 300 ms budget (report-only)',
  ]);
  const summary = formatSummary(e);
  assert.match(summary, /\| ▲ LCP \| 6131 ms \| 2500 ms \| 1 \| report-only \|/);
  assert.match(summary, /\| ✔ CLS \| 0\.001 \| 0\.1 \| 1 \| blocking \|/);
  assert.match(summary, /Report-only: LCP, TBT\./);

  const strict = evaluate([], parseEnforce('all'));
  assert.equal(formatAnnotations(strict)[0], '::error title=Lighthouse LCP::LCP had no value in any run (budget 2500 ms)');
});

test('workflow-command escaping', () => {
  assert.equal(escapeData('50% done\r\nnext'), '50%25 done%0D%0Anext');
  assert.equal(escapeProperty('a:b,c%'), 'a%3Ab%2Cc%25');
});

test('the gate configured in ci.yml passes on the measured baseline', () => {
  const enforced = parseEnforce(ciEnforce());
  for (const [name, reports] of Object.entries(BASELINES)) {
    const e = evaluate(reports, enforced);
    assert.equal(e.failed, false, `${name}: ${formatLines(e).join(' | ')}`);
  }
});

test('enforcing every metric fails on the baseline (the gate that turned every push red)', () => {
  for (const reports of Object.values(BASELINES)) {
    const e = evaluate(reports, parseEnforce('all'));
    assert.equal(e.failed, true);
    assert.deepEqual(
      e.metrics.filter((m) => m.status === 'fail').map((m) => m.label),
      ['LCP', 'TBT'],
    );
  }
});

test('ci.yml runs the checker and keeps CLS blocking', () => {
  const yml = readFileSync(CI_YML, 'utf8');
  assert.match(yml, /node scripts\/check-lighthouse\.mjs --dir lighthouse/);
  assert.ok(parseEnforce(ciEnforce()).has('CLS'), 'CLS passes today and must keep blocking regressions');
  assert.deepEqual(
    BUDGETS.map((b) => [b.label, b.max]),
    [
      ['LCP', 2500],
      ['CLS', 0.1],
      ['TBT', 300],
    ],
  );
});

function runCheck(dir: string, env: Record<string, string>, extraArgs: string[] = []) {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  // Hermetic even inside GitHub Actions: never write to the real job's step summary.
  delete clean.GITHUB_ACTIONS;
  delete clean.GITHUB_STEP_SUMMARY;
  delete clean.LIGHTHOUSE_ENFORCE;
  return spawnSync(process.execPath, [CHECK, '--dir', dir, ...extraArgs], {
    env: { ...clean, ...env },
    encoding: 'utf8',
  });
}

test('check-lighthouse.mjs: report-only misses exit 0 with annotations and a step summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lh-check-'));
  try {
    BASELINES['gpu host'].forEach((r, i) => writeFileSync(join(dir, `run-${i + 1}.json`), JSON.stringify(r)));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const summaryPath = join(dir, 'summary.md');

    const relaxed = runCheck(dir, { LIGHTHOUSE_ENFORCE: 'CLS', GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryPath });
    assert.equal(relaxed.status, 0, relaxed.stdout + relaxed.stderr);
    assert.match(relaxed.stdout, /▲ LCP 6131 ms \(median of 3\); limit 2500 ms \[report-only\]/);
    assert.match(relaxed.stdout, /::warning title=Lighthouse TBT::TBT median 2760 ms/);
    assert.match(relaxed.stderr, /skipped broken\.json/);
    assert.match(readFileSync(summaryPath, 'utf8'), /\| ✔ CLS \| 0\.001 \| 0\.1 \| 3 \| blocking \|/);

    const strict = runCheck(dir, { GITHUB_ACTIONS: 'true' });
    assert.equal(strict.status, 1, 'unset LIGHTHOUSE_ENFORCE enforces every metric');
    assert.match(strict.stdout, /::error title=Lighthouse LCP::/);

    const override = runCheck(dir, { LIGHTHOUSE_ENFORCE: 'all' }, ['--enforce', 'none']);
    assert.equal(override.status, 0, '--enforce wins over the env');
    assert.doesNotMatch(override.stdout, /::warning/, 'annotations only on GitHub Actions');

    const typo = runCheck(dir, { LIGHTHOUSE_ENFORCE: 'CSL' });
    assert.equal(typo.status, 1);
    assert.match(typo.stderr, /Unknown Lighthouse metric 'CSL'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-lighthouse.mjs: no reports cannot pass an enforced metric', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lh-empty-'));
  try {
    const result = runCheck(join(dir, 'missing'), { LIGHTHOUSE_ENFORCE: 'CLS' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no Lighthouse reports/);
    assert.match(result.stdout, /✖ CLS no value in any run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
