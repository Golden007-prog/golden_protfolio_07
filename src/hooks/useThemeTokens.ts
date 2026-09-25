'use client';

import { useSyncExternalStore } from 'react';

export type ThemeTokens = {
  violet: string;
  violetBright: string;
  cyan: string;
  cyanBright: string;
  amber: string;
  pink: string;
  bgBase: string;
  textPrimary: string;
  textMuted: string;
};

const VARS: Record<keyof ThemeTokens, string> = {
  violet: '--app-violet',
  violetBright: '--app-violet-bright',
  cyan: '--app-cyan',
  cyanBright: '--app-cyan-bright',
  amber: '--app-amber',
  pink: '--app-pink',
  bgBase: '--app-bg-base',
  textPrimary: '--app-text-primary',
  textMuted: '--app-text-muted',
};

// Dark-theme values from index.css, used on the server and during hydration.
const DARK_DEFAULTS: ThemeTokens = Object.freeze({
  violet: '#7C3AED',
  violetBright: '#A855F7',
  cyan: '#06B6D4',
  cyanBright: '#22D3EE',
  amber: '#F59E0B',
  pink: '#EC4899',
  bgBase: '#060609',
  textPrimary: '#FAFAFA',
  textMuted: '#94A3B8',
});

let cacheKey: string | null = null;
let cached: ThemeTokens = DARK_DEFAULTS;

function read(): ThemeTokens {
  const root = document.documentElement;
  const key = root.getAttribute('data-theme') ?? '';
  if (key === cacheKey) return cached;
  const style = getComputedStyle(root);
  const next = { ...DARK_DEFAULTS };
  for (const name of Object.keys(VARS) as (keyof ThemeTokens)[]) {
    const value = style.getPropertyValue(VARS[name]).trim();
    if (value) next[name] = value;
  }
  cacheKey = key;
  cached = next;
  return next;
}

function subscribe(fn: () => void) {
  const observer = new MutationObserver(fn);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** Resolved accent and surface colours for canvas, WebGL and SVG code; follows data-theme live. */
export function useThemeTokens(): ThemeTokens {
  return useSyncExternalStore(subscribe, read, () => DARK_DEFAULTS);
}
