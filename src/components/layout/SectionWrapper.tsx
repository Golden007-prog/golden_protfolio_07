import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { SectionIdProvider } from '../shared/SectionHeading';

type Props = {
  id: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** Defaults to `${id}-title`, the id a SectionHeading inside this section gives its h2. */
  labelledBy?: string;
};

/**
 * A page section: a labelled region that clears the fixed nav when jumped to.
 * It never sets overflow, so sticky children keep working; clip inside instead.
 */
export function SectionWrapper({ id, children, className, innerClassName, labelledBy }: Props) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy ?? `${id}-title`}
      className={cn('section-shell relative scroll-mt-(--nav-offset)', className)}
    >
      <SectionIdProvider id={id}>
        <div className={cn('relative mx-auto max-w-[1440px]', innerClassName)}>{children}</div>
      </SectionIdProvider>
    </section>
  );
}
