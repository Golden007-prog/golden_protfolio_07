import { BookOpenCheck, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';

export type AnswerSource = 'rules' | 'ai' | 'cache';

// The rule engine answers in the first person and the model in the third, so
// every bubble says which one spoke.
const COPY: Record<AnswerSource, string> = {
  rules: "From the site's data",
  ai: 'AI-generated · may be wrong',
  cache: 'AI-generated · may be wrong',
};

/** Marks one answer as rule-based ('rules') or model-written ('ai', or 'cache' for a saved AI answer). */
export function SourceBadge({ source, className }: { source: AnswerSource; className?: string }) {
  const Icon = source === 'rules' ? BookOpenCheck : Sparkles;
  return (
    <span
      data-source={source}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[11px] font-medium leading-tight text-text-muted',
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3 shrink-0', source !== 'rules' && 'text-cyan-text')} />
      {COPY[source]}
      {source === 'cache' ? <span className="sr-only"> (a saved answer)</span> : null}
    </span>
  );
}
