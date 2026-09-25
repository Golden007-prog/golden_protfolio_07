'use client';

import { useSyncExternalStore } from 'react';
import { MapPin } from 'lucide-react';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

export type LocalTimeProps = {
  timeZone?: string;
  /** Defaults to the first part of the profile location ('Bengaluru'). */
  city?: string;
  /** Adds how far ahead of or behind the visitor that zone is, e.g. '5h 30m ahead of you'. */
  showOffset?: boolean;
  className?: string;
};

/* ---- one minute clock for every instance ---- */

const listeners = new Set<() => void>();
let timer: number | undefined;

function tick() {
  listeners.forEach((fn) => fn());
  // Re-aligned every minute so drift never accumulates.
  timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) window.clearTimeout(timer);
  };
}

const currentMinute = () => Math.floor(Date.now() / 60_000);
// The server has no idea what time it is for the visitor; it renders a placeholder.
const serverMinute = () => null;

function offsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = part?.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) return null;
    if (!m[1]) return 0;
    const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === '-' ? -mins : mins;
  } catch {
    return null;
  }
}

function describeOffset(diff: number): string {
  if (diff === 0) return 'same time as you';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
  return `${span} ${diff > 0 ? 'ahead of' : 'behind'} you`;
}

/**
 * The current time in `timeZone` (IST by default), ticking each minute. The
 * server and the hydration render show a stable '--:--', so a visitor in any
 * time zone gets no hydration mismatch.
 */
export function LocalTime({ timeZone = 'Asia/Kolkata', city, showOffset = false, className }: LocalTimeProps) {
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  const place = city ?? SITE.location.split(',')[0].trim();

  let time = '--:--';
  let zone = '';
  let offset = '';
  if (minute !== null) {
    const now = new Date(minute * 60_000);
    try {
      time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(now);
      zone =
        new Intl.DateTimeFormat('en-IN', { timeZone, timeZoneName: 'short' })
          .formatToParts(now)
          .find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      time = '--:--';
    }
    const theirs = offsetMinutes(timeZone, now);
    const visitor = -now.getTimezoneOffset();
    if (showOffset && theirs !== null) offset = describeOffset(theirs - visitor);
  }

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-text-muted', className)}>
      <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{place}</span>
      <span aria-hidden="true">·</span>
      <time className="tabular-nums text-text-secondary" data-local-time="">
        {time}
      </time>
      {zone ? <span>{zone}</span> : null}
      {offset ? <span className="text-text-dim">({offset})</span> : null}
    </span>
  );
}
