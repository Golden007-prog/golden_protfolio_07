/**
 * Framing for the contact envelope. The camera has a fixed vertical field of
 * view, so a canvas narrower than the framed aspect shows less of the scene
 * horizontally and would cut the envelope's sides; there the camera zooms out
 * instead, which keeps the whole envelope in view at any column width.
 */

export const ENVELOPE_CAMERA = { position: [0, 0.2, 5.5] as [number, number, number], fov: 38 };
export const ENVELOPE_SCALE = 1.15;

/** holo-envelope.glb's half extents at scale 1: its quantised bounds times the node scale. */
const MODEL_HALF = { x: 0.9497, y: 0.895, z: 0.1924 };

/**
 * Width over height at which the level envelope spans 80% of the canvas width,
 * which leaves room for the pointer tilt and the float without meeting an edge.
 */
export const FRAMED_ASPECT = 0.75;

/** Camera zoom for a canvas of this aspect: 1 when wide enough, less when narrower. */
export function envelopeZoom(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return Math.min(1, aspect / FRAMED_ASPECT);
}

/**
 * The share of the canvas width the level envelope covers, measured at its front
 * face (the nearest, so the widest on screen). Above 1 its sides are cut off.
 */
export function envelopeWidthShare(aspect: number, zoom = envelopeZoom(aspect)): number {
  const halfX = MODEL_HALF.x * ENVELOPE_SCALE;
  const distance = ENVELOPE_CAMERA.position[2] - MODEL_HALF.z * ENVELOPE_SCALE;
  const halfViewWidth = (distance * Math.tan(((ENVELOPE_CAMERA.fov / 2) * Math.PI) / 180) * aspect) / zoom;
  return halfX / halfViewWidth;
}
