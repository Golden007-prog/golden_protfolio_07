'use client';

import { forwardRef, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { useCoreforgeLink } from '@/lib/coreforge/track';
import { cn } from '@/utils/cn';

const NEW_TAB_HINT = <span className="sr-only"> (opens in new tab)</span>;

type LinkProps = {
  /** A goldensdmat.in path such as '/demo'. */
  path: string;
  /** Where the link sits; becomes utm_campaign and the analytics placement. */
  placement: string;
  className?: string;
  children: ReactNode;
  /** Trailing ↗ glyph (decorative). Default true. */
  arrow?: boolean;
  'aria-label'?: string;
};

/**
 * Inline text link to goldensdmat.in: UTM-tagged, tracked, new tab, rel 'noopener'
 * without 'noreferrer' so the owner's analytics see the portfolio as the referrer.
 */
export const CoreforgeLink = forwardRef<HTMLAnchorElement, LinkProps>(function CoreforgeLink(
  { path, placement, className, children, arrow = true, 'aria-label': ariaLabel },
  ref,
) {
  const link = useCoreforgeLink(path, placement);
  return (
    <a
      ref={ref}
      {...link}
      aria-label={ariaLabel ? `${ariaLabel} (opens in new tab)` : undefined}
      data-cursor="open"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm font-medium text-(--cf-berry-text) underline decoration-(--cf-berry-border) decoration-1 underline-offset-4 ring-focus transition-colors hover:decoration-current',
        className,
      )}
    >
      {children}
      {arrow ? <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {ariaLabel ? null : NEW_TAB_HINT}
    </a>
  );
});

type ButtonLinkProps = LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  magnetic?: boolean;
  fullWidth?: boolean;
  /** Extra data-* hooks for the anchor, e.g. { 'data-role-site': '' }. */
  data?: Readonly<Record<`data-${string}`, string>>;
};

/**
 * A Button-styled link to goldensdmat.in. It goes through Button's asChild slot rather
 * than its `external` prop, because `external` would add rel 'noreferrer'.
 */
export function CoreforgeButton({
  path,
  placement,
  className,
  children,
  arrow = true,
  variant = 'primary',
  size = 'md',
  leadingIcon,
  magnetic,
  fullWidth,
  data,
  'aria-label': ariaLabel,
}: ButtonLinkProps) {
  const link = useCoreforgeLink(path, placement);
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      magnetic={magnetic}
      fullWidth={fullWidth}
      cursor="open"
      leadingIcon={leadingIcon}
      trailingIcon={arrow ? <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /> : undefined}
      className={className}
    >
      <a {...data} {...link} aria-label={ariaLabel ? `${ariaLabel} (opens in new tab)` : undefined}>
        {children}
        {ariaLabel ? null : NEW_TAB_HINT}
      </a>
    </Button>
  );
}
