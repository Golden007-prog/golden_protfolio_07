'use client';

import { useId } from 'react';
import type { AiSource } from '@/lib/ai/protocol';
import { cn } from '@/utils/cn';
import { citeParts } from './StreamingText';

type Props = {
  sources: readonly AiSource[];
  /** Ids the answer actually cited, in order of first citation (the done frame's `cited`). */
  cited: readonly string[];
  /** A chip was activated; pass source.target to useAiActionRunner. */
  onOpen: (source: AiSource) => void;
  /** The answer text: numbers then follow its inline chips exactly, whatever order `cited` is in. */
  text?: string;
  className?: string;
};

function asOfLabel(asOf: string): string {
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? asOf : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The Sources footer of an answer: one numbered 44px chip per cited source, in
 * the same numbers the inline chips carry. Reference material (a description
 * of a technology, not evidence of his use of it) and dated live data say so.
 */
export function CitationChips({ sources, cited, onOpen, text, className }: Props) {
  const headingId = useId();
  const byId = new Map(sources.map((s) => [s.id, s]));
  const inText = text ? citeParts(text, sources).flatMap((p) => (p.kind === 'cite' ? [p.source.id] : [])) : [];
  const allowed = new Set(cited);
  const order = [...new Set([...inText.filter((id) => allowed.has(id)), ...cited])];
  const items = order.map((id) => byId.get(id)).filter((s): s is AiSource => Boolean(s));
  if (items.length === 0) return null;

  return (
    <div data-ai-sources="" className={cn('mt-3', className)}>
      <p id={headingId} className="mb-1 text-xs font-medium text-text-muted">
        Sources
      </p>
      <ol aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {items.map((s, i) => (
          <li key={s.id} className="min-w-0 max-w-full">
            <button
              type="button"
              data-cite-id={s.id}
              data-cursor="open"
              onClick={() => onOpen(s)}
              className="tap-safe max-w-full justify-start gap-2 rounded-full border border-glass-border bg-glass-fill py-1.5 pl-1.5 pr-3.5 text-left text-[13px] leading-snug text-text-secondary ring-focus transition-colors duration-200 hover:border-violet-bright hover:text-text-primary"
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-tint font-mono text-[11px] font-semibold text-cyan-text"
              >
                {i + 1}
              </span>
              <span className="sr-only">Source {i + 1}: </span>
              <span className="min-w-0 truncate">{s.label}</span>
              {s.cls === 'reference' ? <span className="shrink-0 text-xs text-text-muted">· reference</span> : null}
              {s.cls === 'live' && s.asOf ? <span className="shrink-0 text-xs text-text-muted">· as of {asOfLabel(s.asOf)}</span> : null}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
