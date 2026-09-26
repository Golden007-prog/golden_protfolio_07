'use client';

import { Parallax } from '@/components/motion';
import { COREFORGE_BRAND } from '@/lib/coreforge/facts';
import {
  COREFORGE_SHOTS,
  shotSrc,
  shotSrcSet,
  type CoreforgeShot,
  type CoreforgeShotId,
} from '@/lib/coreforge/shots';
import { cn } from '@/utils/cn';
import { CoreforgeLink } from './CoreforgeLink';

type ShotProps = {
  shot: CoreforgeShot;
  /** A sizes attribute for the srcset. */
  sizes: string;
  priority?: boolean;
  className?: string;
};

/**
 * A pre-optimised screenshot: WebP renditions at 1x and 2x with a tiny blurred WebP
 * behind it until it decodes. A plain <img> because the renditions are already sized
 * and compressed by scripts/coreforge/optimize-shots.mjs.
 */
export function ShotImage({ shot, sizes, priority = false, className }: ShotProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions with their own srcset; the optimiser would only re-encode them
    <img
      src={shotSrc(shot)}
      srcSet={shotSrcSet(shot)}
      sizes={sizes}
      width={shot.width}
      height={shot.height}
      alt={shot.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('cf-shot', className)}
      style={{ backgroundImage: `url("${shot.blurDataURL}")` }}
    />
  );
}

export function BrowserFrame({ shot, sizes, priority, className }: ShotProps) {
  return (
    <div className={cn('cf-browser overflow-clip', className)}>
      <div aria-hidden="true" className="cf-browser-bar">
        <span className="cf-browser-dot" />
        <span className="cf-browser-dot" />
        <span className="cf-browser-dot" />
        <span className="cf-browser-url truncate">
          {COREFORGE_BRAND.domain}
          {shot.path}
        </span>
      </div>
      <ShotImage shot={shot} sizes={sizes} priority={priority} />
    </div>
  );
}

export function PhoneFrame({ shot, sizes, priority, className }: ShotProps) {
  return (
    <div className={cn('cf-phone', className)}>
      <div className="cf-phone-screen overflow-clip">
        <ShotImage shot={shot} sizes={sizes} priority={priority} />
      </div>
    </div>
  );
}

function Framed({ shot, sizes }: { shot: CoreforgeShot; sizes: string }) {
  return shot.device === 'desktop' ? <BrowserFrame shot={shot} sizes={sizes} /> : <PhoneFrame shot={shot} sizes={sizes} />;
}

const STRIP_ORDER: readonly CoreforgeShotId[] = [
  'welcome-desktop',
  'demo-mobile',
  'brain-gym-desktop',
  'modules-desktop',
  'welcome-mobile',
  'demo-desktop',
];

const GALLERY_DESKTOP: readonly CoreforgeShotId[] = ['welcome-desktop', 'brain-gym-desktop', 'modules-desktop', 'demo-desktop', 'pricing-desktop'];
const GALLERY_PHONES: readonly CoreforgeShotId[] = ['welcome-mobile', 'demo-mobile'];

const CAPTIONS: Readonly<Record<CoreforgeShotId, string>> = {
  'welcome-desktop': 'Home',
  'welcome-mobile': 'Home on a phone',
  'demo-desktop': 'The public daily demo',
  'demo-mobile': 'The daily demo on a phone',
  'brain-gym-desktop': 'Brain Gym',
  'modules-desktop': 'Every subject module',
  'pricing-desktop': 'Free plan and Pro',
};

function Caption({ shot, placement }: { shot: CoreforgeShot; placement: string }) {
  return (
    <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
      <span>{CAPTIONS[shot.id as CoreforgeShotId]}</span>
      <CoreforgeLink path={shot.path} placement={`${placement}-${shot.id}`} className="tap-safe-sm justify-start text-xs">
        {COREFORGE_BRAND.domain}
        {shot.path}
      </CoreforgeLink>
    </figcaption>
  );
}

