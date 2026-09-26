'use client';

import { useMemo } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { KaggleData } from '@/lib/kaggle/types';
import { cn } from '@/utils/cn';
import { KaggleBadgeArt } from './KaggleBadgeArt';
import { formatCount, kaggleHref, sortBadges } from './kaggleFormat';

export type KaggleBadgeStripProps = {
  data: Pick<KaggleData, 'badges' | 'profile'>;
  /** Most badges to show; featured ones first, then the newest. */
  limit?: number;
  /**
   * Where the trailing link points: the Kaggle section on this page ('#kaggle'),
   * or by default the Kaggle profile. A '#' link is a plain anchor; the shell's
   * delegated anchor handler (LenisContext useAnchorLinks) glides it under the nav
   * and focuses the section heading. It only writes the URL hash for a SectionId,
   * so add 'kaggle' to SECTIONS in src/lib/site.ts when the section is mounted.
   */
  moreHref?: string;
  className?: string;
};

/**
 * A compact row of featured Kaggle badges for the About / At-a-glance area: each
 * badge's own art and name, then one link to see the rest. Featured badges lead;
 * when none is featured the newest fill the row.
 */
export function KaggleBadgeStrip({ data, limit = 4, moreHref, className }: KaggleBadgeStripProps) {
  const shown = useMemo(() => {
    const sorted = sortBadges(data.badges);
    const featured = sorted.filter((b) => b.featured);
    return (featured.length > 0 ? featured : sorted).slice(0, Math.max(0, limit));
  }, [data.badges, limit]);

  if (shown.length === 0) return null;

  const total = data.badges.length;
  const internal = typeof moreHref === 'string' && moreHref.startsWith('#');
  const href = internal ? moreHref : kaggleHref(data.profile.url);

  return (
    <div data-kaggle-badge-strip="" className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', className)}>
      <ul role="list" aria-label="Featured Kaggle badges" className="flex min-w-0 flex-wrap gap-2">
        {shown.map((b) => (
          <li
            key={`${b.name}-${b.achieved}`}
            data-kaggle-strip-item=""
            className="kaggle-badge inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-glass-border bg-surface-tint py-1 pr-3 pl-1"
          >
            <KaggleBadgeArt badge={b} size={32} decorative />
            <span className="min-w-0 text-xs font-medium leading-snug text-text-secondary [overflow-wrap:anywhere]">{b.name}</span>
          </li>
        ))}
      </ul>
      {href ? (
        <a
          href={href}
          {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer', 'data-cursor': 'open' })}
          data-kaggle-strip-more=""
          className="ring-focus inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 font-mono text-xs text-cyan-text transition-colors hover:text-text-primary"
        >
          {total > shown.length ? `All ${formatCount(total)} Kaggle badges` : 'Kaggle profile'}
          {internal ? (
            <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          {internal ? null : <span className="sr-only"> (opens in new tab)</span>}
        </a>
      ) : null}
    </div>
  );
}
