'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import type { LottieHandle, LottieLight as LottieLightComponent, LottieState } from 'lottie-react';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { LOTTIE, type LottieName } from '@/lib/lottie-registry';
import { recolorLottie } from '@/lib/lottie-recolor';
import { useComposedRefs } from '@/components/ui/Slot';

type Player = typeof LottieLightComponent;
type Theme = 'dark' | 'light';
type ColorMap = Record<string, string>;

export type LottiePlayMode = 'auto' | 'hover' | 'click' | 'once' | 'inView' | 'controlled';

/* ---- shared loaders: one player chunk and one fetch per file for the whole app ---- */

let playerPromise: Promise<Player> | null = null;
function loadPlayer(): Promise<Player> {
  if (!playerPromise) {
    playerPromise = import('lottie-react').then((m) => m.LottieLight);
    playerPromise.catch(() => {
      playerPromise = null;
    });
  }
  return playerPromise;
}

const jsonCache = new Map<string, Promise<object | null>>();
function loadJson(src: string): Promise<object | null> {
  let pending = jsonCache.get(src);
  if (!pending) {
    pending = fetch(src)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) =>
        json && typeof json === 'object' && Array.isArray((json as { layers?: unknown }).layers) ? json : null,
      )
      .catch(() => {
        // A network failure may be transient; a 404 or bad JSON (null above) stays cached.
        jsonCache.delete(src);
        return null;
      });
    jsonCache.set(src, pending);
  }
  return pending;
}

/**
 * Warms the player chunk and one animation's JSON, e.g. while a button is in its
 * loading state so the success animation is ready. No-op while motion is paused.
 */
export function preloadLottie(nameOrSrc: LottieName | string): void {
  if (typeof window === 'undefined' || getMotionPrefs().paused) return;
  const src = nameOrSrc in LOTTIE ? LOTTIE[nameOrSrc as LottieName] : nameOrSrc;
  void loadPlayer().catch(() => {});
  void loadJson(src);
}

/*
 * The files in /public/lottie are recoloured to the dark-theme tokens. In the
 * light theme those hexes swap to the light values of the same tokens, so every
 * icon reads on cream without per-call colour maps. `colors` merges on top.
 */
const LIGHT_DEFAULTS: ColorMap = {
  '#A855F7': '#6D28D9', // violet-bright -> light violet
  '#818CF8': '#5B21B6',
  '#22D3EE': '#0E7490', // cyan-bright -> light cyan-bright
  '#67E8F9': '#0891B2',
  '#E2E8F0': '#2A2A33', // near-white neutral -> light text-secondary
  '#E2F6FD': '#55555F', // scroll cue -> light text-muted
  '#F59E0B': '#A3480A', // amber -> light amber-text
  '#FB7185': '#BE123C', // danger
};

// The player mutates the animation data it is given (lottie-web adds functions),
// and a mutated document can no longer be structuredCloned. So the fetched JSON
// never reaches a player: every theme, even one with nothing to swap, gets a copy.
const themedCache = new Map<string, object>();
function themed(raw: object, src: string, theme: Theme, colors: { dark?: ColorMap; light?: ColorMap } | undefined, colorsKey: string): object {
  const map: ColorMap = { ...(theme === 'light' ? LIGHT_DEFAULTS : {}), ...colors?.[theme] };
  const key = `${src}|${theme}|${colorsKey}`;
  let out = themedCache.get(key);
  if (!out) {
    out = recolorLottie(raw, map);
    themedCache.set(key, out);
  }
  return out;
}

/* ---- data-theme as an external store (one observer for every icon) ---- */

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function subscribeTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => themeListeners.forEach((l) => l()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  return () => {
    themeListeners.delete(fn);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
}

// Mounted but invisible until the engine has built the first frame, so the
// fallback holds the space instead of an empty box.
const LOADING_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  pointerEvents: 'none',
};
const READY_STYLE: CSSProperties = { display: 'block', width: '100%', height: '100%' };

