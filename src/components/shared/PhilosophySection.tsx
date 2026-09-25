'use client';

import { useEffect, useRef } from 'react';
import { motion, scroll, useMotionValue } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { Stagger, StaggerItem } from '@/components/motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { GlassCard } from './GlassCard';
import { SectionHeading } from './SectionHeading';

const TENETS = [
  {
    n: '01',
    title: 'Ship the boring version first.',
    body: 'A working end-to-end pipeline beats a half-finished clever one. Prove the wire, then tune the signal.',
  },
  {
    n: '02',
    title: 'Evals before vibes.',
    body: 'If you can’t measure it, you’re guessing. Every LLM feature gets a scored test set before it gets a UI.',
  },
  {
    n: '03',
    title: 'Small models, sharp prompts.',
    body: 'Most production problems don’t need a frontier model — they need a well-indexed retrieval layer and crisp instructions.',
  },
  {
    n: '04',
    title: 'Observability is a feature.',
    body: 'Traces, token counts, latency histograms, cost dashboards. The team that can see the system can fix the system.',
  },
  {
    n: '05',
    title: 'Data > architecture.',
    body: 'A clean, labeled, deduped dataset beats a fancy model. Spend the weekend on the CSVs, not the ConvNet.',
  },
  {
    n: '06',
    title: 'Write the docs you wish existed.',
    body: 'Half of engineering is unblocking the next person — usually future you. README first, commit second.',
  },
];

type Tenet = (typeof TENETS)[number];

/** The same condition as the sticky-deck layout in story.css (which also requires no data-lite and no reduced motion). */
const DECK_QUERY = '(min-width: 1024px) and (pointer: fine) and (hover: hover)';
const COVERED_SCALE = 0.94;
const COVERED_DIM = 0.5;

/**
 * One card. In the desktop deck it shrinks toward COVERED_SCALE and dims while the
 * next card slides up over it; the scroll listener exists only while the deck is live.
 */
function TenetCard({ tenet, deck }: { tenet: Tenet; deck: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useMotionValue(1);
  const dim = useMotionValue(0);

  useEffect(() => {
    const item = ref.current?.closest('li');
    const next = item?.nextElementSibling;
    if (!deck || !item || !(next instanceof HTMLElement)) return;
    // Sticky tops come from the CSS, so the two can never drift apart. The cover runs
    // from the next card touching this one's bottom edge (while this one is stuck)
    // to the next card settling into its own sticky slot.
    const ownTop = Math.round(parseFloat(getComputedStyle(item).top)) || 0;
    const nextTop = Math.round(parseFloat(getComputedStyle(next).top)) || 0;
    const touch = Math.max(nextTop + 1, ownTop + item.offsetHeight);
    const stop = scroll(
      (p: number) => {
        scale.set(1 - (1 - COVERED_SCALE) * p);
        dim.set(COVERED_DIM * p);
      },
      { target: next, offset: [`start ${touch}px`, `start ${nextTop}px`] },
    );
    return () => {
      stop();
      scale.set(1);
      dim.set(0);
    };
  }, [deck, scale, dim]);

  return (
    <motion.div ref={ref} className="h-full origin-top" style={{ scale }}>
      <GlassCard strong spotlight className="story-deck-card h-full p-6 md:p-7">
        <div className="mb-4 flex items-center gap-2">
          <span className="bg-gradient-to-r from-violet-bright to-cyan-bright bg-clip-text font-mono text-[11px] uppercase tracking-[0.3em] text-transparent">
            {tenet.n}
          </span>
          <Sparkles aria-hidden="true" className="size-3 text-violet-bright" />
        </div>
        <h3 className="font-display text-lg font-semibold leading-snug text-text-primary md:text-xl">{tenet.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">{tenet.body}</p>
        <motion.span aria-hidden="true" className="story-deck-dim" style={{ opacity: dim }} />
      </GlassCard>
    </motion.div>
  );
}

/**
 * Six working principles. A grid everywhere, except on wide fine-pointer screens
 * with full motion, where the cards form a sticky deck beside a sticky heading.
 * The layout switch is pure CSS keyed to the html attributes the head script sets
 * before paint, so hydration never reflows the section; DOM and tab order never change.
 */
export function PhilosophySection() {
  const { reduce, lite } = useMotionPrefs();
  const wide = useMediaQuery(DECK_QUERY);
  const deck = wide && !reduce && !lite;

  return (
    <SectionWrapper id="philosophy">
      <div className="story-principles">
        <div className="story-principles-head">
          <SectionHeading
            sectionId="philosophy"
            title="How I *build*."
            subtitle="Six working beliefs I return to — earned from production LLM systems, not from reading about them."
          />
        </div>
        <Stagger as="ol" className="story-deck">
          {TENETS.map((t) => (
            <StaggerItem as="li" key={t.n} className="story-deck-item">
              <TenetCard tenet={t} deck={deck} />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </SectionWrapper>
  );
}
