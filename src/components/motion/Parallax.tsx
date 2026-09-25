'use client';

import { motion, useMotionValue, useMotionValueEvent, useScroll } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';

export type ParallaxProps = {
  /** Travel as a fraction of the element's own size, each way. 0.1 moves it ±10%. */
  speed?: number;
  axis?: 'x' | 'y';
  /** Lite devices (coarse pointer, low power) skip the scrub. Default true. */
  disabledOnLite?: boolean;
  className?: string;
  children: ReactNode;
};

/** progress 0 (element entering at the bottom) .. 1 (leaving at the top). */
function place(progress: number, speed: number): string {
  return `${((0.5 - progress) * 2 * speed * 100).toFixed(3)}%`;
}

/**
 * Scroll-scrubbed drift. The offset is 0% on the server and only moves once the
 * client knows motion is allowed, so hydration never jumps; reduced motion (and
 * lite, by default) parks it at 0%. framer measures the target by layout offsets,
 * so the element's own transform never feeds back into its progress.
 */
export function Parallax({ speed = 0.1, axis = 'y', disabledOnLite = true, className, children }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduce, lite } = useMotionPrefs();
  const enabled = !reduce && !(disabledOnLite && lite) && speed !== 0;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const offset = useMotionValue('0%');

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (enabled) offset.set(place(p, speed));
  });

  useEffect(() => {
    offset.set(enabled ? place(scrollYProgress.get(), speed) : '0%');
  }, [enabled, speed, offset, scrollYProgress]);

  return (
    <motion.div ref={ref} className={className} style={axis === 'x' ? { x: offset } : { y: offset }}>
      {children}
    </motion.div>
  );
}