/** Swipeable on touch, scrollable with a trackpad, and focusable so arrow keys scroll it. */
function Strip({ ids, placement, label, className }: { ids: readonly CoreforgeShotId[]; placement: string; label: string; className?: string }) {
  return (
    <ul
      aria-label={label}
      // A focusable scroller is how keyboard users reach the off-screen shots.
      tabIndex={0}
      data-cf-strip=""
      className={cn('cf-strip ring-focus', className)}
    >
      {ids.map((id) => {
        const shot = COREFORGE_SHOTS[id];
        return (
          <li key={id} className={cn('self-center', shot.device === 'mobile' && 'justify-self-center')}>
            <figure className={shot.device === 'mobile' ? 'w-[min(15rem,70vw)]' : undefined}>
              <Framed shot={shot} sizes={shot.device === 'mobile' ? '240px' : '(min-width: 640px) 46vw, 78vw'} />
              <Caption shot={shot} placement={placement} />
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  /** 'pair' (the home section): browser plus overlapping phone. 'gallery' (the venture page): every capture. */
  variant?: 'pair' | 'gallery';
  /** Prefix for each link's utm_campaign. */
  placement?: string;
  className?: string;
};

/**
 * Real goldensdmat.in captures in device frames. On phones both variants become one
 * native scroll-snap strip. On wider screens 'pair' overlaps a phone on a browser
 * window, the phone drifting a little on scroll (Parallax: off on lite devices and
 * under reduced motion, and the only scrub in this section).
 */
export function DeviceShowcase({ variant = 'pair', placement = 'showcase', className }: Props) {
  const label = `Screenshots of ${COREFORGE_BRAND.product} at ${COREFORGE_BRAND.domain}`;

  if (variant === 'gallery') {
    return (
      <div data-cf-showcase="gallery" className={className}>
        <Strip ids={STRIP_ORDER.concat('pricing-desktop')} placement={placement} label={label} className="md:hidden" />
        <div className="hidden gap-8 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ul aria-label={label} className="grid gap-8 lg:grid-cols-2">
            {GALLERY_DESKTOP.map((id) => (
              <li key={id}>
                <figure>
                  <BrowserFrame shot={COREFORGE_SHOTS[id]} sizes="(min-width: 1024px) 30vw, 60vw" />
                  <Caption shot={COREFORGE_SHOTS[id]} placement={placement} />
                </figure>
              </li>
            ))}
          </ul>
          <ul aria-label={`${label}, on a phone`} className="grid content-start gap-8">
            {GALLERY_PHONES.map((id) => (
              <li key={id} className="mx-auto w-full max-w-60">
                <figure>
                  <PhoneFrame shot={COREFORGE_SHOTS[id]} sizes="240px" />
                  <Caption shot={COREFORGE_SHOTS[id]} placement={placement} />
                </figure>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const desktop = COREFORGE_SHOTS['welcome-desktop'];
  const phone = COREFORGE_SHOTS['demo-mobile'];
  return (
    <div data-cf-showcase="pair" className={className}>
      <Strip ids={STRIP_ORDER.slice(0, 4)} placement={placement} label={label} className="md:hidden" />
      <div className="relative hidden pr-[12%] pb-[10%] md:block">
        <BrowserFrame shot={desktop} sizes="(min-width: 1280px) 560px, 45vw" />
        <Parallax speed={0.06} className="cf-parallax absolute right-0 bottom-0 w-[28%] min-w-36">
          <PhoneFrame shot={phone} sizes="200px" />
        </Parallax>
      </div>
      <p className="mt-4 hidden text-xs text-text-muted md:block">
        <CoreforgeLink path={desktop.path} placement={`${placement}-pair`} className="tap-safe-sm justify-start text-xs">
          {COREFORGE_BRAND.domain}
        </CoreforgeLink>
      </p>
    </div>
  );
}

export default DeviceShowcase;
