import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { SectionIdProvider } from '../shared/SectionHeading';

type Props = {
  id: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** Defaults to `${id}-title`, the id a SectionHeading inside this section gives its h2. */
  labelledBy?: string;
  /**
   * Decorative layers (videos, images, gradients) sized to the whole section, gutters
   * included. Children are laid out in the 1440px column, so an `absolute inset-0`
   * layer among them stops at the column's edges.
   */
  background?: ReactNode;
};

// The layers fade in and out across the section's own block padding, so the band
// never meets the neighbouring section in a hard line; the content box is untouched.
const FADE = 'linear-gradient(to bottom, transparent, #000 var(--section-space), #000 calc(100% - var(--section-space)), transparent)';
const BACKGROUND_FADE: CSSProperties = { maskImage: FADE, WebkitMaskImage: FADE };

/**
 * A page section: a labelled region that clears the fixed nav when jumped to.
 * It never sets overflow, so sticky children keep working; clip inside instead.
 */
export function SectionWrapper({ id, children, className, innerClassName, labelledBy, background }: Props) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy ?? `${id}-title`}
      className={cn('section-shell relative scroll-mt-(--nav-offset)', className)}
    >
      {background ? (
        <div aria-hidden="true" data-section-bg="" className="pointer-events-none absolute inset-0" style={BACKGROUND_FADE}>
          {background}
        </div>
      ) : null}
      <SectionIdProvider id={id}>
        <div className={cn('relative mx-auto max-w-[1440px]', innerClassName)}>{children}</div>
      </SectionIdProvider>
    </section>
  );
}
