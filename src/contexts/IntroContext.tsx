'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { safeStorage } from '@/lib/safeStorage';

export type IntroPhase = 'pending' | 'playing' | 'done';

export type IntroState = {
  phase: IntroPhase;
  done: boolean;
  /** Ends the intro for this browser session (sessionStorage 'ob-seen-loader-v2', html[data-intro]='seen'). */
  markDone: () => void;
  /** The hero has painted what the curtain reveals. */
  heroReady: boolean;
  setHeroReady: () => void;
};

// Keep in step with BOOTSTRAP_SCRIPT, which sets data-intro before first paint.
const SEEN_KEY = 'ob-seen-loader-v2';

/* ---- html[data-intro] and heroReady as one external store ---- */

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let heroReady = false;

function notify() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!observer) {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-intro'] });
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

function readPhase(): IntroPhase {
  const v = document.documentElement.getAttribute('data-intro');
  return v === 'pending' ? 'pending' : v === 'playing' ? 'playing' : 'done';
}

// The curtain is server-rendered and shown only by CSS under html[data-intro=pending],
// so hydration starts from 'pending' and settles to the real phase right after.
const serverPhase = (): IntroPhase => 'pending';

function markDone() {
  if (typeof document === 'undefined') return;
  safeStorage.set(SEEN_KEY, '1', 'session');
  document.documentElement.setAttribute('data-intro', 'seen');
  notify();
}

function setHeroReady() {
  if (heroReady) return;
  heroReady = true;
  notify();
}

const getHeroReady = () => heroReady;
const serverHeroReady = () => false;

// index.css hides a still-unhydrated curtain this long after load. html.hydrated
// (added by Providers in the same effects flush, after this provider's effect)
// removes that failsafe, so a late hydration ends the intro instead of bringing
// the curtain back over content the visitor is already reading.
const FAILSAFE_MS = 4000;

function endIntroIfLate() {
  const start = window.__navStart;
  const elapsed = typeof start === 'number' ? Date.now() - start : performance.now();
  if (elapsed > FAILSAFE_MS && readPhase() !== 'done') markDone();
}

const IntroContext = createContext<IntroState | null>(null);

export function IntroProvider({ children }: { children: ReactNode }) {
  const phase = useSyncExternalStore(subscribe, readPhase, serverPhase);
  const ready = useSyncExternalStore(subscribe, getHeroReady, serverHeroReady);
  useEffect(endIntroIfLate, []);
  const value = useMemo<IntroState>(
    () => ({ phase, done: phase === 'done', markDone, heroReady: ready, setHeroReady }),
    [phase, ready],
  );
  return <IntroContext.Provider value={value}>{children}</IntroContext.Provider>;
}

// Outside the provider there is no curtain to wait for.
const NO_INTRO: IntroState = { phase: 'done', done: true, markDone, heroReady: true, setHeroReady };

export function useIntro(): IntroState {
  return useContext(IntroContext) ?? NO_INTRO;
}
