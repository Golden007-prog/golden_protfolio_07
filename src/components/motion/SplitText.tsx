'use client';

import { motion, type Variants } from 'framer-motion';
import { Fragment, useMemo, type ReactNode } from 'react';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';
import { cn } from '../../utils/cn';
import { duration, ease, stagger as STAGGER, staggerContainer } from '../../lib/motion';
import { REDUCED_TRANSITION, REVEAL_MARGIN } from './Reveal';

export type SplitTag = 'h1' | 'h2' | 'h3' | 'p' | 'span';
export type SplitTrigger = 'inView' | 'mount' | boolean;

/** A stretch of text with an optional renderer, so part of a word can be styled differently. */
export type SplitRun = { text: string; render?: (text: string) => ReactNode };

const HEADINGS = new Set<SplitTag>(['h1', 'h2', 'h3']);
const INSTANT_CONTAINER: Variants = { hidden: {}, visible: {} };

// y is a percentage of the piece's own height. 115% clears the mask's padding.
const PIECE: Record<'mask' | 'words' | 'chars', Variants> = {
  mask: {
    hidden: { y: '115%', opacity: 0 },
    visible: {
      y: '0%',
      opacity: 1,
      transition: { duration: duration.reveal, ease: ease.out, opacity: { duration: duration.base, ease: ease.out } },
    },
  },
  words: {
    hidden: { y: '0.35em', opacity: 0 },
    visible: { y: '0em', opacity: 1, transition: { duration: duration.reveal * 0.7, ease: ease.out } },
  },
  chars: {
    hidden: { y: '0.25em', opacity: 0 },
    visible: { y: '0em', opacity: 1, transition: { duration: duration.base, ease: ease.out } },
  },
};

const REDUCED_PIECE: Record<keyof typeof PIECE, Variants> = {
  mask: { hidden: PIECE.mask.hidden, visible: { y: '0%', opacity: 1, transition: REDUCED_TRANSITION } },
  words: { hidden: PIECE.words.hidden, visible: { y: '0em', opacity: 1, transition: REDUCED_TRANSITION } },
  chars: { hidden: PIECE.chars.hidden, visible: { y: '0em', opacity: 1, transition: REDUCED_TRANSITION } },
};

/**
 * Splits runs on whitespace into words. Runs that touch without a space stay in
 * one word ('*built*' + '.' is one word), so a line never breaks between them.
 */
export function toWords(runs: readonly SplitRun[]): SplitRun[][] {
  const words: SplitRun[][] = [];
  let current: SplitRun[] = [];
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (current.length) words.push(current);
        current = [];
      } else {
        current.push({ text: part, render: run.render });
      }
    }
  }
  if (current.length) words.push(current);
  return words;
}

type SplitRunsProps = {
  as?: SplitTag;
  id?: string;
  /** The accessible text. Pieces are aria-hidden. */
  label: string;
  runs: readonly SplitRun[];
  by?: 'words' | 'chars';
  mask?: boolean;
  stagger?: number;
  delay?: number;
  trigger?: SplitTrigger;
  className?: string;
  pieceClassName?: string;
};

function renderRun(run: SplitRun, text: string) {
  return run.render ? run.render(text) : text;
}

/**
 * The engine behind SplitText, exported for callers that need styled runs inside
 * the split (SectionHeading's gradient emphasis). Headings get aria-label; every
 * tag also carries the text as sr-only content, because aria-label is ignored on
 * a <p> or <span> and the pieces are hidden from assistive tech.
 */
export function SplitRuns({
  as = 'span',
  id,
  label,
  runs,
  by = 'words',
  mask = false,
  stagger,
  delay = 0,
  trigger = 'inView',
  className,
  pieceClassName,
}: SplitRunsProps) {
  const { reduce } = useMotionPrefs();
  const kind = mask ? 'mask' : by;
  const each = stagger ?? (by === 'chars' ? STAGGER.micro * 0.75 : STAGGER.micro * 1.5);
  const container = useMemo(
    () => (reduce ? INSTANT_CONTAINER : staggerContainer(each, delay)),
    [reduce, each, delay],
  );
  const pieceVariants = reduce ? REDUCED_PIECE[kind] : PIECE[kind];
  const words = useMemo(() => toWords(runs), [runs]);
  const Tag = motion[as];

  let animate: 'visible' | 'hidden' | undefined;
  let whileInView: 'visible' | undefined;
  if (typeof trigger === 'boolean') animate = trigger ? 'visible' : 'hidden';
  else if (trigger === 'mount' || reduce) animate = 'visible';
  else whileInView = 'visible';

  const piece = (content: ReactNode, key: string | number) => {
    const inner = (
      <motion.span
        key={mask ? undefined : key}
        data-reveal=""
        variants={pieceVariants}
        className={cn('inline-block', pieceClassName)}
      >
        {content}
      </motion.span>
    );
    if (!mask) return inner;
    // Padding (cancelled by negative margins) keeps descenders and italic overhang
    // inside the clip without changing the layout.
    return (
      <span key={key} className="-mx-[0.08em] -my-[0.14em] inline-block overflow-clip px-[0.08em] py-[0.14em] align-bottom">
        {inner}
      </span>
    );
  };

  return (
    <Tag
      id={id}
      className={className}
      aria-label={HEADINGS.has(as) ? label : undefined}
      variants={container}
      initial="hidden"
      animate={animate}
      whileInView={whileInView}
      viewport={{ once: true, margin: REVEAL_MARGIN }}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {words.map((word, w) => (
          <Fragment key={w}>
            {w > 0 && ' '}
            {by === 'chars' ? (
              <span className="inline-block whitespace-nowrap">
                {word.flatMap((run, r) =>
                  Array.from(run.text).map((ch, c) => piece(renderRun(run, ch), `${r}-${c}`)),
                )}
              </span>
            ) : (
              piece(
                word.map((run, r) => <Fragment key={r}>{renderRun(run, run.text)}</Fragment>),
                w,
              )
            )}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}

export type SplitTextProps = Omit<SplitRunsProps, 'label' | 'runs'> & { text: string };

/**
 * Text that reveals word by word or letter by letter. Its accessible name is the
 * plain text; under reduced motion it simply fades in over 200ms.
 */
export function SplitText({ text, ...rest }: SplitTextProps) {
  const runs = useMemo(() => [{ text }], [text]);
  return <SplitRuns label={text} runs={runs} {...rest} />;
}
