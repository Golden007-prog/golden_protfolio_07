'use client';

import { Suspense, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDeviceCapability } from '../../hooks/useDeviceCapability';
import { cn } from '../../utils/cn';
import { CanvasBoundary } from './CanvasBoundary';
import { carryFocus } from './focusCarry';

/** Hands the stage from the fallback to the canvas only once the canvas has drawn. */
export type Handoff = {
  /**
   * Matches an element in the canvas's DOM once the canvas has drawn its first full
   * frame. Until then the fallback stays mounted on top of the canvas; then it fades out.
   */
  ready: string;
  /** How long the fallback takes to fade out (ms). */
  fadeMs?: number;
};

type Cover = 'on' | 'fading' | 'off';

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
  /**
   * An attribute whose value names the same control in the fallback and in the
   * canvas's own DOM. Keyboard focus on such a control follows it across every swap
   * instead of dropping to <body>.
   */
  focusKey?: string;
  /**
   * Keeps the fallback up until the canvas has drawn, instead of unmounting it when
   * the chunk resolves: a committed canvas is blank until R3F has measured it and
   * rendered a frame, and anything that suspends inside it shows the fallback again.
   */
  handoff?: Handoff;
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

function isShown(el: Element): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;
}

/** Suspense's fallback inside a handoff: whenever the canvas (re)suspends, the cover comes back. */
function Suspended({ onShow }: { onShow: () => void }) {
  useLayoutEffect(onShow, [onShow]);
  return null;
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
  focusKey,
  handoff,
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

  // With a handoff, the fallback stays on top of a mounted canvas until it has drawn.
  const [cover, setCover] = useState<Cover>('on');
  if (!showing && cover !== 'on') setCover('on');
  const coverUp = useCallback(() => setCover('on'), []);
  const readySelector = handoff?.ready;
  const fadeMs = handoff?.fadeMs ?? 300;

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

  // Without a handoff the branches below never share DOM (Suspense even mounts a
  // second copy of the fallback), so every swap unmounts whatever control had focus;
  // with one, the fallback still goes when its fade ends.
  useEffect(() => {
    const el = ref.current;
    if (!el || !focusKey) return;
    return carryFocus(el, focusKey);
  }, [focusKey]);

  // The canvas has drawn once its DOM matches the handoff selector outside the cover
  // and is shown (a re-suspended canvas is hidden with display:none).
  useEffect(() => {
    const el = ref.current;
    if (!el || !readySelector || !showing || cover !== 'on') return;
    const drawn = () => {
      const coverEl = el.querySelector(':scope > [data-deferred3d-cover]');
      for (const match of el.querySelectorAll(readySelector)) {
        if (!coverEl?.contains(match) && isShown(match)) return true;
      }
      return false;
    };
    const check = () => {
      if (!drawn()) return;
      observer.disconnect();
      cancelAnimationFrame(firstCheck);
      setCover('fading');
    };
    const observer = new MutationObserver(check);
    observer.observe(el, { subtree: true, childList: true, attributes: true });
    // It may already match (a canvas revealed again after a re-suspend).
    const firstCheck = requestAnimationFrame(check);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(firstCheck);
    };
  }, [readySelector, showing, cover]);

  // transitionend normally ends the fade; this covers a missed event.
  useEffect(() => {
    if (cover !== 'fading') return;
    const t = window.setTimeout(() => setCover('off'), fadeMs + 150);
    return () => window.clearTimeout(t);
  }, [cover, fadeMs]);

  const notifyFallback = useEffectEvent(() => onFallback?.());
  const fallbackFinal = ready && (!allowHeavy3D || failed);
  useEffect(() => {
    if (fallbackFinal) notifyFallback();
  }, [fallbackFinal]);

  if (!handoff) {
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

  // The cover keeps its slot (the first child) from the first render until the fade
  // ends, so the fallback on screen is the same instance throughout: no remount, no
  // blank frame, and a focused control inside it stays focused. Before the grant it
  // lays out as if unwrapped; over a live canvas it is an overlay. The canvas stays
  // inert under it, so the stage never offers two sets of controls at once.
  const covered = !showing || cover !== 'off';
  return (
    <div
      ref={ref}
      className={className}
      data-deferred3d={id}
      data-state={showing ? 'live' : 'fallback'}
      data-cover={showing ? cover : undefined}
    >
      {covered ? (
        <div
          data-deferred3d-cover=""
          className={
            showing ? cn('absolute inset-0 z-1 transition-opacity ease-out', cover === 'fading' && 'pointer-events-none opacity-0') : 'contents'
          }
          style={showing ? { transitionDuration: `${fadeMs}ms` } : undefined}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget && e.propertyName === 'opacity' && cover === 'fading') setCover('off');
          }}
        >
          {fallback}
        </div>
      ) : null}
      {showing ? (
        <div className="contents" inert={cover === 'on'}>
          <CanvasBoundary fallback={null} onError={() => setFailed(true)}>
            <Suspense fallback={<Suspended onShow={coverUp} />}>{children}</Suspense>
          </CanvasBoundary>
        </div>
      ) : null}
    </div>
  );
}

export default Deferred3D;
