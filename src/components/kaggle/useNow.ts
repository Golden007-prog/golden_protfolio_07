'use client';

import { useSyncExternalStore } from 'react';

// Countdowns count whole hours and days, so a minute tick is plenty.
const TICK_MS = 60_000;

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  if (!now) now = Date.now();
  return now;
}

const getServerSnapshot = () => null;

/**
 * The visitor's clock in epoch ms, refreshed every minute; null on the server and
 * during hydration, so time-relative labels render only after hydration and the
 * server markup never disagrees with the browser's.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
