'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { useMotionPrefs } from './useMotionPrefs';

function subscribeVisibility(fn: () => void) {
  document.addEventListener('visibilitychange', fn);
  return () => document.removeEventListener('visibilitychange', fn);
}

/**
 * R3F frameloop for a canvas wrapper: 'always' while the element is within
 * rootMargin of the viewport and the tab is visible, otherwise 'never'.
 * While motion is paused it is 'demand': the idle loop (bobs, floats, spins)
 * stops, but state changes such as a clicked sphere node still render.
 */
export function useFrameloop(ref: RefObject<Element | null>, rootMargin = '200px'): 'always' | 'demand' | 'never' {
  const [near, setNear] = useState(false);
  const { paused } = useMotionPrefs();
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);

  if (!near || !visible) return 'never';
  return paused ? 'demand' : 'always';
}