type Props = {
  /** A registered animation; wins over `src`. */
  name?: LottieName;
  /** Path under /public, e.g. "/lottie/scroll.json". */
  src?: string;
  /**
   * auto: plays once loaded, pauses offscreen. inView: restarts each time it scrolls in.
   * once: plays one time the first time it is seen. hover/click: plays from the start on
   * pointer hover (or focus) / click of `hoverTargetRef` or the icon. controlled: only through lottieRef.
   */
  play?: LottiePlayMode;
  loop?: boolean | number;
  speed?: number;
  /**
   * Frames [first, last] that play instead of the whole file, e.g. [0, 31] for one
   * of wave.json's five waves. Every mode, loop and stop stays inside it. Load-time:
   * a different range reloads the animation (an inline tuple is fine).
   */
  segment?: readonly [number, number];
  /** true: load when near the viewport (default). 'idle': near and the main thread is idle. false: on mount. */
  lazy?: boolean | 'idle';
  /** Shown under reduced motion, while loading, and when the file is missing. */
  fallback?: ReactNode;
  /** Source hex -> hex per theme, merged over the built-in light-theme map. */
  colors?: { dark?: ColorMap; light?: ColorMap };
  /** Element whose hover/focus or click drives the 'hover' and 'click' modes. Defaults to the icon. */
  hoverTargetRef?: RefObject<HTMLElement | null>;
  lottieRef?: Ref<LottieHandle>;
  onComplete?: () => void;
  className?: string;
  style?: CSSProperties;
  /** Makes the icon meaningful (role=img). Without it the icon is aria-hidden. */
  label?: string;
};

/**
 * Lottie player built on lottie-react's LottieLight. Neither the player chunk nor
 * the JSON is fetched under reduced motion, while motion is paused, or before the
 * icon nears the viewport. Loops pause while offscreen. The live playback state
 * is mirrored to data-lottie-state (playing | paused | stopped | ...).
 */
