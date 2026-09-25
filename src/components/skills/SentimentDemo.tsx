'use client';

import { motion } from 'framer-motion';
import { ChevronDown, RotateCcw, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { GeminiCompare } from '@/components/ai/skills/GeminiCompare';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { emit } from '@/lib/events';
import { duration, ease } from '@/lib/motion';
import { analyze, INTENSIFIER_FACTOR, type Polarity, type SentimentHit } from '@/lib/sentiment';
import { cn } from '@/utils/cn';

const EXAMPLES = [
  'The new RAG pipeline is blazing fast and surprisingly accurate.',
  'That deploy pipeline broke again — really frustrating debug session.',
  'Meeting went okay, nothing to report.',
];

const ANNOUNCE_DELAY_MS = 700;

// Its own chunk (and the AI store's), fetched only when the visitor opens it.
const DisagreementGallery = lazy(() =>
  import('@/components/ai/skills/DisagreementGallery').then((m) => ({ default: m.DisagreementGallery })),
);

const LABEL_TONE: Record<Polarity, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-muted',
};

const BAR = { duration: duration.base, ease: ease.out };

function hitTone(hit: SentimentHit) {
  return hit.weight > 0
    ? 'border-positive/40 bg-positive/10 text-positive'
    : 'border-negative/40 bg-negative/10 text-negative';
}

function describeHit(hit: SentimentHit): string {
  const parts = [hit.base > 0 ? 'positive word' : 'negative word'];
  if (hit.intensified) parts.push(`intensified ×${INTENSIFIER_FACTOR}`);
  if (hit.negated) parts.push('negated');
  return `${hit.word}: ${parts.join(', ')}, weight ${hit.weight.toFixed(2)}`;
}

/**
 * A lexicon sentiment model that runs in the browser (src/lib/sentiment.ts). Each
 * scored word is listed with what changed its weight (¬ negated, ×1.6 intensified),
 * the polarity bar grows from the centre with scaleX, and the verdict is announced
 * politely once typing pauses. The lexicon stays the default; comparing with
 * Gemini is opt-in (GeminiCompare), and "Where lexicons break" shows prepared
 * examples without any request.
 */
