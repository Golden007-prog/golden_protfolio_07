'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import { splitCitations } from '@/lib/ai/citations';
import type { AiSource } from '@/lib/ai/protocol';
import { cn } from '@/utils/cn';

type Part = { kind: 'text'; text: string } | { kind: 'cite'; source: AiSource; n: number };

// splitCitations leaves a malformed marker ('[c:fake]') as text; the server's
// allow-list removes those, and this keeps one from ever showing if it slips through.
const STRAY_MARKER = /\[c:[^[\]\n]*(\]|$)/g;

/**
 * Text and citation chips in reading order. A chip is numbered by its source's
 * first appearance; markers naming a source the answer did not list are dropped.
 */
export function citeParts(text: string, sources: readonly AiSource[] = []): Part[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const numbers = new Map<string, number>();
  const out: Part[] = [];
  for (const p of splitCitations(text)) {
    if ('cite' in p) {
      const source = byId.get(p.cite);
      if (!source) continue;
      if (!numbers.has(source.id)) numbers.set(source.id, numbers.size + 1);
      out.push({ kind: 'cite', source, n: numbers.get(source.id) ?? 0 });
    } else {
      const clean = p.text.replace(STRAY_MARKER, '');
      if (clean) out.push({ kind: 'text', text: clean });
    }
  }
  return out;
}

/** The answer as a screen reader should hear it: no markers, no doubled spaces. */
export function plainAnswer(parts: readonly Part[]): string {
  return parts
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

const ANNOUNCE_DELAY_MS = 60;
const ANNOUNCE_CLEAR_MS = 7000;

type Props = {
  text: string;
  streaming: boolean;
  sources?: AiSource[];
  /** A chip was activated; pass source.target to useAiActionRunner. */
  onCite?: (source: AiSource) => void;
  /**
   * Announce the finished answer through this component's own polite region
   * (default). Turn it off when the surrounding UI already announces answers,
   * so nothing is read twice.
   */
  announce?: boolean;
  lang?: string;
  className?: string;
};

/**
 * An answer that arrives one verified sentence at a time. While it streams the
 * text is aria-hidden (a screen reader would otherwise re-read every sentence)
 * and the chips are inert; once it ends, the whole answer is announced once and
 * the chips become 44px buttons.
 */
export function StreamingText({ text, streaming, sources, onCite, announce = true, lang, className }: Props) {
  const parts = useMemo(() => citeParts(text, sources), [text, sources]);
  const plain = useMemo(() => plainAnswer(parts), [parts]);
  const regionRef = useRef<HTMLSpanElement>(null);
  const announced = useRef('');

  useEffect(() => {
    if (!announce || streaming || !plain || plain === announced.current) return;
    announced.current = plain;
    const region = regionRef.current;
    if (!region) return;
    // Written into an already-mounted, empty region: that is what screen readers pick up.
    let clear = 0;
    const speak = window.setTimeout(() => {
      region.textContent = plain;
      clear = window.setTimeout(() => {
        region.textContent = '';
      }, ANNOUNCE_CLEAR_MS);
    }, ANNOUNCE_DELAY_MS);
    return () => {
      window.clearTimeout(speak);
      window.clearTimeout(clear);
    };
  }, [announce, streaming, plain]);

  return (
    <div className={cn('ai-stream', className)} data-streaming={streaming ? '' : undefined} lang={lang}>
      <div className="ai-stream-text" aria-hidden={streaming || undefined}>
        {parts.map((p, i) => {
          if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>;
          const label = `Source ${p.n}: ${p.source.label}`;
          return streaming || !onCite ? (
            <span key={i} className="ai-cite" title={p.source.label} data-cite-id={p.source.id}>
              <span className="ai-cite-pill" aria-hidden="true">
                {p.n}
              </span>
              <span className="sr-only">({label})</span>
            </span>
          ) : (
            <button
              key={i}
              type="button"
              className="ai-cite"
              aria-label={label}
              data-cite-id={p.source.id}
              data-cursor="open"
              onClick={() => onCite(p.source)}
            >
              <span className="ai-cite-pill" aria-hidden="true">
                {p.n}
              </span>
            </button>
          );
        })}
        {streaming ? <span className="ai-caret" aria-hidden="true" /> : null}
      </div>
      {announce ? <span ref={regionRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-ai-announce="" /> : null}
    </div>
  );
}