export function LottieIcon({
  name,
  src: srcProp,
  play = 'auto',
  loop = true,
  speed = 1,
  segment,
  lazy = true,
  fallback = null,
  colors,
  hoverTargetRef,
  lottieRef,
  onComplete,
  className,
  style,
  label,
}: Props) {
  const src = name ? LOTTIE[name] : (srcProp ?? '');
  const prefs = useMotionPrefs();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark' as Theme);

  const hostRef = useRef<HTMLSpanElement>(null);
  const handleRef = useRef<LottieHandle | null>(null);
  const setHandle = useComposedRefs<LottieHandle>(handleRef, lottieRef);

  const [near, setNear] = useState(lazy === false);
  const [idleDone, setIdleDone] = useState(lazy !== 'idle');
  const [loaded, setLoaded] = useState<{ src: string; Player: Player; raw: object } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [readySrc, setReadySrc] = useState<string | null>(null);

  const current = loaded && loaded.src === src ? loaded : null;
  const failed = failedSrc === src || !src;
  // Paused before anything loaded: stay on the fallback and fetch nothing.
  const blocked = prefs.reduce || (prefs.paused && !current);
  const showPlayer = !prefs.reduce && !failed && current !== null;
  const ready = showPlayer && readySrc === src;
  const effectiveLoop = play === 'once' ? false : loop;

  const colorsKey = colors ? JSON.stringify(colors) : '';
  const data = useMemo(
    () => (current ? themed(current.raw, src, theme, colors, colorsKey) : null),
    // colors is covered by colorsKey, so an inline object does not re-theme every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, src, theme, colorsKey],
  );

  // 1. Near the viewport?
  useEffect(() => {
    if (near || blocked) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, blocked]);

  // 2. lazy='idle': wait for an idle slot so above-the-fold icons don't compete with first paint.
  useEffect(() => {
    if (idleDone || !near || blocked) return;
    const w = window as Window & { requestIdleCallback?: typeof requestIdleCallback };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdleDone(true), { timeout: 2500 });
      return () => w.cancelIdleCallback(id);
    }
    const t = window.setTimeout(() => setIdleDone(true), 300);
    return () => window.clearTimeout(t);
  }, [idleDone, near, blocked]);

  // 3. Load the player chunk and the JSON together.
  useEffect(() => {
    if (blocked || !near || !idleDone || current || failed) return;
    let alive = true;
    Promise.all([loadPlayer(), loadJson(src)])
      .then(([Player, raw]) => {
        if (!alive) return;
        if (raw) setLoaded({ src, Player, raw });
        else setFailedSrc(src);
      })
      .catch(() => alive && setFailedSrc(src));
    return () => {
      alive = false;
    };
  }, [blocked, near, idleDone, current, failed, src]);

  // Latest playback inputs, read by the imperative control below.
  const control = useRef({
    play,
    loop: effectiveLoop,
    paused: prefs.paused,
    visible: false,
    hovering: false,
    /** The mode's automatic start has happened (auto, once, inView). */
    played: false,
    completed: false,
    /** Paused by us (offscreen or the pause switch), so it resumes when that ends. */
    autoPaused: false,
  });
  useEffect(() => {
    control.current.play = play;
    control.current.loop = effectiveLoop;
  });
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  const restart = () => {
    const h = handleRef.current;
    if (!h || control.current.paused) return;
    control.current.completed = false;
    h.stop();
    h.play();
  };

  /** Plays or pauses to match the mode, visibility and the pause switch. */
  const sync = () => {
    const h = handleRef.current;
    if (!h?.animationItem) return;
    const c = control.current;
    const playing = !h.animationItem.isPaused;
    if (c.paused || !c.visible) {
      if (playing) {
        h.pause();
        c.autoPaused = true;
      }
      return;
    }
    if (c.autoPaused) {
      c.autoPaused = false;
      if (!playing) h.play();
      return;
    }
    if (c.play === 'hover') {
      // A pointer or focus that arrived while the file was still loading counts too.
      if (c.hovering && !c.played) {
        c.played = true;
        restart();
      }
      return;
    }
    if (c.played || (c.play !== 'auto' && c.play !== 'once' && c.play !== 'inView')) return;
    c.played = true;
    if (c.play === 'auto') h.play();
    else restart();
  };

  const subscriptions = useMemo(
    () => ({
      ready: () => {
        setReadySrc(src);
        // A theme swap reloads the animation at frame 0: a finished one-shot goes
        // back to its last frame, anything else starts again as its mode says.
        const c = control.current;
        c.autoPaused = false;
        if (c.completed && !c.loop) {
          handleRef.current?.seek({ percent: 100 });
          return;
        }
        c.played = false;
        requestAnimationFrame(sync);
      },
      complete: () => {
        control.current.completed = true;
        onCompleteRef.current?.();
      },
      newState: ({ state }: { state: LottieState }) => {
        hostRef.current?.setAttribute('data-lottie-state', state);
      },
      error: () => setFailedSrc(src),
    }),
    // sync reads refs only; src is the one input that changes these handlers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src],
  );

  // 4. Pause offscreen, resume on return; inView restarts on each entry.
  useEffect(() => {
    if (!showPlayer) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      control.current.visible = true;
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const c = control.current;
      if (entry.isIntersecting && !c.visible && c.play === 'inView') {
        c.played = false;
        c.autoPaused = false;
      }
      c.visible = entry.isIntersecting;
      sync();
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlayer]);

  // 5. The pause switch.
  useEffect(() => {
    control.current.paused = prefs.paused;
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.paused]);

  // 6. Hover and click triggers.
  useEffect(() => {
    if (!showPlayer || (play !== 'hover' && play !== 'click')) return;
    const target = hoverTargetRef?.current ?? hostRef.current;
    if (!target) return;
    const c = control.current;
    if (play === 'click') {
      const onClick = () => restart();
      target.addEventListener('click', onClick);
      return () => target.removeEventListener('click', onClick);
    }
    const enter = () => {
      if (c.hovering) return;
      c.hovering = true;
      restart();
    };
    const leave = (e: Event) => {
      if (e.type === 'focusout' && target.contains((e as FocusEvent).relatedTarget as Node | null)) return;
      c.hovering = false;
      if (c.loop) handleRef.current?.stop();
    };
    // The pointer may already be over the target when these listeners arrive.
    c.hovering = target.matches(':hover, :focus-within');
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    return () => {
      target.removeEventListener('pointerenter', enter);
      target.removeEventListener('pointerleave', leave);
      target.removeEventListener('focusin', enter);
      target.removeEventListener('focusout', leave);
    };
  }, [showPlayer, play, hoverTargetRef]);

  const Player = current?.Player;
  const phase = blocked || failed ? 'fallback' : ready ? 'ready' : 'loading';

  return (
    <span
      ref={hostRef}
      className={className}
      style={style}
      data-lottie={name ?? src}
      data-lottie-phase={phase}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {!ready && fallback}
      {showPlayer && Player && data ? (
        <Player
          as="span"
          src={data}
          loop={effectiveLoop}
          speed={speed}
          segment={segment}
          autoplay={false}
          lottieRef={setHandle}
          subscriptions={subscriptions}
          style={ready ? READY_STYLE : LOADING_STYLE}
        />
      ) : null}
    </span>
  );
}

export default LottieIcon;
