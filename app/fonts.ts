import localFont from 'next/font/local';
import { Cormorant_Garamond, JetBrains_Mono } from 'next/font/google';

/*
 * Every face is self-hosted and served from our own origin, so no third-party
 * stylesheet blocks the LCP heading. Each loader sets one --ff-* variable on
 * <html>; src/index.css builds --font-display/-body/-mono/-elegant from them.
 *
 * Clash Display and Satoshi are the unmodified variable WOFF2 files from
 * Fontshare, self-hosted under the ITF Free Font License 2.0 (s.01 permits
 * self-hosting for our own site; s.02 forbids modifying or subsetting them).
 */

export const clashDisplay = localFont({
  src: './fonts/ClashDisplay-Variable.woff2',
  weight: '200 700',
  style: 'normal',
  display: 'swap',
  variable: '--ff-display',
});

export const satoshi = localFont({
  src: './fonts/Satoshi-Variable.woff2',
  weight: '300 900',
  style: 'normal',
  display: 'swap',
  variable: '--ff-body',
});

// Eyebrows and code labels: small text, so a swap is invisible and a preload would compete with the LCP.
export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--ff-mono',
});

// Only the intro curtain uses it, and only at weight 300.
export const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: '300',
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
  variable: '--ff-elegant',
});

export const fontVariables = [clashDisplay, satoshi, jetbrainsMono, cormorant].map((f) => f.variable).join(' ');
