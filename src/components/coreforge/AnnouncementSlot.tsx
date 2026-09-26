'use client';

import dynamic from 'next/dynamic';

// Client-only and in its own chunk: the floating strip appears only after hydration
// anyway, and a chunk that fails to load leaves the page without it rather than broken.
const AnnouncementBar = dynamic(
  () => import('./AnnouncementBar').then((m) => m.AnnouncementBar, () => () => null),
  { ssr: false },
);

/*
 * Docked to the right under the nav rather than centred: centred, it covered the
 * hero's kicker row on short viewports (1280x800, 1024x768). Capped at 42vw it
 * stays clear of the hero's text column, which ends near 51% of the width at every
 * breakpoint from md up, and wraps onto two or three lines instead. Below md the
 * hero column is full width, so the strip starts at md (the kit's own default is sm).
 * top-[5.5rem] leaves a clear 16px under the 72px nav instead of the kit's 8px.
 */
const DOCK_RIGHT =
  'sm:hidden md:flex top-[5.5rem] left-auto right-4 mx-0 max-w-[min(30rem,42vw)] rounded-2xl py-1.5 lg:right-8 min-[1504px]:right-[calc((100vw-1440px)/2+2rem)]';

/** The CoreForge announcement for every route; it hides itself on /ventures/coreforge. */
export function AnnouncementSlot() {
  return <AnnouncementBar className={DOCK_RIGHT} />;
}
