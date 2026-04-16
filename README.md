# Oikantik Basu — Portfolio

An immersive 3D portfolio website with a cinematic dark/light theme, AI-generated background video, glassmorphism UI, and an interactive Three.js cyborg hero. Data is sourced from LinkedIn (profile) and GitHub (projects); assets are generated via Meshy (3D models) and Google Gemini Veo + Imagen (video + imagery).

**Live:** https://golden007-prog.github.io/golden_protfolio_07/

## Tech Stack

- **React 19** + **TypeScript 5** + **Vite 7**
- **Tailwind CSS 4** — `@theme` / `@utility` tokens, CSS custom properties, theme-aware surfaces
- **Three.js** + **@react-three/fiber** + **@react-three/drei** + **@react-three/postprocessing** — 3D scenes, environment lighting, Bloom/ChromaticAberration/Vignette
- **Framer Motion** + **GSAP** (ScrollTrigger) — scroll reveals, transitions
- **Lenis** — smooth scroll
- **Lucide React** — icons

## Features

- **Dark / light / system** theme with distinct token sets (warm cream vs deep charcoal)
- **Interactive 3D hero cyborg** driven by mouse parallax + scroll progress
- **Per-theme background videos** (Veo 3.1 generated) — dark neon for dark mode, pastel aurora / line-art network / origami for light mode, feathered via radial CSS mask
- **Animated skills sphere** (R3F) with category filtering, skill pills, and an in-browser sentiment demo
- **Projects grid** with uniform `auto-rows-fr` cards, filter pills, and a detail modal
- **Experience timeline** with alternating glass cards
- **Contact** with a theme-aware 3D envelope and mailto form
- **Glassmorphism** system (`glass`, `glass-strong`) that flips fill/border/shadow per theme
- **Featured card** hover effect — a light-beam traces the border via `@property --beam-angle` conic-gradient animation

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install & run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build → dist/
npm run preview
npm run lint
```

### Environment

Copy `.env.example` to `.env` and fill in:

```env
GOOGLE_AI_API_KEY=...     # Gemini API key for Veo / Imagen generation scripts
VITE_GEMINI_API_KEY=...   # same key, exposed to client if needed
```

## Project Structure

```
src/
├── components/
│   ├── about/           # AboutSection, StatCard
│   ├── contact/         # ContactSection, ContactCanvas (R3F envelope)
│   ├── experience/      # ExperienceSection, TimelineCard
│   ├── hero/            # HeroSection, HeroCanvas (R3F), HeroText, ScrollNarrative
│   ├── layout/          # Navbar, Footer, SectionWrapper, ThemeToggle
│   ├── loading/         # LoadingScreen
│   ├── projects/        # ProjectsSection, ProjectCard, ProjectModal
│   ├── shared/          # GlassCard, GradientText, ScrollReveal, MagneticButton, CustomCursor
│   └── skills/          # SkillsSection, SkillSphere, SkillCard, SkillPill, SkillModal, SentimentDemo
├── contexts/            # ThemeContext (dark / light / system, resolvedTheme)
├── data/                # profile.json (LinkedIn), projects.json (GitHub)
├── hooks/               # useScrollProgress, useInView, useMousePosition
├── styles/              # design-tokens.ts
├── utils/               # animation presets
└── index.css            # Tailwind v4 @theme, glass tokens, theme scopes

public/
├── images/              # Imagen-generated backgrounds + project thumbnails (.webp)
├── models/              # Meshy GLB models (hero cyborg, envelope, tech sphere, laptop, brackets)
└── videos/              # Veo 3.1 generated backgrounds — *.mp4 (dark) + *-light.mp4

scripts/                 # Media generation + data fetch scripts
├── fetch_linkedin.py
├── generate-media.mjs         # Veo 3.1 dark-mode videos + Imagen images
├── generate-media-v2.mjs
├── generate-media-light.mjs   # Veo 3.1 Fast light-mode videos
├── regen-skills-light.mjs     # one-off regen for skills-bg-light.mp4
└── generate-skill-data.mjs
```

## Theming

Theme state lives in [src/contexts/ThemeContext.tsx](src/contexts/ThemeContext.tsx). The root element gets `data-theme="light"` or nothing (dark default). Token sets in [src/index.css](src/index.css):

- Cream (`#F7F5F0`), raised-contrast text, desaturated accents, inverted glass (white fill + dark hairline border + soft close shadows)
- Deep charcoal (`#0A0A0F`), bright accents, frosted white glass with subtle borders

Utilities `.dark-only` / `.light-only` hide elements by theme — used for per-theme background videos and heavy neon overlays.

## Asset pipeline

- **3D models (Meshy):** text-to-3D preview → refine → `.glb` → `public/models/`
- **Background videos (Veo 3.1 / Veo 3.1 Fast):** `scripts/generate-media*.mjs` — `predictLongRunning` + poll + download to `public/videos/`
- **Section imagery (Imagen 4.0):** generated inline by `scripts/generate-media.mjs` → `public/images/*.webp`
- **Profile data (LinkedIn MCP):** `scripts/fetch_linkedin.py` → `src/data/profile.json`
- **Project data (GitHub MCP):** `src/data/projects.json`

## Deployment

Configured for GitHub Pages with base path `/golden_protfolio_07/` in [vite.config.ts](vite.config.ts). Update `base` when deploying elsewhere. The build splits Three.js, R3F, and motion libs into separate chunks for cache-friendly loading.

## License

Personal project — all rights reserved.
