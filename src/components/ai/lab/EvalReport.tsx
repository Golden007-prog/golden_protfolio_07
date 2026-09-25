import { AlertTriangle, FlaskConical } from 'lucide-react';
import { EVAL_CAVEATS, METRICS } from '@/data/ai-model-cards';
import { formatIsoDate } from '@/utils/dates';

/*
 * The eval report card for /ai: src/data/ai-eval-report.json as written by
 * scripts/ai/eval.mjs. Server component. Plain <a> links only, so tests can
 * render it with react-dom/server outside Next.
 */

export type EvalMetric = { key: string; label: string; value: number | null; n: number; definition: string };
export type EvalInjectionResult = { id: string; category: string; expect: string; guard: string; resisted: boolean | null };
export type EvalMiss = { set: string; id: string; q: string; why: string };
export type EvalRun = {
  date: string;
  models: { primary: string; fallback: string };
  tier?: string;
  fake?: boolean;
  answeredBy?: Record<string, number>;
  retrievalMode?: string | null;
  sets: { golden: number; bait: number; injection: number };
  metrics: EvalMetric[];
  goldenAbstained?: number | null;
  injection: EvalInjectionResult[];
  misses?: EvalMiss[];
};
export type EvalReportFile = { version: 1; note?: string; run: EvalRun | null };
export type SetSizes = { golden: number; bait: number; injection: number };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

/** The committed JSON, checked field by field: anything malformed reads as no run. */
export function parseEvalReport(x: unknown): EvalReportFile {
  const empty: EvalReportFile = { version: 1, run: null };
  if (!isObj(x) || !isObj(x.run)) return empty;
  const r = x.run;
  if (!isStr(r.date) || !isObj(r.models) || !isStr(r.models.primary) || !isStr(r.models.fallback) || !Array.isArray(r.metrics)) return empty;
  const metrics = r.metrics.filter(
    (m): m is EvalMetric =>
      isObj(m) && isStr(m.key) && isStr(m.label) && isStr(m.definition) && typeof m.n === 'number' && (m.value === null || typeof m.value === 'number'),
  );
  const injection = (Array.isArray(r.injection) ? r.injection : []).filter(
    (i): i is EvalInjectionResult => isObj(i) && isStr(i.id) && isStr(i.guard) && isStr(i.expect) && (i.resisted === null || typeof i.resisted === 'boolean'),
  );
  const sets = isObj(r.sets) ? r.sets : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    version: 1,
    note: isStr(x.note) ? x.note : undefined,
    run: {
      date: r.date,
      models: { primary: r.models.primary, fallback: r.models.fallback },
      tier: isStr(r.tier) ? r.tier : undefined,
      fake: r.fake === true,
      answeredBy: isObj(r.answeredBy) ? (r.answeredBy as Record<string, number>) : undefined,
      retrievalMode: isStr(r.retrievalMode) ? r.retrievalMode : null,
      sets: { golden: num(sets.golden), bait: num(sets.bait), injection: num(sets.injection) },
      metrics,
      goldenAbstained: typeof r.goldenAbstained === 'number' ? r.goldenAbstained : null,
      injection,
      misses: (Array.isArray(r.misses) ? r.misses : []).filter(
        (m): m is EvalMiss => isObj(m) && isStr(m.set) && isStr(m.id) && isStr(m.q) && isStr(m.why),
      ),
    },
  };
}

