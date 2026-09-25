'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { Button } from '@/components/ui/Button';
import { AI_LIMITS } from '@/lib/ai/config';
import type { Requirement } from '@/lib/ai/fit';
import { cn } from '@/utils/cn';

type Props = {
  requirements: Requirement[];
  onChange: (next: Requirement[]) => void;
  onMatch: () => void;
  busy: boolean;
  /** The JD's language when it is not English: the chips then show an English gloss. */
  language: string | null;
};

/**
 * The extracted requirements as editable 44px chips, so a recruiter can fix a
 * misread or drop boilerplate before matching. Each chip toggles must/nice;
 * Backspace or Delete on a focused chip removes it; 'Add requirement' adds one.
 */
export function RequirementChips({ requirements, onChange, onMatch, busy, language }: Props) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const full = requirements.length >= AI_LIMITS.jdRequirements;

  const focusChip = (index: number) => {
    requestAnimationFrame(() => {
      const chips = listRef.current?.querySelectorAll<HTMLElement>('[data-fit-chip-toggle]');
      const target = chips?.[Math.min(index, (chips?.length ?? 1) - 1)];
      (target ?? addRef.current)?.focus();
    });
  };

  const remove = (index: number) => {
    onChange(requirements.filter((_, i) => i !== index));
    focusChip(index);
  };

  const toggle = (index: number) => onChange(requirements.map((r, i) => (i === index ? { ...r, kind: r.kind === 'must' ? 'nice' : 'must' } : r)));

  const add = () => {
    const text = draft.replace(/\s+/g, ' ').trim().slice(0, AI_LIMITS.requirement);
    if (!text || full || requirements.some((r) => r.text.toLowerCase() === text.toLowerCase())) return;
    onChange([...requirements, { text, kind: 'must' }]);
    setDraft('');
  };

  const onChipKey = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      remove(index);
    }
  };

  return (
    <div data-fit-review="" data-fit-noprint="" className="flex flex-col gap-4">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
          Requirements found ({requirements.length})
        </h3>
        <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-text-muted">
          Fix anything misread before matching. Select a chip to switch must-have and nice-to-have; Backspace removes a focused chip.
          {language ? ` The JD is in '${language}'; an English gloss sits beside each line.` : ''}
        </p>
      </div>

      <ul ref={listRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} className="flex flex-wrap gap-2">
        {requirements.map((r, i) => (
          <li key={`${r.text}-${i}`} data-fit-chip={r.kind} className="flex min-w-0 max-w-full items-stretch rounded-full border border-glass-border bg-glass-fill">
            <button
              type="button"
              data-fit-chip-toggle=""
              aria-label={`${r.kind === 'must' ? 'Must-have' : 'Nice-to-have'}: ${r.text}. Select to make it ${r.kind === 'must' ? 'nice-to-have' : 'must-have'}; Backspace removes it.`}
              onClick={() => toggle(i)}
              onKeyDown={onChipKey(i)}
              className="tap-safe min-w-0 justify-start gap-2 rounded-full py-1.5 pl-1.5 pr-2 text-left text-[13px] leading-snug text-text-secondary ring-focus transition-colors hover:text-text-primary"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
                  r.kind === 'must' ? 'bg-surface-tint text-cyan-text' : 'border border-hairline text-text-muted',
                )}
              >
                {r.kind === 'must' ? 'Must' : 'Nice'}
              </span>
              <span aria-hidden="true" className="min-w-0 [overflow-wrap:anywhere]">
                {r.text}
                {r.gloss ? <span className="text-text-muted"> · {r.gloss}</span> : null}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${r.text}`}
              onClick={() => remove(i)}
              onKeyDown={onChipKey(i)}
              className="tap-safe shrink-0 rounded-full text-text-muted ring-focus transition-colors hover:text-text-primary"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-add`} className="sr-only">
          Add requirement
        </label>
        <input
          ref={addRef}
          id={`${id}-add`}
          value={draft}
          maxLength={AI_LIMITS.requirement}
          disabled={full}
          placeholder={full ? `At most ${AI_LIMITS.jdRequirements} requirements` : 'Add requirement'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          data-fit-add=""
          className="min-h-11 min-w-0 flex-1 basis-48 rounded-full border border-glass-border bg-surface-tint px-4 text-sm text-text-primary ring-focus placeholder:text-text-muted"
        />
        <Button type="button" variant="secondary" size="md" onClick={add} disabled={full || !draft.trim()} leadingIcon={<Plus aria-hidden="true" className="size-4 shrink-0" />}>
          Add
        </Button>
      </div>

      <div>
        <AIButton variant="primary" pending={busy} loadingLabel="Matching…" disabled={requirements.length === 0} onClick={onMatch} data-fit-match="">
          Match against the site
        </AIButton>
      </div>
    </div>
  );
}
