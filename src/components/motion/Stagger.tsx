'use client';

import { motion, type Variants } from 'framer-motion';
import { useMemo, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { stagger as STAGGER, staggerContainer } from '../../lib/motion';
import { REVEAL_MARGIN, revealVariants, type RevealTag, type RevealVariant } from './Reveal';

// Under reduced motion the children appear together, with no cascade.
const INSTANT_CONTAINER: Variants = { hidden: {}, visible: {} };

export type StaggerProps = {
  as?: RevealTag;
  /** Seconds between children; shortened automatically so the cascade stays within stagger.maxTotal. */
  stagger?: number;
  delayChildren?: number;
  /** Fraction of the container that must be visible. Default: any of it. */
  amount?: number;
  className?: string;
  children: ReactNode;
};

/**
 * Reveals its StaggerItem descendants in sequence when it scrolls into view. The
 * container itself never hides, so only the items carry data-reveal.
 */
export function Stagger({
  as = 'div',
  stagger = STAGGER.card,
  delayChildren = 0,
  amount,
  className,
  children,
}: StaggerProps) {
  const { reduce } = useMotionPrefs();
  const variants = useMemo(
    () => (reduce ? INSTANT_CONTAINER : staggerContainer(stagger, delayChildren)),
    [reduce, stagger, delayChildren],
  );
  const Tag = motion[as];

  return (
    <Tag
      className={className}
      variants={variants}
      initial="hidden"
      animate={reduce ? 'visible' : undefined}
      whileInView={reduce ? undefined : 'visible'}
      viewport={{ once: true, amount: amount ?? 'some', margin: REVEAL_MARGIN }}
    >
      {children}
    </Tag>
  );
}

export type StaggerItemProps = {
  as?: RevealTag;
  variant?: RevealVariant;
  id?: string;
  className?: string;
  children: ReactNode;
};

/** One step of a Stagger cascade. It inherits 'hidden'/'visible' from the nearest Stagger. */
export function StaggerItem({ as = 'div', variant = 'fade-up', id, className, children }: StaggerItemProps) {
  const { reduce, lite } = useMotionPrefs();
  const variants = useMemo(() => revealVariants(variant, reduce, 0, lite), [variant, reduce, lite]);
  const Tag = motion[as];

  return (
    <Tag id={id} className={className} data-reveal="" variants={variants}>
      {children}
    </Tag>
  );
}
