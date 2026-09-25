'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { safeStorage } from '../lib/safeStorage';

const KEYS_KEY = 'ob-keys';

type Combo = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** No modifier and a printable key: covered by the WCAG 2.1.4 switch. */
  single: boolean;
};

const ALIASES: Record<string, string> = { esc: 'escape', space: ' ', spacebar: ' ' };

function parse(combo: string): Combo {
  // Split on '+' but keep a literal '+' key ('shift++' or '+').
  const parts = combo.toLowerCase().split(/\+(?!$)/);
  const raw = parts.pop() ?? '';
  const key = ALIASES[raw] ?? raw;
  const has = (m: string) => parts.includes(m);
  const mod = has('mod');
  const ctrl = has('ctrl') || has('control');
  const meta = has('meta') || has('cmd');
  const alt = has('alt') || has('option');
  const shift = has('shift');
  return { key, mod, ctrl, meta, alt, shift, single: !mod && !ctrl && !meta && !alt && key.length === 1 };
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '');
}

function matches(c: Combo, e: KeyboardEvent, mac: boolean): boolean {
  const wantMeta = c.meta || (c.mod && mac);
  const wantCtrl = c.ctrl || (c.mod && !mac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== c.alt) return false;
  // Shift is only checked when asked for: '?' needs Shift on most layouts.
  if (c.shift && !e.shiftKey) return false;
  const key = e.key.toLowerCase();
  if (key === c.key) return true;
  // With a modifier held, some layouts report a non-Latin e.key; fall back to the physical key.
  return (wantMeta || wantCtrl || c.alt) && /^[a-z]$/.test(c.key) && e.code === `Key${c.key.toUpperCase()}`;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
  );
}

/* ---- single-key shortcut switch (WCAG 2.1.4) ---- */

const switchListeners = new Set<() => void>();
let singleKeysOn: boolean | null = null;

function getSingleKeys(): boolean {
  singleKeysOn ??= safeStorage.get(KEYS_KEY) !== 'off';
  return singleKeysOn;
}

function setSingleKeys(v: boolean) {
  singleKeysOn = v;
  if (v) safeStorage.remove(KEYS_KEY);
  else safeStorage.set(KEYS_KEY, 'off');
  switchListeners.forEach((fn) => fn());
}

function subscribeSwitch(fn: () => void) {
  switchListeners.add(fn);
  return () => {
    switchListeners.delete(fn);
  };
}

/** Whether single-character shortcuts (t, m, /, ?) are on. Persisted in 'ob-keys'. */
export function useSingleKeyShortcuts(): [enabled: boolean, set: (v: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeSwitch, getSingleKeys, () => true);
  return [enabled, setSingleKeys];
}

/**
 * Keyboard shortcuts. Combos: 'mod+k' (Cmd on Mac, Ctrl elsewhere), 'shift+/', 't',
 * '/', '?', 'escape'. Events from inputs, textareas, selects and contenteditable
 * are ignored, as are single-key combos while single-key shortcuts are off.
 * Matched combos other than Escape call preventDefault.
 */
export function useHotkeys(
  map: Record<string, (e: KeyboardEvent) => void>,
  opts: { enabled?: boolean } = {},
): void {
  const { enabled = true } = opts;
  const mapRef = useRef(map);

  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    const mac = isMac();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isEditable(e.target)) return;
      for (const [combo, handler] of Object.entries(mapRef.current)) {
        const c = parse(combo);
        if (c.single && !getSingleKeys()) continue;
        if (!matches(c, e, mac)) continue;
        if (c.key !== 'escape') e.preventDefault();
        handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
