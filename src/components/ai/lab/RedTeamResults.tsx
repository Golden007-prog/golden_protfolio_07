import { ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { GUARDS, isGuardKey } from '@/data/ai-model-cards';
import { formatIsoDate } from '@/utils/dates';
import type { EvalInjectionResult } from './EvalReport';

/*
 * The prompt-injection set (evals/injection.jsonl) beside the guard that fired
 * for each attack in the last recorded eval run. There is deliberately no live
 * "try it" box: the assistant itself is the live surface. Server component.
 */

export type InjectionAttack = { id: string; category: string; attack: string; expect: string };

/** evals/injection.jsonl -> attacks; malformed lines are skipped. */
export function parseAttacks(jsonl: string): InjectionAttack[] {
  const out: InjectionAttack[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Partial<InjectionAttack>;
      if (typeof o.id === 'string' && typeof o.category === 'string' && typeof o.attack === 'string' && typeof o.expect === 'string') {
        out.push({ id: o.id, category: o.category, attack: o.attack, expect: o.expect });
      }
    } catch {
      /* skipped */
    }
  }
  return out;
}

const label = (key: string) => (isGuardKey(key) ? GUARDS[key] : key);

function Outcome({ result }: { result: EvalInjectionResult | undefined }) {
  if (!result) return <span className="text-text-muted">Not run yet</span>;
  if (result.resisted === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-muted">
        <ShieldQuestion aria-hidden="true" className="size-4 shrink-0" />
        Not scored
      </span>
    );
  }
  return result.resisted ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-success">
      <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
      Resisted
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
      <ShieldOff aria-hidden="true" className="size-4 shrink-0" />
      Got through
    </span>
  );
}

export function RedTeamResults({ attacks, results, date }: { attacks: readonly InjectionAttack[]; results: readonly EvalInjectionResult[] | null; date?: string }) {
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const when = date ? formatIsoDate(date) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[68ch] text-sm leading-relaxed text-text-secondary">
        {results
          ? `Recorded in the eval run of ${when ?? 'the last run'}. `
          : 'No eval run has been recorded yet, so each attack shows only the defence it was written against. '}
        The guard is inferred from what a browser can see: a relevance or safety refusal, an answer cut off by the canary, a compliance
        phrase whose link was scrubbed, or sentences the filter dropped. When none of those shows, the model declined on its own, following
        its rules.
      </p>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {attacks.map((a) => {
          const r = byId.get(a.id);
          return (
            <li key={a.id} data-attack={a.id} data-attack-guard={r ? r.guard : ''} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-hairline bg-surface-tint p-5">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-text-primary">{a.category}</span>
                <span className="font-mono text-xs text-text-dim">{a.id}</span>
              </p>
              <blockquote className="border-l-2 border-glass-border-strong pl-3 text-sm leading-relaxed text-text-muted [overflow-wrap:anywhere]">
                {a.attack}
              </blockquote>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-text-muted">Written against</dt>
                <dd className="text-text-secondary">{label(a.expect)}</dd>
                <dt className="text-text-muted">Guard that fired</dt>
                <dd data-guard-label="" className="font-medium text-text-primary">
                  {r ? (
                    label(r.guard)
                  ) : (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">None recorded</span>
                    </>
                  )}
                </dd>
                <dt className="text-text-muted">Result</dt>
                <dd>
                  <Outcome result={r} />
                </dd>
              </dl>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
