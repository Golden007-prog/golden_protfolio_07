'use client';

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type Lenis from 'lenis';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { SECTIONS } from '@/lib/site';
import { findTarget, setUrlHash } from '@/lib/urlState';

export type ScrollTarget = string | HTMLElement | number;
export type SmoothScrollOptions = { offset?: number; immediate?: boolean; focus?: boolean };

/** Distance kept between a scrolled-to element and the top of the viewport (the fixed nav). */
const NAV_OFFSET = -88;

/* ---- the one Lenis instance, as an external store ---- */

let instance: Lenis | null = null;
const listeners = new Set<() => void>();

function setInstance(next: Lenis | null) {
  instance = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Non-React read, for scroll locks and imperative code. */
export function getLenis(): Lenis | null {
  return instance;
}

export function useLenis(): Lenis | null {
  return useSyncExternalStore(subscribe, getLenis, () => null);
}

/* ---- programmatic scrolling ---- */

const NATIVELY_FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** The section's h2 (`${id}-title`), else its first heading, else the element itself. */
function focusTargetFor(el: HTMLElement): HTMLElement {
  if (el.matches(NATIVELY_FOCUSABLE)) return el;
  const heading =
    (el.id ? document.getElementById(`${el.id}-title`) : null) ?? el.querySelector<HTMLElement>('h1, h2, h3');
  return heading ?? el;
}

function focusWithoutScroll(el: HTMLElement) {
  if (!el.matches(NATIVELY_FOCUSABLE)) el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

/**
 * Scrolls to a section id ('#projects' or 'projects'), an element or a y
 * position. Elements land `offset` px below the viewport top (default: under the
 * nav). Glides through Lenis when it is running and jumps under reduced motion.
 */
export function smoothScrollTo(target: ScrollTarget, opts: SmoothScrollOptions = {}): void {
  if (typeof window === 'undefined') return;
  const { immediate = false, focus = true } = opts;
  let el: HTMLElement | null = null;
  let top: number;

  if (typeof target === 'number') {
    top = target + (opts.offset ?? 0);
  } else {
    el = typeof target === 'string' ? findTarget(target) : target;
    if (!el) {
      if (typeof target === 'string' && /^#?top$/.test(target)) top = 0;
      else return;
    } else {
      // A number, not the element: Lenis would also subtract the root's
      // scroll-padding-top (the same 88px) and land twice as low.
      top = el.getBoundingClientRect().top + window.scrollY + (opts.offset ?? NAV_OFFSET);
    }
  }
  top = Math.max(0, Math.round(top));

  const reduce = getMotionPrefs().reduce;
  const lenis = instance;
  if (lenis && !reduce) {
    // force: a dialog that just closed may not have released its scroll lock yet.
    lenis.scrollTo(top, { immediate, force: true });
  } else {
    window.scrollTo({ top, behavior: immediate || reduce ? 'instant' : 'smooth' });
  }

  if (focus && el) focusWithoutScroll(focusTargetFor(el));
}

/** smoothScrollTo as a hook, for components. */
export function useSmoothScrollTo(): (target: ScrollTarget, opts?: SmoothScrollOptions) => void {
  return useCallback((target: ScrollTarget, opts?: SmoothScrollOptions) => smoothScrollTo(target, opts), []);
}

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

/**
 * Same-page fragment links (<a href="#projects">) glide through smoothScrollTo,
 * land under the nav and move focus to the section heading. Links whose click a
 * component already handled (defaultPrevented) are left alone.
 */
function useAnchorLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        return;
      }
      const here = window.location;
      if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search) return;
      if (url.hash.length < 2) return;
      const el = findTarget(url.hash);
      if (!el) return;
      e.preventDefault();
      smoothScrollTo(el);
      // The shell owns the hash and only ever holds a section id.
      if (SECTION_IDS.has(el.id)) setUrlHash(el.id);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

/**
 * Smooth wheel scrolling (Lenis) ticked from gsap.ticker and synced to
 * ScrollTrigger. Not created under reduced motion. Nested scrollers (dialogs,
 * chat logs, [data-lenis-prevent]) scroll natively.
 */
export function LenisProvider({ children }: { children: ReactNode }) {
  const { reduce } = useMotionPrefs();

  useEffect(() => {
    // The hydration pass sees the store's server snapshot (reduce: false); the live
    // read keeps an OS-reduce visit from fetching Lenis only to discard it.
    if (reduce || getMotionPrefs().reduce) return;
    let cancelled = false;
    let cleanup = () => {};

    Promise.all([import('lenis'), import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ default: LenisCtor }, { default: gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        const lenis = new LenisCtor({
          allowNestedScroll: true,
          // Fragment links are handled by useAnchorLinks, which lands them at the
          // same 88px offset without Lenis's scroll-padding double count.
          anchors: false,
          stopInertiaOnNavigate: true,
          smoothWheel: true,
          syncTouch: false,
        });
        const offScroll = lenis.on('scroll', () => ScrollTrigger.update());
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        // A dialog may have locked scrolling before Lenis finished loading.
        if (document.documentElement.hasAttribute('data-scroll-lock')) lenis.stop();
        setInstance(lenis);

        cleanup = () => {
          gsap.ticker.remove(tick);
          offScroll();
          lenis.destroy();
          if (instance === lenis) setInstance(null);
        };
      })
      .catch(() => {
        /* native scrolling is the fallback */
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [reduce]);

  useAnchorLinks();

  return <>{children}</>;
}
