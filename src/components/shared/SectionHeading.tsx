'use client';

import { motion, type Variants } from 'framer-motion';
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useInView } from '../../hooks/useInView';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { useScrambleText } from '../../hooks/useScrambleText';
import { duration, ease } from '../../lib/motion';
import { kickerFor, SECTIONS, type SectionId } from '../../lib/site';
import { cn } from '../../utils/cn';
import { REDUCED_TRANSITION, REVEAL_MARGIN, revealVariants } from '../motion/Reveal';
import { SplitRuns, type SplitRun } from '../motion/SplitText';
import { GlitchText } from './GlitchText';

type Props = {
  /**
   * Supplies the kicker ('06 / Contact') and the h2 id (`${sectionId}-title`). Wins over
   * `kicker`. Defaults to the enclosing SectionWrapper's id when that is a SectionId.
   */
  sectionId?: SectionId;
  kicker?: string;
  /** A string may mark one emphasised word with asterisks: 'Things I've *built*.' */
  title: ReactNode;
  subtitle?: ReactNode;
  /** h2 id for aria-labelledby. Defaults to `${sectionId}-title`, else `${wrapperId}-title`. */
  id?: string;
  align?: 'left' | 'center';
  className?: string;
};

// A symmetric ramp at double width, so the one-time pan moves the colours across
// the word and both resting positions still show the full palette.
const EMPHASIS =
  'bg-[linear-gradient(90deg,var(--color-violet-bright),var(--color-pink),var(--color-cyan-bright),var(--color-pink),var(--color-violet-bright))] bg-[length:200%_100%] bg-clip-text text-transparent';
// Starts once the masked words have mostly landed. CSS, so the global reduced and
// paused rules settle or freeze it.
const SWEEP = 'animate-[gradient-pan_1.4s_var(--ease-in-out)_0.9s_1_both]';

const HAIRLINE: Record<'motion' | 'reduced', Variants> = {
  motion: {
    hidden: { scaleX: 0 },
    visible: { scaleX: 1, transition: { duration: duration.reveal * 0.7, ease: ease.out } },
  },
  reduced: { hidden: { scaleX: 0 }, visible: { scaleX: 1, transition: REDUCED_TRANSITION } },
};

const SectionIdContext = createContext<string | null>(null);

/** Rendered by SectionWrapper, so a heading inside it defaults to the section's kicker and `${id}-title`. */
export function SectionIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <SectionIdContext.Provider value={id}>{children}</SectionIdContext.Provider>;
}

function isSectionId(id: string | null): id is SectionId {
  return SECTIONS.some((s) => s.id === id);
}

function parseTitle(title: string, swept: boolean): { label: string; runs: SplitRun[] } {
  const runs = title
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((part): SplitRun => {
      if (part.length < 3 || !part.startsWith('*') || !part.endsWith('*')) return { text: part };
      return {
        text: part.slice(1, -1),
        render: (t) => (
          <GlitchText text={t} className="italic">
            <span className={cn(EMPHASIS, swept && SWEEP)}>{t}</span>
          </GlitchText>
        ),
      };
    });
  return { label: runs.map((r) => r.text).join(''), runs };
}

/**
 * Section title block. When it scrolls into view the hairline draws, the kicker
 * decodes, the title rises word by word out of a mask and the emphasised word gets
 * one colour sweep. The h2's accessible name is its plain text (no asterisks);
 * under reduced motion everything fades in without travelling.
 */
export function SectionHeading({ sectionId, kicker, title, subtitle, id, align = 'left', className }: Props) {
  const { reduce } = useMotionPrefs();
  const { ref, inView } = useInView<HTMLElement>({ threshold: 0, rootMargin: REVEAL_MARGIN });
  const kickerRef = useRef<HTMLSpanElement>(null);
  const show = inView || reduce;

  const wrapperId = useContext(SectionIdContext);
  const section = sectionId ?? (isSectionId(wrapperId) ? wrapperId : undefined);
  const kickerText = section ? kickerFor(section) : kicker;
  const titleId = id ?? (section ? `${section}-title` : wrapperId ? `${wrapperId}-title` : undefined);
  const parsed = useMemo(() => (typeof title === 'string' ? parseTitle(title, show && !reduce) : null), [title, show, reduce]);
  const fade = useMemo(() => revealVariants('fade-up', reduce), [reduce]);
  const subtitleFade = useMemo(() => revealVariants('fade-up', reduce, 0.3), [reduce]);
  const state = show ? 'visible' : 'hidden';

  useScrambleText(kickerRef, kickerText ?? '', { trigger: show && !reduce });

  const h2Class = 'font-display text-h2 font-bold text-balance text-text-primary';

  return (
    <header ref={ref} className={cn('mb-16 max-w-3xl', align === 'center' && 'mx-auto text-center', className)}>
      {kickerText && (
        <p
          className={cn(
            'mb-4 flex items-center gap-3 font-mono text-eyebrow uppercase text-cyan-text',
            align === 'center' && 'justify-center',
          )}
        >
          <motion.span
            aria-hidden="true"
            data-reveal=""
            className="h-px w-8 shrink-0 origin-left bg-current/60"
            variants={reduce ? HAIRLINE.reduced : HAIRLINE.motion}
            initial="hidden"
            animate={state}
          />
          <span className="sr-only">{kickerText}</span>
          <span ref={kickerRef} aria-hidden="true">
            {kickerText}
          </span>
        </p>
      )}

      {parsed ? (
        <SplitRuns
          as="h2"
          id={titleId}
          label={parsed.label}
          runs={parsed.runs}
          mask
          delay={0.12}
          trigger={show}
          className={h2Class}
        />
      ) : (
        <motion.h2 id={titleId} data-reveal="" className={h2Class} variants={fade} initial="hidden" animate={state}>
          {title}
        </motion.h2>
      )}

      {subtitle && (
        <motion.p
          data-reveal=""
          className={cn('mt-6 max-w-2xl text-lead text-text-muted', align === 'center' && 'mx-auto')}
          variants={subtitleFade}
          initial="hidden"
          animate={state}
        >
          {subtitle}
        </motion.p>
      )}
    </header>
  );
}
