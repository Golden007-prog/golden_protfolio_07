'use client';

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

const COLORS = ['rgba(168, 85, 247, 0.55)', 'rgba(34, 211, 238, 0.45)', 'rgba(236, 72, 153, 0.40)'];

/** Small deterministic PRNG: the same layout on every render (and any server render). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const rand = mulberry32(i + 1);
    const size = 6 + rand() * 22;
    const dur = 18 + rand() * 22;
    return {
      key: i,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        left: `${rand() * 100}%`,
        background: `radial-gradient(circle, ${COLORS[i % COLORS.length]} 0%, transparent 70%)`,
        animationDuration: `${dur}s`,
        animationDelay: `${-rand() * dur}s`,
        '--dx': `${(rand() - 0.5) * 120}px`,
      } as CSSProperties,
    };
  });
}

/**
 * Drifting dark-theme orbs behind the hero. The orbs pause (animation-play-state)
 * once the hero leaves the viewport; shell.css hides them in light and under
 * reduced motion, and the pause switch freezes them like every CSS loop.
 */
export function BokehParticles({ count = 14 }: { count?: number }) {
  const dots = useMemo(() => layout(count), [count]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    const hero = document.getElementById('hero');
    if (!host || !hero || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) host.removeAttribute('data-offscreen');
      else host.setAttribute('data-offscreen', '');
    });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="bokeh" aria-hidden="true" data-bokeh="">
      {dots.map((d) => (
        <span key={d.key} style={d.style} />
      ))}
    </div>
  );
}
