'use client';

import type { ReactNode } from 'react';
import { Reveal, type RevealTag } from '../motion/Reveal';

type Props = {
  children: ReactNode;
  delay?: number;
  /** @deprecated Ignored: every reveal travels the shared 24px so entrances stay consistent. */
  y?: number;
  className?: string;
  as?: RevealTag;
};

/** The old scroll reveal, now a thin alias of Reveal so existing call sites get its SSR fix. */
export function ScrollReveal({ children, delay, className, as }: Props) {
  return (
    <Reveal as={as} delay={delay} className={className}>
      {children}
    </Reveal>
  );
}
