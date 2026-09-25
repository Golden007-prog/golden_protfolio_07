import { useSyncExternalStore } from 'react';

/*
 * The single writer of the query string and hash. Namespaces: shell owns the hash
 * (#<SectionId>), projects owns ?project ?q ?cat ?tech ?live, skills owns ?skill.
 * Writes merge into the current URL, so features never wipe each other's state.
 */

const REPLACE_INTERVAL_MS = 250;

// The URL as the app sees it, including writes not yet flushed to history.
let pending: URL | null = null;
// location.search when the unflushed writes began.
let committedSearch = '';
let timer: ReturnType<typeof setTimeout> | null = null;
let windowListeners = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function ensureWindowListeners() {
  if (windowListeners || typeof window === 'undefined') return;
  windowListeners = true;
  // Fragment jumps fire popstate (Chromium, Firefox) and hashchange. When only the
  // hash moved, keep unflushed params and adopt the new hash; any other history
  // move (back/forward to another entry) wins over unflushed writes.
  const onExternal = () => {
    const loc = window.location;
    if (pending && pending.pathname === loc.pathname && loc.search === committedSearch) {
      pending.hash = loc.hash;
    } else {
      cancelFlush();
      pending = null;
    }
    notify();
  };
  window.addEventListener('popstate', onExternal);
  window.addEventListener('hashchange', onExternal);
  window.addEventListener('pagehide', () => flush());
}

function currentUrl(): URL {
  return new URL(pending ?? window.location.href);
}

function cancelFlush() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function flush() {
  cancelFlush();
  if (!pending) return;
  const next = pending;
  pending = null;
  // A route change since the write means the write belongs to a page that is gone.
  if (next.pathname !== window.location.pathname) return;
  if (next.href !== window.location.href) window.history.replaceState(null, '', next.href);
}

function write(next: URL, push: boolean) {
  ensureWindowListeners();
  if (!pending) committedSearch = window.location.search;
  pending = next;
  notify();
  if (push) {
    cancelFlush();
    pending = null;
    window.history.pushState(null, '', next.href);
    return;
  }
  // Throttled rather than debounced: at most one replaceState per interval (Safari
  // rejects more than 100 per 30s) while the URL still tracks long typing runs.
  timer ??= setTimeout(flush, REPLACE_INTERVAL_MS);
}

export function readUrl(): { hash: string; params: URLSearchParams } {
  if (typeof window === 'undefined') return { hash: '', params: new URLSearchParams() };
  const url = currentUrl();
  return { hash: decodeHash(url.hash), params: url.searchParams };
}

function decodeHash(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function subscribe(fn: () => void) {
  ensureWindowListeners();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Live value of one query param. null on the server and during hydration. */
export function useUrlParam(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => currentUrl().searchParams.get(key),
    () => null,
  );
}

/** Live hash without '#'. '' on the server and during hydration. */
export function useUrlHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => decodeHash(currentUrl().hash),
    () => '',
  );
}

/** Merges params into the current URL, keeping the hash. null or '' removes a key. */
export function setUrlParams(patch: Record<string, string | null>, opts: { push?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const url = currentUrl();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  write(url, Boolean(opts.push));
}

/** Sets or clears the hash with replaceState, keeping the query string. */
export function setUrlHash(id: string | null): void {
  if (typeof window === 'undefined') return;
  const url = currentUrl();
  url.hash = id ? `#${id}` : '';
  write(url, false);
}

/** getElementById, so ids like 'skill/rag' never reach a selector parser. */
export function findTarget(id: string): HTMLElement | null {
  if (typeof document === 'undefined' || !id) return null;
  const raw = id.replace(/^#/, '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep the raw id */
  }
  return document.getElementById(decoded) ?? (decoded === raw ? null : document.getElementById(raw));
}