export function SentimentDemo() {
  const [text, setText] = useState(EXAMPLES[0]);
  const result = useMemo(() => analyze(text), [text]);
  const inputId = useId();
  const hintId = useId();
  const galleryId = useId();
  const empty = !text.trim();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const tryText = (next: string) => {
    setText(next);
    inputRef.current?.focus();
  };

  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const message = empty ? 'Waiting for text' : `Sentiment ${result.label}, score ${result.score.toFixed(2)}`;
    // Silent until the visitor edits the text, so page load announces nothing.
    const t = window.setTimeout(
      () => setAnnouncement((prev) => (prev === '' && text === EXAMPLES[0] ? prev : message)),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(t);
  }, [text, empty, result.label, result.score]);

  const positive = Math.max(0, result.score);
  const negative = Math.max(0, -result.score);

  return (
    <div className="glass-strong rounded-2xl p-6 md:p-8" data-sentiment-demo="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Sparkles aria-hidden="true" size={16} className="shrink-0 text-cyan-text" />
          <div>
            <h3 className="font-display text-lg font-semibold text-text-primary">Try it — inline sentiment</h3>
            <p id={hintId} className="font-mono text-eyebrow uppercase text-text-dim">
              Tiny lexicon model · runs in your browser · no API
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => emit('skill:open', { name: 'Sentiment analysis' })}
            aria-haspopup="dialog"
            className="tap-safe-sm rounded-full px-3 font-mono text-[11px] text-text-muted ring-focus transition-colors hover:text-violet-bright"
          >
            How it works
          </button>
          <button
            type="button"
            onClick={() => setText('')}
            className="tap-safe-sm gap-1.5 rounded-full px-3 font-mono text-[11px] text-text-muted ring-focus transition-colors hover:text-violet-bright"
          >
            <RotateCcw aria-hidden="true" size={12} /> Clear
          </button>
        </div>
      </div>

      <label htmlFor={inputId} className="sr-only">
        Text to analyse
      </label>
      <textarea
        ref={inputRef}
        id={inputId}
        aria-describedby={hintId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type or paste some text…"
        className="w-full resize-none rounded-xl border border-glass-border-strong bg-glass-fill px-4 py-3 text-base text-text-primary ring-focus transition-colors placeholder:text-text-dim focus-visible:border-violet-bright md:text-sm"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            aria-pressed={text === ex}
            className="tap-safe-sm rounded-full border border-glass-border-strong bg-glass-fill px-3 text-[11px] text-text-muted ring-focus transition-colors hover:border-cyan-bright hover:text-text-primary aria-pressed:border-cyan-bright aria-pressed:text-text-primary"
          >
            Example {i + 1}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-glass-border-strong bg-glass-fill p-4 md:col-span-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-dim">Polarity</p>
          <div
            role="meter"
            aria-label="Polarity"
            aria-valuemin={-1}
            aria-valuemax={1}
            aria-valuenow={Number(result.score.toFixed(2))}
            aria-valuetext={`${result.score.toFixed(2)}, ${result.label}`}
            className="relative mt-3 h-2 overflow-clip rounded-full bg-heat-0"
          >
            <motion.div
              className="absolute inset-y-0 right-1/2 w-1/2 origin-right rounded-l-full bg-negative"
              initial={false}
              animate={{ scaleX: negative }}
              transition={BAR}
            />
            <motion.div
              className="absolute inset-y-0 left-1/2 w-1/2 origin-left rounded-r-full bg-positive"
              initial={false}
              animate={{ scaleX: positive }}
              transition={BAR}
            />
            <div aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-glass-border-strong" />
          </div>
          <div aria-hidden="true" className="mt-2 flex justify-between font-mono text-[10px] text-text-dim">
            <span>−1.0 negative</span>
            <span>0 neutral</span>
            <span>+1.0 positive</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-glass-border-strong bg-glass-fill p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-dim">Label</p>
          {empty ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-text-muted" data-sentiment-label="idle">
              <LottieIcon name="dots" className="block h-5 w-8" fallback={<span aria-hidden="true">…</span>} />
              Waiting for text
            </p>
          ) : (
            <>
              <p
                className={cn('mt-2 font-display text-2xl font-bold capitalize', LABEL_TONE[result.label])}
                data-sentiment-label={result.label}
              >
                {result.label}
              </p>
              <p className="mt-1 font-mono text-[10px] text-text-dim">score {result.score.toFixed(2)}</p>
            </>
          )}
        </div>
      </div>

      {result.hits.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Scored words">
          {result.hits.map((hit, i) => (
            <li
              key={`${hit.start}-${i}`}
              title={describeHit(hit)}
              className={cn('inline-flex items-baseline gap-1 rounded border px-2 py-0.5 font-mono text-[11px]', hitTone(hit))}
            >
              <span className="sr-only">{describeHit(hit)}</span>
              <span aria-hidden="true">{hit.word}</span>
              {hit.negated ? <span aria-hidden="true">¬</span> : null}
              {hit.intensified ? <span aria-hidden="true">×{INTENSIFIER_FACTOR}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {result.hits.length > 0 ? (
        <p className="mt-2 font-mono text-[10px] text-text-dim">¬ negated · ×{INTENSIFIER_FACTOR} intensified</p>
      ) : null}

      <GeminiCompare text={text} lexicon={result} />

      <div className="mt-6 border-t border-hairline pt-4">
        <Button
          variant="ghost"
          size="md"
          className="-ml-3"
          aria-expanded={galleryOpen}
          aria-controls={galleryOpen ? galleryId : undefined}
          onClick={() => setGalleryOpen((v) => !v)}
          trailingIcon={<ChevronDown aria-hidden="true" className="ai-skills-chevron size-4" data-open={galleryOpen || undefined} />}
          data-lexicon-gallery-toggle=""
        >
          Where lexicons break
        </Button>
        {galleryOpen ? (
          <div id={galleryId}>
            <Suspense fallback={<p className="mt-4 text-sm text-text-muted">Loading the examples…</p>}>
              <DisagreementGallery onTry={tryText} />
            </Suspense>
          </div>
        ) : null}
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only" data-sentiment-live="">
        {announcement}
      </p>
    </div>
  );
}
