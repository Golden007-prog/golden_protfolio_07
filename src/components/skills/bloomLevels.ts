/**
 * Mip levels for the skill sphere's bloom. The mip-blur glow reaches about four of
 * its coarsest texels (4 * 2^levels drawing-buffer pixels) from a node, and whatever
 * reaches the canvas edge shows as a hard-edged lighter square: the composer adds
 * glow colour over the transparent canvas while alpha stays near zero. The nodes sit
 * within 69% of the half-size, so about 15% of the side is margin, and
 * 28 * 2^levels <= side keeps the glow inside it: 3 levels at the 1024px layout's
 * ~320px stage, 4 at 474px, 5 from 896 buffer pixels. postprocessing's default of 8
 * spans the whole canvas.
 */
export function bloomLevels(bufferSide: number): number {
  if (!(bufferSide > 0)) return 4;
  return Math.min(5, Math.max(3, Math.floor(Math.log2(bufferSide / 28))));
}

/** The upsampling mix; below postprocessing's 0.85 so the coarsest level stays a soft halo, not a blotch. */
export const BLOOM_RADIUS = 0.7;
