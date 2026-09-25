'use client';

import { useId, useMemo, useState } from 'react';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { CopyButton } from '@/components/ui/CopyButton';
import {
  COMPARE_DIMS,
  NOT_LISTED,
  compareFacts,
  compareMarkdown,
  type CompareCell,
  type CompareView,
  type ProjectSource,
} from '@/lib/ai/prompts/projects';
import { cn } from '@/utils/cn';

type Props = {
  project: ProjectSource;
  /** Every other project, in grid order. */
  others: readonly ProjectSource[];
  /** Precomputed AI rows for this project, keyed by the other slug (selectCaseStudyAi). */
  compare: Readonly<Record<string, CompareView>>;
  /** GitHub stars by slug, for the stars row. */
  stars?: Readonly<Record<string, number>>;
  className?: string;
};

const CELL = 'min-w-40 border-t border-hairline px-3 py-3 align-top text-sm leading-relaxed';

function Quote({ cell }: { cell: CompareCell | null }) {
  if (!cell) return <span className="text-text-muted">{NOT_LISTED}</span>;
  return <q className="text-text-secondary">{cell.quote}</q>;
}

/**
 * 'Compare with…' (#205). The data rows (category, language, live demo, stack
 * overlap, stars once they are a signal) are computed here; the three quoted rows
 * come from the store, where every cell is a verbatim quote from that project's
 * own write-up (re-checked on selection) or 'Not listed'. No request is made.
 */
export function CompareTable({ project, others, compare, stars, className }: Props) {
  const selectId = useId();
  const captionId = useId();
  const [otherSlug, setOtherSlug] = useState('');
  const other = others.find((o) => o.slug === otherSlug) ?? null;

  const table = useMemo(() => {
    if (!other) return null;
    const facts = compareFacts(project, other, stars ? { a: stars[project.slug] ?? 0, b: stars[other.slug] ?? 0 } : undefined);
    const ai = compare[other.slug] ?? null;
    const rows = ai?.rows ?? [];
    return { facts, ai, rows, markdown: compareMarkdown(project, other, facts, rows) };
  }, [project, other, compare, stars]);

  return (
    <div className={cn('flex flex-col gap-4', className)} data-ai-compare="">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor={selectId} className="text-sm text-text-secondary">
          Compare with
        </label>
        <select
          id={selectId}
          value={otherSlug}
          onChange={(e) => setOtherSlug(e.target.value)}
          className="ai-compare-select ring-focus"
          data-compare-select=""
        >
          <option value="">Choose a project…</option>
          {others.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {other && table ? (
        <>
          {/* A keyboard-scrollable region, so a narrow screen scrolls the table rather than the page. */}
          <div className="ai-compare-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
            <table className="w-full min-w-[34rem] border-collapse text-left" data-compare-with={other.slug}>
              <caption id={captionId} className="mb-3 text-left text-sm font-medium text-text-primary">
                {project.name} compared with {other.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-36 px-3 pb-2 text-xs font-medium text-text-muted">
                    <span className="sr-only">Aspect</span>
                  </th>
                  <th scope="col" className="px-3 pb-2 text-sm font-semibold text-text-primary">
                    {project.name}
                  </th>
                  <th scope="col" className="px-3 pb-2 text-sm font-semibold text-text-primary">
                    {other.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.facts.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className={cn(CELL, 'min-w-0 font-medium text-text-muted')}>
                      {r.label}
                    </th>
                    {'both' in r ? (
                      <td colSpan={2} className={cn(CELL, 'text-text-secondary')}>
                        {r.both}
                      </td>
                    ) : (
                      <>
                        <td className={cn(CELL, 'text-text-secondary')}>{r.a}</td>
                        <td className={cn(CELL, 'text-text-secondary')}>{r.b}</td>
                      </>
                    )}
                  </tr>
                ))}
                {table.rows.map((r) => (
                  <tr key={r.dim} data-compare-ai-row={r.dim}>
                    <th scope="row" className={cn(CELL, 'min-w-0 font-medium text-text-muted')}>
                      {COMPARE_DIMS.find((d) => d.id === r.dim)?.label ?? r.dim}
                      <span className="mt-1 block text-[11px] font-normal text-cyan-text">AI-picked quote</span>
                    </th>
                    <td className={CELL}>
                      <Quote cell={r.a} />
                    </td>
                    <td className={CELL}>
                      <Quote cell={r.b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CopyButton value={table.markdown} label="Copy as Markdown" copiedLabel="Copied" toastMessage="Comparison copied as Markdown" />
            {table.ai ? (
              <p className="text-xs text-text-muted" data-ai-provenance="">
                Quoted rows: {table.ai.provenance}
              </p>
            ) : null}
          </div>
          {table.ai ? (
            <AIDisclosure note="Quoted rows were picked by AI, word for word from each project’s own write-up." />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default CompareTable;
