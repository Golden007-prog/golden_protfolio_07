'use client';

import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { ArrowUpRight, Github } from 'lucide-react';
import { CountUp } from '@/components/motion';
import { ContributionGrid, HeatLegend, HeatStat } from '@/components/shared/ContributionGrid';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { getLive, IDLE_ENTRY, loadLive, subscribeLive } from '@/lib/live-data';
import { SITE } from '@/lib/site';
import { formatDay, plural, summarize, usernameFromUrl } from '@/utils/contributionStats';

const USER = usernameFromUrl(SITE.links.github);
const EMPTY: never[] = [];

const days = (n: number) => (n === 1 ? ' day' : ' days');

/**
 * The last year of GitHub contributions from /api/github (cached server-side, so
 * the browser never calls GitHub). The card keeps one size from skeleton to data.
 */
export function GitHubHeatmap() {
  const titleId = useId();
  const entry = useSyncExternalStore(subscribeLive, () => getLive('github'), () => IDLE_ENTRY);
  useEffect(() => loadLive('github'), []);

  const data = entry.data;
  const list = data?.contributions.days ?? EMPTY;
  const stats = useMemo(() => summarize(list), [list]);
  const total = data?.contributions.total ?? stats.total;
  const ready = entry.status === 'ready' && list.length > 0;
  const failed = entry.status === 'error' || (entry.status === 'ready' && list.length === 0);

  const sub = ready
    ? `${plural(total, 'contribution', 'contributions')} in the last year${
        data?.stale && data.snapshotAt ? ` · snapshot ${formatDay(data.snapshotAt.slice(0, 10))}` : ''
      }`
    : failed
      ? 'Activity unavailable right now'
      : 'Loading activity…';

  const label = ready
    ? `${plural(total, 'GitHub contribution', 'GitHub contributions')} in the last year. Current streak ${plural(
        stats.currentStreak,
        'day',
        'days',
      )}, longest ${plural(stats.longestStreak, 'day', 'days')}. Arrow keys move between days.`
    : '';

  return (
    <section
      aria-labelledby={titleId}
      data-heatmap="github"
      data-state={ready ? 'ready' : failed ? 'error' : 'loading'}
      className="glass-strong rounded-2xl p-6 [contain:inline-size] md:p-8"
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-tint text-violet-bright">
            <Github aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-lg font-semibold leading-6 text-text-primary">
              Live from GitHub
            </h3>
            <p className="truncate font-mono text-xs leading-5 text-text-muted">{sub}</p>
          </div>
        </div>
        <Button
          href={SITE.links.github}
          external
          variant="ghost"
          size="sm"
          cursor="open"
          aria-label={`${USER} on GitHub`}
          trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4" />}
          className="shrink-0 font-mono text-xs"
        >
          <span className="hidden sm:inline">@{USER}</span>
        </Button>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <HeatStat label="Current streak">
          {ready ? <CountUp value={stats.currentStreak} suffix={days(stats.currentStreak)} /> : failed ? '—' : null}
        </HeatStat>
        <HeatStat label="Longest streak">
          {ready ? <CountUp value={stats.longestStreak} suffix={days(stats.longestStreak)} /> : failed ? '—' : null}
        </HeatStat>
        <HeatStat label="Busiest weekday" className="col-span-2 sm:col-span-1">
          {ready ? (stats.busiestWeekday?.name ?? '—') : failed ? '—' : null}
        </HeatStat>
      </dl>

      {ready ? (
        <ContributionGrid days={list} tone="violet" unit={['contribution', 'contributions']} label={label} />
      ) : (
        <div className="cg cg-area">
          {failed ? (
            <div className="flex h-full flex-col items-start justify-center gap-2 rounded-2xl border border-dashed border-glass-border px-4">
              <p className="text-sm leading-6 text-text-secondary">GitHub activity could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => loadLive('github', { retry: true })}>
                Try again
              </Button>
            </div>
          ) : (
            <Skeleton variant="block" className="h-full" />
          )}
        </div>
      )}

      <div className="mt-4 flex h-5 items-center justify-end">
        <HeatLegend tone="violet" />
      </div>
    </section>
  );
}
