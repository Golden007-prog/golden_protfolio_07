'use client';

import { motion } from 'framer-motion';
import { Equal, EqualNot, Split } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { useAiJson } from '@/components/ai/useAiJson';
import { hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import { AI_LIMITS } from '@/lib/ai/config';
import type { AiFallback } from '@/lib/ai/protocol';
import {
  agreement,
  isSentimentResponse,
  verifySpans,
  type Agreement,
  type LexiconLabel,
  type SentimentResponse,
  type Span,
  type SpanPolarity,
  type VerdictLabel,
} from '@/lib/ai/spans';
import { duration, ease } from '@/lib/motion';
import type { SentimentResult } from '@/lib/sentiment';
import { cn } from '@/utils/cn';

/* ---- pieces shared with the gallery ---- */

export const VERDICT_TONE: Record<VerdictLabel, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-muted',
  mixed: 'text-amber-text',
};

// The lexicon demo's chip style, so a Gemini span reads as the same kind of mark.
const SPAN_TONE: Record<SpanPolarity, string> = {
  positive: 'border-positive/40 bg-positive/10 text-positive',
  negative: 'border-negative/40 bg-negative/10 text-negative',
  neutral: 'border-glass-border-strong bg-glass-fill text-text-secondary',
};

export const AGREEMENT: Record<Agreement, { label: string; icon: typeof Equal }> = {
  agree: { label: 'Agrees with the lexicon', icon: Equal },
  differ: { label: 'Differs from the lexicon', icon: Split },
  disagree: { label: 'Disagrees with the lexicon', icon: EqualNot },
};

export function AgreementBadge({ value, className }: { value: Agreement; className?: string }) {
  const { label, icon: Icon } = AGREEMENT[value];
  return (
    <span
      data-agreement={value}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-medium text-text-secondary',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
      {label}
    </span>
  );
}

/** One verdict tile: who decided, the label and the score. */
export function VerdictTile({ title, label, score, className }: { title: string; label: VerdictLabel; score?: number; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-glass-border-strong bg-glass-fill p-4', className)}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-dim">{title}</p>
      <p className={cn('mt-1 font-display text-lg font-bold capitalize', VERDICT_TONE[label])} data-verdict-label={label}>
        {label}
      </p>
      {typeof score === 'number' ? <p className="font-mono text-[10px] text-text-dim">score {score.toFixed(2)}</p> : null}
    </div>
  );
}

/** `text` with verified spans marked in place. Callers pass spans already checked against this exact text. */
export function HighlightedText({ text, spans, className }: { text: string; spans: readonly Span[]; className?: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start < at || s.end > text.length) return;
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(
      <mark
        key={`${s.start}-${i}`}
        data-span-polarity={s.polarity}
        className={cn('ai-span rounded border px-1 py-px', SPAN_TONE[s.polarity])}
      >
        {text.slice(s.start, s.end)}
        <span className="sr-only"> ({s.polarity})</span>
      </mark>,
    );
    at = s.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <p className={cn('ai-span-text', className)}>{parts}</p>;
}

/* ---- the live comparison ---- */

const ENDPOINT = '/api/ai/sentiment';
// Matches the lexicon's own announcement delay, so the two never talk over each other.
const ANNOUNCE_DELAY_MS = 700;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function verdictMessage(data: SentimentResponse, lexicon: LexiconLabel): string {
  return `Gemini: ${data.label}, score ${data.score.toFixed(2)}. ${AGREEMENT[agreement(lexicon, data.label)].label}.`;
}

function Comparison({ text, data, lexicon }: { text: string; data: SentimentResponse; lexicon: SentimentResult }) {
  // Re-checked here too: a proxy or a stale cache must not mark text that isn't there.
  const spans = verifySpans(text, data.aspects).kept;
  const hidden = data.dropped + (data.aspects.length - spans.length);
  return (
    <motion.div
      data-sentiment-gemini={data.label}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease: ease.out }}
      className="mt-5 space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <VerdictTile title="Lexicon · in your browser" label={lexicon.label} score={lexicon.score} />
        <VerdictTile title="Gemini" label={data.label} score={data.score} />
      </div>
      <AgreementBadge value={agreement(lexicon.label, data.label)} />
      {data.rationale ? (
        <p className="text-sm leading-relaxed text-text-secondary" data-sentiment-rationale="">
          <span className="font-medium text-text-primary">Gemini&rsquo;s reason: </span>
          {data.rationale}
        </p>
      ) : null}
      {spans.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-dim">Phrases Gemini weighed</p>
          <HighlightedText text={text} spans={spans} className="mt-2 text-sm leading-loose text-text-secondary" />
        </div>
      ) : null}
      <AIDisclosure
        model={data.model}
        note={
          hidden > 0
            ? `${plural(hidden, 'phrase', 'phrases')} Gemini named ${hidden === 1 ? "wasn't" : "weren't"} in your text, so ${hidden === 1 ? "it isn't" : "they aren't"} highlighted.`
            : undefined
        }
      />
    </motion.div>
  );
}

