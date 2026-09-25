'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { cn } from '@/utils/cn';

export type SkeletonProps = {
  variant?: 'line' | 'block' | 'grid';
  /** Text lines for 'line'. */
  lines?: number;
  rows?: number;
  cols?: number;
  className?: string;
};

// A highlight band swept across a quiet fill; both are theme tokens.
const BAR_STYLE: CSSProperties = {
  backgroundColor: 'var(--app-heat-0)',
  backgroundImage: 'linear-gradient(90deg, transparent 0%, var(--app-glass-fill-strong) 50%, transparent 100%)',
  backgroundSize: '200% 100%',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: '150% 0',
};

/**
 * Loading placeholder. The shimmer runs through the Web Animations API, so it is
 * off (a static fill) under reduced motion or the pause switch.
 */
export function Skeleton({ variant = 'line', lines = 3, rows = 2, cols = 3, className }: SkeletonProps) {
  const { paused } = useMotionPrefs();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (paused || !root) return;
    const bars = Array.from(root.querySelectorAll<HTMLElement>('[data-skeleton-bar]'));
    if (bars.length === 0 || typeof bars[0].animate !== 'function') return;
    const anims = bars.map((bar) =>
      bar.animate([{ backgroundPosition: '150% 0' }, { backgroundPosition: '-50% 0' }], {
        duration: 1600,
        iterations: Infinity,
        easing: 'ease-in-out',
      }),
    );
    // One shared phase, so every bar sweeps together.
    const start = document.timeline?.currentTime ?? null;
    anims.forEach((a) => {
      a.startTime = start;
    });
    return () => anims.forEach((a) => a.cancel());
  }, [paused, variant, lines, rows, cols]);

  let body;
  if (variant === 'block') {
    body = <div data-skeleton-bar="" className="h-full min-h-24 w-full rounded-2xl" style={BAR_STYLE} />;
  } else if (variant === 'grid') {
    body = (
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(var(--skeleton-cols),minmax(0,1fr))]"
        style={{ '--skeleton-cols': cols } as CSSProperties}
      >
        {Array.from({ length: rows * cols }, (_, i) => (
          <div key={i} data-skeleton-bar="" className="aspect-[4/3] rounded-2xl" style={BAR_STYLE} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            data-skeleton-bar=""
            className="h-3 rounded-full"
            style={{ ...BAR_STYLE, width: i === lines - 1 && lines > 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={rootRef} role="status" data-skeleton={variant} className={cn('w-full', className)}>
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-full">
        {body}
      </div>
    </div>
  );
}
