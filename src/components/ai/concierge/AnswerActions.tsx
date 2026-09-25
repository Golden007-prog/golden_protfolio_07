'use client';

import { useState } from 'react';
import { BookOpenCheck, Flag, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { targetHref } from '@/lib/ai/actions';
import { AI_EXPORT_NOTE, splitCitations } from '@/lib/ai/citations';
import type { AiSource } from '@/lib/ai/protocol';
import { track } from '@/lib/analytics';
import { SITE } from '@/lib/site';
import { scrubCanary } from './useConversation';

/**
 * The answer as Markdown: '[n]' markers numbered by first use, a Sources list of
 * links to the page that shows each one, then the AI-generated line. Markers for
 * sources the answer did not list are dropped.
 */
export function answerMarkdown(
  text: string,
  sources: readonly AiSource[],
  caseStudySlugs: ReadonlySet<string> | readonly string[],
): string {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const order: string[] = [];
  let body = '';
  for (const part of splitCitations(scrubCanary(text))) {
    if ('text' in part) {
      body += part.text.replace(/\[c:[^\]\n]*(\]|$)/g, '');
      continue;
    }
    if (!byId.has(part.cite)) continue;
    if (!order.includes(part.cite)) order.push(part.cite);
    body += `[${order.indexOf(part.cite) + 1}]`;
  }
  body = body
    .replace(/[ \t]+(\[\d+\])/g, ' $1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const list = order.map((id, i) => {
    const s = byId.get(id)!;
    const extra = s.cls === 'reference' ? ' (general reference)' : s.asOf ? ` (as of ${s.asOf})` : '';
    return `[${i + 1}] [${scrubCanary(s.label).replace(/[[\]]/g, '')}](${SITE.url}${targetHref(s.target, caseStudySlugs)})${extra}`;
  });
  return [body, list.length ? `Sources\n${list.join('\n')}` : '', `_${AI_EXPORT_NOTE}_`].filter(Boolean).join('\n\n');
}

type Props = {
  markdown: string;
  model: string;
  /** Pre-fills the contact form with the question and this answer. */
  onWrong: () => void;
  /** Absent when this answer can't be regenerated (not the latest, or the session cap is used). */
  onRegenerate?: () => void;
  regenLeft: number;
  quickShown: boolean;
  onToggleQuick: () => void;
};

/** Copy as Markdown, a thumbs vote (no text is sent), 'This is wrong', Regenerate and the free quick answer. */
export function AnswerActions({ markdown, model, onWrong, onRegenerate, regenLeft, quickShown, onToggleQuick }: Props) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const cast = (v: 'up' | 'down') => {
    if (vote) return;
    setVote(v);
    track('ai_feedback', {
      feature: 'ask',
      intent: v,
      model: model.slice(0, 40),
    });
  };

  return (
    <div data-ask-actions="" className="mt-2 flex flex-wrap items-center gap-1">
      <CopyButton value={markdown} label="Copy as Markdown" copiedLabel="Copied as Markdown" iconOnly size="md" />
      <Button
        variant="icon"
        size="md"
        aria-label="Helpful"
        aria-pressed={vote === 'up'}
        disabled={vote !== null && vote !== 'up'}
        onClick={() => cast('up')}
        data-ask-vote="up"
      >
        <ThumbsUp aria-hidden="true" className="size-4" />
      </Button>
      <Button
        variant="icon"
        size="md"
        aria-label="Not helpful"
        aria-pressed={vote === 'down'}
        disabled={vote !== null && vote !== 'down'}
        onClick={() => cast('down')}
        data-ask-vote="down"
      >
        <ThumbsDown aria-hidden="true" className="size-4" />
      </Button>
      {vote ? (
        <span role="status" className="px-1 text-xs text-text-muted">
          Thanks for the feedback
        </span>
      ) : null}
      <Button variant="ghost" size="sm" leadingIcon={<Flag aria-hidden="true" className="size-3.5" />} onClick={onWrong} data-ask-wrong="">
        This is wrong
      </Button>
      {onRegenerate ? (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<RefreshCw aria-hidden="true" className="size-3.5" />}
          onClick={onRegenerate}
          data-ask-regenerate=""
        >
          Regenerate
          <span className="sr-only"> ({regenLeft} left in this visit)</span>
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<BookOpenCheck aria-hidden="true" className="size-3.5" />}
        aria-expanded={quickShown}
        onClick={onToggleQuick}
        data-ask-quick=""
      >
        {quickShown ? 'Hide the quick answer' : 'Show the quick answer'}
      </Button>
    </div>
  );
}
