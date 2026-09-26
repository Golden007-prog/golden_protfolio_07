'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Stagger, StaggerItem } from '@/components/motion';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useHydrated } from '@/hooks/useHydrated';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { duration as DURATION, ease } from '@/lib/motion';
import { cn } from '@/utils/cn';

export type SpineItem = { key: string; content: ReactNode };

/** A collapsed group at the foot of the timeline ('Earlier work'), on the same spine. */
export type SpineGroup = { label: string; items: readonly SpineItem[] };

type Props = { items: readonly SpineItem[]; earlier?: SpineGroup; className?: string };

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
    // Opening the earlier-work group resizes the root, which re-measures every stop.
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
 * The earlier roles behind a disclosure on the same spine. They stay in the DOM
 * (collapsed, inert), so the timeline still lists every role and each node keeps
 * its place on the line. An AI action or tour stop that rings one of them
 * (data-ai-spotlight) opens the group and brings the ringed card back into view.
 */
function EarlierGroup({ group, lit }: { group: SpineGroup; lit: boolean }) {
  const [open, setOpen] = useState(false);
  const { reduce } = useMotionPrefs();
  const regionRef = useRef<HTMLDivElement>(null);
  const regionId = `${useId()}-earlier`;

  useEffect(() => {
    const region = regionRef.current;
    if (!region || typeof MutationObserver === 'undefined') return;
    let timer = 0;
    const mo = new MutationObserver((records) => {
      const ringed = records.find((r) => r.target instanceof HTMLElement && r.target.hasAttribute('data-ai-spotlight'))?.target;
      if (!(ringed instanceof HTMLElement)) return;
      setOpen(true);
      window.clearTimeout(timer);
      // Once the group has opened, the card sits where the scroll was aimed only for the first role.
      timer = window.setTimeout(
        () => smoothScrollTo(ringed, { focus: false, immediate: getMotionPrefs().reduce }),
        getMotionPrefs().reduce ? 0 : DURATION.base * 1000 + 40,
      );
    });
    mo.observe(region, { subtree: true, attributes: true, attributeFilter: ['data-ai-spotlight'] });
    return () => {
      mo.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const count = group.items.length;

  return (
    <div data-earlier-work="" data-open={open ? '' : undefined} className="relative mt-8 md:mt-10">
      <div className="story-timeline-item">
        {/* A small diamond on the line marks where the earlier roles begin; it is not a role's node. */}
        <span
          aria-hidden="true"
          className="absolute left-[calc(var(--spine-x)_-_5px)] top-1/2 z-[1] size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-glass-border-strong bg-bg-base"
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((v) => !v)}
          data-earlier-toggle=""
          className="tap-safe ring-focus -ml-3 gap-2.5 rounded-full px-3 font-mono text-eyebrow uppercase text-text-muted transition-colors hover:text-text-primary"
        >
          {group.label}
          <span className="rounded-full border border-hairline bg-surface-tint px-2 py-0.5 tabular-nums tracking-normal text-text-secondary">
            {count}
            <span className="sr-only"> {count === 1 ? 'role' : 'roles'}</span>
          </span>
          <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 transition-transform duration-300', open && 'rotate-180')} />
        </button>
      </div>
      <motion.div
        ref={regionRef}
        id={regionId}
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={reduce ? { duration: 0 } : { duration: DURATION.base, ease: ease.out }}
        inert={!open}
        className="overflow-clip"
      >
        <ol aria-label={group.label} className="story-timeline-list pt-8 md:pt-10">
          {group.items.map((item) => (
            <li key={item.key} className="story-timeline-item">
              <span aria-hidden="true" data-spine-node="" data-lit={lit ? '' : undefined} className="story-spine-node" />
              {item.content}
            </li>
          ))}
        </ol>
      </motion.div>
    </div>
  );
}

/**
 * Timeline with a spine. The line, its head and every node share one x position
 * (--spine-x), so the dots always sit on the line. This is the Experience
 * section's one scroll-scrubbed effect: on lite devices, under reduced motion, on
 * the server and without JS the line is simply full and every node lit.
 */
export function TimelineSpine({ items, earlier, className }: Props) {
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
      {earlier && earlier.items.length > 0 ? <EarlierGroup group={earlier} lit={!scrub} /> : null}
    </div>
  );
}
