'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ArrowUpRight, Code2 } from 'lucide-react';
import { CountUp } from '@/components/motion';
import { ContributionGrid, HeatLegend, HeatStat } from '@/components/shared/ContributionGrid';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { getLive, IDLE_ENTRY, loadLive, subscribeLive, type LeetCodeLive } from '@/lib/live-data';
import { SITE } from '@/lib/site';
import { activeDays, formatDay, lastYearDays, plural, totalCount, usernameFromUrl } from '@/utils/contributionStats';
import { cn } from '@/utils/cn';

const USER = usernameFromUrl(SITE.links.leetcode);

const SIZE = 112;
const R = 46;
const STROKE = 10;
const CIRC = 2 * Math.PI * R;

const SEGMENTS = [
  { key: 'easy', label: 'Easy', stroke: 'stroke-cyan-bright', dot: 'bg-cyan-bright' },
  { key: 'medium', label: 'Medium', stroke: 'stroke-amber', dot: 'bg-amber' },
  { key: 'hard', label: 'Hard', stroke: 'stroke-pink', dot: 'bg-pink' },
] as const;

type Counts = Pick<LeetCodeLive, 'easy' | 'medium' | 'hard' | 'totalSolved'>;

/**
 * Easy / Medium / Hard as arcs of one ring whose lengths are shares of
 * totalSolved. The arcs draw in once in view (CSS; static under reduced motion).
 */
function DifficultyDonut({ counts }: { counts: Counts | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState<'wait' | 'run'>('wait');

  useEffect(() => {
    const el = ref.current;
    if (!el || !counts || play === 'run') return;
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
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [counts, play]);

  const total = counts ? counts.totalSolved || counts.easy + counts.medium + counts.hard : 0;
  const shown = counts ? SEGMENTS.filter((s) => counts[s.key] > 0) : [];
  const gap = shown.length > 1 ? 3 : 0;
  let offset = 0;

  return (
    <div ref={ref} data-play={play} data-donut="" className="relative size-28 shrink-0">
      <svg aria-hidden="true" viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="stroke-heat-0" />
        {counts && total > 0
          ? shown.map((s, i) => {
              const len = (CIRC * counts[s.key]) / total;
              const start = offset;
              offset += len;
              return (
                <circle
                  key={s.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeDashoffset={-start}
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  data-segment={s.key}
                  data-count={counts[s.key]}
                  className={cn('lc-arc', s.stroke)}
                  style={
                    {
                      '--len': `${Math.max(0, len - gap).toFixed(2)}px`,
                      '--circ': `${CIRC.toFixed(2)}px`,
                      '--delay': `${i * 140}ms`,
                    } as CSSProperties
                  }
                />
              );
            })
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="h-7 font-display text-2xl font-bold leading-7 text-text-primary">
          {counts ? <CountUp value={total} /> : <span className="inline-block h-5 w-10 rounded bg-heat-0 align-middle" />}
        </span>
        <span className="font-mono text-[11px] leading-4 text-text-muted">solved</span>
      </div>
    </div>
  );
}

/**
 * LeetCode progress from /api/leetcode: all-time solves by difficulty, the streak
 * and active days LeetCode reports, and a year of submissions. The route falls
 * back to a build-time snapshot, labelled as such, when LeetCode is unreachable.
 */
export function LeetCodeHeatmap() {
  const titleId = useId();
  const entry = useSyncExternalStore(subscribeLive, () => getLive('leetcode'), () => IDLE_ENTRY);
  useEffect(() => loadLive('leetcode'), []);

  const data = entry.data;
  const ready = entry.status === 'ready' && data !== null;
  const failed = entry.status === 'error';

  // The window ends on the day the data was fetched, not on the visitor's clock.
  const endDay = data?.fetchedAt?.slice(0, 10) ?? data?.snapshotAt?.slice(0, 10) ?? '';
  const list = useMemo(() => (data && endDay ? lastYearDays(data.calendar, endDay) : []), [data, endDay]);
  const submissions = totalCount(list);
  const active = activeDays(list);

  const sub = ready
    ? `${plural(data.totalSolved, 'problem', 'problems')} solved all-time${
        data.stale && data.snapshotAt ? ` · snapshot ${formatDay(data.snapshotAt.slice(0, 10))}` : ''
      }`
    : failed
      ? 'Stats unavailable right now'
      : 'Loading stats…';

  const label = `${plural(submissions, 'LeetCode submission', 'LeetCode submissions')} in the last year, on ${plural(
    active,
    'day',
    'days',
  )}. Arrow keys move between days.`;

  const dash = failed ? '—' : null;

  return (
    <section
      aria-labelledby={titleId}
      data-heatmap="leetcode"
      data-state={ready ? 'ready' : failed ? 'error' : 'loading'}
      data-stale={data?.stale ? '' : undefined}
      className="glass-strong rounded-2xl p-6 [contain:inline-size] md:p-8"
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-tint text-amber-text">
            <Code2 aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-lg font-semibold leading-6 text-text-primary">
              Live from LeetCode
            </h3>
            <p className="truncate font-mono text-xs leading-5 text-text-muted" data-leetcode-total={ready ? data.totalSolved : undefined}>
              {sub}
            </p>
          </div>
        </div>
        <Button
          href={SITE.links.leetcode}
          external
          variant="ghost"
          size="sm"
          cursor="open"
          aria-label={`${USER} on LeetCode`}
          trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4" />}
          className="shrink-0 font-mono text-xs"
        >
          <span className="hidden sm:inline">@{USER}</span>
        </Button>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <DifficultyDonut counts={ready ? data : null} />
          <ul className="grid min-w-0 flex-1 gap-1.5 sm:w-32 sm:flex-none" aria-label="Solved by difficulty">
            {SEGMENTS.map((s) => (
              <li key={s.key} className="flex h-6 items-center gap-2 text-sm">
                <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', s.dot)} />
                <span className="text-text-secondary">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-text-primary">
                  {ready ? data[s.key] : failed ? '—' : <span className="inline-block h-3 w-6 rounded bg-heat-0" />}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <HeatStat label="Max streak">
            {ready ? <CountUp value={data.streak} suffix={data.streak === 1 ? ' day' : ' days'} /> : dash}
          </HeatStat>
          <HeatStat label="Active days">{ready ? <CountUp value={data.totalActiveDays} /> : dash}</HeatStat>
          <HeatStat label="Global rank" className="col-span-2 lg:col-span-1">
            {ready ? data.ranking > 0 ? <CountUp value={data.ranking} prefix="#" /> : '—' : dash}
          </HeatStat>
        </dl>
      </div>

      {ready && list.length > 0 ? (
        <ContributionGrid days={list} tone="amber" unit={['submission', 'submissions']} label={label} />
      ) : (
        <div className="cg cg-area">
          {failed ? (
            <div className="flex h-full flex-col items-start justify-center gap-2 rounded-2xl border border-dashed border-glass-border px-4">
              <p className="text-sm leading-6 text-text-secondary">LeetCode stats could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => loadLive('leetcode', { retry: true })}>
                Try again
              </Button>
            </div>
          ) : (
            <Skeleton variant="block" className="h-full" />
          )}
        </div>
      )}

      <div className="mt-4 flex h-5 items-center justify-end">
        <HeatLegend tone="amber" />
      </div>
    </section>
  );
}
