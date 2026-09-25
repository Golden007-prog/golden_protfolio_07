'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { formatDay, monthLabels, plural, toWeeks, weekdayOf, type Day } from '@/utils/contributionStats';
import { cn } from '@/utils/cn';

export type HeatTone = 'violet' | 'amber';

export const LEVEL_CLASS: Record<HeatTone, readonly string[]> = {
  violet: ['bg-heat-0', 'bg-violet/30', 'bg-violet/55', 'bg-violet-bright/75', 'bg-violet-bright'],
  amber: ['bg-heat-0', 'bg-amber/25', 'bg-amber/50', 'bg-amber/75', 'bg-amber'],
};

type Props = {
  /** Consecutive days, oldest first. */
  days: readonly Day[];
  tone: HeatTone;
  /** Tooltip noun: ['contribution', 'contributions']. */
  unit: readonly [string, string];
  /** Summary read by screen readers for the whole grid. */
  label: string;
  className?: string;
};

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A year of days as 53 week columns of plain spans. It opens scrolled to the
 * newest week, fades an edge where more weeks hide, and staggers the columns in
 * (CSS, 9ms apart) the first time it is seen. One floating tooltip follows mouse
 * hover, a tap, or the keyboard: the grid is a single tab stop whose arrow keys
 * move a day cursor (Left/Right a week, Up/Down a day, Home/End) and announce
 * each day politely. Hover and cursor moves write to the DOM directly, so
 * exploring the grid never re-renders it.
 */
