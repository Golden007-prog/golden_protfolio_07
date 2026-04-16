import { useAnimation, useInView as useFMInView } from 'framer-motion';
import { useEffect, useRef } from 'react';

type Preset = 'fade-up' | 'fade-in' | 'slide-left' | 'slide-right' | 'scale-in';

const PRESETS: Record<Preset, { hidden: Record<string, number>; visible: Record<string, number> }> = {
  'fade-up': { hidden: { opacity: 0, y: 32 }, visible: { opacity: 1, y: 0 } },
  'fade-in': { hidden: { opacity: 0 }, visible: { opacity: 1 } },
  'slide-left': { hidden: { opacity: 0, x: -48 }, visible: { opacity: 1, x: 0 } },
  'slide-right': { hidden: { opacity: 0, x: 48 }, visible: { opacity: 1, x: 0 } },
  'scale-in': { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1 } },
};

export function useInViewAnimation(preset: Preset = 'fade-up', options?: { once?: boolean; amount?: number; delay?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useFMInView(ref, { once: options?.once ?? true, amount: options?.amount ?? 0.2 });
  const controls = useAnimation();
  const variants = PRESETS[preset];

  useEffect(() => {
    if (inView) {
      controls.start({
        ...variants.visible,
        transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: options?.delay ?? 0 },
      });
    } else if (!(options?.once ?? true)) {
      controls.start(variants.hidden);
    }
  }, [inView, controls, variants, options?.delay, options?.once]);

  return { ref, controls, initial: variants.hidden };
}
