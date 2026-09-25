'use client';

import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, BookOpen, FileText } from 'lucide-react';
import { CopyButton } from '@/components/ui/CopyButton';
import reading from '@/data/reading.json';
import { cn } from '@/utils/cn';

type Kind = 'paper' | 'book';

type Item = {
  title: string;
  authors: string;
  year: string;
  kind: Kind;
  tag: string;
  note: string;
  url: string;
};

const ITEMS = reading as Item[];
const TAGS = Array.from(new Set(ITEMS.map((i) => i.tag)));
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'paper', label: 'Papers' },
  { kind: 'book', label: 'Books' },
];

/** 'Vaswani et al. (2017). Attention Is All You Need. https://arxiv.org/abs/1706.03762' */
export function citationFor(item: Pick<Item, 'authors' | 'year' | 'title' | 'url'>): string {
  return `${item.authors} (${item.year}). ${item.title}. ${item.url}`;
}

/** '1706.03762' for an arxiv.org/abs or /pdf link, else null. */
export function arxivId(url: string): string | null {
  return /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(url)?.[1] ?? null;
}

function FilterChip({
  pressed,
  count,
  onClick,
  children,
}: {
  pressed: boolean;
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'tap-safe-sm ring-focus gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
        pressed
          ? 'border-violet-bright bg-surface-tint text-text-primary'
          : 'border-glass-border text-text-secondary hover:border-glass-border-strong hover:text-text-primary',
      )}
    >
      {children}
      <span className="font-mono text-[11px] tabular-nums text-text-muted">{count}</span>
    </button>
  );
}

/**
 * Papers and books behind the work. Filter by topic or by papers/books; each card
 * is an <article> with its title link and a separate actions row, so no control
 * sits inside another.
 */
export function ReadingList() {
  const [tag, setTag] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const baseId = useId();

  const shown = useMemo(
    () => ITEMS.filter((i) => (tag === null || i.tag === tag) && (kind === null || i.kind === kind)),
    [tag, kind],
  );
  // Each group's counts respect the other group's filter, so a chip never promises items that won't show.
  const tagCount = (t: string | null) => ITEMS.filter((i) => (t === null || i.tag === t) && (kind === null || i.kind === kind)).length;
  const kindCount = (k: Kind) => ITEMS.filter((i) => i.kind === k && (tag === null || i.tag === tag)).length;

  return (
    <section aria-labelledby={`${baseId}-title`} data-reading-list="" className="glass-strong rounded-2xl p-6 md:p-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen aria-hidden="true" className="size-4 shrink-0 text-cyan-text" />
        <div>
          <h3 id={`${baseId}-title`} className="font-display text-lg font-semibold text-text-primary">
            What I&apos;m reading
          </h3>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
            Papers and books that shape how I build
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by topic" className="flex flex-wrap gap-2">
          <FilterChip pressed={tag === null} count={tagCount(null)} onClick={() => setTag(null)}>
            All
          </FilterChip>
          {TAGS.map((t) => (
            <FilterChip key={t} pressed={tag === t} count={tagCount(t)} onClick={() => setTag((cur) => (cur === t ? null : t))}>
              {t}
            </FilterChip>
          ))}
        </div>
        <div role="group" aria-label="Filter by format" className="flex flex-wrap gap-2">
          {KINDS.map(({ kind: k, label }) => (
            <FilterChip key={k} pressed={kind === k} count={kindCount(k)} onClick={() => setKind((cur) => (cur === k ? null : k))}>
              {label}
            </FilterChip>
          ))}
        </div>
      </div>

      <p role="status" className="sr-only">
        {shown.length} of {ITEMS.length} shown
      </p>

      <ul data-reading-grid="" className="relative grid grid-cols-1 gap-3 md:auto-rows-fr md:grid-cols-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((item) => {
            const id = `${baseId}-${ITEMS.indexOf(item)}`;
            const arxiv = arxivId(item.url);
            return (
              <motion.li
                key={item.title}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="min-w-0"
              >
                <article
                  aria-labelledby={id}
                  data-reading-item=""
                  className="flex h-full flex-col rounded-xl border border-hairline bg-surface-tint p-4 transition-colors hover:border-glass-border-strong"
                >
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-dim">
                    {item.kind === 'paper' ? (
                      <FileText aria-hidden="true" className="size-3 text-violet-bright" />
                    ) : (
                      <BookOpen aria-hidden="true" className="size-3 text-cyan-text" />
                    )}
                    <span>
                      {item.tag} · {item.year}
                    </span>
                    {arxiv && (
                      <span className="rounded-full border border-glass-border px-2 py-px normal-case tracking-normal text-text-muted">
                        arXiv:{arxiv}
                      </span>
                    )}
                  </div>
                  <h4 id={id} className="mt-2 text-sm font-semibold leading-snug text-text-primary">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ring-focus -mx-1 block min-h-11 rounded px-1 py-2 transition-colors hover:text-violet-bright"
                    >
                      {item.title}
                      <ArrowUpRight aria-hidden="true" className="-mt-0.5 ml-1 inline size-3.5 align-middle" />
                      <span className="sr-only"> (opens in new tab)</span>
                    </a>
                  </h4>
                  <p className="text-[11px] text-text-dim">{item.authors}</p>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-text-muted">{item.note}</p>
                  <div className="mt-3 flex items-center border-t border-hairline pt-3">
                    <CopyButton
                      value={citationFor(item)}
                      label="Copy citation"
                      copiedLabel="Citation copied"
                      variant="ghost"
                      size="sm"
                      className="-ml-2"
                    />
                  </div>
                </article>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {shown.length === 0 && (
        <p className="mt-2 text-sm text-text-muted">
          Nothing matches both filters.{' '}
          <button
            type="button"
            onClick={() => {
              setTag(null);
              setKind(null);
            }}
            className="tap-safe-sm ring-focus rounded px-1 font-medium text-violet-bright underline underline-offset-4"
          >
            Clear filters
          </button>
        </p>
      )}
    </section>
  );
}
