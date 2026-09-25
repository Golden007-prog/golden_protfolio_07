'use client';

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useEffectEvent, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { spring } from '../../lib/motion';

type Props = {
  children: ReactNode;
  /** Fraction of the pointer's offset from centre to follow. Capped at 0.25. */
  strength?: number;
  /** Adds an inner layer that travels half as far again, for depth. */
  inner?: boolean;
  className?: string;
};

const MAX_STRENGTH = 0.25;
const SPRING = { stiffness: spring.pointer.stiffness, damping: spring.pointer.damping };

/**
 * Pulls its content toward a mouse pointer. Only pointerType 'mouse' moves it, so a
 * tapped CTA never stays displaced on touch; reduced motion keeps it still. The
 * centre is measured on pointerenter (minus the current offset, so the element's
 * own transform does not feed back) and again only after a scroll.
 */
export function Magnetic({ children, strength = MAX_STRENGTH, inner = false, className }: Props) {
  const { reduce } = useMotionPrefs();
  const k = Math.min(Math.max(strength, 0), MAX_STRENGTH);
  const x = useSpring(0, SPRING);
  const y = useSpring(0, SPRING);
  const innerX = useTransform(x, (v) => v * 0.5);
  const innerY = useTransform(y, (v) => v * 0.5);
  const centre = useRef<{ x: number; y: number } | null>(null);
  // Stable identity, so the scroll listener added on enter is the one removed on leave.
  const [invalidate] = useState(() => () => {
    centre.current = null;
  });

  const measure = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    centre.current = { x: r.left + r.width / 2 - x.get(), y: r.top + r.height / 2 - y.get() };
    return centre.current;
  };

  const release = (immediate: boolean) => {
    window.removeEventListener('scroll', invalidate);
    centre.current = null;
    if (immediate) {
      x.jump(0);
      y.jump(0);
    } else {
      x.set(0);
      y.set(0);
    }
  };
  const releaseFromEffect = useEffectEvent(() => release(true));

  useEffect(() => {
    if (reduce) releaseFromEffect();
    return () => releaseFromEffect();
  }, [reduce]);

  const onPointerEnter = (e: PointerEvent<HTMLSpanElement>) => {
    if (reduce || e.pointerType !== 'mouse') return;
    measure(e.currentTarget);
    window.addEventListener('scroll', invalidate, { passive: true });
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (reduce || e.pointerType !== 'mouse') return;
    const c = centre.current ?? measure(e.currentTarget);
    x.set((e.clientX - c.x) * k);
    y.set((e.clientY - c.y) * k);
  };
  const onPointerLeave = () => release(false);

  return (
    <motion.span
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ x, y, display: 'inline-block' }}
      className={className}
    >
      {inner ? <motion.span style={{ x: innerX, y: innerY, display: 'inline-block' }}>{children}</motion.span> : children}
    </motion.span>
  );
}
