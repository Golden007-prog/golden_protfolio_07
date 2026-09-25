'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

function subscribeVisibility(fn: () => void) {
  document.addEventListener('visibilitychange', fn);
  return () => document.removeEventListener('visibilitychange', fn);
}

/**
 * R3F frameloop for a canvas wrapper: 'always' while the element is within
 * rootMargin of the viewport and the tab is visible, otherwise 'never'.
 */
export function useFrameloop(ref: RefObject<Element | null>, rootMargin = '200px'): 'always' | 'never' {
  const [near, setNear] = useState(false);
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

  return near && visible ? 'always' : 'never';
}
