'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

type Options = {
  threshold?: number;
  rootMargin?: string;
  /** Stop observing after the first intersection. Default true. */
  once?: boolean;
};

/**
 * Options are read as primitives, so an inline options object does not tear down
 * and recreate the observer on every render.
 */
export function useInView<T extends Element = HTMLDivElement>(
  opts: Options = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const { threshold = 0.15, rootMargin = '0px 0px -10% 0px', once = true } = opts;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}