/**
 * The opt-in second opinion under the lexicon demo. Nothing is sent until the
 * button is pressed; then the current text (at most 280 characters) goes to the
 * cheap tier and the verdict appears beside the lexicon's, with its verified
 * spans marked in the lexicon's chip style. A result belongs to the exact text
 * it was asked about: edit the text and it steps aside until compared again.
 * Every failure leaves the lexicon's verdict as the answer.
 */
export function GeminiCompare({ text, lexicon }: { text: string; lexicon: SentimentResult }) {
  const ai = useAiJson<SentimentResponse>(ENDPOINT);
  const noteId = useId();
  const [result, setResult] = useState<{ text: string; data: SentimentResponse } | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [invalidFor, setInvalidFor] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const latest = useRef(text);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    latest.current = text;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const limit = AI_LIMITS.sentimentText;
  const empty = !text.trim();
  const tooLong = text.length > limit;
  const current = result && result.text === text ? result.data : null;
  const loading = ai.status === 'loading' && asked === text;
  const failure: AiFallback | null =
    asked !== text || current
      ? null
      : invalidFor === text
        ? { mode: 'fallback', reason: 'unverified' }
        : ai.status === 'fallback'
          ? ai.fallback
          : null;

  const show = (sent: string, data: SentimentResponse, lexiconLabel: LexiconLabel) => {
    setResult({ text: sent, data });
    if (latest.current !== sent) return;
    // One polite announcement per verdict, after the tiles have settled.
    window.clearTimeout(timer.current);
    const message = verdictMessage(data, lexiconLabel);
    timer.current = window.setTimeout(() => setLive(message), ANNOUNCE_DELAY_MS);
  };

  async function compare() {
    const sent = text;
    const lexiconLabel = lexicon.label;
    if (!sent.trim() || sent.length > limit || loading) return;
    setAsked(sent);
    setInvalidFor(null);
    const key = await hashText(sent);
    const cached = sessionGet<unknown>('sentiment', key);
    if (isSentimentResponse(cached)) {
      show(sent, cached, lexiconLabel);
      return;
    }
    const data = await ai.run({ text: sent });
    if (!data) return;
    if (!isSentimentResponse(data)) {
      setInvalidFor(sent);
      return;
    }
    sessionSet('sentiment', key, data);
    show(sent, data, lexiconLabel);
  }

  return (
    <div data-sentiment-compare="" className="mt-6 border-t border-hairline pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <AIButton
          size="md"
          pending={loading}
          loadingLabel="Asking Gemini…"
          disabled={empty || tooLong}
          aria-describedby={noteId}
          onClick={() => void compare()}
          data-sentiment-compare-button=""
        >
          Compare with Gemini
        </AIButton>
        <p id={noteId} className="min-w-0 flex-1 basis-48 text-xs leading-relaxed text-text-muted">
          {tooLong
            ? `Gemini compares up to ${limit} characters; this text has ${text.length}.`
            : 'Optional: sends this text to Google Gemini for a second opinion.'}
        </p>
      </div>

      {current ? <Comparison key={text} text={text} data={current} lexicon={lexicon} /> : null}
      {failure ? (
        <AIErrorState className="mt-4" reason={failure.reason} retryAfterSec={failure.retryAfterSec} onRetry={() => void compare()}>
          <p className="text-sm text-text-muted">The lexicon&rsquo;s verdict above still stands.</p>
        </AIErrorState>
      ) : null}

      <p aria-live="polite" aria-atomic="true" className="sr-only" data-sentiment-ai-live="">
        {live}
      </p>
    </div>
  );
}
