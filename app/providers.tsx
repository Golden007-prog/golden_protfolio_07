'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '../src/contexts/ThemeContext';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;

    (async () => {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const [{ default: Lenis }, { default: gsap }, { ScrollTrigger }] = await Promise.all([
        import('lenis'),
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);

      if (prefersReduced) {
        cleanup = () => ScrollTrigger.killAll();
        return;
      }

      const lenis = new Lenis({
        duration: 1.2,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        smoothWheel: true,
        // Native momentum on touch devices beats a JS-driven scroll loop.
        syncTouch: false,
      });

      const onScroll = () => ScrollTrigger.update();
      lenis.on('scroll', onScroll);

      const raf = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      cleanup = () => {
        gsap.ticker.remove(raf);
        lenis.off('scroll', onScroll);
        lenis.destroy();
        ScrollTrigger.killAll();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return <ThemeProvider>{children}</ThemeProvider>;
}
