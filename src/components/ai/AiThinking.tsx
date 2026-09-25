'use client';

import { LottieIcon } from '@/components/shared/LottieIcon';
import { cn } from '@/utils/cn';

function Dots() {
  return (
    <span className="ai-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * The pending state before the first sentence: the typing animation with a text
 * equivalent ('Thinking…', or a step such as 'Reading the JD…'). Under reduced
 * motion or the pause switch LottieIcon fetches nothing and the dots stay still.
 * Not a live region: the surface that owns the request announces the result.
 */
export function AiThinking({ step, className }: { step?: string; className?: string }) {
  return (
    <div data-ai-thinking="" className={cn('flex items-center gap-2 text-sm text-text-muted', className)}>
      <span className="grid h-6 w-10 shrink-0 place-items-center text-violet-bright">
        <LottieIcon name="typing" play="auto" loop lazy={false} className="block h-6 w-10" fallback={<Dots />} />
      </span>
      <span>{step ?? 'Thinking…'}</span>
    </div>
  );
}
