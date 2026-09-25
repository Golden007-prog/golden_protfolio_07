'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { cn } from '../../utils/cn';

type Props = {
  children: ReactNode;
  /** The visible text, repeated in the two aria-hidden glitch layers. */
  text: string;
  className?: string;
  intervalMs?: number;
};

const FLASH_MS = 220;
const LAYER = 'pointer-events-none absolute inset-0 select-none mix-blend-screen';

/**
 * An occasional two-colour glitch. The layers are aria-hidden siblings (not
 * attr() pseudo-content, which leaked into the accessible name). Nothing is
 * scheduled while motion is paused or reduced, while the text is offscreen, or
 * while the tab is hidden, and both timers are cleared on unmount.
 */
export function GlitchText({ children, text, className, intervalMs = 12000 }: Props) {
  const { paused } = useMotionPrefs();
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || paused) return;
    let schedule = 0;
    let flash = 0;
    let onScreen = false;

    const clear = () => {
      window.clearTimeout(schedule);
      window.clearTimeout(flash);
      schedule = 0;
      flash = 0;
      setActive(false);
    };
    const plan = () => {
      window.clearTimeout(schedule);
      if (!onScreen || document.visibilityState !== 'visible') return;
      schedule = window.setTimeout(() => {
        schedule = 0;
        setActive(true);
        flash = window.setTimeout(() => {
          flash = 0;
          setActive(false);
          plan();
        }, FLASH_MS);
      }, intervalMs + Math.random() * 4000);
    };
    const resume = () => {
      if (onScreen && document.visibilityState === 'visible') {
        if (!schedule && !flash) plan();
      } else {
        clear();
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      resume();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', resume);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', resume);
      clear();
    };
  }, [paused, intervalMs]);

  return (
    <span ref={ref} className={cn('relative inline-block', className)}>
      {children}
      {active && !paused && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              LAYER,
              'text-pink [clip-path:polygon(0_0,100%_0,100%_45%,0_45%)] animate-[glitchShift_0.22s_steps(2,end)_1]',
            )}
          >
            {text}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              LAYER,
              'text-cyan-bright [clip-path:polygon(0_55%,100%_55%,100%_100%,0_100%)] animate-[glitchShift2_0.22s_steps(2,end)_1]',
            )}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
