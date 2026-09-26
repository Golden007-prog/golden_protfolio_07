'use client';

import { useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  CELL_LABELS,
  CELL_POS,
  cellAt,
  dayKey,
  generatePuzzle,
  optionLetter,
  puzzleSeed,
  type Cell,
} from '@/lib/coreforge/puzzle';
import { CTA, MINI_DEMO_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeButton } from './CoreforgeLink';

/** Row-major render order of the ring-ordered cells: TL, TR, BL, BR. */
const GRID_ORDER: readonly Cell[] = [0, 1, 3, 2];

// The day comes from the viewer's clock, so the server (and the first client render)
// sees null and draws the empty frames; the puzzle appears right after hydration.
// A minute tick and tab re-focus roll it over at midnight.
function subscribeDay(fn: () => void): () => void {
  const timer = window.setInterval(fn, 60_000);
  document.addEventListener('visibilitychange', fn);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', fn);
  };
}
const readDay = () => dayKey(new Date());

function Marker({ ghost = false, enter = false, className }: { ghost?: boolean; enter?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" data-ghost={ghost || undefined} className={cn('cf-marker', enter && 'cf-marker-in', className)} />
  );
}

function Frame({ cell, index, current }: { cell: Cell | null; index: number; current: boolean }) {
  const label = cell === null ? `Frame ${index}` : `Frame ${index}: marker ${CELL_LABELS[cell].toLowerCase()}`;
  return (
    <li className="flex min-w-0 flex-col items-center gap-2">
      <div role="img" aria-label={label} data-current={current || undefined} className="cf-frame w-full">
        {GRID_ORDER.map((c) => (
          <span key={c} className="cf-cell">
            {cell === c ? <Marker /> : null}
          </span>
        ))}
      </div>
      <span aria-hidden="true" className="font-mono text-[11px] text-text-muted">
        {index}
      </span>
    </li>
  );
}

type Props = {
  /** Prefix for the CTA's utm_campaign. */
  placement?: string;
  headingLevel?: 'h2' | 'h3';
  className?: string;
};

/**
 * 'Follow the marker': an original daily puzzle in the spirit of CoreForge's figure
 * sequences. Four frames show a marker moving by one rule; the player picks its cell
 * in the fifth. The answer cells are a 2x2 grid of real buttons with a roving tab stop
 * (arrow keys move spatially, Home/End jump), the verdict and the rule go to a polite
 * live region, and every puzzle is proven to have exactly one defensible answer
 * (src/lib/coreforge/puzzle.test.ts).
 */