export function ContributionGrid({ days, tone, unit, label, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const activeRef = useRef(-1);
  const edgeFrame = useRef(0);
  const awayRef = useRef<((e: PointerEvent) => void) | null>(null);
  const [play, setPlay] = useState<'wait' | 'run'>('wait');

  const weeks = useMemo(() => toWeeks(days), [days]);
  const months = useMemo(() => monthLabels(weeks), [weeks]);
  const lead = days.length ? weekdayOf(days[0].date) : 0;
  const levels = LEVEL_CLASS[tone];

  const updateEdges = () => {
    edgeFrame.current = 0;
    const s = scrollerRef.current;
    if (!s) return;
    const max = s.scrollWidth - s.clientWidth;
    const atStart = s.scrollLeft <= 1;
    const atEnd = s.scrollLeft >= max - 1;
    const edge = max <= 1 ? '' : atStart ? 'end' : atEnd ? 'start' : 'both';
    if (edge) s.setAttribute('data-edge', edge);
    else s.removeAttribute('data-edge');
  };

  // Newest week in view from the first paint, on phones too.
  useLayoutEffect(() => {
    const s = scrollerRef.current;
    if (!s) return;
    s.scrollLeft = s.scrollWidth;
    updateEdges();
  }, [weeks]);

  useEffect(() => {
    const s = scrollerRef.current;
    if (!s || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(s);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(edgeFrame.current);
      if (awayRef.current) document.removeEventListener('pointerdown', awayRef.current);
    };
  }, []);

  // The column cascade runs once, when the grid is first on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || play === 'run') return;
    if (typeof IntersectionObserver === 'undefined') {
      const t = window.setTimeout(() => setPlay('run'), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        setPlay('run');
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [play]);

  const cellAt = (i: number) => gridRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`) ?? null;

  const hideTip = () => {
    tipRef.current?.setAttribute('data-hidden', '');
    gridRef.current?.querySelector('[data-active]')?.removeAttribute('data-active');
  };

  const showTip = (i: number, announce: boolean) => {
    const root = rootRef.current;
    const tip = tipRef.current;
    const cell = cellAt(i);
    const day = days[i];
    if (!root || !tip || !cell || !day) return;
    gridRef.current?.querySelector('[data-active]')?.removeAttribute('data-active');
    cell.setAttribute('data-active', '');
    activeRef.current = i;
    const text = `${plural(day.count, unit[0], unit[1])} · ${formatDay(day.date)}`;
    tip.textContent = text;
    tip.removeAttribute('data-hidden');
    const r = root.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const w = tip.offsetWidth;
    const x = Math.min(Math.max(c.left + c.width / 2 - r.left - w / 2, 0), Math.max(0, r.width - w));
    const y = c.top - r.top - tip.offsetHeight - 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (announce && liveRef.current) liveRef.current.textContent = text;
  };

  /** Keeps the cursor's cell inside the scroller's visible part. */
  const reveal = (cell: HTMLElement) => {
    const s = scrollerRef.current;
    if (!s) return;
    const pad = 24;
    const left = cell.offsetLeft;
    if (left - pad < s.scrollLeft) s.scrollLeft = left - pad;
    else if (left + cell.offsetWidth + pad > s.scrollLeft + s.clientWidth) {
      s.scrollLeft = left + cell.offsetWidth + pad - s.clientWidth;
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const n = days.length;
    if (!n) return;
    let i = activeRef.current < 0 ? n - 1 : activeRef.current;
    switch (e.key) {
      case 'ArrowLeft':
        i -= 7;
        break;
      case 'ArrowRight':
        i += 7;
        break;
      case 'ArrowUp':
        i -= 1;
        break;
      case 'ArrowDown':
        i += 1;
        break;
      case 'Home':
        i = 0;
        break;
      case 'End':
        i = n - 1;
        break;
      case 'Escape':
        hideTip();
        return;
      default:
        return;
    }
    e.preventDefault();
    i = Math.min(n - 1, Math.max(0, i));
    const cell = cellAt(i);
    if (cell) reveal(cell);
    showTip(i, true);
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (!isFocusVisible(e.currentTarget) || !days.length) return;
    const i = activeRef.current < 0 ? days.length - 1 : activeRef.current;
    const cell = cellAt(i);
    if (cell) reveal(cell);
    showTip(i, true);
  };

  const indexFrom = (target: EventTarget | null): number => {
    const el = (target as Element | null)?.closest?.('[data-i]');
    return el ? Number(el.getAttribute('data-i')) : -1;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const i = indexFrom(e.target);
    if (i >= 0 && i !== activeRef.current) showTip(i, false);
    else if (i >= 0 && tipRef.current?.hasAttribute('data-hidden')) showTip(i, false);
  };

  const onPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || document.activeElement === gridRef.current) return;
    hideTip();
  };

  // A tap shows the day; the next tap outside the grid hides it again.
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const i = indexFrom(e.target);
    if (i < 0) return;
    showTip(i, false);
    if (awayRef.current) return;
    const away = (ev: PointerEvent) => {
      if (gridRef.current?.contains(ev.target as Node)) return;
      hideTip();
      document.removeEventListener('pointerdown', away);
      awayRef.current = null;
    };
    awayRef.current = away;
    document.addEventListener('pointerdown', away, { passive: true });
  };

  const onScroll = () => {
    if (document.activeElement !== gridRef.current) hideTip();
    if (!edgeFrame.current) edgeFrame.current = requestAnimationFrame(updateEdges);
  };

  return (
    <div ref={rootRef} data-play={play} data-contribution-grid="" className={cn('cg relative', className)}>
      <div className="cg-area">
        {/* The padding (inside the clip) leaves room for the focus ring and the day cursor's outline. */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="cg-scroller scrollbar-none -m-1.5 overflow-x-auto overflow-y-hidden p-1.5"
        >
          <div className="inline-flex min-w-full flex-col gap-2">
            <div aria-hidden="true" className="relative h-4 font-mono text-[11px] leading-4 text-text-muted">
              {months.map((m) => (
                <span
                  key={`${m.col}-${m.label}`}
                  className="absolute top-0"
                  style={{
                    left: `calc(${m.col} * (var(--cell) + var(--gap)))`,
                  }}
                >
                  {m.label}
                </span>
              ))}
            </div>
            <div
              ref={gridRef}
              role="img"
              aria-label={label}
              tabIndex={0}
              data-heat-grid=""
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              onBlur={hideTip}
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              onClick={onClick}
              className="flex w-max gap-(--gap) rounded-md ring-focus"
            >
              {weeks.map((week, c) => (
                <span key={c} className="cg-col flex flex-col gap-(--gap)" style={{ '--c': c } as CSSProperties}>
                  {week.map((day, r) => {
                    if (!day) return <span key={r} className="cg-cell" />;
                    const i = c * 7 + r - lead;
                    return (
                      <span
                        key={r}
                        data-i={i}
                        data-level={day.level}
                        data-count={day.count}
                        data-date={day.date}
                        className={cn('cg-cell block', levels[day.level])}
                      />
                    );
                  })}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div
        ref={tipRef}
        aria-hidden="true"
        data-hidden=""
        data-heat-tip=""
        className="cg-tip glass-strong glass-keep pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-lg px-2.5 py-1.5 font-mono text-xs text-text-primary"
      />
      <p ref={liveRef} className="sr-only" aria-live="polite" aria-atomic="true" data-heat-live="" />
    </div>
  );
}

/** 'Less ■■■■■ More' key for a heatmap tone. Decorative: the grid label carries the meaning. */
export function HeatLegend({ tone, className }: { tone: HeatTone; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('cg flex items-center gap-1.5 font-mono text-[11px] text-text-muted', className)}
    >
      <span className="mr-0.5">Less</span>
      {LEVEL_CLASS[tone].map((c, i) => (
        <span key={i} data-level={i} className={cn('cg-cell block', c)} />
      ))}
      <span className="ml-0.5">More</span>
    </div>
  );
}

/** A fixed-height stat tile, so loading, empty and loaded cards are the same size. */
export function HeatStat({
  label,
  children,
  className,
}: {
  label: string;
  /** The value; null draws a placeholder bar of the same height. */
  children: ReactNode | null;
  className?: string;
}) {
  return (
    <div
      data-heat-stat=""
      className={cn(
        'flex h-18 min-w-0 flex-col justify-center rounded-xl border border-glass-border bg-surface-tint px-3',
        className,
      )}
    >
      <dt className="line-clamp-2 font-mono text-[11px] uppercase leading-4 tracking-[0.12em] text-text-muted">{label}</dt>
      <dd className="mt-1 h-7 truncate font-display text-xl font-semibold leading-7 text-text-primary">
        {children ?? <span aria-hidden="true" className="inline-block h-4 w-14 rounded bg-heat-0 align-middle" />}
      </dd>
    </div>
  );
}
