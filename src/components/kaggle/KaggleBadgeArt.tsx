'use client';

import { useEffect, useRef } from 'react';
import type { KaggleBadge } from '@/lib/kaggle/types';
import { cn } from '@/utils/cn';
import { badgeInitials, httpsSrc } from './kaggleFormat';

type Props = {
  badge: Pick<KaggleBadge, 'name' | 'image'>;
  /** Rendered size in px; the image reserves exactly this box, so nothing shifts when it loads. */
  size: number;
  /**
   * The badge's name is printed right beside the art, so the art stays silent
   * (alt="") instead of announcing the name twice. Leave it off only for a
   * standalone badge with no visible name next to it.
   */
  decorative?: boolean;
  className?: string;
};

// A DOM flag rather than state: a failure costs no re-render, and a failure that
// happened before hydration (no listener attached yet) is caught the same way.
function markFailed(img: HTMLImageElement) {
  img.parentElement?.setAttribute('data-failed', '');
}

/**
 * A Kaggle badge's own SVG, lazy-loaded at a fixed size. If the image cannot load,
 * the badge's initials stand in (with the same accessible name unless decorative).
 * The hover shine (kaggle.css) rides on the wrapper; it is off under reduced motion.
 */
export function KaggleBadgeArt({ badge, size, decorative = false, className }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const src = httpsSrc(badge.image);
  const label = `${badge.name} badge`;

  useEffect(() => {
    const img = ref.current;
    // An image that errored before hydration had no onError listener yet. complete
    // is true for a broken image too; a zero natural size tells the two apart.
    // Not decode(): WebKit has rejected it for SVGs that loaded fine.
    if (img && img.complete && img.naturalWidth === 0 && img.naturalHeight === 0) markFailed(img);
  }, [src]);

  return (
    <span
      data-kaggle-badge-art=""
      data-failed={src ? undefined : ''}
      className={cn('kaggle-badge-art group/art relative grid shrink-0 place-items-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote SVG badge art at a fixed tiny size; next/image would proxy and rasterise a vector for no gain
        <img
          ref={ref}
          data-kaggle-badge-img=""
          src={src}
          alt={decorative ? '' : label}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={(e) => markFailed(e.currentTarget)}
          className="size-full object-contain group-data-[failed]/art:hidden"
        />
      ) : null}
      <span
        {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
        data-kaggle-badge-fallback=""
        className="hidden size-full place-items-center rounded-full border border-glass-border bg-surface-tint font-mono text-[11px] font-semibold text-text-secondary group-data-[failed]/art:grid"
      >
        <span aria-hidden="true">{badgeInitials(badge.name)}</span>
      </span>
      <span aria-hidden="true" className="kaggle-shine pointer-events-none absolute inset-0 rounded-full" />
    </span>
  );
}
