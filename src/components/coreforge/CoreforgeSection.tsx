'use client';

import { CirclePlay } from 'lucide-react';
import { Reveal } from '@/components/motion';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { COREFORGE_BRAND, COREFORGE_FEATURES, COREFORGE_FREE_PLAN_LINE, COREFORGE_POSITIONING } from '@/lib/coreforge/facts';
import { CTA, SECTION_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { BuiltWith } from './BuiltWith';
import { CoreforgeButton, CoreforgeLink } from './CoreforgeLink';
import { DeviceShowcase } from './DeviceShowcase';
import { CoreforgeDisclaimer } from './Disclaimer';
import { FeatureCard } from './FeatureCard';
import { MiniDemo } from './MiniDemo';
import { NewsList, type CoreforgeNewsItem } from './NewsList';
import { PricingTeaser } from './PricingTeaser';
import { ShareButton } from './ShareButton';
import { StatsRow } from './StatsRow';

type Props = {
  /** Section id; the h2 gets `${id}-title`. */
  id?: string;
  /** goldensdmat.in news for the slot beside the pricing card; nothing renders when empty. */
  newsItems?: readonly CoreforgeNewsItem[];
  className?: string;
};

const P = 'section';

/**
 * The home page's CoreForge section: the founder headline and CTAs beside real device
 * captures, CoreForge's published numbers, the feature grid, a playable mini puzzle
 * next to the engineering story, the Free-versus-Pro teaser, an optional news slot and
 * CoreForge's disclaimer. Every outbound link is UTM-tagged per placement.
 */
export function CoreforgeSection({ id = 'coreforge', newsItems = [], className }: Props) {
  const [lead, ...rest] = COREFORGE_FEATURES;
  const hasNews = newsItems.length > 0;
  return (
    <SectionWrapper id={id} className={className} background={<div className="cf-bloom absolute inset-0" />}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="min-w-0">
          <SectionHeading kicker={SECTION_COPY.eyebrow} title={SECTION_COPY.title} subtitle={COREFORGE_POSITIONING} className="mb-8" />
          <Reveal delay={0.2}>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="cf-pulse-dot" />
                {SECTION_COPY.founderMeta}
              </span>
              <CoreforgeLink path={CTA.visit.path} placement={`${P}-domain`} className="tap-safe-sm justify-start">
                {COREFORGE_BRAND.domain}
              </CoreforgeLink>
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <CoreforgeButton
                path={CTA.demo.path}
                placement={`${P}-demo`}
                size="lg"
                magnetic
                leadingIcon={<CirclePlay aria-hidden="true" className="size-4 shrink-0" />}
              >
                {CTA.demo.label}
              </CoreforgeButton>
              <CoreforgeButton path={CTA.start.path} placement={`${P}-start`} size="lg" variant="secondary">
                {CTA.start.label}
              </CoreforgeButton>
              <CoreforgeButton path={CTA.doINeed.path} placement={`${P}-do-i-need`} size="lg" variant="ghost">
                {CTA.doINeed.label}
              </CoreforgeButton>
            </div>
            <p className="mt-4 text-sm text-text-muted">
              <span className="font-medium text-text-secondary">{COREFORGE_FREE_PLAN_LINE}.</span>{' '}
              <CoreforgeLink path={CTA.pricing.path} placement={`${P}-pricing-line`}>
                {CTA.pricing.label}
              </CoreforgeLink>
            </p>
          </Reveal>
        </div>
        <Reveal variant="fade" delay={0.1} className="min-w-0">
          <DeviceShowcase placement={`${P}-showcase`} />
        </Reveal>
      </div>

      <Reveal className="mt-16">
        <StatsRow />
      </Reveal>

      <div className="mt-24">
        <h3 className="font-display text-h3 font-semibold text-text-primary">{SECTION_COPY.featuresTitle}</h3>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lead ? <FeatureCard feature={lead} placement={`${P}-feature`} lead /> : null}
          {rest.map((f) => (
            <FeatureCard key={f.id} feature={f} placement={`${P}-feature`} />
          ))}
        </ul>
      </div>

      <div className="mt-24 grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal className="rounded-2xl border border-glass-border bg-glass-fill p-6 sm:p-8">
          <MiniDemo placement={`${P}-minidemo`} />
        </Reveal>
        <Reveal delay={0.1}>
          <BuiltWith />
        </Reveal>
      </div>

      <div className={cn('mt-24 grid gap-12', hasNews && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-16')}>
        <PricingTeaser placement={`${P}-pricing`} />
        {hasNews ? <NewsList items={newsItems} placement={`${P}-news`} /> : null}
      </div>

      <div className="mt-16 flex flex-col gap-6 border-t border-hairline pt-8 sm:flex-row sm:items-center sm:justify-between">
        <CoreforgeDisclaimer variant="full" className="max-w-3xl" />
        <ShareButton placement={`${P}-share`} className="shrink-0 self-start sm:self-auto" />
      </div>
    </SectionWrapper>
  );
}

export default CoreforgeSection;
