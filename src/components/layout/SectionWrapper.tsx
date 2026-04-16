import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function SectionWrapper({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section
      id={id}
      className={cn(
        'relative container-padding py-[clamp(5rem,10vw,9rem)]',
        className,
      )}
    >
      <div className="mx-auto max-w-[1440px] relative">{children}</div>
    </section>
  );
}
