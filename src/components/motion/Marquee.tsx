'use client';

import { motion, useAnimationFrame, useMotionValue, useScroll, useSpring, useVelocity } from 'framer-motion';
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { cn } from '../../utils/cn';

export type MarqueeProps = {
  children: ReactNode;
  /** Pixels per second. */
  speed?: number;
  direction?: 'left' | 'right';
  /** Scroll speed boosts the row and leans it forward. Skipped on lite devices. */
  velocity?: boolean;
  pauseOnHover?: boolean;
  /** Any CSS length; also the spacing between repeats. */
  gap?: string;
  ariaLabel?: string;
  className?: string;
};

const MAX_SKEW = 6;
// Longer frames (a background tab, a long task) would teleport the row.
const MAX_FRAME_MS = 100;

/**
 * An endless row. When motion is paused (reduced motion or the pause toggle) it is
 * a single static wrapped row instead, so nothing is duplicated or cut off.
 */
export function Marquee({ gap = '2rem', ariaLabel, className, children, ...rest }: MarqueeProps) {
  const { paused, lite } = useMotionPrefs();
  const label = ariaLabel ? { role: 'group', 'aria-label': ariaLabel } : {};

  if (paused) {
    return (
      <div {...label} className={cn('flex flex-wrap items-center', className)} style={{ gap }}>
        {children}
      </div>
    );
  }
  return (
    <MarqueeTrack gap={gap} label={label} lite={lite} className={className} {...rest}>
      {children}
    </MarqueeTrack>
  );
}

type TrackProps = Omit<MarqueeProps, 'ariaLabel' | 'gap'> & {
  gap: string;
  label: { role?: string; 'aria-label'?: string };
  lite: boolean;
};

function MarqueeTrack({
  children,
  speed = 40,
  direction = 'left',
  velocity = false,
  pauseOnHover = true,
  gap,
  label,
  lite,
  className,
}: TrackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const hold = useRef({ hover: false, focus: false, visible: false });
  const [copies, setCopies] = useState(2);
  const x = useMotionValue(0);
  const skewX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const boost = velocity && !lite;
  const dir = direction === 'left' ? -1 : 1;

  useEffect(() => {
    const root = rootRef.current;
    const copy = copyRef.current;
    if (!root || !copy) return;
    // ResizeObserver reports once on observe, so this also takes the first measurement.
    const ro = new ResizeObserver(() => {
      width.current = copy.offsetWidth;
      if (!width.current) return;
      const needed = Math.max(2, Math.ceil(root.clientWidth / width.current) + 1);
      setCopies((c) => (c === needed ? c : needed));
    });
    ro.observe(root);
    ro.observe(copy);
    const io = new IntersectionObserver(
      ([entry]) => {
        hold.current.visible = Boolean(entry?.isIntersecting);
      },
      { rootMargin: '100px' },
    );
    io.observe(root);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  useAnimationFrame((_, delta) => {
    const h = hold.current;
    const w = width.current;
    if (!h.visible || !w) return;
    if (h.hover || h.focus) {
      if (skewX.get() !== 0) skewX.set(0);
      return;
    }
    let factor = 1;
    if (boost) {
      const v = Math.abs(scrollVelocity.get());
      factor += Math.min(v / 400, 4);
      // Lean into the direction of travel, like a fast-moving object.
      skewX.set(-dir * Math.min(v / 250, MAX_SKEW));
    }
    let next = (x.get() + dir * speed * factor * (Math.min(delta, MAX_FRAME_MS) / 1000)) % w;
    if (next > 0) next -= w;
    x.set(next);
  });

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    hold.current.focus = true;
    // Bring the focused item into view; the clipped row cannot scroll to it.
    const el = e.target as HTMLElement;
    const w = width.current;
    if (w && copyRef.current?.contains(el)) x.set(Math.min(0, Math.max(-w, 16 - el.offsetLeft)));
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold.current.focus = false;
  };
  const setHover = (on: boolean) => () => {
    hold.current.hover = on;
  };

  return (
    <div
      ref={rootRef}
      {...label}
      className={cn('relative overflow-clip', className)}
      onPointerEnter={pauseOnHover ? setHover(true) : undefined}
      onPointerLeave={pauseOnHover ? setHover(false) : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <motion.div className="flex w-max" style={{ x, skewX }}>
        {Array.from({ length: copies }, (_, i) => (
          <div
            key={i}
            ref={i === 0 ? copyRef : undefined}
            aria-hidden={i > 0 ? true : undefined}
            inert={i > 0 ? true : undefined}
            className="relative flex shrink-0 items-center"
            style={{ gap, paddingInlineEnd: gap }}
          >
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
