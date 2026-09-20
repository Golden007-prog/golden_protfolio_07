'use client';

import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';

type PlayerProps = {
  src: string;
  loop?: boolean | number;
  autoplay?: boolean;
  speed?: number;
  className?: string;
  style?: CSSProperties;
};

// Cached at module scope so only the first <LottieIcon> pays for the chunk.
let playerPromise: Promise<ComponentType<PlayerProps>> | null = null;
function loadPlayer() {
  playerPromise ??= import('lottie-react').then(
    (m) => m.LottieLight as unknown as ComponentType<PlayerProps>,
  );
  return playerPromise;
}

type Props = {
  /** Path under /public, e.g. "/lottie/scroll.json". */
  src: string;
  loop?: boolean | number;
  speed?: number;
  className?: string;
  style?: CSSProperties;
  /** Defer loading until scrolled into view. Default true. */
  lazy?: boolean;
  /** Shown instead of the animation when the user prefers reduced motion. */
  fallback?: ReactNode;
};

/**
 * Decorative Lottie wrapper. The player chunk and the animation JSON are both
 * fetched only once the element nears the viewport, and neither is fetched at
 * all under prefers-reduced-motion.
 */
export function LottieIcon({
  src,
  loop = true,
  speed = 1,
  className,
  style,
  lazy = true,
  fallback = null,
}: Props) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(!lazy);
  const [reduced, setReduced] = useState(true); // assume reduced until proven otherwise
  const [Player, setPlayer] = useState<ComponentType<PlayerProps> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (near || reduced) return;
    const el = hostRef.current;
    if (!el) return;
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
  }, [near, reduced]);

  useEffect(() => {
    if (!near || reduced) return;
    let alive = true;
    loadPlayer()
      .then((P) => alive && setPlayer(() => P))
      .catch(() => {
        /* decoration is never worth breaking the page for */
      });
    return () => {
      alive = false;
    };
  }, [near, reduced]);

  return (
    <span ref={hostRef} className={className} style={style} aria-hidden="true">
      {reduced ? (
        fallback
      ) : Player ? (
        <Player src={src} loop={loop} speed={speed} autoplay style={{ width: '100%', height: '100%' }} />
      ) : null}
    </span>
  );
}

export default LottieIcon;
