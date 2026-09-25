'use client';

import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { ChevronLeft, ChevronRight, CornerLeftUp } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { Button } from '@/components/ui/Button';
import { agreement, verifySpans, VERDICT_LABELS, type Span, type VerdictLabel } from '@/lib/ai/spans';
import { duration, ease } from '@/lib/motion';
import { analyze } from '@/lib/sentiment';
import { AgreementBadge, HighlightedText, VerdictTile } from './GeminiCompare';
import { useSkillsStore, type SkillsStore } from './SkillUsage';

type Example = {
  key: string;
  model: string;
  text: string;
  /** The kind of trap, e.g. 'Negation scope'. */
  trap: string;
  /** Why a word-list model trips on it. */
  note: string;
  /** How a person reads it. */
  intended: VerdictLabel;
  label: VerdictLabel;
  score: number;
  rationale: string;
  aspects: Span[];
};

const isLabel = (x: unknown): x is VerdictLabel => typeof x === 'string' && (VERDICT_LABELS as readonly string[]).includes(x);

function examplesOf(store: SkillsStore | null): Example[] {
  if (!store) return [];
  const out: Example[] = [];
  for (const key of Object.keys(store.entries).sort()) {
    if (!key.startsWith('gallery:')) continue;
    const entry = store.entries[key];
    const v = entry?.value as Partial<Example> | undefined;
    if (!v || typeof v.text !== 'string' || !v.text || typeof v.trap !== 'string' || typeof v.note !== 'string') continue;
    if (!isLabel(v.intended) || !isLabel(v.label) || typeof v.score !== 'number') continue;
    out.push({
      key,
      model: typeof entry.model === 'string' && entry.model ? entry.model : 'Gemini',
      text: v.text,
      trap: v.trap,
      note: v.note,
      intended: v.intended,
      label: v.label,
      score: v.score,
      rationale: typeof v.rationale === 'string' ? v.rationale : '',
      aspects: verifySpans(v.text, v.aspects).kept,
    });
  }
  return out;
}

// The card slides the way the visitor paged; the one leaving goes the other way.
const SLIDE: Variants = {
  enter: (d: number) => ({ opacity: 0, x: 12 * d }),
  center: { opacity: 1, x: 0, transition: { duration: duration.base, ease: ease.out } },
  exit: (d: number) => ({ opacity: 0, x: -12 * d, transition: { duration: duration.quick, ease: ease.in } }),
};

/**
 * "Where lexicons break": about ten illustrative sentences (negation scope,
 * sarcasm, litotes, technical idioms...) with three readings side by side: how a
 * person reads it, the browser lexicon's verdict (computed live, so it is always
 * this lexicon's real answer), and Gemini's verdict, generated ahead of time by
 * gen-skills.mjs with the live route's prompt. Browsing makes no request.
 */
export function DisagreementGallery({ onTry }: { onTry?: (text: string) => void }) {
  const store = useSkillsStore();
  const examples = useMemo(() => examplesOf(store), [store]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const counterId = useId();

  if (!store) return <p className="mt-4 text-sm text-text-muted">Loading the examples…</p>;
  if (!examples.length) {
    return (
      <p className="mt-4 text-sm text-text-muted" data-gallery-empty="">
        The examples haven&rsquo;t been generated yet.
      </p>
    );
  }

  const i = Math.min(index, examples.length - 1);
  const ex = examples[i];
  const lexicon = analyze(ex.text);
  const breaks = lexicon.label !== ex.intended;
  const go = (step: 1 | -1) => {
    setDir(step);
    setIndex((i + step + examples.length) % examples.length);
  };

  return (
    <div data-lexicon-gallery="" className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="icon"
          size="md"
          aria-label="Previous example"
          aria-describedby={counterId}
          onClick={() => go(-1)}
          leadingIcon={<ChevronLeft aria-hidden="true" className="size-5" />}
          data-gallery-prev=""
        />
        <p id={counterId} className="text-center font-mono text-xs tabular-nums text-text-muted" aria-live="polite" data-gallery-counter="">
          <span className="sr-only">Example </span>
          {i + 1}
          <span aria-hidden="true"> / </span>
          <span className="sr-only"> of </span>
          {examples.length}
        </p>
        <Button
          variant="icon"
          size="md"
          aria-label="Next example"
          aria-describedby={counterId}
          onClick={() => go(1)}
          leadingIcon={<ChevronRight aria-hidden="true" className="size-5" />}
          data-gallery-next=""
        />
      </div>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.figure
          key={ex.key}
          data-gallery-example={ex.key}
          variants={SLIDE}
          custom={dir}
          initial="enter"
          animate="center"
          exit="exit"
          className="mt-3 rounded-xl border border-glass-border-strong bg-glass-fill p-4"
        >
          <figcaption className="font-mono text-[10px] uppercase tracking-wider text-cyan-text">{ex.trap}</figcaption>
          <blockquote className="mt-2">
            <HighlightedText text={ex.text} spans={ex.aspects} className="text-base leading-loose text-text-primary" />
          </blockquote>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <VerdictTile title="A person" label={ex.intended} className="p-3" />
            <VerdictTile title="Lexicon · live" label={lexicon.label} score={lexicon.score} className="p-3" />
            <VerdictTile title="Gemini" label={ex.label} score={ex.score} className="p-3" />
          </div>
          <AgreementBadge value={agreement(lexicon.label, ex.label)} className="mt-3" />

          <p className="mt-3 text-sm leading-relaxed text-text-secondary" data-gallery-note="">
            {breaks ? (
              <>
                <span className="font-medium text-text-primary">Why the lexicon slips: </span>
                {ex.note}
              </>
            ) : (
              'The lexicon reads this one the way a person would.'
            )}
          </p>
          {ex.rationale ? (
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              <span className="font-medium text-text-primary">Gemini&rsquo;s reason: </span>
              {ex.rationale}
            </p>
          ) : null}

          {onTry ? (
            <Button
              variant="ghost"
              size="md"
              className="-ml-3 mt-2"
              onClick={() => onTry(ex.text)}
              leadingIcon={<CornerLeftUp aria-hidden="true" className="size-4" />}
              data-gallery-try=""
            >
              Try it in the demo
            </Button>
          ) : null}
        </motion.figure>
      </AnimatePresence>

      <p className="mt-3 text-xs text-text-muted">
        Illustrative sentences written for this demo. Gemini&rsquo;s verdicts were generated ahead of time with the same prompt as the live
        comparison, not live.
      </p>
      <AIDisclosure model={ex.model} className="mt-2" />
    </div>
  );
}
