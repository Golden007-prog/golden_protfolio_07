/*
 * Click tracking for goldensdmat.in links: every click fires
 * track('coreforge_click', { placement }) through the site's analytics module, which is
 * a no-op off Vercel. Client components use useCoreforgeLink; anything else that opens
 * CoreForge (a command-palette action, a window.open) calls trackCoreforge itself.
 */
import { useMemo, type MouseEvent } from 'react';
import { track } from '@/lib/analytics';
import { coreforgeLinkAttrs, normalizePlacement, type CoreforgeLinkAttrs } from './links.ts';

type CoreforgeClickTrack = (event: 'coreforge_click', props: { placement: string }) => void;

// analytics.ts's event union has no 'coreforge_click' yet and is owned by another stream;
// its runtime forwards any event name to @vercel/analytics. Once the union gains the
// event, this cast can go.
const trackClick = track as unknown as CoreforgeClickTrack;

export function trackCoreforge(placement: string): void {
  trackClick('coreforge_click', { placement: normalizePlacement(placement) });
}

export type CoreforgeLinkProps = CoreforgeLinkAttrs & {
  onClick: () => void;
  /** Middle-click opens a tab without firing click. */
  onAuxClick: (e: MouseEvent<HTMLElement>) => void;
};

/**
 * Props for an <a> to goldensdmat.in: href with UTM parameters, target _blank,
 * rel 'noopener' (the referrer is kept on purpose), and click tracking.
 *
 *   const link = useCoreforgeLink('/demo', 'hero-badge');
 *   <a {...link} className="...">Try 10 questions free<span className="sr-only"> (opens in new tab)</span></a>
 */
export function useCoreforgeLink(path: string, placement: string): CoreforgeLinkProps {
  return useMemo(() => {
    const attrs = coreforgeLinkAttrs(path, placement);
    const fire = () => trackCoreforge(attrs['data-cf-placement']);
    return {
      ...attrs,
      onClick: fire,
      onAuxClick: (e: MouseEvent<HTMLElement>) => {
        if (e.button === 1) fire();
      },
    };
  }, [path, placement]);
}
