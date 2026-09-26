'use client';

import { ArrowUpRight } from 'lucide-react';
import { COREFORGE_ICONS } from '@/lib/coreforge/icons';
import type { CoreforgeFeature } from '@/lib/coreforge/facts';
import { useCoreforgeLink } from '@/lib/coreforge/track';
import { cn } from '@/utils/cn';

type Props = {
  feature: CoreforgeFeature;
  placement: string;
  /** The lead card of a grid: larger title, spans two columns from md up. */
  lead?: boolean;
  as?: 'li' | 'div';
  /** h4 under a section's h3 (the home section), h3 on the venture page. */
  headingLevel?: 'h3' | 'h4';
  className?: string;
};

/**
 * One CoreForge feature. The whole card is the link (a stretched ::after on the title
 * link), so it is one tab stop with one accessible name: the title. Features the
 * /pricing table marks 'Pro only' carry a Pro chip, so they never read as free.
 */
export function FeatureCard({ feature, placement, lead = false, as: Tag = 'li', headingLevel = 'h4', className }: Props) {
  const Heading = headingLevel;
  const Icon = COREFORGE_ICONS[feature.icon];
  const link = useCoreforgeLink(feature.path, `${placement}-${feature.id}`);
  return (
    <Tag
      data-cf-feature={feature.id}
      className={cn(
        // The whole card is the target, so the focus cue is drawn around the whole card.
        'group/card relative flex flex-col gap-3 rounded-2xl border border-glass-border bg-glass-fill p-6 transition-colors hover:border-(--cf-berry-border) has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-(--app-focus-ring)',
        lead && 'md:col-span-2 md:p-8',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-xl border border-(--cf-berry-border) bg-(--cf-berry-tint) text-(--cf-berry-text)"
        >
          <Icon className="size-5" />
        </span>
        {feature.plan === 'pro' ? (
          <span
            aria-hidden="true"
            data-cf-plan="pro"
            className="rounded-full border border-(--cf-berry-border) px-2 py-0.5 font-mono text-[11px] leading-4 text-(--cf-berry-text)"
          >
            Pro
          </span>
        ) : null}
      </div>
      <Heading className={cn('font-display font-semibold text-balance text-text-primary', lead ? 'text-xl md:text-2xl' : 'text-base')}>
        <a
          {...link}
          data-cursor="open"
          className="rounded-sm ring-focus after:absolute after:inset-0 after:rounded-2xl after:content-['']"
        >
          {feature.title}
          {feature.plan === 'pro' ? <span className="sr-only">, on the Pro plan</span> : null}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </Heading>
      <p className={cn('text-text-muted', lead ? 'text-base leading-relaxed' : 'text-sm leading-relaxed')}>{feature.body}</p>
      <ArrowUpRight
        aria-hidden="true"
        className="absolute top-6 right-6 size-4 text-text-dim transition-[color,translate] duration-200 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 group-hover/card:text-(--cf-berry-text)"
      />
    </Tag>
  );
}

export default FeatureCard;
