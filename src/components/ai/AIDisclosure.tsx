import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';

type Props = {
  /** One line without the model name or note, for tight spaces such as chat bubbles. */
  compact?: boolean;
  /** The model that answered, from the stream's meta frame or /api/ai/health. */
  model?: string;
  /** One extra sentence, e.g. what was removed before the answer was shown. */
  note?: string;
  className?: string;
};

/**
 * The disclosure every AI surface carries: the text was generated and may be
 * wrong, with links to how it works and what happens to what a visitor types.
 */
export function AIDisclosure({ compact = false, model, note, className }: Props) {
  return (
    <p
      data-ai-disclosure=""
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal text-text-muted', className)}
    >
      <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
      <span className="font-medium text-text-secondary">AI-generated · may be wrong</span>
      {!compact && model ? <span>Model: {model}</span> : null}
      {!compact && note ? <span className="basis-full">{note}</span> : null}
      <span className="inline-flex items-center gap-2">
        <Link href="/ai#how" prefetch={false} className="ai-link ring-focus rounded-md">
          How it works
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/ai#privacy" prefetch={false} className="ai-link ring-focus rounded-md">
          Privacy
        </Link>
      </span>
    </p>
  );
}
