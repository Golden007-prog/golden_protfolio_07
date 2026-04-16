# Oikantik Portfolio — Design System

> Glassmorphism + Dark Luxury + Cinematic motion. Inspired by worldquantfoundry.com, wam.global, scalify.ai. Dark-mode only.

## Palette

| Role | Token | Hex / Value |
|---|---|---|
| Background base | `colors.bg.base` | `#0A0A0F` |
| Background surface | `colors.bg.surface` | `#0D0D14` |
| Background elevated | `colors.bg.elevated` | `#111118` |
| Glass fill | `colors.glass.fill` | `rgba(255,255,255,0.03)` |
| Glass border | `colors.glass.border` | `rgba(255,255,255,0.08)` |
| Accent (primary) | `colors.accent.violet` → `violetBright` | `#7C3AED → #A855F7` |
| Accent (secondary) | `colors.accent.cyan` → `cyanBright` | `#06B6D4 → #22D3EE` |
| Accent (warm) | `colors.accent.amber` | `#F59E0B` |
| Text primary | `colors.text.primary` | `#FAFAFA` |
| Text muted | `colors.text.muted` | `#94A3B8` |

Aurora glow backgrounds use layered radial gradients (violet 15% / cyan 10% / pink 8%), see `gradients.aurora`.

## Typography

- **Display** — Clash Display / Cabinet Grotesk, 900 weight, tight tracking (`-0.03em`), leading 1.05. Hero uses `clamp(4rem, 14vw, 13rem)`.
- **Body** — Satoshi / General Sans, 400–500, leading 1.5–1.7.
- **Mono** — JetBrains Mono / Space Mono, used for labels, badges, code.

Load via Google Fonts `@import` in `index.css`.

## Glassmorphism System

Every card follows this base pattern:

```css
background: rgba(255, 255, 255, 0.03);
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 1rem;
box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
```

Hover / active states lift to `glass.fillStrong` + `borderStrong` + `shadow.glassLg` and optional glow (`shadow.glowViolet` / `shadow.glowCyan`).

## Motion

- Easing: `power3.out` / `cubic-bezier(0.16, 1, 0.3, 1)` for reveals; spring for interactive.
- Section reveals: GSAP `ScrollTrigger`, y: 80 → 0, opacity 0 → 1, 1.2s.
- Staggered children: 0.08–0.12s offset.
- Navbar: backdrop blur escalates on scroll.
- Cards: perspective tilt (`rotateY ±6°`) on hover.
- Stat counters: count-up when `IntersectionObserver` fires.
- Custom cursor: mix-blend-difference, scales 1 → 2 on interactive targets.

## 3D / R3F Pattern

Every Canvas:

- Camera: `fov: 45`, pos `[0,0,5]`.
- Lighting: `<ambientLight intensity={0.2}/>` + violet `#7C3AED` pointLight + cyan `#06B6D4` fill.
- Post: `<Bloom intensity={1.5} luminanceThreshold={0.2}/>` + `<ChromaticAberration offset={[0.0005,0.0005]}/>`.
- Wrap models in `<Float>` + `<PresentationControls global>`.
- Lazy load with `React.lazy` + `<Suspense>`; preload via `useGLTF.preload(path)`.

## Layout

- Section vertical rhythm: `clamp(5rem, 10vw, 9rem)`.
- Container horizontal padding: `clamp(1.25rem, 5vw, 6rem)`.
- Max content width: 1440px center-aligned.
- Every section has an aurora background layer + content layer + optional 3D layer.

## Section Blueprint

1. **Hero** — 3D character in R3F canvas + animated gradient title + typewriter subtitle + particle field + video background @ 30% opacity.
2. **About** — Split: video bg left / glass bio card right + 3 stat counters.
3. **Skills** — Orbiting 3D skill sphere + category tabs + expandable skill cards.
4. **Projects** — Perspective-tilt carousel of glass cards, filter pills, detail modal.
5. **Experience** — Vertical timeline, alternating cards, animated connection line.
6. **Contact** — Glass form with glowing borders + floating envelope 3D + social magnet buttons.
7. **Nav** — Floating pill navbar, scroll progress bar, active-section indicator.

## Tokens

Machine-readable tokens in `src/styles/design-tokens.ts`. Import via:

```ts
import { colors, gradients, typography, motion } from '@/styles/design-tokens';
```

Tailwind 4 CSS variables mirror the same values in `src/index.css` under `@theme`.
