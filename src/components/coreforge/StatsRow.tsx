'use client';

import { CountUp } from '@/components/motion';
import { COREFORGE_STATS, type CoreforgeStat } from '@/lib/coreforge/facts';
import { SECTION_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';

type Props = {
  stats?: readonly CoreforgeStat[];
  className?: string;
};

/**
 * CoreForge's own published numbers (module counts, exam timing, the demo's daily
 * allowance). CountUp keeps the final value in the server HTML and in sr-only text.
 */
export function StatsRow({ stats = COREFORGE_STATS, className }: Props) {
  return (
    <dl
      aria-label={SECTION_COPY.statsLabel}
      data-cf-stats=""
      className={cn('grid grid-cols-2 gap-px overflow-clip rounded-2xl border border-glass-border bg-hairline sm:grid-cols-3 xl:grid-cols-6', className)}
    >
      {stats.map((s) => (
        <div key={s.id} className="flex flex-col-reverse gap-2 bg-bg-base p-4 sm:p-6">
          <dt className="text-xs leading-snug text-text-muted">{s.label}</dt>
          <dd className="font-display text-3xl font-semibold text-text-primary sm:text-4xl">
            <CountUp value={s.value} suffix={s.suffix} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default StatsRow;
