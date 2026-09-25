'use client';

import { useCallback, useSyncExternalStore } from 'react';

type Entry = { mql: MediaQueryList; listeners: Set<() => void>; onChange: () => void };

// One MediaQueryList and at most one 'change' listener per distinct query for the
// whole app, however many components ask for it.
const registry = new Map<string, Entry>();

function entryFor(query: string): Entry | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let entry = registry.get(query);
  if (!entry) {
    const listeners = new Set<() => void>();
    entry = {
      mql: window.matchMedia(query),
      listeners,
      onChange: () => listeners.forEach((fn) => fn()),
    };
    registry.set(query, entry);
  }
  return entry;
}

/** Current match state without subscribing. False on the server. */
export function matchesMedia(query: string): boolean {
  return entryFor(query)?.mql.matches ?? false;
}

/** Ref-counted subscription to a media query's 'change' events. */
export function subscribeMedia(query: string, fn: () => void): () => void {
  const entry = entryFor(query);
  if (!entry) return () => {};
  if (entry.listeners.size === 0) entry.mql.addEventListener('change', entry.onChange);
  entry.listeners.add(fn);
  return () => {
    entry.listeners.delete(fn);
    if (entry.listeners.size === 0) entry.mql.removeEventListener('change', entry.onChange);
  };
}

/**
 * Live media query match. Server and hydration renders return serverValue, so the
 * markup always matches; the real value arrives in the next render.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback((fn: () => void) => subscribeMedia(query, fn), [query]);
  return useSyncExternalStore(
    subscribe,
    () => matchesMedia(query),
    () => serverValue,
  );
}
