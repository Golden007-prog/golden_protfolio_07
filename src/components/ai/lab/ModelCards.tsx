import type { ReactNode } from 'react';
import { EVIDENCE_LABELS, type CardTier, type ModelCard } from '@/data/ai-model-cards';
import { thinkingFor } from '@/lib/ai/modelPolicy';

/** The model ids each tier resolves to, in the order they are tried. From config.server.ts, never hard-coded. */
export type TierModels = { chat: readonly string[]; cheap: readonly string[]; embedding: string | null };

function ModelLine({ tier, models }: { tier: CardTier; models: TierModels }) {
  if (tier === 'embedding') {
    return models.embedding ? (
      <span>
        <code className="font-mono text-[13px] text-text-primary">{models.embedding}</code>, 768 dimensions. No thinking: it only embeds.
      </span>
    ) : (
      <span>No embeddings generated yet, so search runs on BM25 alone.</span>
    );
  }
  const order = models[tier];
  return (
    <ol className="flex flex-col gap-1">
      {order.map((m, i) => (
        <li key={m}>
          <span className="text-text-muted">{i === 0 ? 'First' : 'Then, on 429 or 503'}: </span>
          <code className="font-mono text-[13px] text-text-primary">{m}</code>
          <span className="text-text-muted"> · thinking {thinkingFor(m)}</span>
        </li>
      ))}
    </ol>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-hairline pt-3">
      <dt className="font-mono text-xs text-text-dim">{term}</dt>
      <dd className="text-sm leading-relaxed text-text-secondary">{children}</dd>
    </div>
  );
}

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-text-dim">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

/**
 * One card per AI feature: what runs, on which model and thinking level, what it
 * may draw on, what checks its output, and how it is known to fail.
 */
export function ModelCards({ cards, models }: { cards: readonly ModelCard[]; models: TierModels }) {
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((c) => (
        <li key={c.id} className="min-w-0">
          <article
            id={`card-${c.id}`}
            aria-labelledby={`card-${c.id}-title`}
            data-model-card={c.id}
            className="flex h-full flex-col gap-3 rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6"
          >
            <header>
              <p className="font-mono text-xs text-text-dim">{c.when === 'build' ? 'Runs once, at build time' : 'Runs when a visitor asks'}</p>
              <h3 id={`card-${c.id}-title`} className="mt-1 font-display text-xl font-semibold text-text-primary">
                {c.title}
              </h3>
            </header>
            <p className="text-sm leading-relaxed text-text-secondary">{c.does}</p>
            <dl className="flex flex-col gap-3">
              <Row term="Where">{c.where}</Row>
              <Row term={c.tier === 'embedding' ? 'Model' : `Models (${c.tier} tier)`}>
                <ModelLine tier={c.tier} models={models} />
              </Row>
              {c.features.length ? (
                <Row term="Route">
                  {c.features.map((f, i) => (
                    <span key={f}>
                      {i ? ', ' : ''}
                      <code className="font-mono text-[13px]">/api/ai/{f}</code>
                    </span>
                  ))}
                </Row>
              ) : null}
              <Row term="Known failure modes">
                <List items={c.failureModes} />
              </Row>
            </dl>
            {/* The longer lists fold away, so nine cards stay scannable on a phone. */}
            <details className="ai-lab-details -mx-2 rounded-xl" data-card-details="">
              <summary className="ring-focus flex min-h-11 cursor-pointer items-center rounded-xl px-2 text-sm font-semibold text-text-primary">
                Grounding, evidence and checks
              </summary>
              <dl className="flex flex-col gap-3 px-2 pb-2">
                <Row term="Grounded in">
                  <List items={c.grounding} />
                </Row>
                <Row term="Evidence classes">
                  {c.evidence.length ? <List items={c.evidence.map((e) => EVIDENCE_LABELS[e])} /> : 'None: it makes no claim about Oikantik.'}
                </Row>
                <Row term="Checks on the output">
                  <List items={c.validators} />
                </Row>
              </dl>
            </details>
            <dl className="mt-auto">
              <Row term="Evals">
                {c.evals.length ? (
                  <ul className="flex flex-wrap gap-x-4 gap-y-6">
                    {c.evals.map((e) => (
                      <li key={e.label}>
                        <a href={e.href} className="ai-link ring-focus rounded-md">
                          {e.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  'No scored eval yet. Its checks are covered by the feature’s own tests.'
                )}
              </Row>
            </dl>
          </article>
        </li>
      ))}
    </ul>
  );
}
