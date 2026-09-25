'use client';

import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { matchesMedia } from '@/hooks/useMediaQuery';
import { setMotionOverride, setPaused, useMotionPrefs, usePaused } from '@/hooks/useMotionPrefs';
import { cn } from '@/utils/cn';

type Props = {
  className?: string;
  /** Adds a labelled 'Reduce motion' switch (the persistent, site-wide setting). */
  showReduce?: boolean;
};

/** Reduce motion on: pin 'reduced'. Off: pin 'full' when the OS asks for less, else follow the OS again. */
export function toggleReducedMotion(on: boolean): void {
  if (on) setMotionOverride('reduced');
  else setMotionOverride(matchesMedia('(prefers-reduced-motion: reduce)') ? 'full' : null);
}

/**
 * WCAG 2.2.2 pause control. The icon button pauses marquees, videos, tickers,
 * looping Lotties and CSS loops for this visit (sessionStorage).
 */
export function MotionToggle({ className, showReduce = false }: Props) {
  const paused = usePaused();
  const { reduce } = useMotionPrefs();

  const button = (
    <Button
      variant="icon"
      aria-label="Pause motion"
      aria-pressed={paused}
      data-motion-toggle=""
      onClick={() => setPaused(!paused)}
      className="size-11"
    >
      {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
    </Button>
  );

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Tooltip content={paused ? 'Motion paused for this visit' : 'Pause animation, video and marquees'}>{button}</Tooltip>
      {showReduce ? (
        <Button
          variant="ghost"
          role="switch"
          aria-checked={reduce}
          onClick={() => toggleReducedMotion(!reduce)}
          className="gap-2.5 px-3"
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
              reduce ? 'border-violet-bright bg-violet' : 'border-glass-border-strong bg-surface-tint',
            )}
          >
            <span
              className={cn(
                'absolute left-0.5 size-3.5 rounded-full transition-transform duration-200',
                reduce ? 'translate-x-4 bg-bg-base' : 'bg-text-muted',
              )}
            />
          </span>
          Reduce motion
        </Button>
      ) : null}
    </span>
  );
}