/** How the run's models differ from the ones this deployment uses; empty when current. */
export function staleness(run: Pick<EvalRun, 'models'>, current: { primary: string; fallback: string }): string[] {
  const out: string[] = [];
  if (run.models.primary !== current.primary) out.push(`primary ${run.models.primary} → ${current.primary}`);
  if (run.models.fallback !== current.fallback) out.push(`fallback ${run.models.fallback} → ${current.fallback}`);
  return out;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 1000) / 10}%`);

function Caveats({ extra }: { extra?: string[] }) {
  return (
    <div className="rounded-2xl border border-hairline p-5">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-text-primary">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-amber-text" />
        Read these numbers with care
      </h3>
      <ul data-eval-caveats="" className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-text-secondary marker:text-text-dim">
        {[...EVAL_CAVEATS, ...(extra ?? [])].map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Each metric with its n, the run date, the model and its definition; a
 * 'stale: re-run evals' badge when the run's models differ from the ones this
 * deployment is configured with (the same values /api/ai/health reports).
 */
export function EvalReport({ report, current, sets }: { report: EvalReportFile; current: { primary: string; fallback: string }; sets: SetSizes }) {
  const run = report.run;

  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        <div data-eval-empty="" className="rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
          <p className="flex items-center gap-2 font-display text-xl font-semibold text-text-primary">
            <FlaskConical aria-hidden="true" className="size-5 shrink-0 text-cyan-text" />
            No eval run yet
          </p>
          <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-text-secondary">
            The sets are written and waiting: {sets.golden} golden questions with expected facts and citations, {sets.bait} bait questions the
            assistant must decline, and {sets.injection} prompt-injection attacks. They run by hand against a local server, never against the
            live site, and the scores will appear here with their sample sizes.
          </p>
          <pre
            tabIndex={0}
            role="region"
            aria-label="How to run the evals"
            className="mt-4 overflow-x-auto rounded-xl border border-hairline p-4 font-mono text-xs leading-relaxed text-text-secondary ring-focus"
          >
            {'AI_EVAL=1 npx next start\nnode --env-file-if-exists=.env scripts/ai/eval.mjs'}
          </pre>
        </div>
        <Caveats />
      </div>
    );
  }

  const stale = staleness(run, current);
  const date = formatIsoDate(run.date) ?? run.date;
  const byMetric = new Map(run.metrics.map((m) => [m.key, m]));
  const ordered = [...METRICS.map((m) => byMetric.get(m.key)).filter((m): m is EvalMetric => Boolean(m)), ...run.metrics.filter((m) => !METRICS.some((k) => k.key === m.key))];
  const extra: string[] = [];
  if (typeof run.goldenAbstained === 'number' && run.goldenAbstained > 0) {
    extra.push(`${run.goldenAbstained} golden question${run.goldenAbstained === 1 ? ' was' : 's were'} answered with “not on this site”, which counts as zero recall.`);
  }
  if (run.retrievalMode === 'lexical') extra.push('Retrieval ran on BM25 alone for this run (no embeddings), so recall@5 is the lexical floor.');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary">
        <span>
          Run <time dateTime={run.date}>{date}</time>
        </span>
        <span>
          Models <code className="font-mono text-[13px] text-text-primary">{run.models.primary}</code> then{' '}
          <code className="font-mono text-[13px] text-text-primary">{run.models.fallback}</code>
        </span>
        {run.tier ? <span>Tier {run.tier}</span> : null}
        {stale.length ? (
          <span data-eval-stale="" className="inline-flex items-center gap-1.5 rounded-full border border-amber-text px-3 py-1 text-xs font-semibold text-amber-text">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            stale: re-run evals
            <span className="sr-only"> (the site now uses {stale.join(' and ')})</span>
          </span>
        ) : null}
        {run.fake ? (
          <span data-eval-fake="" className="rounded-full border border-danger px-3 py-1 text-xs font-semibold text-danger">
            fake model: not a real score
          </span>
        ) : null}
      </div>
      {stale.length ? (
        <p className="text-sm text-text-muted">
          These scores were measured on other models than the site uses now ({stale.join('; ')}), so they may not describe today’s answers.
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((m) => (
          <li key={m.key} className="min-w-0">
            <article
              data-eval-metric={m.key}
              aria-labelledby={`metric-${m.key}`}
              className="flex h-full flex-col gap-2 rounded-2xl border border-hairline bg-surface-tint p-5"
            >
              <h3 id={`metric-${m.key}`} className="text-sm font-semibold text-text-secondary">
                {m.label}
              </h3>
              <p className="font-display text-4xl font-semibold tabular-nums text-text-primary">{pct(m.value)}</p>
              <p className="font-mono text-xs text-text-muted">
                n = {m.n} · {date} · {run.models.primary}
              </p>
              <p className="text-sm leading-relaxed text-text-secondary">{m.definition}</p>
            </article>
          </li>
        ))}
      </ul>

      {run.misses?.length ? (
        <details className="ai-lab-details rounded-2xl border border-hairline">
          <summary className="ring-focus flex min-h-11 cursor-pointer items-center rounded-2xl px-5 text-sm font-semibold text-text-primary">
            What it got wrong ({run.misses.length})
          </summary>
          <ul className="flex flex-col gap-2 px-5 pb-5 text-sm text-text-secondary">
            {run.misses.map((m) => (
              <li key={`${m.set}-${m.id}`}>
                <span className="font-mono text-xs text-text-dim">
                  {m.set} {m.id}
                </span>{' '}
                “{m.q}”: {m.why}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Caveats extra={extra} />
    </div>
  );
}
