import type { ReactNode } from 'react';
import { ChevronDown, CirclePlay } from 'lucide-react';
import { Reveal } from '@/components/motion';
import {
  COREFORGE_AUDIENCE,
  COREFORGE_CHANGELOG,
  COREFORGE_FAQ,
  COREFORGE_FEATURES,
  COREFORGE_FREE_PLAN_LINE,
  COREFORGE_POSITIONING,
  COREFORGE_RESOURCES,
} from '@/lib/coreforge/facts';
import { CTA, VENTURE_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { BuiltWith } from './BuiltWith';
import { CoreforgeButton, CoreforgeLink } from './CoreforgeLink';
import { DeviceShowcase } from './DeviceShowcase';
import { CoreforgeDisclaimer } from './Disclaimer';
import { FeatureCard } from './FeatureCard';
import { MiniDemo } from './MiniDemo';
import { NewsList, type CoreforgeNewsItem } from './NewsList';
import { PricingTeaser } from './PricingTeaser';
import { QRCard } from './QRCard';
import { ShareButton } from './ShareButton';
import { StatsRow } from './StatsRow';

type Props = {
  /** goldensdmat.in news for the 'Latest dMAT news' block; the block is left out when empty. */
  newsItems?: readonly CoreforgeNewsItem[];
  /** The portfolio's own URL for this page. When set, Share shares it; otherwise Share shares goldensdmat.in. */
  shareUrl?: string;
  /** Wrap in the site's max-w-6xl content column (default). Turn off if the route already does. */
  contained?: boolean;
  className?: string;
};

const P = 'venture';

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso: string) => DATE_FMT.format(Date.parse(`${iso}T00:00:00Z`));

function Block({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('mt-24 scroll-mt-(--nav-offset) sm:mt-32', className)}>
      <Reveal>
        <h2 id={`${id}-title`} className="font-display text-h2 font-bold text-balance text-text-primary">
          {title}
        </h2>
      </Reveal>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}

function Ctas({ placement, size = 'lg' }: { placement: string; size?: 'md' | 'lg' }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CoreforgeButton
        path={CTA.demo.path}
        placement={`${placement}-demo`}
        size={size}
        magnetic
        leadingIcon={<CirclePlay aria-hidden="true" className="size-4 shrink-0" />}
      >
        {CTA.demo.label}
      </CoreforgeButton>
      <CoreforgeButton path={CTA.start.path} placement={`${placement}-start`} size={size} variant="secondary">
        {CTA.start.label}
      </CoreforgeButton>
      <CoreforgeButton path={CTA.doINeed.path} placement={`${placement}-do-i-need`} size={size} variant="ghost">
        {CTA.doINeed.label}
      </CoreforgeButton>
      <CoreforgeButton path={CTA.wizard.path} placement={`${placement}-wizard`} size={size} variant="ghost">
        {CTA.wizard.label}
      </CoreforgeButton>
    </div>
  );
}

/**
 * Full-page content for /ventures/coreforge: hero, device gallery, features and free resources, numbers, how the questions are generated (with the
 * playable puzzle), Free versus Pro, the changelog, optional news, an FAQ that works
 * without JavaScript (native details/summary), and a closing call to action with the
 * disclaimer. The route supplies SubpageHeader, <main id="main"> and Footer.
 *
 * A server component: the QR code, FAQ, changelog and copy render on the server, and
 * only MiniDemo, ShareButton, Reveal, DeviceShowcase, StatsRow and the tracked links
 * hydrate as client islands. Mount it once per page (the hero id is fixed).
 */
