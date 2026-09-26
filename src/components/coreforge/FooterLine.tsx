'use client';

import { COREFORGE_BRAND, COREFORGE_DISCLAIMER_SHORT, COREFORGE_FOUNDER } from '@/lib/coreforge/brand';
import { CTA } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeLink } from './CoreforgeLink';

type Props = {
  placement?: string;
  className?: string;
};

/** One line for the site footer: the founder role and a link to the live product. */
export function FooterLine({ placement = 'footer', className }: Props) {
  return (
    <p data-cf-footer="" className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted', className)}>
      <span aria-hidden="true" className="cf-pulse-dot" />
      <span>{COREFORGE_FOUNDER.line}.</span>
      <span>
        Building {COREFORGE_BRAND.product} at{' '}
        <CoreforgeLink path={CTA.visit.path} placement={placement} className="tap-safe-sm justify-start text-xs">
          {COREFORGE_BRAND.domain}
        </CoreforgeLink>
      </span>
      <span aria-hidden="true">·</span>
      <span>{COREFORGE_DISCLAIMER_SHORT}</span>
    </p>
  );
}

export default FooterLine;
