'use client';

import { Sparkles } from 'lucide-react';
import { SourceBadge } from '@/components/ai/SourceBadge';
import type { InterestId, InterestView } from '@/lib/ai/prompts/projects';
import { cn } from '@/utils/cn';

type Props = {
  interests: readonly InterestView[];
  active: InterestId | null;
  onChange: (id: InterestId | null) => void;
  /** id of the grid the chips reorder. */
  controls: string;
  className?: string;
};

/**
 * Interest chips (#204): Agents, RAG, Forecasting. Pressing one reorders the grid
 * by a ranking gen-projects.mjs precomputed from embeddings, entirely in the
 * browser; the grid's layout animation is off under reduced motion. Rendered
 * only when the store has rankings, which needs ai-vectors.json.
 */
export function InterestChips({ interests, active, onChange, controls, className }: Props) {
  if (!interests.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-ai-interests="">
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
        <Sparkles aria-hidden="true" className="size-3.5 text-cyan-text" />
        <span id={`${controls}-interests-label`}>Closest to</span>
      </span>
      <div role="group" aria-labelledby={`${controls}-interests-label`} className="flex flex-wrap gap-2">
        {interests.map((it) => {
          const pressed = active === it.id;
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={pressed}
              aria-controls={controls}
              onClick={() => onChange(pressed ? null : it.id)}
              data-interest={it.id}
              className={cn('ai-interest-chip ring-focus', pressed && 'is-pressed')}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      <SourceBadge source="ai" />
    </div>
  );
}

export default InterestChips;
