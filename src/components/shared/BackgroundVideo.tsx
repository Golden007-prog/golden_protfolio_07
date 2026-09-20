'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useDeviceCapability } from '../../hooks/useDeviceCapability';

type Props = {
  src: string;
  /** Which theme this layer belongs to. Only the active one ever loads. */
  variant: 'dark' | 'light';
  poster?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Decorative background video.
 *
 * The old markup shipped both theme variants with preload="auto", so a phone
 * downloaded two files to show one. This mounts a source only for the active
 * theme, only once the section is near the viewport, and not at all under Data
 * Saver or reduced-motion — where the poster frame stands in.
 */
export function BackgroundVideo({ src, variant, poster, className, style }: Props) {
  const { resolvedTheme } = useTheme();
  const { ready, allowVideo } = useDeviceCapability();
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  const active = resolvedTheme === variant;

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  // Don't spend battery decoding a video that is scrolled away.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void el.play().catch(() => {});
          else el.pause();
        }
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const shouldLoad = ready && allowVideo && active && near;

  if (ready && !allowVideo) {
    return poster ? (
      <img src={poster} alt="" aria-hidden="true" className={className} style={style} loading="lazy" decoding="async" />
    ) : null;
  }

  return (
    <video
      ref={ref}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
      aria-hidden="true"
      className={className}
      style={style}
      src={shouldLoad ? src : undefined}
    />
  );
}

export default BackgroundVideo;
