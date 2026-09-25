import type { DynamicOption, Variants } from 'framer-motion';

/** Cubic-bezier curves, mirrored in CSS as --ease-out-expo, --ease-in-expo, --ease-in-out, --ease-curtain. */
export const ease = {
  out: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  inOut: [0.65, 0, 0.35, 1],
  curtain: [0.87, 0, 0.13, 1],
} as const;

/** Seconds, mirrored in CSS as --dur-quick, --dur-base, --dur-reveal, --dur-hero. */
export const duration = {
  quick: 0.16,
  base: 0.42,
  reveal: 0.9,
  hero: 1.2,
} as const;

export const spring = {
  ui: { type: 'spring', stiffness: 380, damping: 32 },
  pointer: { type: 'spring', stiffness: 220, damping: 20 },
  layout: { type: 'spring', stiffness: 260, damping: 32 },
  press: { type: 'spring', stiffness: 400, damping: 25 },
} as const;

export const stagger = {
  micro: 0.04,
  card: 0.07,
  maxTotal: 0.5,
} as const;

type VariantName = 'fadeUp' | 'fade' | 'scaleIn' | 'blurIn' | 'clipUp';

export const variants: Record<VariantName, Variants> = {
  fadeUp: {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: duration.reveal, ease: ease.out } },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: duration.base, ease: ease.out } },
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1, transition: { duration: duration.base, ease: ease.out } },
  },
  blurIn: {
    hidden: { opacity: 0, filter: 'blur(12px)' },
    visible: { opacity: 1, filter: 'blur(0px)', transition: { duration: duration.reveal, ease: ease.out } },
  },
  clipUp: {
    hidden: { opacity: 0, clipPath: 'inset(100% 0% 0% 0%)' },
    visible: {
      opacity: 1,
      clipPath: 'inset(0% 0% 0% 0%)',
      transition: { duration: duration.reveal, ease: ease.out },
    },
  },
};

/**
 * Parent variants that stagger their children. The per-child interval shrinks
 * for long lists so the whole cascade never exceeds stagger.maxTotal.
 */
export function staggerContainer(each: number = stagger.card, delayChildren = 0): Variants {
  const delay: DynamicOption<number> = (i, total) => {
    const step = total > 1 ? Math.min(each, stagger.maxTotal / (total - 1)) : each;
    return delayChildren + i * step;
  };
  return {
    hidden: {},
    visible: { transition: { delayChildren: delay } },
  };
}

/** Scales a travel distance by the viewport factor from useMotionPrefs().scale. */
export function travel(px: number, scale: number): number {
  return Math.round(px * scale);
}
