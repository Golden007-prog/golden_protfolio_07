'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** 'visible': when within rootMargin of the viewport. 'idle': when the browser is idle after load. */
  when?: 'visible' | 'idle';
  rootMargin?: string;
  /** Space reserved before and after mounting, so nothing below jumps. */
  minHeight?: number | string;
  placeholder?: ReactNode;
  className?: string;
};

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Defers mounting (and, with a lazy child, downloading) its children. Server and
 * first client render show the placeholder, so hydration always matches.
 */
export function LazyMount({ children, when = 'visible', rootMargin = '400px', minHeight, placeholder = null, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    if (when === 'idle') {
      const w = window as IdleWindow;
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(() => setMounted(true), { timeout: 3000 });
        return () => w.cancelIdleCallback?.(id);
      }
      const t = window.setTimeout(() => setMounted(true), 300);
      return () => window.clearTimeout(t);
    }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      const t = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          io.disconnect();
          setMounted(true);
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, when, rootMargin]);

  return (
    <div ref={ref} className={className} style={minHeight !== undefined ? { minHeight } : undefined}>
      {mounted ? children : placeholder}
    </div>
  );
}

export default LazyMount;
