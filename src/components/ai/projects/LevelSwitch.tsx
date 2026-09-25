'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { ReadAloud } from '@/components/ai/ReadAloud';
import type { Level, LevelView } from '@/lib/ai/prompts/projects';
import { cn } from '@/utils/cn';

type Props = {
  /** Visible summaries only (selectCaseStudyAi); the caller renders nothing when empty. */
  levels: readonly LevelView[];
  className?: string;
};

/**
 * Explain-at-your-level (#200): a segmented control (tabs, with arrow keys, Home
 * and End) over precomputed ELI5, Recruiter and Engineer summaries. All three
 * texts sit in one grid cell, so the panel is always as tall as the longest and
 * switching never moves the page. The crossfade is CSS and turns off under
 * html[data-motion=reduced]. Each summary shows where it came from.
 */
export function LevelSwitch({ levels, className }: Props) {
  const base = useId();
  const [active, setActive] = useState<Level>(levels[0]?.id ?? 'eli5');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = levels.find((l) => l.id === active) ?? levels[0];
  if (!current) return null;

  const tabId = (id: Level) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = levels.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(levels[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className={cn('flex flex-col gap-4', className)} data-ai-levels="" data-level-active={current.id}>
      {levels.length > 1 ? (
        <div role="tablist" aria-label="Explain at your level" className="ai-levels-tabs">
          {levels.map((l, i) => {
            const selected = l.id === current.id;
            return (
              <button
                key={l.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={tabId(l.id)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(l.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="ai-levels-tab ring-focus"
                data-level={l.id}
              >
                <span aria-hidden="true">{l.label}</span>
                <span className="sr-only">{l.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        role={levels.length > 1 ? 'tabpanel' : undefined}
        id={panelId}
        aria-labelledby={levels.length > 1 ? tabId(current.id) : undefined}
        className="flex flex-col gap-4"
      >
        <div className="ai-levels-stack" data-ai-levels-stack="">
          {levels.map((l) => {
            const on = l.id === current.id;
            return (
              <p
                key={l.id}
                data-level-text={l.id}
                aria-hidden={on ? undefined : true}
                className={cn('ai-levels-text text-base leading-relaxed text-text-secondary', on && 'is-active')}
              >
                {l.text}
              </p>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ReadAloud key={current.id} text={current.text} label="Listen" caption={false} />
          <p className="text-xs text-text-muted" data-ai-provenance="">
            {current.provenance}
          </p>
        </div>
        <AIDisclosure compact />
      </div>
    </div>
  );
}

export default LevelSwitch;
