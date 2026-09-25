'use client';

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { cn } from '@/utils/cn';

const RADIUS = 32;

/**
 * A section that rises over the one before it like a sheet. While its top
 * travels from the viewport bottom to the top, its top corners straighten from
 * 32px and a hairline draws across its top edge; while its bottom does the same,
 * an overlay dims it under the next sheet.
 *
 * Clipping is clip-path, never overflow, so sticky children (the skills sphere,
 * the principles deck) keep sticking; nothing is pinned. html[data-lite] and
 * html[data-motion=reduced] switch it all off in shell.css, which keeps the
 * server and client markup identical and never remounts the section.
 */
export function SectionTransition({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: enter } = useScroll({ target: ref, offset: ['start end', 'start start'] });
  const { scrollYProgress: leave } = useScroll({ target: ref, offset: ['end end', 'end start'] });

  // 'none' outside the transition, so nothing (a glow, a fixed descendant) is clipped at rest.
  const clipPath = useTransform(enter, (p) => {
    if (p <= 0 || p >= 1) return 'none';
    const r = Math.round(RADIUS * (1 - p) * 10) / 10;
    return `inset(0px 0px -100vh 0px round ${r}px ${r}px 0px 0px)`;
  });
  const lip = useTransform(enter, [0, 0.8, 1], [1, 0.6, 0]);
  const dim = useTransform(leave, [0, 1], [0, 0.45]);

  return (
    <motion.div ref={ref} data-section-sheet="" className={cn('section-sheet', className)} style={{ clipPath }}>
      <motion.div aria-hidden="true" className="sheet-lip" style={{ opacity: lip }} />
      {children}
      <motion.div aria-hidden="true" className="sheet-hairline" style={{ scaleX: enter }} />
      <motion.div aria-hidden="true" className="sheet-dim" style={{ opacity: dim }} />
    </motion.div>
  );
}
