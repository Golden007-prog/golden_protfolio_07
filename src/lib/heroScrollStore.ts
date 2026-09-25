/**
 * Mutable hero state shared by the hero's GSAP timelines (writers) and the R3F
 * frame loop (reader). Plain fields, no subscriptions: reading it in useFrame
 * never causes a React render, and nothing here imports three.
 */
export const heroScroll = {
  /** Exit-scrub progress, 0 with the hero at the top of the page, 1 once it has scrolled away. */
  progress: 0,
  /** Bloom multiplier, 0..1. The first-visit intro ramps it up; otherwise it stays at 1. */
  bloom: 1,
};

export function resetHeroScroll(): void {
  heroScroll.progress = 0;
  heroScroll.bloom = 1;
}
