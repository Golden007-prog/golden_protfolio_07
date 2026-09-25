'use client';

import { motion, useSpring, type HTMLMotionProps, type MotionStyle } from 'framer-motion';
import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { spring } from '../../lib/motion';
import { cn } from '../../utils/cn';

type Props = HTMLMotionProps<'div'> & {
  as?: 'div' | 'article' | 'li' | 'section';
  strong?: boolean;
  glow?: 'violet' | 'cyan' | 'none';
  /** Hover border lift and sheen (glass-interactive). */
  interactive?: boolean;
  /** The sheen follows the pointer. Implies interactive. */
  spotlight?: boolean;
  /** Pointer tilt; a number sets the maximum in degrees (capped at 6). */
  tilt?: boolean | number;
  /** 'auto' drops the backdrop blur on lite devices, 'always' keeps it, 'none' never blurs (for opaque fills). */
  blur?: 'auto' | 'always' | 'none';
};

const MAX_TILT = 6;
const PERSPECTIVE = 900;
const TILT_SPRING = { stiffness: spring.pointer.stiffness, damping: spring.pointer.damping };
const NO_BLUR: MotionStyle = { backdropFilter: 'none', WebkitBackdropFilter: 'none' };

/**
 * Frosted card. Tilt and spotlight run only for a mouse on a fine, hover-capable
 * pointer with motion allowed; touch, pen and reduced motion get a still card. The
 * rect is read once on pointerenter (and again only after a scroll), and the
 * spotlight writes --mx/--my once per frame, so moving the mouse forces no layout.
 */
export function GlassCard({
  as = 'div',
  strong,
  glow = 'none',
  interactive,
  spotlight,
  tilt,
  blur = 'auto',
  className,
  style,
  children,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  ...rest
}: Props) {
  const { reduce, finePointer, hover } = useMotionPrefs();
  const maxTilt = tilt === true ? MAX_TILT : typeof tilt === 'number' ? Math.min(Math.max(tilt, 0), MAX_TILT) : 0;
  const effects = finePointer && hover && !reduce && (maxTilt > 0 || Boolean(spotlight));

  const rotateX = useSpring(0, TILT_SPRING);
  const rotateY = useSpring(0, TILT_SPRING);
  const el = useRef<HTMLElement | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const spot = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  // Stable identity, so the scroll listener added on enter is the one removed on leave.
  const [invalidate] = useState(() => () => {
    rect.current = null;
  });

  const stopTracking = () => {
    window.removeEventListener('scroll', invalidate);
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    rect.current = null;
    rotateX.set(0);
    rotateY.set(0);
  };
  const stopFromEffect = useEffectEvent(stopTracking);

  useEffect(() => {
    if (!effects) stopFromEffect();
    return () => stopFromEffect();
  }, [effects]);

  const handleEnter = (e: PointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(e);
    if (!effects || e.pointerType !== 'mouse') return;
    el.current = e.currentTarget;
    rect.current = e.currentTarget.getBoundingClientRect();
    window.addEventListener('scroll', invalidate, { passive: true });
  };

  const handleMove = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e);
    if (!effects || e.pointerType !== 'mouse') return;
    const r = (rect.current ??= e.currentTarget.getBoundingClientRect());
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (maxTilt) {
      rotateY.set((px - 0.5) * 2 * maxTilt);
      rotateX.set(-(py - 0.5) * 2 * maxTilt);
    }
    if (spotlight) {
      spot.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      raf.current ||= requestAnimationFrame(() => {
        raf.current = 0;
        el.current?.style.setProperty('--mx', `${spot.current.x}px`);
        el.current?.style.setProperty('--my', `${spot.current.y}px`);
      });
    }
  };

  const handleLeave = (e: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(e);
    stopTracking();
  };

  // Hydration renders with the server prefs (effects off), so the perspective only
  // appears afterwards, and only where tilt can run; at rest elsewhere transform stays 'none'.
  let merged: MotionStyle | undefined = style;
  if (maxTilt) merged = { ...merged, rotateX, rotateY, ...(effects && { transformPerspective: PERSPECTIVE }) };
  if (blur === 'none') merged = { ...merged, ...NO_BLUR };

  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag
      className={cn(
        strong ? 'glass-strong' : 'glass',
        glow === 'violet' && 'glow-violet',
        glow === 'cyan' && 'glow-cyan',
        (interactive || spotlight) && 'glass-interactive',
        blur === 'always' && 'glass-keep',
        'relative overflow-clip',
        className,
      )}
      style={merged}
      onPointerEnter={handleEnter}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      {...rest}
    >
      {children}
    </Tag>
  );
}
