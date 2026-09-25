import { useEffect } from 'react';

/**
 * Mutable pointer and scroll state for rAF loops and useFrame, fed by one passive
 * pointermove listener and one passive scroll listener for the whole app. Reading
 * it never causes a React render.
 */

/** x/y in CSS px; nx/ny in -1..1 with ny up (three.js convention). */
export const pointer = { x: 0, y: 0, nx: 0, ny: 0, active: false };

/** y in px, progress 0..1 over the whole page, velocity in px/s (decays to 0 when idle). */
export const scrollState: { y: number; progress: number; velocity: number; direction: 1 | -1 } = {
  y: 0,
  progress: 0,
  velocity: 0,
  direction: 1,
};

const pointerSubs = new Set<() => void>();
const scrollSubs = new Set<() => void>();
let refCount = 0;
let lastScrollTime = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function onPointerMove(e: PointerEvent) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.ny = -(e.clientY / window.innerHeight) * 2 + 1;
  pointer.active = true;
  pointerSubs.forEach((fn) => fn());
}

function onPointerOut(e: PointerEvent) {
  // relatedTarget is null only when the pointer leaves the window.
  if (e.relatedTarget !== null) return;
  pointer.active = false;
  pointerSubs.forEach((fn) => fn());
}

function readScroll(now: number) {
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const dt = now - lastScrollTime;
  const dy = y - scrollState.y;
  if (dy !== 0) scrollState.direction = dy > 0 ? 1 : -1;
  scrollState.velocity = dt > 0 && lastScrollTime > 0 ? (dy / dt) * 1000 : 0;
  scrollState.y = y;
  scrollState.progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
  lastScrollTime = now;
}

function onScroll() {
  readScroll(performance.now());
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    scrollState.velocity = 0;
    idleTimer = null;
    scrollSubs.forEach((fn) => fn());
  }, 100);
  scrollSubs.forEach((fn) => fn());
}

function attach() {
  lastScrollTime = 0;
  readScroll(performance.now());
  scrollState.velocity = 0;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerout', onPointerOut, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
}

function detach() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerout', onPointerOut);
  window.removeEventListener('scroll', onScroll);
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  pointer.active = false;
}

/** Keeps the shared listeners alive while the calling component is mounted. Ref-counted. */
export function usePointerTracking(): void {
  useEffect(() => {
    if (refCount++ === 0) attach();
    return () => {
      if (--refCount === 0) detach();
    };
  }, []);
}

/** Called after every pointer update. Does not keep the listeners alive by itself. */
export function subscribePointer(fn: () => void): () => void {
  pointerSubs.add(fn);
  return () => {
    pointerSubs.delete(fn);
  };
}

/** Called after every scroll update and once when scrolling goes idle. */
export function subscribeScroll(fn: () => void): () => void {
  scrollSubs.add(fn);
  return () => {
    scrollSubs.delete(fn);
  };
}
