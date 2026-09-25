'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useIntro } from '@/contexts/IntroContext';
import { SECTIONS, type SectionId } from '@/lib/site';
import { findTarget, readUrl, setUrlHash } from '@/lib/urlState';

const IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);
const ID_SET = new Set<string>(IDS);

/** A section is active once its top passes this line, in percent of the viewport height. */
const PROBE_PCT = 45;
/** Height of the observed band, which ends on the probe line. */
const BAND_PCT = 1;
const NAV_OFFSET = 88;

let active: SectionId | null = null;
let hashSync = false;
// The probe line in viewport px as the observer measured it (its rootBounds
// bottom). Chromium rounds the margins to whole pixels, so innerHeight * 45% can
// sit up to a pixel off the band's edge, enough to miss a 1px-per-frame crossing.
// Null until the first callback, and again after a resize.
let probeLine: number | null = null;
const listeners = new Set<() => void>();
let io: IntersectionObserver | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function isSectionId(v: string): v is SectionId {
  return ID_SET.has(v);
}

/** Mirrors the active section into the hash, but never replaces a hash the shell does not own. */
function writeHash(next: SectionId | null) {
  if (!hashSync) return;
  const { hash } = readUrl();
  if (hash !== '' && !ID_SET.has(hash)) return;
  if ((next ?? '') !== hash) setUrlHash(next);
}

function compute(line = probeLine ?? (window.innerHeight * PROBE_PCT) / 100) {
  let next: SectionId | null = null;
  // Sections sit in document order, so the last one whose top has passed the
  // line wins; strips between sections (ToolsStrip) keep the one above active.
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= line) next = id;
  }
  if (next === active) return;
  active = next;
  listeners.forEach((fn) => fn());
  writeHash(next);
}

function onIntersect(entries: IntersectionObserverEntry[]) {
  const bottom = entries[0]?.rootBounds?.bottom;
  if (bottom !== undefined) probeLine = bottom;
  compute();
}

/** Observes every section in the DOM and returns how many were found. */
function observeSections(): number {
  let found = 0;
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (el) {
      io?.observe(el);
      found += 1;
    }
  }
  return found;
}

function observeAll(attempt = 0) {
  if (!io) return;
  if (observeSections() < IDS.length && attempt < 10) {
    retryTimer = setTimeout(() => observeAll(attempt + 1), 500);
  }
}

// Re-observing makes the observer report every section afresh against the new
// viewport, rootBounds included, instead of guessing the line from innerHeight.
function onResize() {
  if (!io) return;
  probeLine = null;
  io.disconnect();
  observeSections();
}

function start() {
  if (typeof IntersectionObserver === 'undefined') return;
  // A thin band that ends on the probe line. A section's top entering the band
  // from below is the only callback that section gets until its bottom leaves
  // the band, so the band's lower edge must be the line itself; a band below the
  // line would see the top arrive, find it short of the line, and then go quiet.
  io = new IntersectionObserver(onIntersect, {
    rootMargin: `-${PROBE_PCT - BAND_PCT}% 0px -${100 - PROBE_PCT}% 0px`,
  });
  observeAll();
  window.addEventListener('resize', onResize, { passive: true });
}

function stop() {
  io?.disconnect();
  io = null;
  probeLine = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  window.removeEventListener('resize', onResize);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}

const noop = () => {};
const getActive = () => active;
const getServerActive = () => null;

/** The section under the reading line, shared by the nav, the menu and the rail through one observer. */
export function useActiveSection(): SectionId | null {
  return useSyncExternalStore(subscribe, getActive, getServerActive);
}

/**
 * Mount once (App). After the intro, a #<section> deep link is scrolled to (and
 * corrected once if late layout moved it), then the active section is mirrored
 * into the hash with replaceState, keeping ?project and ?skill.
 */
export function useSectionHashSync(): void {
  const { done } = useIntro();

  // Keeps the observer alive even when no visible consumer (the rail) is mounted,
  // without re-rendering the caller on every section change.
  useEffect(() => subscribe(noop), []);

  useEffect(() => {
    if (!done) return;
    // compute() only writes on a change of section, so a section reached while
    // syncing was off must be written when it turns on.
    const enableSync = () => {
      hashSync = true;
      compute();
      writeHash(active);
    };
    const { hash } = readUrl();
    if (!ID_SET.has(hash)) {
      enableSync();
      return;
    }
    smoothScrollTo(hash, { immediate: true, focus: false });
    const landedY = window.scrollY;
    const timer = setTimeout(() => {
      const el = findTarget(hash);
      // Fonts and lazy media above the target can push it down; re-land unless the visitor has moved on.
      if (el && Math.abs(window.scrollY - landedY) < 2 && Math.abs(el.getBoundingClientRect().top - NAV_OFFSET) > 4) {
        smoothScrollTo(hash, { immediate: true, focus: false });
      }
      enableSync();
    }, 700);
    return () => {
      clearTimeout(timer);
      hashSync = true;
    };
  }, [done]);
}
