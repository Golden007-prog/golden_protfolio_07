'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { getMotionPrefs } from '@/hooks/useMotionPrefs';
import { subscribeMedia } from '@/hooks/useMediaQuery';
import { safeStorage } from '@/lib/safeStorage';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type ThemeOrigin = { x: number; y: number };

type ThemeContextValue = {
  /** The stored preference. */
  theme: Theme;
  /** What html[data-theme] holds right now. */
  resolvedTheme: ResolvedTheme;
  /** Stores the preference and swaps the page, revealing from `origin` when given. */
  setTheme: (t: Theme, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
};

// Keep in step with BOOTSTRAP_SCRIPT, which applies the stored theme before first paint.
const STORAGE_KEY = 'theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';
// --app-bg-base in each theme (index.css).
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#060609', light: '#F7F5F0' };

const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ---- preference and html[data-theme] as one external store ---- */

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let pref: Theme | null = null;

function notify() {
  listeners.forEach((fn) => fn());
}

function readPref(): Theme {
  if (pref === null) {
    const saved = safeStorage.get(STORAGE_KEY);
    pref = saved === 'light' || saved === 'system' || saved === 'dark' ? saved : 'dark';
  }
  return pref;
}

function readResolved(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  pref = null;
  paint(resolve(readPref()));
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!observer) {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
      window.removeEventListener('storage', onStorage);
    }
  };
}

const serverPref = (): Theme => 'dark';
const serverResolved = (): ResolvedTheme => 'dark';

function resolve(t: Theme): ResolvedTheme {
  if (t !== 'system') return t;
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Writes the attribute and every theme-color meta, synchronously. */
function paint(r: ResolvedTheme) {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== r) root.setAttribute('data-theme', r);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[r]));
}

function commit(t: Theme) {
  pref = t;
  safeStorage.set(STORAGE_KEY, t);
  paint(resolve(t));
  notify();
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone?: Promise<void> };
type DocWithViewTransition = Document & { startViewTransition?: (cb: () => void) => ViewTransition };

let transitionToken = 0;

function swap(next: Theme, origin?: ThemeOrigin) {
  const doc = document as DocWithViewTransition;
  const from = readResolved();
  const to = resolve(next);
  if (from === to || !doc.startViewTransition || getMotionPrefs().reduce) {
    commit(next);
    return;
  }

  const root = document.documentElement;
  const token = ++transitionToken;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  root.style.setProperty('--theme-origin-x', `${Math.round(x)}px`);
  root.style.setProperty('--theme-origin-y', `${Math.round(y)}px`);
  // Farthest viewport corner from the origin, so the iris always covers the page.
  const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.style.setProperty('--theme-reach', `${Math.ceil(reach)}px`);
  root.setAttribute('data-theme-dir', to === 'light' ? 'to-light' : 'to-dark');
  root.classList.add('theme-transitioning');

  // The snapshot is taken when the callback returns, so React must have
  // re-rendered by then: flushSync, not a scheduled update.
  const transition = doc.startViewTransition(() => {
    flushSync(() => commit(next));
  });
  const cleanup = () => {
    if (token !== transitionToken) return;
    root.classList.remove('theme-transitioning');
    root.removeAttribute('data-theme-dir');
  };
  // A second swap mid-flight skips this one, which rejects ready; nothing to report.
  transition.ready.catch(() => {});
  transition.updateCallbackDone?.catch(() => {});
  transition.finished.then(cleanup, cleanup);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readPref, serverPref);
  const resolvedTheme = useSyncExternalStore(subscribe, readResolved, serverResolved);

  // 'system' follows the OS live. The head script already painted the initial
  // theme, so nothing is written on mount.
  useEffect(() => {
    if (theme !== 'system') return;
    return subscribeMedia(LIGHT_QUERY, () => paint(resolve('system')));
  }, [theme]);

  const setTheme = useCallback((t: Theme, origin?: ThemeOrigin) => swap(t, origin), []);
  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => swap(readResolved() === 'dark' ? 'light' : 'dark', origin),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
