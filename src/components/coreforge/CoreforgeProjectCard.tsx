'use client';

import { useId } from 'react';
import Link from 'next/link';
import { ArrowRight, CirclePlay } from 'lucide-react';
import { COREFORGE_BRAND, COREFORGE_BUILT_WITH, COREFORGE_FREE_PLAN_LINE, COREFORGE_POSITIONING } from '@/lib/coreforge/facts';
import { COREFORGE_SHOTS } from '@/lib/coreforge/shots';
import { CTA, PROJECT_CARD_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeButton } from './CoreforgeLink';
import { BrowserFrame } from './DeviceShowcase';
import { CoreforgeDisclaimer } from './Disclaimer';

type Props = {
  /** The portfolio's own CoreForge page, once its route exists ('/ventures/coreforge'). */
  ventureHref?: string;
  placement?: string;
  as?: 'article' | 'div';
  className?: string;
};

/**
 * A featured bento card for the projects grid: text beside a browser capture from md
 * up, stacked on phones. Built to fill a full grid row (md:col-span-2 lg:col-span-6).
 */
export function CoreforgeProjectCard({ ventureHref, placement = 'projects-card', as: Tag = 'article', className }: Props) {
  const titleId = `${useId()}-title`;
  return (
    <Tag
      aria-labelledby={titleId}
      data-cf-project-card=""
      className={cn(
        'relative isolate grid h-full gap-6 overflow-clip rounded-2xl border border-(--cf-berry-border) bg-glass-fill p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center lg:gap-10 lg:p-8',
        className,
      )}
    >
      <div aria-hidden="true" className="cf-bloom pointer-events-none absolute inset-0 -z-10" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-2 rounded-full border border-(--cf-berry-border) bg-(--cf-berry-tint) px-2.5 py-1 text-text-primary">
            <span aria-hidden="true" className="cf-pulse-dot" />
            {PROJECT_CARD_COPY.badge}
          </span>
          <span>{COREFORGE_BRAND.company}</span>
        </p>
        <h3 id={titleId} className="mt-4 font-display text-h3 font-semibold text-text-primary">
          {COREFORGE_BRAND.product}
        </h3>
        <p className="mt-1.5 text-sm leading-snug text-(--cf-berry-text)">{COREFORGE_BRAND.tagline}</p>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">{COREFORGE_POSITIONING}</p>
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Technologies">
          {COREFORGE_BUILT_WITH.map((b) => (
            <li key={b.name} className="rounded-md border border-hairline bg-surface-tint px-2 py-0.5 text-[11px] leading-5 text-text-muted">
              {b.name}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <CoreforgeButton
            path={CTA.demo.path}
            placement={`${placement}-demo`}
            size="sm"
            leadingIcon={<CirclePlay aria-hidden="true" className="size-3.5 shrink-0" />}
          >
            {CTA.demo.label}
          </CoreforgeButton>
          <CoreforgeButton path={CTA.visit.path} placement={`${placement}-visit`} size="sm" variant="secondary">
            {CTA.visit.label}
          </CoreforgeButton>
          {ventureHref ? (
            <Link
              href={ventureHref}
              className="tap-safe-sm gap-1.5 rounded-full px-3 text-[13px] font-medium text-text-secondary ring-focus hover:text-text-primary"
            >
              {PROJECT_CARD_COPY.story}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>
        <p className="mt-4 text-xs text-text-muted">{COREFORGE_FREE_PLAN_LINE}</p>
        {/* A featured card with the full positioning line is promotion at length: standard wording. */}
        <CoreforgeDisclaimer className="mt-1" />
      </div>
      <BrowserFrame shot={COREFORGE_SHOTS['welcome-desktop']} sizes="(min-width: 1024px) 50vw, (min-width: 768px) 45vw, 90vw" />
    </Tag>
  );
}

export default CoreforgeProjectCard;
