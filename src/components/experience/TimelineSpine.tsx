'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'framer-motion';
import { Stagger, StaggerItem } from '@/components/motion';
import { useHydrated } from '@/hooks/useHydrated';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { cn } from '@/utils/cn';

export type SpineItem = { key: string; content: ReactNode };

type Props = { items: readonly SpineItem[]; className?: string };

// The tip of the line sits on this reading line (a fraction of the viewport height).
const READING_LINE = '65%';
const SPINE_SPRING = { stiffness: 140, damping: 30, mass: 0.4, restDelta: 0.0005 };

/** Distance from the top of `root` to the top of `el`, through the offsetParent chain (transforms ignored). */
function offsetWithin(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

/**
 * The scroll-drawn line. Its tip follows the section through a spring, a glowing
 * head rides the tip, and each node ignites (data-lit) once the tip reaches its
 * centre. Nodes are toggled directly on the DOM, so scrolling never re-renders.
 */
function SpineScrub({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { scrollYProgress } = useScroll({ target: rootRef, offset: [`start ${READING_LINE}`, `end ${READING_LINE}`] });
  const progress = useSpring(scrollYProgress, SPINE_SPRING);
  const height = useMotionValue(0);
  const headY = useTransform(() => progress.get() * height.get());
  const headOpacity = useTransform(progress, [0, 0.02, 0.98, 1], [0, 1, 1, 0]);
  const nodes = useRef<HTMLElement[]>([]);
  const stops = useRef<number[]>([]);
  const lit = useRef<boolean[]>([]);

  const paint = (p: number) => {
    const tip = p * height.get();
    nodes.current.forEach((node, i) => {
      // Half a pixel of slack so the last node lights when the spring settles at 1.
      const on = tip >= stops.current[i] - 0.5;
      if (lit.current[i] === on) return;
      lit.current[i] = on;
      node.toggleAttribute('data-lit', on);
    });
  };
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    nodes.current = Array.from(root.querySelectorAll<HTMLElement>('[data-spine-node]'));
    lit.current = nodes.current.map((n) => n.hasAttribute('data-lit'));
    const measure = () => {
      height.set(root.offsetHeight);
      stops.current = nodes.current.map((n) => offsetWithin(n, root) + n.offsetHeight / 2);
      paintRef.current(progress.get());
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef, height, progress]);

  useMotionValueEvent(progress, 'change', (p) => paintRef.current(p));

  return (
    <>
      <motion.span aria-hidden="true" data-spine-fill="" className="story-spine-fill" style={{ scaleY: progress }} />
      <motion.span aria-hidden="true" className="story-spine-head" style={{ y: headY, opacity: headOpacity }} />
    </>
  );
}

/**
 * Timeline with a spine. The line, its head and every node share one x position
 * (--spine-x), so the dots always sit on the line. This is the Experience
 * section's one scroll-scrubbed effect: on lite devices, under reduced motion, on
 * the server and without JS the line is simply full and every node lit.
 */
export function TimelineSpine({ items, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const { reduce, lite } = useMotionPrefs();
  const scrub = hydrated && !reduce && !lite;

  return (
    <div ref={rootRef} data-timeline="" data-spine-mode={scrub ? 'scrub' : 'static'} className={cn('story-timeline', className)}>
      <span aria-hidden="true" className="story-spine-track" />
      {scrub ? (
        <SpineScrub rootRef={rootRef} />
      ) : (
        <span aria-hidden="true" data-spine-fill="" className="story-spine-fill" />
      )}
      <Stagger as="ol" className="story-timeline-list">
        {items.map((item) => (
          <StaggerItem as="li" key={item.key} className="story-timeline-item">
            <span aria-hidden="true" data-spine-node="" data-lit={scrub ? undefined : ''} className="story-spine-node" />
            {item.content}
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
