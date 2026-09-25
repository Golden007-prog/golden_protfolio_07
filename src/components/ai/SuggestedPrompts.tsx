'use client';

import { cn } from '@/utils/cn';

type Props = {
  prompts: readonly string[];
  onPick: (prompt: string) => void;
  /** Accessible name of the group, e.g. 'Suggested questions'. */
  label: string;
  /** While an answer is running the chips stay visible but can't be sent. */
  disabled?: boolean;
  className?: string;
};

/** Question chips: 44px targets that wrap on narrow screens and keep reading order. */
export function SuggestedPrompts({ prompts, onPick, label, disabled = false, className }: Props) {
  if (prompts.length === 0) return null;
  return (
    <ul role="list" aria-label={label} data-ai-prompts="" className={cn('flex flex-wrap gap-2', className)}>
      {prompts.map((p) => (
        <li key={p} className="min-w-0 max-w-full">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="tap-safe max-w-full justify-start rounded-full border border-glass-border bg-glass-fill px-4 py-2 text-left text-[13px] leading-snug text-text-secondary ring-focus transition-colors duration-200 hover:border-violet-bright hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {p}
          </button>
        </li>
      ))}
    </ul>
  );
}
