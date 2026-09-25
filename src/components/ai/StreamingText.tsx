'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { AiSource } from '@/lib/ai/protocol';
import { cn } from '@/utils/cn';
import { citeParts, plainAnswer } from './citeParts';

export { citeParts, plainAnswer };

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
   * so nothing is read twice. That UI should speak plainAnswer(), and must not
   * put this component inside a live region: every chip's "Source N" label
   * would be read with the text.
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
