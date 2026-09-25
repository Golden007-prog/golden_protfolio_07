'use client';

import { useEffect } from 'react';
import { getLenis } from '@/contexts/LenisContext';

let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

function lock() {
  locks += 1;
  if (locks > 1) return;
  const root = document.documentElement;
  const body = document.body;
  saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  // html has scrollbar-gutter: stable, so usually nothing shifts; pad only by
  // whatever width the page actually gained (browsers without gutter support).
  // Measure the layout box, not clientWidth: with overflow hidden Chromium keeps
  // the gutter reserved but stops subtracting it from clientWidth, which reads
  // as a phantom 15px gain on classic (non-overlay) scrollbars.
  const before = root.getBoundingClientRect().width;
  body.style.overflow = 'hidden';
  const gained = root.getBoundingClientRect().width - before;
  if (gained > 0.5) {
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gained}px`;
  }
  // LenisProvider reads this when an instance is created mid-lock.
  root.setAttribute('data-scroll-lock', '');
  getLenis()?.stop();
}

function unlock() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  const body = document.body;
  if (saved) {
    body.style.overflow = saved.overflow;
    body.style.paddingRight = saved.paddingRight;
    saved = null;
  }
  document.documentElement.removeAttribute('data-scroll-lock');
  getLenis()?.start();
}

/**
 * Freezes page scrolling while `active`: stops Lenis and hides body overflow,
 * compensating for a disappearing scrollbar. Ref-counted, so stacked dialogs
 * release the page only when the last one closes. Scrollers marked
 * data-lenis-prevent keep scrolling natively.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
