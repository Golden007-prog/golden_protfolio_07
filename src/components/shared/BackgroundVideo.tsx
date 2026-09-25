'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useDeviceCapability } from '../../hooks/useDeviceCapability';
import { useMotionPrefs } from '../../hooks/useMotionPrefs';

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
 * Saver or reduced-motion — where the poster frame stands in. The pause toggle
 * stops playback without unloading.
 */
export function BackgroundVideo({ src, variant, poster, className, style }: Props) {
  const { resolvedTheme } = useTheme();
  const { ready, allowVideo } = useDeviceCapability();
  const { paused } = useMotionPrefs();
  // A callback ref, not useRef: the <video> is created again whenever allowVideo
  // flips back on (reduced motion switched off mid-visit), and both observers must
  // follow the new element.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [near, setNear] = useState(false);

  const active = resolvedTheme === variant;
  const shouldLoad = ready && allowVideo && active && near;

  useEffect(() => {
    if (!video || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [video, near]);

  // Plays only while on screen: no battery spent decoding a video scrolled away.
  useEffect(() => {
    if (!video) return;
    if (!shouldLoad || paused) {
      video.pause();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0.01 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [video, shouldLoad, paused]);

  if (ready && !allowVideo) {
    return poster && active ? (
      // eslint-disable-next-line @next/next/no-img-element -- stands in for the <video> with the caller's own sizing classes; next/image would need dimensions or a positioned parent this layer does not control
      <img src={poster} alt="" aria-hidden="true" className={className} style={style} loading="lazy" decoding="async" />
    ) : null;
  }

  return (
    <video
      ref={setVideo}
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
