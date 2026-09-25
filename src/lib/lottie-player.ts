/*
 * The Lottie player chunk's entry. LottieIcon loads it with import(); it must not
 * call import('lottie-react') itself. A dynamic import keeps every export of the
 * module it names, and lottie-react's index re-exports Lottie, LottieSvg and
 * LottieLight, which pull in all three lottie-web engines (full, svg, light:
 * about 745 kB of which the icons ran 18%). A static named re-export lets the
 * bundler follow it past the side-effect-free index (lottie-react declares
 * sideEffects: false) to LottieLight alone, so only lottie_light.js ships.
 * Keep this file to this one re-export: every export added here ships in the chunk.
 */
export { LottieLight } from 'lottie-react';