export function VenturePage({ newsItems = [], shareUrl, contained = true, className }: Props) {
  const heroId = 'cf-venture-title';
  const body = (
    <article aria-labelledby={heroId} data-cf-venture="" className="relative isolate">
      <div aria-hidden="true" className="cf-bloom pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem]" />

      <header className="grid gap-12 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
        {/* The hero text renders at once: it is the page's first paint and likely its LCP. */}
        <div>
          <p className="flex flex-wrap items-center gap-3 font-mono text-eyebrow text-cyan-text uppercase">
            <span aria-hidden="true" className="cf-pulse-dot" />
            {VENTURE_COPY.eyebrow}
          </p>
          <h1 id={heroId} className="mt-4 font-display text-h1 font-bold text-balance text-text-primary">
            {VENTURE_COPY.title}
          </h1>
          <p className="mt-6 max-w-2xl text-lead text-text-secondary">{COREFORGE_POSITIONING}</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-muted">{COREFORGE_AUDIENCE}</p>
          <div className="mt-8">
            <Ctas placement={`${P}-hero`} />
            <p className="mt-4 text-sm text-text-muted">
              <span className="font-medium text-text-secondary">{COREFORGE_FREE_PLAN_LINE}.</span>{' '}
              <CoreforgeLink path={CTA.pricing.path} placement={`${P}-hero-pricing`}>
                {CTA.pricing.label}
              </CoreforgeLink>
            </p>
            <CoreforgeDisclaimer className="mt-6 max-w-2xl" />
          </div>
        </div>
        <Reveal variant="fade" delay={0.15} className="flex flex-wrap items-end gap-4 lg:justify-end">
          <QRCard placement={`${P}-qr`} className="hidden md:inline-flex" />
          <ShareButton url={shareUrl} placement={`${P}-share`} />
        </Reveal>
      </header>

      <Block id="cf-gallery" title={VENTURE_COPY.galleryTitle}>
        <DeviceShowcase variant="gallery" placement={`${P}-gallery`} />
      </Block>

      <Block id="cf-features" title={VENTURE_COPY.featuresTitle}>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {COREFORGE_FEATURES.map((f, i) => (
            <FeatureCard key={f.id} feature={f} placement={`${P}-feature`} lead={i === 0} headingLevel="h3" />
          ))}
        </ul>
        <div className="mt-12">
          <StatsRow />
        </div>
      </Block>

      <Block id="cf-resources" title={VENTURE_COPY.resourcesTitle}>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {COREFORGE_RESOURCES.map((r) => (
            <FeatureCard key={r.id} feature={r} placement={`${P}-resource`} headingLevel="h3" />
          ))}
        </ul>
      </Block>

      <Block id="cf-how" title={VENTURE_COPY.howTitle}>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <BuiltWith hideTitle />
          <div className="rounded-2xl border border-glass-border bg-glass-fill p-6 sm:p-8">
            <MiniDemo placement={`${P}-minidemo`} headingLevel="h3" />
          </div>
        </div>
      </Block>

      <Block id="cf-pricing" title={VENTURE_COPY.pricingTitle}>
        <PricingTeaser placement={`${P}-pricing`} headingLevel="h2" hideTitle />
      </Block>

      <Block id="cf-changelog" title={VENTURE_COPY.changelogTitle}>
        <ol className="cf-timeline grid max-w-3xl gap-10">
          {COREFORGE_CHANGELOG.map((m) => (
            <li key={m.date + m.title} className="relative pl-10">
              <span aria-hidden="true" className="cf-timeline-node" />
              <time dateTime={m.date} className="font-mono text-xs text-text-muted">
                {formatDate(m.date)}
              </time>
              <h3 className="mt-1 font-display text-lg font-semibold text-balance text-text-primary">{m.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{m.summary}</p>
              <CoreforgeLink path={m.path} placement={`${P}-changelog`} className="tap-safe-sm mt-2 justify-start text-sm">
                Read the entry
              </CoreforgeLink>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <CoreforgeButton path={CTA.changelog.path} placement={`${P}-changelog-all`} variant="secondary">
            {CTA.changelog.label}
          </CoreforgeButton>
        </div>
      </Block>

      {newsItems.length > 0 ? (
        <Block id="cf-news" title={VENTURE_COPY.newsTitle}>
          <NewsList items={newsItems} placement={`${P}-news`} limit={6} hideTitle className="max-w-3xl" />
          <div className="mt-6">
            <CoreforgeLink path={CTA.news.path} placement={`${P}-news-all`} className="tap-safe-sm justify-start">
              {CTA.news.label}
            </CoreforgeLink>
          </div>
        </Block>
      ) : null}

      <Block id="cf-faq" title={VENTURE_COPY.faqTitle}>
        <div className="max-w-3xl divide-y divide-hairline border-y border-hairline">
          {COREFORGE_FAQ.map((f) => (
            <details key={f.id} className="cf-faq group" data-cf-faq={f.id}>
              <summary className="flex min-h-14 items-center justify-between gap-4 py-4 text-left font-medium text-text-primary ring-focus">
                <span className="text-base">{f.q}</span>
                <ChevronDown aria-hidden="true" className="cf-faq-chevron size-4 shrink-0 text-text-muted" />
              </summary>
              <div className="pb-5">
                <p className="text-sm leading-relaxed text-text-secondary">{f.a}</p>
                <CoreforgeLink path={f.path} placement={`${P}-faq-${f.id}`} className="tap-safe-sm mt-2 justify-start text-sm">
                  More on goldensdmat.in
                </CoreforgeLink>
              </div>
            </details>
          ))}
        </div>
      </Block>

      <Block id="cf-start" title={VENTURE_COPY.closingTitle} className="pb-8">
        <p className="-mt-4 max-w-2xl text-lead text-text-secondary">{VENTURE_COPY.closingLead}</p>
        <div className="mt-8">
          <Ctas placement={`${P}-closing`} />
        </div>
        <div className="mt-12 flex flex-col gap-6 border-t border-hairline pt-8 sm:flex-row sm:items-center sm:justify-between">
          <CoreforgeDisclaimer variant="full" className="max-w-3xl" />
          <ShareButton url={shareUrl} placement={`${P}-closing-share`} className="shrink-0 self-start sm:self-auto" />
        </div>
      </Block>
    </article>
  );

  return contained ? <div className={cn('mx-auto max-w-6xl px-4 pb-16 sm:px-8', className)}>{body}</div> : <div className={className}>{body}</div>;
}

export default VenturePage;
