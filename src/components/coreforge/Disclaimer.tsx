import { Info } from 'lucide-react';
import { COREFORGE_DISCLAIMER, COREFORGE_DISCLAIMER_FULL, COREFORGE_DISCLAIMER_SHORT } from '@/lib/coreforge/facts';
import { cn } from '@/utils/cn';

type Props = {
  /** 'short' for small placements, 'standard' wherever CoreForge is promoted at length, 'full' for the site footer's whole wording. */
  variant?: 'short' | 'standard' | 'full';
  className?: string;
};

const TEXT = { short: COREFORGE_DISCLAIMER_SHORT, standard: COREFORGE_DISCLAIMER, full: COREFORGE_DISCLAIMER_FULL } as const;

/** CoreForge's own disclaimer, verbatim. A server component: it has no state. */
export function CoreforgeDisclaimer({ variant = 'standard', className }: Props) {
  return (
    <p data-cf-disclaimer={variant} className={cn('flex items-start gap-2 text-xs leading-relaxed text-text-muted', className)}>
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{TEXT[variant]}</span>
    </p>
  );
}

export default CoreforgeDisclaimer;
