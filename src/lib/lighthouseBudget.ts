/**
 * The mobile Lighthouse budget that CI checks (scripts/check-lighthouse.mjs reads the
 * reports and calls into this module). Each metric is either enforced, so a miss fails
 * the job, or report-only, so a miss is a warning. That lets a metric that is known to be
 * over budget stay visible without turning every push red, while the metrics that pass
 * today keep blocking regressions.
 */

export interface Budget {
  /** Lighthouse audit id. */
  id: string;
  /** Short name used in logs and in LIGHTHOUSE_ENFORCE. */
  label: string;
  max: number;
  unit: 'ms' | '';
}

export const BUDGETS: readonly Budget[] = [
  { id: 'largest-contentful-paint', label: 'LCP', max: 2500, unit: 'ms' },
  { id: 'cumulative-layout-shift', label: 'CLS', max: 0.1, unit: '' },
  { id: 'total-blocking-time', label: 'TBT', max: 300, unit: 'ms' },
];

/** The part of a Lighthouse JSON report that the gate reads. */
export interface LighthouseReport {
  audits?: Record<string, { numericValue?: number } | undefined>;
  categories?: { performance?: { score?: number | null } };
  runtimeError?: { code?: string; message?: string };
}

export type Status = 'pass' | 'fail' | 'warn';

export interface MetricResult extends Budget {
  /** null when no report had a value for this audit. */
  median: number | null;
  /** How many reports had a value. */
  runs: number;
  enforced: boolean;
  status: Status;
}

export interface Evaluation {
  metrics: MetricResult[];
  /** Performance category scores, 0-100, one per report that had one. */
  scores: number[];
  /** Lighthouse runtimeError codes, one per report that carried one. */
  runtimeErrors: string[];
  /** True when an enforced metric is over budget or has no value. */
  failed: boolean;
}

/** Median of the values; the mean of the middle two for an even count, null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Parses LIGHTHOUSE_ENFORCE into the labels whose misses fail the run. Unset or blank
 * means every metric, 'none' means report-only for all, 'all' means every metric, and
 * anything else is a comma- or space-separated list of labels (any case). An unknown label
 * throws: a typo must not quietly switch a gate off.
 */
export function parseEnforce(raw: string | undefined, budgets: readonly Budget[] = BUDGETS): Set<string> {
  const all = new Set(budgets.map((b) => b.label));
  const text = (raw ?? '').trim();
  if (text === '' || text.toLowerCase() === 'all') return all;
  if (text.toLowerCase() === 'none') return new Set();

  const byUpper = new Map(budgets.map((b) => [b.label.toUpperCase(), b.label]));
  const chosen = new Set<string>();
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const label = byUpper.get(token.toUpperCase());
    if (!label) {
      throw new Error(
        `Unknown Lighthouse metric '${token}' in LIGHTHOUSE_ENFORCE. Use ${[...all].join(', ')}, 'all' or 'none'.`,
      );
    }
    chosen.add(label);
  }
  return chosen;
}

export function evaluate(
  reports: readonly LighthouseReport[],
  enforced: ReadonlySet<string>,
  budgets: readonly Budget[] = BUDGETS,
): Evaluation {
  const metrics = budgets.map((budget): MetricResult => {
    const values = reports
      .map((r) => r.audits?.[budget.id]?.numericValue)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const value = median(values);
    const isEnforced = enforced.has(budget.label);
    const within = value !== null && value <= budget.max;
    return {
      ...budget,
      median: value,
      runs: values.length,
      enforced: isEnforced,
      status: within ? 'pass' : isEnforced ? 'fail' : 'warn',
    };
  });

  const scores = reports
    .map((r) => r.categories?.performance?.score)
    .filter((s): s is number => typeof s === 'number')
    .map((s) => Math.round(s * 100));
  const runtimeErrors = reports.flatMap((r) => (r.runtimeError?.code ? [r.runtimeError.code] : []));

  return { metrics, scores, runtimeErrors, failed: metrics.some((m) => m.status === 'fail') };
}

export function formatValue(value: number, unit: Budget['unit']): string {
  return unit === 'ms' ? `${Math.round(value)} ms` : value.toFixed(3);
}

function limitText(m: Budget): string {
  return `${m.max}${m.unit ? ` ${m.unit}` : ''}`;
}

function measured(m: MetricResult): string {
  return m.median === null ? 'no value in any run' : `${formatValue(m.median, m.unit)} (median of ${m.runs})`;
}

const ICON: Record<Status, string> = { pass: '✔', fail: '✖', warn: '▲' };

/** Plain log lines, one per metric, then the scores. */
export function formatLines(e: Evaluation): string[] {
  const lines = e.metrics.map((m) => {
    const note = m.status === 'warn' ? ' [report-only]' : '';
    return `${ICON[m.status]} ${m.label} ${measured(m)}; limit ${limitText(m)}${note}`;
  });
  lines.push(`Performance scores: ${e.scores.length ? e.scores.join(', ') : 'none'}`);
  if (e.runtimeErrors.length) lines.push(`Lighthouse runtime errors: ${e.runtimeErrors.join(', ')}`);
  return lines;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function formatSummary(e: Evaluation): string {
  const rows = e.metrics.map((m) => {
    const value = m.median === null ? 'no value' : formatValue(m.median, m.unit);
    const gate = m.enforced ? 'blocking' : 'report-only';
    return `| ${ICON[m.status]} ${m.label} | ${value} | ${limitText(m)} | ${m.runs} | ${gate} |`;
  });
  const reportOnly = e.metrics.filter((m) => !m.enforced).map((m) => m.label);
  return [
    '### Lighthouse (mobile)',
    '',
    '| Metric | Median | Limit | Runs | Gate |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Performance scores: ${e.scores.length ? e.scores.join(', ') : 'none'}`,
    ...(e.runtimeErrors.length ? ['', `Lighthouse runtime errors: ${e.runtimeErrors.join(', ')}`] : []),
    ...(reportOnly.length
      ? ['', `Report-only: ${reportOnly.join(', ')}. A miss on these is a warning; LIGHTHOUSE_ENFORCE in ci.yml makes them blocking.`]
      : []),
    '',
  ].join('\n');
}

/** Escapes the message part of a GitHub Actions workflow command. */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escapes a property value (title=...) of a GitHub Actions workflow command. */
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** ::error for enforced misses, ::warning for report-only misses, nothing for passes. */
export function formatAnnotations(e: Evaluation): string[] {
  return e.metrics
    .filter((m) => m.status !== 'pass')
    .map((m) => {
      const level = m.status === 'fail' ? 'error' : 'warning';
      const what =
        m.median === null
          ? `${m.label} had no value in any run (budget ${limitText(m)})`
          : `${m.label} median ${formatValue(m.median, m.unit)} is over the ${limitText(m)} budget`;
      const message = `${what}${m.status === 'warn' ? ' (report-only)' : ''}`;
      return `::${level} title=${escapeProperty(`Lighthouse ${m.label}`)}::${escapeData(message)}`;
    });
}
