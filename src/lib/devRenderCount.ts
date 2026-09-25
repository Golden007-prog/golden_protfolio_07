import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    __renders?: Record<string, number>;
  }
}

function useRenderCountDev(name: string): void {
  // A fresh object per render lets StrictMode's replayed effects count once.
  const token = {};
  const lastToken = useRef<object | null>(null);
  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    const counts = (window.__renders ??= {});
    counts[name] = (counts[name] ?? 0) + 1;
  });
}

/**
 * Counts committed renders into window.__renders[name] for Playwright checks.
 * Development only (or a build with NEXT_PUBLIC_RENDER_COUNT=1); both conditions
 * are inlined at build time, so a normal production chunk keeps only the no-op.
 */
export const useRenderCount: (name: string) => void =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_RENDER_COUNT === '1'
    ? useRenderCountDev
    : () => {};
