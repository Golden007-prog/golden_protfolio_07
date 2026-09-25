'use client';

import { motion, type Transition, type Variants } from 'framer-motion';
import { useMemo, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { ease, variants as presets } from '../../lib/motion';

export type RevealVariant = 'fade-up' | 'fade' | 'scale' | 'blur-in' | 'clip-up';
export type RevealTag = 'div' | 'section' | 'article' | 'header' | 'footer' | 'li' | 'ul' | 'ol' | 'p' | 'span';

const PRESETS: Record<RevealVariant, Variants> = {
  'fade-up': presets.fadeUp,
  fade: presets.fade,
  scale: presets.scaleIn,
  'blur-in': presets.blurIn,
  'clip-up': presets.clipUp,
};

/** Seconds. Under reduced motion content still fades, but nothing travels. */
export const REDUCED_FADE = 0.2;

/** Transforms, filters and clips land at once; only opacity fades. */
export const REDUCED_TRANSITION: Transition = {
  default: { duration: 0 },
  opacity: { duration: REDUCED_FADE, ease: ease.out },
};

/**
 * IntersectionObserver margin for scroll reveals. The root reaches far above the
 * screen, so anything already scrolled past (a hash jump, End, a fast fling that
 * never intersected) counts as seen instead of staying hidden. The bottom inset
 * keeps a reveal from starting on the very edge of the screen.
 */
export const REVEAL_MARGIN = '100000px 0px -64px 0px';

/**
 * A preset with the caller's delay folded in, or its reduced-motion twin. `hidden`
 * never changes, because it is what the server renders; only the way to `visible`
 * differs. On lite devices a blur is dropped at once instead of animated, since
 * animating filter repaints every frame.
 */
export function revealVariants(variant: RevealVariant, reduce: boolean, delay = 0, lite = false): Variants {
  const preset = PRESETS[variant];
  const visible = preset.visible;
  if (!visible || typeof visible === 'function') return preset;
  const base = (visible.transition ?? {}) as Transition;
  const timed: Transition = {
    ...base,
    delay: (base.delay ?? 0) + delay,
    ...(lite && 'filter' in visible ? { filter: { duration: 0 } } : {}),
  };
  return {
    hidden: preset.hidden,
    visible: { ...visible, transition: reduce ? REDUCED_TRANSITION : timed },
  };
}

export type RevealProps = {
  as?: RevealTag;
  variant?: RevealVariant;
  /** Seconds before the reveal starts. Ignored under reduced motion. */
  delay?: number;
  /** Fraction of the element that must be visible. Default: any of it. */
  amount?: number;
  once?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Scroll reveal whose server and first client render are identical: `initial` is
 * always 'hidden', so hydration never has to patch a style React 19 would leave
 * alone. Reduced motion switches the trigger from the viewport to mount and the
 * transition to an opacity-only fade, which keeps content visible without scrolling.
 * data-reveal lets the global no-JS and hydration-failure rules force it visible.
 */
export function Reveal({
  as = 'div',
  variant = 'fade-up',
  delay = 0,
  amount,
  once = true,
  id,
  className,
  children,
}: RevealProps) {
  const { reduce, lite } = useMotionPrefs();
  const variants = useMemo(() => revealVariants(variant, reduce, delay, lite), [variant, reduce, delay, lite]);
  const Tag = motion[as];

  return (
    <Tag
      id={id}
      className={className}
      data-reveal=""
      variants={variants}
      initial="hidden"
      animate={reduce ? 'visible' : undefined}
      whileInView={reduce ? undefined : 'visible'}
      viewport={{ once, amount: amount ?? 'some', margin: REVEAL_MARGIN }}
    >
      {children}
    </Tag>
  );
}
