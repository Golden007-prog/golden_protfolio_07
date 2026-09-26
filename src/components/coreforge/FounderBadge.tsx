'use client';

import { ArrowUpRight } from 'lucide-react';
import { COREFORGE_BRAND, COREFORGE_DISCLAIMER_SHORT, COREFORGE_PATHS } from '@/lib/coreforge/brand';
import { useCoreforgeLink } from '@/lib/coreforge/track';
import { cn } from '@/utils/cn';

export type FounderBadgeVariant = 'hero' | 'nav' | 'inline';

type Props = {
  variant?: FounderBadgeVariant;
  /** Overrides the default placement ('founder-badge-<variant>'). */
  placement?: string;
  className?: string;
};

// hero: a roomy pill under the hero headline. nav: fits the floating navbar's 44px row.
// inline: sits in running text (About copy, experience role line).
const VARIANT: Record<FounderBadgeVariant, string> = {
  hero: 'tap-safe gap-2 px-4 text-sm glass glass-keep',
  nav: 'tap-safe gap-1.5 px-3 text-[13px]',
  inline: 'tap-safe-sm gap-1.5 px-2.5 text-[13px] align-middle',
};

/**
 * 'Founder · CoreForge ↗': a compact pill linking to goldensdmat.in. The accessible
 * name starts with the visible words (so voice control can target them) and then
 * spells out the company, the disclaimer and the domain, since the pill is terse.
 */
export function FounderBadge({ variant = 'inline', placement, className }: Props) {
  const link = useCoreforgeLink(COREFORGE_PATHS.home, placement ?? `founder-badge-${variant}`);
  return (
    <a
      {...link}
      data-cf-badge={variant}
      data-cursor="open"
      className={cn(
        'group/cf inline-flex shrink-0 items-center rounded-full border border-(--cf-berry-border) font-medium whitespace-nowrap text-text-primary ring-focus transition-colors hover:bg-(--cf-berry-tint)',
        variant !== 'hero' && 'bg-(--cf-berry-tint)',
        VARIANT[variant],
        className,
      )}
    >
      <span aria-hidden="true" className="cf-pulse-dot shrink-0" />
      <span>
        Founder{' '}
        <span aria-hidden="true" className="text-text-muted">
          ·
        </span>{' '}
        <span className="text-(--cf-berry-text)">{COREFORGE_BRAND.product}</span>
      </span>
      <span className="sr-only">
        {`, ${COREFORGE_BRAND.company}. ${COREFORGE_DISCLAIMER_SHORT} at ${COREFORGE_BRAND.domain} (opens in new tab)`}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-hover/cf:-translate-y-px group-hover/cf:translate-x-px group-hover/cf:text-text-primary"
      />
    </a>
  );
}

export default FounderBadge;
