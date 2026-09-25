'use client';

import { useId, useState, type RefObject } from 'react';
import { ClipboardPaste, Trash2 } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { Button } from '@/components/ui/Button';
import { AI_LIMITS } from '@/lib/ai/config';
import { cn } from '@/utils/cn';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  skipReview: boolean;
  onSkipReview: (value: boolean) => void;
  onClear: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const canReadClipboard = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

/**
 * Paste-only intake: a textarea capped at 8,000 characters (no file upload, so
 * no OCR and no token blow-up), Paste, Run, 'Skip review' and 'Clear my data'.
 * mod+Enter submits from the textarea.
 */
export function JdInput({ value, onChange, onSubmit, busy, skipReview, onSkipReview, onClear, textareaRef }: Props) {
  const id = useId();
  const [hint, setHint] = useState('');
  const count = value.length;

  // readText() must run inside the click, or browsers refuse it.
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onChange(text.slice(0, AI_LIMITS.jd));
        setHint(text.length > AI_LIMITS.jd ? `Pasted the first ${AI_LIMITS.jd.toLocaleString('en-US')} characters.` : '');
      } else setHint('The clipboard is empty.');
    } catch {
      setHint('Paste with Ctrl+V (⌘V on a Mac) instead.');
    }
    textareaRef.current?.focus();
  };

  return (
    <form
      data-fit-noprint=""
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={`${id}-jd`} className="text-sm font-medium text-text-primary">
          Job description
        </label>
        {canReadClipboard() ? (
          <Button type="button" variant="ghost" size="sm" leadingIcon={<ClipboardPaste aria-hidden="true" className="size-4 shrink-0" />} onClick={paste} data-fit-paste="">
            Paste
          </Button>
        ) : null}
      </div>
      <textarea
        ref={textareaRef}
        id={`${id}-jd`}
        name="jd"
        value={value}
        maxLength={AI_LIMITS.jd}
        rows={7}
        spellCheck={false}
        aria-describedby={`${id}-count ${id}-hint`}
        placeholder="Paste the role's description here: title, responsibilities, requirements."
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        data-fit-jd=""
        className="min-h-40 w-full resize-y rounded-2xl border border-glass-border bg-surface-tint p-4 text-[15px] leading-relaxed text-text-primary ring-focus placeholder:text-text-muted"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
        <span id={`${id}-hint`} aria-live="polite">
          {hint || 'Text only. Ctrl+Enter (⌘Enter) runs the check.'}
        </span>
        <span id={`${id}-count`} className={cn('font-mono tabular-nums', count >= AI_LIMITS.jd && 'text-amber-text')}>
          {count.toLocaleString('en-US')} / {AI_LIMITS.jd.toLocaleString('en-US')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AIButton type="submit" variant="primary" pending={busy} loadingLabel="Checking…" data-fit-run="">
          Check fit
        </AIButton>
        <label className="tap-safe cursor-pointer gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={skipReview}
            onChange={(e) => onSkipReview(e.target.checked)}
            data-fit-skip-review=""
            className="size-4 shrink-0 cursor-pointer accent-violet-bright ring-focus"
          />
          Skip review
        </label>
        <Button type="button" variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden="true" className="size-4 shrink-0" />} onClick={onClear} data-fit-clear="">
          Clear my data
        </Button>
      </div>
    </form>
  );
}
