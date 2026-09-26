'use client';

import { useId } from 'react';
import { ArrowUpRight, Trophy } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { Button } from '@/components/ui/Button';
import type { KaggleWriteup } from '@/lib/kaggle/types';
import { cn } from '@/utils/cn';
import { formatDay, kaggleHref } from './kaggleFormat';

export type KaggleWriteupCardProps = {
  writeup: KaggleWriteup;
  /** The card title's level; h4 inside the Kaggle section, h3 where it sits directly under a section h2. */
  headingLevel?: 'h3' | 'h4';
  /** Drops the excerpt, for tight spots such as a project card or case-study sidebar. */
  compact?: boolean;
  className?: string;
};

/**
 * One published Kaggle writeup: type and date, title, subtitle, the competition it
 * was written for, an optional excerpt and a 'Read on Kaggle' link. Every string is
 * the writeup's own: the excerpt is a verbatim passage of its body (see
 * KaggleWriteup.excerpt), which is why it is marked up as a quotation.
 */
export function KaggleWriteupCard({ writeup, headingLevel = 'h3', compact = false, className }: KaggleWriteupCardProps) {
  const titleId = `${useId()}-writeup`;
  const href = kaggleHref(writeup.url);
  const date = formatDay(writeup.published);
  const Heading = headingLevel;

  return (
    <GlassCard
      as="article"
      interactive
      aria-labelledby={titleId}
      data-kaggle-writeup=""
      data-url={href ?? undefined}
      className={cn('flex h-full flex-col p-6 md:p-8', className)}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs text-text-muted">
        {writeup.type ? (
          <span className="rounded-full border border-glass-border bg-surface-tint px-3 py-1 text-text-secondary">
            {writeup.type}
          </span>
        ) : null}
        {date ? (
          <span>
            Published <time dateTime={writeup.published}>{date}</time>
          </span>
        ) : null}
      </p>

      <Heading id={titleId} className="mt-4 font-display text-xl font-semibold leading-tight text-balance text-text-primary">
        {writeup.title}
      </Heading>
      {writeup.subtitle ? (
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{writeup.subtitle}</p>
      ) : null}

      {writeup.competition ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-text-muted">
          <Trophy aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-text" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="sr-only">Written for </span>
            {writeup.competition}
          </span>
        </p>
      ) : null}

      {!compact && writeup.excerpt ? (
        <blockquote cite={href ?? undefined} className="mt-4 border-l border-hairline pl-4 text-sm leading-relaxed text-text-muted">
          <p className="line-clamp-4">{writeup.excerpt}</p>
        </blockquote>
      ) : null}

      {href ? (
        <div className="mt-auto pt-6">
          <Button
            href={href}
            variant="secondary"
            cursor="open"
            data-kaggle-writeup-link=""
            aria-label={`Read on Kaggle: ${writeup.title}`}
            trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}
          >
            Read on Kaggle
          </Button>
        </div>
      ) : null}
    </GlassCard>
  );
}
