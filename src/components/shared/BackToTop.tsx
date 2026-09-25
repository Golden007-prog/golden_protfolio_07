'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { duration, ease } from '@/lib/motion';
import { setUrlHash } from '@/lib/urlState';

/** Shown once the hero (one viewport) is behind the visitor. */
const SHOW_AFTER = 0.9;

/**
 * Bottom-left, level with the dock row, so it never meets the dock (bottom-right)
 * or a toast (which sits above the dock row). The ring is bound to the scroll
 * position through a motion value: scrolling never re-renders this component.
 */
export function BackToTop() {
  const { scrollY, scrollYProgress } = useScroll();
  const dashoffset = useTransform(scrollYProgress, (p) => 1 - p);
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useMotionValueEvent(scrollY, 'change', (y) => {
    const next = y > window.innerHeight * SHOW_AFTER;
    if (next !== visible) setVisible(next);
  });

  const toTop = () => {
    smoothScrollTo(0, { focus: false });
    setUrlHash(null);
    document.getElementById('main')?.focus({ preventScroll: true });
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="back-to-top"
          className="fixed z-dock"
          style={{
            left: 'calc(1rem + env(safe-area-inset-left))',
            bottom: 'calc(var(--dock-clearance) + (var(--dock-height) - 44px) / 2)',
          }}
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: ease.out } }}
          exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.2, ease: ease.in } }}
        >
          <button
            ref={buttonRef}
            type="button"
            onClick={toTop}
            aria-label="Back to top"
            data-back-to-top=""
            className="glass glass-keep tap-safe relative size-11 rounded-full text-text-primary ring-focus transition-colors hover:border-glass-border-strong"
          >
            <svg aria-hidden="true" viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
              <circle cx="22" cy="22" r="20.5" fill="none" strokeWidth="1.5" className="stroke-hairline" />
              <motion.circle
                cx="22"
                cy="22"
                r="20.5"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1 1"
                className="stroke-violet-bright"
                style={{ strokeDashoffset: dashoffset }}
              />
            </svg>
            <LottieIcon
              name="rocket"
              play="hover"
              loop={false}
              hoverTargetRef={buttonRef}
              className="relative block size-6"
              fallback={<ArrowUp aria-hidden="true" className="size-4" />}
            />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
