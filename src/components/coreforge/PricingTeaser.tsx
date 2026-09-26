import { Check, Plus } from 'lucide-react';
import { COREFORGE_FREE_PLAN_LINE } from '@/lib/coreforge/facts';
import { CTA, PRICING_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeButton } from './CoreforgeLink';

type Props = {
  placement?: string;
  headingLevel?: 'h2' | 'h3';
  hideTitle?: boolean;
  className?: string;
};

/**
 * Free plan against Pro, as feature lists only. Never an amount: the ₹ prices on
 * goldensdmat.in were a launch sale, so the card sends people to /pricing instead.
 */
export function PricingTeaser({ placement = 'pricing', headingLevel = 'h3', hideTitle = false, className }: Props) {
  const Heading = headingLevel;
  const Sub = headingLevel === 'h2' ? 'h3' : 'h4';
  return (
    <div data-cf-pricing="" className={className}>
      {hideTitle ? null : (
        <Heading className="font-display text-h3 font-semibold text-text-primary">{PRICING_COPY.title}</Heading>
      )}
      <p className={cn('max-w-prose text-base text-text-secondary', !hideTitle && 'mt-3')}>{PRICING_COPY.lead}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-(--cf-berry-border) bg-(--cf-berry-tint) p-6">
          <Sub className="font-display text-lg font-semibold text-text-primary">{PRICING_COPY.freeName}</Sub>
          <p className="mt-1 text-sm font-medium text-(--cf-berry-text)">{COREFORGE_FREE_PLAN_LINE}</p>
          <ul className="mt-4 grid gap-2">
            {PRICING_COPY.free.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-glass-border bg-glass-fill p-6">
          <Sub className="font-display text-lg font-semibold text-text-primary">{PRICING_COPY.proName}</Sub>
          <p className="mt-1 text-sm text-text-muted">{PRICING_COPY.note}</p>
          <ul className="mt-4 grid gap-2">
            {PRICING_COPY.pro.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <CoreforgeButton path={CTA.pricing.path} placement={`${placement}-see-pricing`} variant="secondary">
          {CTA.pricing.label}
        </CoreforgeButton>
      </div>
    </div>
  );
}

export default PricingTeaser;
