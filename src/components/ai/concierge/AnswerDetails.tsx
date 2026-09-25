'use client';

import { ChevronRight } from 'lucide-react';
import type { AiSource, AiUsage, RetrievalHit } from '@/lib/ai/protocol';
import { GATE } from '@/lib/ai/retrieval';
import { scrubCanary } from './useConversation';

export type AnswerRoute = 'rules' | 'cache' | 'RAG' | 'fallback';

type Props = {
  model: string;
  route: AnswerRoute;
  /** Retrieval mode behind a RAG answer. */
  mode?: 'hybrid' | 'lexical' | 'full';
  ttftMs: number | null;
  totalMs: number | null;
  usage?: AiUsage;
  retrieval: readonly RetrievalHit[];
  sources: readonly AiSource[];
  cited: readonly string[];
};

const ms = (n: number | null) => (n === null ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const score = (n: number | null) => (n === null ? '—' : n.toFixed(3));

const ROUTE_LABEL: Record<AnswerRoute, string> = {
  rules: "Rules (the site's data, no AI)",
  cache: 'Cache (a saved AI answer)',
  RAG: 'RAG (retrieval, then Gemini)',
  fallback: 'Fallback to the rules',
};

/**
 * A collapsed 'Details' disclosure under an AI answer: which model and route
 * answered, how long it took, the token counts, and the retrieved chunks as a
 * table (BM25, cosine, fused rank; cited, used as context, or dropped by the
 * packer) with the relevance gate. It shows no prompt: /ai documents the defences.
 */
export function AnswerDetails({ model, route, mode, ttftMs, totalMs, usage, retrieval, sources, cited }: Props) {
  const inContext = new Set(sources.map((s) => s.id));
  const label = new Map(sources.map((s) => [s.id, s.label]));
  const citedSet = new Set(cited);
  const rows = retrieval.slice(0, 10);

  return (
    <details data-ask-details="" className="ask-details mt-2 text-xs text-text-muted">
      <summary className="tap-safe ask-details-summary ring-focus inline-flex cursor-pointer select-none items-center gap-1 rounded-md pr-2 font-medium text-text-secondary">
        <ChevronRight aria-hidden="true" className="ask-details-chevron size-3.5 shrink-0" />
        Details
      </summary>
      <div className="mt-2 space-y-3 rounded-xl border border-hairline bg-surface-tint p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Model</dt>
          <dd className="font-mono text-text-secondary">{scrubCanary(model) || '—'}</dd>
          <dt>Route</dt>
          <dd className="text-text-secondary">
            {ROUTE_LABEL[route]}
            {route === 'RAG' && mode ? ` · ${mode === 'hybrid' ? 'BM25 + embeddings' : 'BM25 only'}` : null}
          </dd>
          <dt>First sentence</dt>
          <dd className="text-text-secondary">{ms(ttftMs)}</dd>
          <dt>Total</dt>
          <dd className="text-text-secondary">{ms(totalMs)}</dd>
          <dt>Tokens</dt>
          <dd className="text-text-secondary">
            {usage
              ? `${usage.input} in · ${usage.output} out${typeof usage.thoughts === 'number' ? ` · ${usage.thoughts} thinking` : ''}`
              : '—'}
          </dd>
        </dl>

        {rows.length ? (
          <div className="ask-details-table overflow-x-auto" data-lenis-prevent="">
            <table className="w-full min-w-[17rem] border-collapse text-left">
              <caption className="mb-1 text-left text-text-secondary">Retrieved from the site</caption>
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Chunk
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    BM25
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    Cosine
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    Rank
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Use
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const use = citedSet.has(h.id) ? 'cited' : inContext.has(h.id) ? 'context' : 'dropped';
                  return (
                    <tr key={h.id} data-use={use} className="border-b border-hairline last:border-0">
                      <th scope="row" className="max-w-[9rem] truncate py-1 pr-2 font-normal text-text-secondary" title={scrubCanary(h.id)}>
                        {scrubCanary(label.get(h.id) ?? h.id)}
                      </th>
                      <td className="py-1 pr-2 text-right font-mono">{score(h.bm25)}</td>
                      <td className="py-1 pr-2 text-right font-mono">{score(h.cosine)}</td>
                      <td className="py-1 pr-2 text-right font-mono">{h.rank}</td>
                      <td className={use === 'cited' ? 'py-1 text-cyan-text' : 'py-1'}>{use}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <p>
          Relevance gate: a chunk from his own content needs BM25 ≥ {GATE.lexical} or cosine ≥ {GATE.cosine}, or the model isn&apos;t
          called.
        </p>
      </div>
    </details>
  );
}
