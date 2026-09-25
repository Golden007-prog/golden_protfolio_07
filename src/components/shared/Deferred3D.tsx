'use client';

import { Suspense, useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { useDeviceCapability } from '../../hooks/useDeviceCapability';
import { CanvasBoundary } from './CanvasBoundary';

type Props = {
  /** Usually a React.lazy canvas, so its chunk is only fetched when it can mount. */
  children: ReactNode;
  fallback: ReactNode;
  /** Names this canvas in the live-context registry (window.__deferred3d). */
  id: string;
  /** How close the element must come before the canvas mounts. */
  rootMargin?: string;
  /** Touch devices unmount the canvas once it is farther away than this. */
  unmountMargin?: string;
  className?: string;
  /** Called when the fallback is final: heavy 3D is not allowed here, or the canvas failed. */
  onFallback?: () => void;
};

/* ---------------------------------------------------------------------------
 * Live-context registry. On touch devices (where iOS reloads a tab under GPU
 * memory pressure and Safari never reports deviceMemory) only one canvas may be
 * mounted at a time: the one nearest the viewport. A new canvas is granted only
 * after the previous one has actually unmounted, so two never overlap.
 * ------------------------------------------------------------------------- */

type Entry = {
  id: string;
  el: HTMLElement;
  /** Touch device: at most one live canvas. */
  exclusive: boolean;
  /** Close enough, allowed, and not failed. */
  wants: boolean;
  /** The registry has cleared it to mount. */
  granted: boolean;
  /** Its canvas subtree is committed to the DOM. */
  mounted: boolean;
  setGranted: (v: boolean) => void;
};

const entries = new Map<string, Entry>();
let frame = 0;
let scrollBound = false;
// R3F disposes the renderer and forces context loss 500ms after a canvas unmounts,
// so the next canvas waits this long after a release.
const RELEASE_MS = 600;
let releasedAt = -Infinity;
let retry = 0;

/** Lower is nearer: minus the visible height when on screen, else the distance to the screen. */
function score(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  if (visible > 0) return -visible;
  return r.top >= vh ? r.top - vh : -r.bottom;
}

function grant(e: Entry, v: boolean) {
  if (e.granted === v) return;
  e.granted = v;
  e.setGranted(v);
}

function onScroll() {
  schedule();
}

function bindScroll(on: boolean) {
  if (on === scrollBound) return;
  scrollBound = on;
  if (on) window.addEventListener('scroll', onScroll, { passive: true });
  else window.removeEventListener('scroll', onScroll);
}

function reconcile() {
  frame = 0;
  const list = [...entries.values()];
  for (const e of list) if (!e.wants) grant(e, false);
  const wanting = list.filter((e) => e.wants);

  if (!wanting.some((e) => e.exclusive)) {
    bindScroll(false);
    for (const e of wanting) grant(e, true);
    return;
  }

  // Two candidates near at once: keep re-ranking while the page scrolls.
  bindScroll(wanting.length > 1);
  let best: Entry | null = null;
  let bestScore = Infinity;
  for (const e of wanting) {
    const s = score(e.el);
    if (s < bestScore) {
      best = e;
      bestScore = s;
    }
  }
  const holder = list.find((e) => e.granted) ?? null;
  if (holder && best && holder !== best) {
    // Hysteresis, so two canvases straddling the fold do not trade places on every frame.
    if (bestScore < score(holder.el) - window.innerHeight * 0.15) grant(holder, false);
    return;
  }
  // Wait until nothing is mounted before granting; the release re-runs this.
  if (!holder && best && !list.some((e) => e.mounted)) {
    const wait = releasedAt + RELEASE_MS - performance.now();
    if (wait > 0) {
      window.clearTimeout(retry);
      retry = window.setTimeout(schedule, wait);
      return;
    }
    grant(best, true);
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(reconcile);
}

declare global {
  interface Window {
    __deferred3d?: { live(): string[]; granted(): string[] };
  }
}

if (typeof window !== 'undefined' && !window.__deferred3d) {
  window.__deferred3d = {
    live: () => [...entries.values()].filter((e) => e.mounted).map((e) => e.id),
    granted: () => [...entries.values()].filter((e) => e.granted).map((e) => e.id),
  };
}

/** Ids of the canvases currently mounted. */
export function getLive3D(): string[] {
  return [...entries.values()].filter((e) => e.mounted).map((e) => e.id);
}

/**
 * Mounts a WebGL scene only when it is allowed and near. The server and first
 * client render show the fallback, so no <canvas> ships in the HTML and devices
 * that opt out never fetch the three.js chunk. A render error, a failed context
 * creation or a lost context swaps the fallback back in for the rest of the visit.
 */
export function Deferred3D({
  children,
  fallback,
  id,
  rootMargin = '300px',
  unmountMargin = '150%',
  className,
  onFallback,
}: Props) {
  const key = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { ready, allowHeavy3D, isTouch } = useDeviceCapability();
  const [near, setNear] = useState(false);
  const [seen, setSeen] = useState(false);
  const [kept, setKept] = useState(false);
  const [granted, setGranted] = useState(false);
  const [failed, setFailed] = useState(false);

  const allowed = ready && allowHeavy3D && !failed;
  // Desktop keeps a canvas once it has mounted; touch mounts when near and lets go
  // only beyond unmountMargin.
  const wants = allowed && (isTouch ? near || (granted && kept) : seen);
  const showing = wants && granted;

  // The two effects after this one list `id` too, so they refill a re-registered entry.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    entries.set(key, { id, el, exclusive: false, wants: false, granted: false, mounted: false, setGranted });
    return () => {
      entries.delete(key);
      setGranted(false);
      schedule();
    };
  }, [key, id]);

  useEffect(() => {
    const e = entries.get(key);
    if (!e) return;
    e.wants = wants;
    e.exclusive = isTouch;
    schedule();
  }, [key, id, wants, isTouch]);

  useEffect(() => {
    const e = entries.get(key);
    if (!e) return;
    if (e.mounted && !showing) releasedAt = performance.now();
    e.mounted = showing;
    // A released slot can go to the next candidate.
    if (!showing) schedule();
  }, [key, id, showing]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !allowed || typeof IntersectionObserver === 'undefined') return;
    const nearIo = new IntersectionObserver(
      ([entry]) => {
        const hit = Boolean(entry?.isIntersecting);
        setNear(hit);
        if (hit) setSeen(true);
      },
      { rootMargin },
    );
    nearIo.observe(el);
    let keepIo: IntersectionObserver | null = null;
    if (isTouch) {
      keepIo = new IntersectionObserver(([entry]) => setKept(Boolean(entry?.isIntersecting)), {
        rootMargin: unmountMargin,
      });
      keepIo.observe(el);
    }
    return () => {
      nearIo.disconnect();
      keepIo?.disconnect();
    };
  }, [allowed, isTouch, rootMargin, unmountMargin]);

  // Context events do not bubble, but a capturing listener on an ancestor still sees them.
  useEffect(() => {
    const el = ref.current;
    if (!el || !showing) return;
    const lose = () => setFailed(true);
    el.addEventListener('webglcontextlost', lose, true);
    el.addEventListener('webglcontextcreationerror', lose, true);
    return () => {
      el.removeEventListener('webglcontextlost', lose, true);
      el.removeEventListener('webglcontextcreationerror', lose, true);
    };
  }, [showing]);

  const notifyFallback = useEffectEvent(() => onFallback?.());
  const fallbackFinal = ready && (!allowHeavy3D || failed);
  useEffect(() => {
    if (fallbackFinal) notifyFallback();
  }, [fallbackFinal]);

  return (
    <div ref={ref} className={className} data-deferred3d={id} data-state={showing ? 'live' : 'fallback'}>
      {showing ? (
        <CanvasBoundary fallback={fallback} onError={() => setFailed(true)}>
          <Suspense fallback={fallback}>{children}</Suspense>
        </CanvasBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}

export default Deferred3D;
