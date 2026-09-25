'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { GitCommitHorizontal, X } from 'lucide-react';
import { getLive, IDLE_ENTRY, loadLive, subscribeLive } from '@/lib/live-data';
import { safeStorage } from '@/lib/safeStorage';
import { cn } from '@/utils/cn';

const DISMISS_KEY = 'ob-status-dismissed';
const FRESH_HOURS = 48;

/* ---- a minute clock, started after hydration ---- */

const clockListeners = new Set<() => void>();
let clockTimer: number | undefined;

function subscribeClock(fn: () => void) {
  clockListeners.add(fn);
  if (clockListeners.size === 1) {
    const tick = () => {
      clockListeners.forEach((l) => l());
      clockTimer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    clockTimer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  }
  return () => {
    clockListeners.delete(fn);
    if (clockListeners.size === 0) window.clearTimeout(clockTimer);
  };
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const serverMinute = () => null;

/* ---- dismissal, for this browser session ---- */

const dismissListeners = new Set<() => void>();
function subscribeDismiss(fn: () => void) {
  dismissListeners.add(fn);
  return () => {
    dismissListeners.delete(fn);
  };
}
const readDismissed = () => safeStorage.get(DISMISS_KEY, 'session') === '1';
function dismiss() {
  safeStorage.set(DISMISS_KEY, '1', 'session');
  dismissListeners.forEach((fn) => fn());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relativeTime(fromMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(fromMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** True once the hero (#hero) has scrolled out of view; before that the pill stays hidden. */
function usePastHero(): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const hero = document.getElementById('hero');
    if (hero && typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(([entry]) => setPast(!entry?.isIntersecting), { threshold: 0 });
      io.observe(hero);
      return () => io.disconnect();
    }
    const onScroll = () => setPast(window.scrollY > window.innerHeight * 0.9);
    const first = requestAnimationFrame(onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return past;
}

/**
 * The latest public push, as a pill in the floating dock: a link to the commit
 * and, beside it (never inside it), a dismiss button that holds for the session.
 * It appears only once the hero is out of view, fetches /api/github only then,
 * and its "5m ago" re-ticks every minute. Phones get the compact form.
 */
export function LiveStatusBar({ className }: { className?: string }) {
  const past = usePastHero();
  const dismissed = useSyncExternalStore(subscribeDismiss, readDismissed, () => false);
  const minute = useSyncExternalStore(subscribeClock, currentMinute, serverMinute);
  const entry = useSyncExternalStore(subscribeLive, () => getLive('github'), () => IDLE_ENTRY);

  useEffect(() => {
    if (past && !dismissed) loadLive('github');
  }, [past, dismissed]);

  const push = entry.data?.latestPush ?? null;
  const created = push ? Date.parse(push.createdAt) : Number.NaN;
  if (!past || dismissed || !push || minute === null || Number.isNaN(created)) return null;

  const now = minute * 60_000;
  const when = relativeTime(created, now);
  const fresh = now - created < FRESH_HOURS * 3_600_000;

  return (
    <div
      data-live-status=""
      className={cn(
        // Leaves room for the sound and ask buttons on the right and BackToTop on the left; too tight below 360px.
        'glass-strong glass-keep hidden h-11 min-w-0 max-w-[min(26rem,calc(100vw-13rem))] items-center rounded-full font-mono text-xs min-[360px]:flex',
        className,
      )}
    >
      <a
        href={push.url}
        target="_blank"
        rel="noopener noreferrer"
        data-cursor="open"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-full pl-3 pr-1 text-text-secondary ring-focus transition-colors hover:text-text-primary sm:gap-2 sm:pl-4"
      >
        <span
          aria-hidden="true"
          data-fresh={fresh ? '' : undefined}
          className={cn('live-dot size-2 shrink-0 rounded-full', fresh ? 'bg-success' : 'bg-text-dim')}
        />
        <GitCommitHorizontal aria-hidden="true" className="hidden size-3.5 shrink-0 text-violet-bright sm:block" />
        <span className="sr-only">Latest push to </span>
        <span className="hidden shrink-0 text-text-muted md:inline" aria-hidden="true">
          Last push
        </span>
        <span className="min-w-0 max-w-[10rem] truncate text-text-primary">{push.repo}</span>
        {push.message ? (
          <span className="hidden min-w-0 flex-1 basis-0 truncate text-text-muted lg:inline">
            <span className="sr-only">: </span>“{push.message}”
          </span>
        ) : null}
        <span className="shrink-0 text-text-muted">
          <span aria-hidden="true">· </span>
          {/* Phones drop the ' ago' so the repo name keeps a few more characters. */}
          <span aria-hidden="true" className="sm:hidden">
            {when.replace(' ago', '').replace('just now', 'now')}
          </span>
          <span className="sr-only sm:not-sr-only">{when}</span>
        </span>
        <span className="sr-only"> (opens in new tab)</span>
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss latest push"
        className="tap-safe shrink-0 rounded-full text-text-muted ring-focus transition-colors hover:bg-surface-tint hover:text-text-primary"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
