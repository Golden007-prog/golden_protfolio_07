'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { ToastProvider } from '@/components/ui/Toast';
import { IntroProvider } from '@/contexts/IntroContext';
import { LenisProvider } from '@/contexts/LenisContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useHydrated } from '@/hooks/useHydrated';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { duration, ease } from '@/lib/motion';

const DEFAULT_TRANSITION = { ease: ease.out, duration: duration.base };

export function Providers({ children }: { children: ReactNode }) {
  const prefs = useMotionPrefs();
  const hydrated = useHydrated();
  // framer-motion fixes each element's reduced-motion mode when the element is
  // created, but hydration renders see the store's server snapshot (reduce: false).
  // So the hydration pass reads the real preference (OS and stored override)
  // directly. It only feeds context, never markup, so hydration still matches.
  const [hydrationReduce] = useState(() => typeof window !== 'undefined' && getMotionPrefs().reduce);
  const reduce = hydrated ? prefs.reduce : hydrationReduce;

  // Drops the hydration-failure safety net in index.css: reveals are ours now.
  useEffect(() => {
    document.documentElement.classList.add('hydrated');
  }, []);

  // ScrollTrigger is registered once for the app; measurements taken before the
  // web fonts land are stale, so refresh when they have.
  useEffect(() => {
    let cancelled = false;
    Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ default: gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        document.fonts?.ready.then(() => {
          if (!cancelled) ScrollTrigger.refresh();
        });
      })
      .catch(() => {
        /* scroll effects degrade to their static state */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'} transition={DEFAULT_TRANSITION}>
      <LenisProvider>
        <IntroProvider>
          <ThemeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </IntroProvider>
      </LenisProvider>
    </MotionConfig>
  );
}
