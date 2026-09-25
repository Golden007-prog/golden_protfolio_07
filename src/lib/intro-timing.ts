/**
 * The intro curtain's wall-clock cap, measured from window.__navStart. The head
 * bootstrap enforces it before hydration and LoadingScreen after, so a phone that
 * hydrates late never keeps the curtain up past it.
 */
export const INTRO_CAP_MS = 1400;
