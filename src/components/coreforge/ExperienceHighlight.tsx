'use client';

import { COREFORGE_BRAND } from '@/lib/coreforge/facts';
import { COREFORGE_SHOTS } from '@/lib/coreforge/shots';
import { CTA } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeButton } from './CoreforgeLink';
import { BrowserFrame } from './DeviceShowcase';
import { CoreforgeDisclaimer } from './Disclaimer';

type Props = {
  placement?: string;
  className?: string;
};

/**
 * Sits under the 'Owner, GOLDEN's Coreforge' role on the experience timeline: a small
 * capture of the live product and a way there. Stacks at every width below sm.
 */
export function ExperienceHighlight({ placement = 'experience', className }: Props) {
  return (
    <div
      data-cf-experience=""
      className={cn(
        'grid gap-4 rounded-2xl border border-glass-border bg-surface-tint p-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-center',
        className,
      )}
    >
      <BrowserFrame shot={COREFORGE_SHOTS['welcome-desktop']} sizes="(min-width: 640px) 176px, 90vw" className="rounded-xl" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary">
          {COREFORGE_BRAND.product} <span className="font-normal text-text-muted">· {COREFORGE_BRAND.tagline}</span>
        </p>
        <p className="mt-1 text-sm text-text-muted">{COREFORGE_BRAND.eyebrow}.</p>
        <div className="mt-3">
          <CoreforgeButton path={CTA.visit.path} placement={placement} size="sm" variant="secondary">
            {CTA.visit.label}
          </CoreforgeButton>
        </div>
        <CoreforgeDisclaimer variant="short" className="mt-3" />
      </div>
    </div>
  );
}

export default ExperienceHighlight;
