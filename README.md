# Oikantik Basu — Immersive 3D Portfolio

> A cinematic, immersive portfolio built with **React 19**, **Three.js**, and **AI-generated media**. Featuring glassmorphism UI, interactive 3D scenes, dual-theme support, scroll-driven animations, and an AI chatbot — all in a single-page experience.

**🌐 Live:** [basuoikantik.in](https://basuoikantik.in)

---

## ✨ Highlights

| Feature | Description |
|---|---|
| **3D Hero Scene** | Interactive cyborg model (Meshy-generated `.glb`) rendered in React Three Fiber with Bloom, Chromatic Aberration & mouse parallax |
| **Dual Theme** | Dark luxe (charcoal + neon accents) and Light mode (warm cream + desaturated tones) with system-preference detection |
| **AI Background Videos** | Per-theme looping videos generated with Google Veo 3.1 — dark neon aurora for dark mode, pastel line-art for light mode |
| **AI Section Imagery** | Backgrounds and project thumbnails generated via Google Imagen 4.0, served as optimized `.webp` |
| **Glassmorphism System** | Frosted-glass cards (`backdrop-blur`, subtle borders, layered shadows) that invert styling per theme |
| **Skills Sphere** | Orbiting 3D skill nodes in an R3F canvas with category filtering, expandable skill pills, and detailed modals with AI-generated illustrations |
| **Sentiment Demo** | In-browser NLP sentiment analysis widget embedded in the skills section |
| **Project Showcase** | Filterable grid with uniform cards, GitHub-sourced data, and a rich detail modal |
| **Experience Timeline** | Alternating glassmorphism cards on an animated vertical timeline |
| **Tools Strip** | Scrolling marquee of technology icons |
| **Philosophy Section** | Rotating quotes/principles with cinematic presentation |
| **AskMe Bot** | Built-in AI assistant that answers questions about skills, projects, experience & education |
| **Comet Cursor** | Custom animated cursor with trail effect and click ripples |
| **Bokeh Particles** | Floating bokeh orbs layered behind content for ambient depth |
| **Konami Code** | Hidden easter egg activated via the classic ↑↑↓↓←→←→BA sequence |
| **Ambient Sound** | Optional background audio toggle for immersive experience |
| **Live Status Bar** | Animated bar showing current availability / status |
| **Loading Screen** | Cinematic intro sequence shown once per session |
| **Accessibility** | Skip-to-content link, semantic HTML, `prefers-reduced-motion` respect |
| **SEO** | Open Graph + Twitter Card meta, descriptive `<title>`, structured heading hierarchy |

---

## 🛠 Tech Stack

| Layer | Technologies |
|---|---|
| **Framework** | React 19 · TypeScript 5.9 · Vite 7 |
| **Styling** | Tailwind CSS 4 (`@theme` tokens, CSS custom properties) · PostCSS · Autoprefixer |
| **3D** | Three.js 0.183 · @react-three/fiber · @react-three/drei · @react-three/postprocessing |
| **Animation** | Framer Motion 12 · GSAP 3.15 (ScrollTrigger) · Lenis (smooth scroll) |
| **Icons** | Lucide React |
| **Utilities** | clsx · tailwind-merge · react-use-measure |
| **AI Asset Gen** | Google Veo 3.1 (video) · Google Imagen 4.0 (images) · Meshy (3D `.glb` models) |
| **Data Sources** | LinkedIn (profile data) · GitHub (project data) |
| **CI/CD** | GitHub Actions → GitHub Pages |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 9+

### Install & Run

```bash
git clone https://github.com/Golden007-prog/golden_protfolio_07.git
cd golden_protfolio_07
npm install
npm run dev          # → http://localhost:5173
```

### Other Commands

```bash
npm run build        # tsc -b && vite build → dist/
npm run preview      # Preview production build locally
npm run lint         # ESLint check
```

### Environment Variables

Copy `.env.example` → `.env` and fill in:

```env
MESHY_API_KEY=           # Meshy 3D model generation
GOOGLE_AI_API_KEY=       # Gemini API (Veo / Imagen generation scripts)
STITCH_API_KEY=          # Stitch design MCP
VITE_GITHUB_USERNAME=    # GitHub username for project data
```

> **Note:** Environment variables are only required for regenerating AI assets via scripts. The site runs without them.

---

## 📁 Project Structure

```
├── index.html                      # Entry point with theme-flash prevention, SEO meta, font preloads
├── vite.config.ts                  # Vite config — conditional base path, manual chunk splitting
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.js
├── postcss.config.js
│
├── src/
│   ├── App.tsx                     # Root — loader gate, cursor, sections, overlays
│   ├── main.tsx                    # React DOM entry + ThemeProvider + Lenis
│   ├── index.css                   # Tailwind v4 @theme tokens, glass system, theme scopes
│   ├── App.css                     # Additional app-level styles
│   ├── constants.ts                # Personal info, skills, projects, experience, education, AI responses
│   │
│   ├── components/
│   │   ├── hero/
│   │   │   ├── HeroSection.tsx     # Full-viewport hero with video bg + 3D canvas + text
│   │   │   ├── HeroCanvas.tsx      # R3F canvas — cyborg model, lighting, post-processing
│   │   │   ├── HeroText.tsx        # Animated gradient title + typewriter subtitle
│   │   │   ├── ParticleField.tsx   # Background particle mesh
│   │   │   └── ScrollNarrative.tsx # Scroll-triggered narrative text
│   │   │
│   │   ├── about/
│   │   │   └── AboutSection.tsx    # Bio card, video bg, stat counters, GitHub heatmap
│   │   │
│   │   ├── skills/
│   │   │   ├── SkillsSection.tsx   # Category tabs + skill sphere + pills
│   │   │   ├── SkillSphere.tsx     # 3D orbiting skill nodes (R3F)
│   │   │   ├── SkillCard.tsx       # Individual skill cards
│   │   │   ├── SkillPill.tsx       # Clickable skill tag pills
│   │   │   ├── SkillModal.tsx      # Full detail modal with AI-generated illustrations
│   │   │   └── SentimentDemo.tsx   # In-browser NLP sentiment analysis
│   │   │
│   │   ├── projects/
│   │   │   ├── ProjectsSection.tsx # Filterable project grid
│   │   │   ├── ProjectCard.tsx     # Glass project card
│   │   │   ├── ProjectModal.tsx    # Detailed project overlay
│   │   │   └── ProjectSlider.tsx   # Horizontal project slider
│   │   │
│   │   ├── experience/
│   │   │   └── ExperienceSection.tsx  # Vertical timeline with alternating cards
│   │   │
│   │   ├── contact/
│   │   │   └── ContactSection.tsx  # Glass form + social links + 3D envelope
│   │   │
│   │   ├── layout/
│   │   │   ├── Navbar.tsx          # Floating glass navbar with scroll progress
│   │   │   └── Footer.tsx          # Minimal footer with credits
│   │   │
│   │   ├── loading/
│   │   │   └── LoadingScreen.tsx   # Cinematic intro loader (once per session)
│   │   │
│   │   └── shared/
│   │       ├── GlassCard.tsx       # Reusable glassmorphism card
│   │       ├── GradientText.tsx    # Animated gradient text
│   │       ├── ScrollReveal.tsx    # Scroll-triggered reveal wrapper
│   │       ├── MagneticButton.tsx  # Magnetic hover effect button
│   │       ├── Magnetic.tsx        # Magnetic wrapper utility
│   │       ├── SectionHeading.tsx  # Consistent section heading component
│   │       ├── CometCursor.tsx     # Custom animated comet cursor
│   │       ├── BokehParticles.tsx  # Floating ambient bokeh orbs
│   │       ├── AskMeBot.tsx        # AI chat assistant widget
│   │       ├── AmbientSoundToggle.tsx  # Background audio toggle
│   │       ├── LiveStatusBar.tsx   # Animated availability status bar
│   │       ├── KonamiCode.tsx      # Easter egg (↑↑↓↓←→←→BA)
│   │       ├── ToolsStrip.tsx      # Scrolling tools/tech marquee
│   │       ├── PhilosophySection.tsx   # Rotating philosophy quotes
│   │       ├── ThemeToggle.tsx     # Dark / Light / System theme switcher
│   │       ├── GlitchText.tsx      # Glitch text animation effect
│   │       ├── GitHubHeatmap.tsx   # GitHub contribution heatmap
│   │       ├── LeetCodeHeatmap.tsx # LeetCode activity heatmap
│   │       └── ReadingList.tsx     # Current reading list display
│   │
│   ├── contexts/
│   │   └── ThemeContext.tsx        # Theme state (dark / light / system + resolvedTheme)
│   │
│   ├── data/
│   │   ├── profile.json           # LinkedIn-sourced profile data
│   │   ├── projects.json          # GitHub-sourced project data
│   │   ├── reading.json           # Current reading list
│   │   └── skills-detailed.json   # AI-generated detailed skill descriptions + images
│   │
│   ├── hooks/
│   │   ├── useScrollProgress.ts   # Scroll percentage tracker
│   │   ├── useScrollReveal.ts     # GSAP scroll reveal hook
│   │   ├── useInView.ts           # Intersection observer
│   │   ├── useInViewAnimation.ts  # In-view animation trigger
│   │   └── useMousePosition.ts    # Mouse parallax tracking
│   │
│   ├── styles/
│   │   └── design-tokens.ts       # Design system tokens (colors, gradients, typography, motion)
│   │
│   ├── types/
│   │   └── skills.ts              # TypeScript interfaces for skill data
│   │
│   └── utils/
│       └── cn.ts                  # clsx + tailwind-merge utility
│
├── public/
│   ├── ob-logo.svg                # Favicon / logo
│   ├── oikantik_basu_u.pdf        # Downloadable CV
│   ├── models/                    # Meshy-generated 3D assets (9 GLB files, ~128 MB)
│   │   ├── hero-character.glb     # Cyborg character for hero section
│   │   ├── Meshy_AI_*.glb         # Alternative hero model
│   │   ├── floating-laptop.glb    # Laptop model
│   │   ├── tech-sphere.glb        # Abstract tech sphere
│   │   ├── code-brackets.glb      # { } code brackets
│   │   ├── envelope.glb           # Contact envelope
│   │   ├── holo-envelope.glb      # Holographic envelope variant
│   │   ├── laptop-holo.glb        # Holographic laptop variant
│   │   └── neural-brain.glb       # Neural network brain model
│   │
│   ├── videos/                    # Veo 3.1 generated backgrounds (7 videos)
│   │   ├── hero-bg.mp4            # Dark mode hero background
│   │   ├── hero-bg-light.mp4      # Light mode hero background
│   │   ├── about-bg.mp4           # About section background
│   │   ├── skills-bg.mp4          # Skills dark background
│   │   ├── skills-bg-light.mp4    # Skills light background
│   │   ├── contact-bg.mp4         # Contact dark background
│   │   └── contact-bg-light.mp4   # Contact light background
│   │
│   ├── images/                    # Imagen 4.0 generated images (16 WebP files)
│   │   ├── skills-bg.webp         # Skills section background
│   │   ├── skills-neural.webp     # Neural network visualization
│   │   ├── about-workspace.webp   # About section workspace image
│   │   ├── timeline-decoration.webp
│   │   ├── contact-bg.webp
│   │   ├── footer-texture.webp
│   │   └── project-thumb-{1-10}.webp  # Project card thumbnails
│   │
│   └── skills/                    # AI-generated skill illustrations (47 WebP files)
│       ├── python.webp, pytorch.webp, tensorflow.webp, ...
│       └── (one illustration per skill for modals)
│
├── scripts/                       # Asset generation & data fetch scripts
│   ├── generate-media.mjs         # Veo 3.1 + Imagen dark-mode assets
│   ├── generate-media-v2.mjs      # V2 generation pipeline
│   ├── generate-media-light.mjs   # Veo 3.1 light-mode videos
│   ├── regen-skills-light.mjs     # Skills light video regeneration
│   ├── generate-skill-data.mjs    # AI skill descriptions + image gen
│   ├── fetch_linkedin.py          # LinkedIn profile data fetcher
│   └── fix-mojibake.mjs           # Encoding fix utility
│
└── .github/workflows/
    └── deploy.yml                 # GitHub Actions → GitHub Pages deploy
```

---

## 🎨 Design System

The portfolio uses a **glassmorphism + dark luxury** aesthetic inspired by [worldquantfoundry.com](https://worldquantfoundry.com), [wam.global](https://wam.global), and [scalify.ai](https://scalify.ai).

### Color Palette

| Role | Dark Mode | Light Mode |
|---|---|---|
| Background | `#0A0A0F` → `#111118` | `#F7F5F0` (warm cream) |
| Glass Fill | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.7)` |
| Primary Accent | `#7C3AED → #A855F7` (violet) | Desaturated variants |
| Secondary Accent | `#06B6D4 → #22D3EE` (cyan) | Desaturated variants |
| Warm Accent | `#F59E0B` (amber) | — |
| Text | `#FAFAFA` / `#94A3B8` | High-contrast dark text |

### Typography

- **Display:** Oswald / Playfair Display (hero headlines)
- **Body:** Inter (clean sans-serif)
- **Code:** JetBrains Mono (labels, badges)

Full design tokens in [`src/styles/design-tokens.ts`](src/styles/design-tokens.ts) and [`DESIGN.md`](DESIGN.md).

---

## 🎬 AI Asset Pipeline

All visual assets are AI-generated. Regenerate them using the scripts in `scripts/`:

| Asset Type | Tool | Script | Output |
|---|---|---|---|
| 3D Models | Meshy | Manual via Meshy MCP | `public/models/*.glb` |
| Dark Videos | Veo 3.1 | `generate-media.mjs` | `public/videos/*-bg.mp4` |
| Light Videos | Veo 3.1 Fast | `generate-media-light.mjs` | `public/videos/*-light.mp4` |
| Section Images | Imagen 4.0 | `generate-media.mjs` | `public/images/*.webp` |
| Skill Illustrations | Imagen 4.0 | `generate-skill-data.mjs` | `public/skills/*.webp` |
| Profile Data | LinkedIn MCP | `fetch_linkedin.py` | `src/data/profile.json` |
| Project Data | GitHub MCP | Manual via GitHub MCP | `src/data/projects.json` |

---

## 🚢 Deployment

The site is deployed via **GitHub Actions** to **GitHub Pages** on every push to `main`.

- **Workflow:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- **Base path:** Conditional — `/golden_protfolio_07/` on GitHub Actions, `/` locally
- **Chunk splitting:** Three.js, R3F, and motion libraries are split into separate cached chunks
- **Custom domain:** `basuoikantik.in`

### Deploy manually

```bash
npm run build
# Upload dist/ to any static host
```

---

## ⚡ Performance

- **Code splitting:** Dynamic imports for heavy 3D sections
- **3D lazy loading:** `React.lazy` + `<Suspense>` with `useGLTF.preload()`
- **Video lazy loading:** IntersectionObserver triggers, poster images
- **Image format:** All images served as optimized WebP
- **Smooth scroll:** Lenis for 60fps scroll experience
- **Reduced motion:** Respects `prefers-reduced-motion` media query

---

## 📄 License

Personal project — all rights reserved.

---

<p align="center">
  Built with ❤️ by <a href="https://basuoikantik.in">Oikantik Basu</a>
</p>