export function MiniDemo({ placement = 'minidemo', headingLevel = 'h3', className }: Props) {
  const Heading = headingLevel;
  const uid = useId();
  const titleId = `${uid}-title`;
  const questionId = `${uid}-q`;
  const day = useSyncExternalStore(subscribeDay, readDay, () => null);
  const [variant, setVariant] = useState(0);
  const [answer, setAnswer] = useState<{ seed: string; cell: Cell } | null>(null);
  const [focusCell, setFocusCell] = useState<Cell>(0);
  // Set by 'Try another pattern' so the status region says the frames changed; cleared on the next pick.
  const [announceNew, setAnnounceNew] = useState(false);
  const choiceRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const puzzle = useMemo(() => (day ? generatePuzzle(puzzleSeed(day, variant)) : null), [day, variant]);
  const pick = answer && puzzle && answer.seed === puzzle.seed ? answer.cell : null;
  const solved = pick !== null;
  const right = solved && puzzle !== null && pick === puzzle.answer;

  const choose = (cell: Cell) => {
    if (!puzzle || solved) return;
    setAnswer({ seed: puzzle.seed, cell });
    setAnnounceNew(false);
  };

  const focusChoice = (cell: Cell) => {
    setFocusCell(cell);
    choiceRefs.current[cell]?.focus();
  };

  const onChoiceKey = (e: KeyboardEvent<HTMLButtonElement>, cell: Cell) => {
    const { row, col } = CELL_POS[cell];
    let next: Cell | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = cellAt(row, 1 - col);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') next = cellAt(1 - row, col);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 2;
    if (next === null) return;
    e.preventDefault();
    focusChoice(next);
  };

  const another = () => {
    setVariant((v) => v + 1);
    setAnswer(null);
    setAnnounceNew(true);
    focusChoice(0);
  };

  return (
    <div data-cf-minidemo="" data-state={!puzzle ? 'loading' : solved ? (right ? 'correct' : 'wrong') : 'open'} className={className}>
      <Heading id={titleId} className="font-display text-h3 font-semibold text-text-primary">
        {MINI_DEMO_COPY.title}
      </Heading>
      <p className="mt-2 max-w-prose text-sm text-text-muted">{MINI_DEMO_COPY.intro}</p>

      <ol aria-label="The four frames" className="mt-6 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Frame key={i} index={i + 1} cell={puzzle ? puzzle.frames[i] : null} current={i === 3} />
        ))}
      </ol>

      <div className="mt-6 flex items-center gap-2 text-text-muted">
        <ChevronRight aria-hidden="true" className="size-4 text-(--cf-berry-text)" />
        <p id={questionId} className="text-sm font-medium text-text-primary">
          {MINI_DEMO_COPY.question}
        </p>
      </div>

      <div
        role="group"
        aria-labelledby={questionId}
        aria-describedby={puzzle ? undefined : `${uid}-loading`}
        className="mt-3 grid max-w-sm grid-cols-2 gap-2"
      >
        {GRID_ORDER.map((cell) => {
          const letter = optionLetter(cell);
          const state = !solved
            ? undefined
            : cell === puzzle?.answer
              ? 'correct'
              : cell === pick
                ? 'wrong'
                : 'dim';
          return (
            <button
              key={cell}
              ref={(el) => {
                choiceRefs.current[cell] = el;
              }}
              type="button"
              data-cf-choice={cell}
              data-state={state}
              tabIndex={cell === focusCell ? 0 : -1}
              aria-disabled={!puzzle || solved || undefined}
              onClick={() => choose(cell)}
              onKeyDown={(e) => onChoiceKey(e, cell)}
              onFocus={() => setFocusCell(cell)}
              // A puzzle takes one pick, so the shake plays once, when the class arrives.
              className={cn('cf-choice min-h-16 gap-1 p-2 text-sm ring-focus', state === 'wrong' && 'cf-shake')}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-6 place-items-center rounded-full border border-glass-border font-mono text-[11px] text-text-muted"
                >
                  {letter}
                </span>
                <span>{CELL_LABELS[cell]}</span>
              </span>
              {state === 'correct' ? (
                <>
                  <Marker enter className="w-5" />
                  <span className="sr-only"> (correct answer)</span>
                </>
              ) : state === 'wrong' ? (
                <>
                  <Marker ghost className="w-5" />
                  <span className="sr-only"> (your pick)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      {puzzle ? null : (
        <p id={`${uid}-loading`} className="mt-3 text-xs text-text-muted">
          {MINI_DEMO_COPY.loading}
        </p>
      )}
      {puzzle && !solved ? <p className="mt-3 text-xs text-text-muted">{MINI_DEMO_COPY.hint}</p> : null}

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-cf-verdict=""
        className={cn(
          'text-sm leading-relaxed text-text-secondary',
          solved && 'mt-4 rounded-lg border border-glass-border bg-surface-tint p-4',
        )}
      >
        {solved && puzzle ? (
          <>
            <strong className={cn('font-semibold', right ? 'text-success' : 'text-text-primary')}>
              {right ? MINI_DEMO_COPY.correct : `${MINI_DEMO_COPY.wrongPrefix} ${CELL_LABELS[pick].toLowerCase()}.`}
            </strong>{' '}
            {puzzle.explanation}
          </>
        ) : announceNew && puzzle ? (
          <span className="sr-only">{MINI_DEMO_COPY.newPuzzle}</span>
        ) : null}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <CoreforgeButton path={CTA.fullDemo.path} placement={`${placement}-cta`} variant={solved ? 'primary' : 'secondary'}>
          {CTA.fullDemo.label}
        </CoreforgeButton>
        <Button
          variant="ghost"
          onClick={another}
          disabled={!puzzle}
          leadingIcon={<RotateCcw aria-hidden="true" className="size-4 shrink-0" />}
        >
          {MINI_DEMO_COPY.another}
        </Button>
      </div>
      <p className="mt-4 max-w-prose text-xs text-text-muted">{MINI_DEMO_COPY.footnote}</p>
    </div>
  );
}

export default MiniDemo;
