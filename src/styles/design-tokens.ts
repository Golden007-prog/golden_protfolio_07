/**
 * Oikantik Portfolio — Design Tokens
 * Glassmorphism + Dark Luxury + Cinematic
 * Inspired by worldquantfoundry.com, wam.global, scalify.ai
 */

export const colors = {
  bg: {
    base: '#0A0A0F',
    surface: '#0D0D14',
    elevated: '#111118',
    overlay: 'rgba(10, 10, 15, 0.72)',
  },
  glass: {
    fill: 'rgba(255, 255, 255, 0.03)',
    fillStrong: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.14)',
    innerHighlight: 'rgba(255, 255, 255, 0.05)',
  },
  accent: {
    violet: '#7C3AED',
    violetBright: '#A855F7',
    cyan: '#06B6D4',
    cyanBright: '#22D3EE',
    amber: '#F59E0B',
    pink: '#EC4899',
  },
  text: {
    primary: '#FAFAFA',
    secondary: '#CBD5E1',
    muted: '#94A3B8',
    dim: '#64748B',
  },
} as const;

export const gradients = {
  violet: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
  cyan: 'linear-gradient(135deg, #06B6D4 0%, #22D3EE 100%)',
  violetCyan: 'linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)',
  text: 'linear-gradient(135deg, #FAFAFA 0%, #A855F7 50%, #22D3EE 100%)',
  aurora: [
    'radial-gradient(ellipse at 20% 50%, rgba(124, 58, 237, 0.15), transparent 50%)',
    'radial-gradient(ellipse at 80% 20%, rgba(6, 182, 212, 0.10), transparent 50%)',
    'radial-gradient(ellipse at 50% 80%, rgba(236, 72, 153, 0.08), transparent 50%)',
  ].join(', '),
} as const;

export const typography = {
  display: '"Clash Display", "Cabinet Grotesk", system-ui, sans-serif',
  body: '"Satoshi", "General Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Space Mono", ui-monospace, monospace',
  scale: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '2rem',
    '4xl': '2.75rem',
    '5xl': '3.75rem',
    '6xl': '5rem',
    '7xl': '7rem',
    display: 'clamp(4rem, 14vw, 13rem)',
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    black: 900,
  },
  leading: { tight: 1.05, snug: 1.2, normal: 1.5, relaxed: 1.7 },
  tracking: { tight: '-0.03em', snug: '-0.01em', normal: '0', wide: '0.05em' },
} as const;

export const spacing = {
  section: 'clamp(5rem, 10vw, 9rem)',
  container: 'clamp(1.25rem, 5vw, 6rem)',
  stack: { xs: '0.5rem', sm: '1rem', md: '1.5rem', lg: '2.5rem', xl: '4rem', '2xl': '6rem' },
} as const;

export const radius = {
  sm: '0.5rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.25rem',
  '2xl': '1.75rem',
  pill: '9999px',
} as const;

export const shadow = {
  glass: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
  glassLg: '0 24px 64px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
  glowViolet: '0 0 40px rgba(124, 58, 237, 0.35)',
  glowCyan: '0 0 40px rgba(6, 182, 212, 0.30)',
} as const;

export const blur = {
  glass: '20px',
  glassHeavy: '32px',
  overlay: '8px',
} as const;

export const motion = {
  ease: {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  duration: { fast: 0.25, base: 0.5, slow: 0.9, cinematic: 1.2 },
} as const;

export const z = {
  base: 0,
  content: 10,
  overlay: 40,
  nav: 50,
  cursor: 60,
  modal: 70,
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const tokens = { colors, gradients, typography, spacing, radius, shadow, blur, motion, z, breakpoints };
export default tokens;
