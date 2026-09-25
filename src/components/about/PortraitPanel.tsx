'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { motion, useSpring } from 'framer-motion';
import { Parallax } from '@/components/motion';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { spring } from '@/lib/motion';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

const MAX_TILT = 6;
const TILT_SPRING = { stiffness: spring.pointer.stiffness, damping: spring.pointer.damping };

type Props = { className?: string };

/**
 * The monogram panel. The aurora and the grid drift at different parallax speeds
 * (off on lite devices and under reduced motion, via Parallax), and on a mouse
 * the 'OB.' mark tilts up to 6 degrees toward the pointer. The panel rect is read
 * on pointerenter and again only after a scroll, never on every move.
 */
export function PortraitPanel({ className }: Props) {
  const { reduce, finePointer, hover } = useMotionPrefs();
  const tiltOn = finePointer && hover && !reduce;
  const rotateX = useSpring(0, TILT_SPRING);
  const rotateY = useSpring(0, TILT_SPRING);
  const rect = useRef<DOMRect | null>(null);
  // Stable identity, so the listener added on enter is the one removed on leave.
  const [invalidate] = useState(() => () => {
    rect.current = null;
  });

  useEffect(() => {
    if (tiltOn) return;
    rotateX.set(0);
    rotateY.set(0);
  }, [tiltOn, rotateX, rotateY]);

  useEffect(() => () => window.removeEventListener('scroll', invalidate), [invalidate]);

  const onEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (!tiltOn || e.pointerType !== 'mouse') return;
    rect.current = e.currentTarget.getBoundingClientRect();
    window.addEventListener('scroll', invalidate, { passive: true });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!tiltOn || e.pointerType !== 'mouse') return;
    const r = (rect.current ??= e.currentTarget.getBoundingClientRect());
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    rotateY.set(px * 2 * MAX_TILT);
    rotateX.set(-py * 2 * MAX_TILT);
  };
  const onLeave = () => {
    window.removeEventListener('scroll', invalidate);
    rect.current = null;
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <div
      data-portrait=""
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn('about-portrait relative isolate h-full min-h-60 overflow-clip rounded-2xl sm:min-h-80', className)}
    >
      <div aria-hidden="true" className="about-portrait-bg absolute inset-0" />
      <Parallax speed={0.12} className="pointer-events-none absolute -inset-y-[15%] inset-x-0">
        <div aria-hidden="true" className="about-portrait-blob-a absolute -right-16 top-[10%] size-64 rounded-full opacity-40" />
        <div aria-hidden="true" className="about-portrait-blob-b absolute -left-10 bottom-[8%] size-72 rounded-full opacity-30" />
      </Parallax>
      <Parallax speed={0.05} className="pointer-events-none absolute -inset-y-[8%] inset-x-0">
        <div aria-hidden="true" className="about-portrait-grid absolute inset-0" />
      </Parallax>

      <div className="relative flex h-full flex-col justify-between gap-10 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-text">{SITE.location}</span>
          <span aria-hidden="true" className="about-portrait-rule h-px flex-1" />
        </div>
        <div>
          <motion.p
            aria-hidden="true"
            className="about-portrait-mark w-fit font-display text-[5.5rem] font-bold leading-[0.85] tracking-[-0.04em] md:text-[7rem]"
            style={{ rotateX, rotateY, ...(tiltOn && { transformPerspective: 600 }) }}
          >
            OB.
          </motion.p>
          <p className="mt-4 font-display text-lg font-semibold text-text-primary md:text-xl">{SITE.name}</p>
        </div>
      </div>
    </div>
  );
}
