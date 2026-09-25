'use client';

import { useSyncExternalStore } from 'react';
import { safeStorage } from '../lib/safeStorage';
import { matchesMedia, subscribeMedia } from './useMediaQuery';

export type MotionOverride = 'reduced' | 'full' | null;

export type MotionPrefs = {
  /** OS reduce (unless overridden to 'full') or the in-page 'reduced' override. */
  reduce: boolean;
  /** Coarse pointer or a low-power device: skip scrubs, blur and other heavy effects. */
  lite: boolean;
  /** Travel multiplier: 0.6 below 640px, 0.8 below 1024px, else 1. */
  scale: number;
  finePointer: boolean;
  hover: boolean;
  override: MotionOverride;
  /** reduce, or the user's pause toggle. Loops, marquees, videos and Lotties stop. */
  paused: boolean;
};

export const OVERRIDE_KEY = 'ob-motion';
export const PAUSE_KEY = 'ob-paused';

const Q_REDUCE = '(prefers-reduced-motion: reduce)';
const Q_BELOW_SM = '(max-width: 639.98px)';
const Q_BELOW_LG = '(max-width: 1023.98px)';
// Pointer and hover capability are read, not watched: they only change when a
// hybrid device docks, and three live listeners are the budget for this store.
const Q_COARSE = '(pointer: coarse)';
const Q_FINE = '(pointer: fine)';
const Q_HOVER = '(hover: hover)';

const SERVER_PREFS: MotionPrefs = Object.freeze({
  reduce: false,
  lite: false,
  scale: 1,
  finePointer: false,
  hover: false,
  override: null,
  paused: false,
});

type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

export type DeviceSignals = {
  coarse: boolean;
  belowSm: boolean;
  lowPower: boolean;
  saveData: boolean;
  slowNetwork: boolean;
};

const SERVER_SIGNALS: DeviceSignals = Object.freeze({
  coarse: false,
  belowSm: false,
  lowPower: false,
  saveData: false,
  slowNetwork: false,
});

let loaded = false;
let override: MotionOverride = null;
let userPaused = false;
let prefs: MotionPrefs | null = null;
let signals: DeviceSignals | null = null;
const listeners = new Set<() => void>();
let teardown: (() => void) | null = null;

function readOverride(): MotionOverride {
  const v = safeStorage.get(OVERRIDE_KEY);
  return v === 'reduced' || v === 'full' ? v : null;
}

function load() {
  if (loaded) return;
  loaded = true;
  override = readOverride();
  userPaused = safeStorage.get(PAUSE_KEY, 'session') === '1';
}

function readSignals(): DeviceSignals {
  const nav = navigator as NavigatorExtras;
  const saveData = nav.connection?.saveData === true;
  return {
    coarse: matchesMedia(Q_COARSE),
    belowSm: matchesMedia(Q_BELOW_SM),
    lowPower: (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || saveData,
    saveData,
    slowNetwork: /^(slow-2g|2g|3g)$/.test(nav.connection?.effectiveType ?? ''),
  };
}

function computePrefs(s: DeviceSignals): MotionPrefs {
  const reduce = (matchesMedia(Q_REDUCE) && override !== 'full') || override === 'reduced';
  return {
    reduce,
    lite: s.coarse || s.lowPower,
    scale: s.belowSm ? 0.6 : matchesMedia(Q_BELOW_LG) ? 0.8 : 1,
    finePointer: matchesMedia(Q_FINE),
    hover: matchesMedia(Q_HOVER),
    override,
    paused: reduce || userPaused,
  };
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);
}

/** Recomputes both snapshots, keeping the old objects when nothing changed. */
function refresh(): boolean {
  load();
  const nextSignals = readSignals();
  const nextPrefs = computePrefs(nextSignals);
  let changed = false;
  if (!signals || !shallowEqual(signals, nextSignals)) {
    signals = nextSignals;
    changed = true;
  }
  if (!prefs || !shallowEqual(prefs, nextPrefs)) {
    prefs = nextPrefs;
    changed = true;
  }
  return changed;
}

function toggleAttr(el: HTMLElement, name: string, on: boolean) {
  if (on) el.setAttribute(name, '');
  else el.removeAttribute(name);
}

function syncDom(p: MotionPrefs) {
  const root = document.documentElement;
  root.setAttribute('data-motion', p.reduce ? 'reduced' : 'full');
  toggleAttr(root, 'data-lite', p.lite);
  toggleAttr(root, 'data-motion-paused', p.paused);
}

function update(force = false) {
  const changed = refresh();
  syncDom(prefs!);
  if (changed || force) listeners.forEach((fn) => fn());
}

/** Non-React read, for GSAP, rAF loops and useFrame. */
export function getMotionPrefs(): MotionPrefs {
  if (typeof window === 'undefined') return SERVER_PREFS;
  // With no subscriber nothing keeps the snapshot current, so re-read on demand;
  // refresh() keeps the same object when nothing changed.
  if (!prefs || !teardown) refresh();
  return prefs!;
}

/** Raw device signals shared with useDeviceCapability. */
export function getDeviceSignals(): DeviceSignals {
  if (typeof window === 'undefined') return SERVER_SIGNALS;
  if (!signals || !teardown) refresh();
  return signals!;
}

export function subscribeMotionPrefs(fn: () => void): () => void {
  listeners.add(fn);
  if (!teardown) {
    const onChange = () => update();
    const unsubs = [Q_REDUCE, Q_BELOW_SM, Q_BELOW_LG].map((q) => subscribeMedia(q, onChange));
    const onStorage = (e: StorageEvent) => {
      if (e.key !== OVERRIDE_KEY) return;
      override = readOverride();
      update();
    };
    const connection = (navigator as NavigatorExtras & { connection?: EventTarget }).connection;
    window.addEventListener('storage', onStorage);
    connection?.addEventListener?.('change', onChange);
    teardown = () => {
      unsubs.forEach((u) => u());
      window.removeEventListener('storage', onStorage);
      connection?.removeEventListener?.('change', onChange);
    };
    // Catch anything that changed while nobody was listening, and mirror it to <html>.
    update();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}

export function useMotionPrefs(): MotionPrefs {
  return useSyncExternalStore(subscribeMotionPrefs, getMotionPrefs, () => SERVER_PREFS);
}

/** 'reduced' or 'full' pins the in-page setting; null follows the OS again. Persisted. */
export function setMotionOverride(v: MotionOverride): void {
  if (typeof window === 'undefined') return;
  load();
  override = v;
  if (v) safeStorage.set(OVERRIDE_KEY, v);
  else safeStorage.remove(OVERRIDE_KEY);
  update();
}

/** The user's pause toggle (WCAG 2.2.2). Lasts for the browser session. */
export function setPaused(v: boolean): void {
  if (typeof window === 'undefined') return;
  load();
  userPaused = v;
  if (v) safeStorage.set(PAUSE_KEY, '1', 'session');
  else safeStorage.remove(PAUSE_KEY, 'session');
  // prefs.paused may not change (reduce already pauses), but usePaused readers must.
  update(true);
}

function getUserPaused(): boolean {
  getMotionPrefs();
  return userPaused;
}

/** Whether the user's pause toggle is on (not whether motion is paused for any reason; see prefs.paused). */
export function usePaused(): boolean {
  return useSyncExternalStore(subscribeMotionPrefs, getUserPaused, () => false);
}
