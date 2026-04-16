# CLAUDE.md — Oikantik Basu Portfolio: Immersive 3D Motion Website

> **Project**: Next-gen personal portfolio with 3D assets, AI-generated media, glassmorphism UI, and cinematic motion design.
> **Stack**: React 19 + TypeScript 5 + Vite 7 + Tailwind CSS 4 + Three.js/React Three Fiber + Framer Motion + GSAP
> **Design DNA**: Glassmorphism + Dark luxury + Cinematic parallax (inspired by worldquantfoundry.com, wam.global, scalify.ai)

---

## 🎯 PROJECT VISION

Build the **most visually stunning personal portfolio website** that combines:
- **3D interactive models** (generated via Meshy MCP → `.glb` files rendered in Three.js)
- **AI-generated hero videos** (via Google Gemini Veo 3.1 API)
- **AI-generated section imagery** (via Google Gemini Imagen 4.0 API)
- **Glassmorphism + dark theme** with frosted glass cards, aurora gradients, and depth layers
- **Cinematic scroll animations** with GSAP ScrollTrigger and Framer Motion
- **Dynamic content** pulled from LinkedIn MCP and GitHub MCP

---

## 🏗️ ARCHITECTURE — AGENT WORKFLOW (Sequential)

Execute these phases IN ORDER. Each phase builds on the previous.

### PHASE 0: PREREQUISITES & ENV SETUP

```bash
# Create project
npm create vite@latest oikantik-portfolio -- --template react-ts
cd oikantik-portfolio

# Core dependencies
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing
npm install framer-motion gsap @gsap/react
npm install lucide-react
npm install tailwindcss @tailwindcss/vite

# Dev dependencies
npm install -D @types/three
```

Create `.env` file:
```env
VITE_GEMINI_API_KEY=<USER_MUST_PROVIDE>
VITE_GITHUB_USERNAME=Golden007
VITE_LINKEDIN_PROFILE_URL=<USER_MUST_PROVIDE>
```

### PHASE 1: DESIGN SYSTEM (Stitch MCP)

**Action**: Use the Stitch MCP to create a new Stitch project called "Oikantik Portfolio 3D".

**Stitch Prompt** (paste this into the Stitch project using Gemini 3.1 Pro):

```
Create a premium dark-theme portfolio website for a software developer named Oikantik Basu.

Design style: Glassmorphism + Cinematic Dark Luxury, inspired by worldquantfoundry.com, wam.global, and scalify.ai.

Color palette:
- Background: Deep charcoal blacks (#0A0A0F, #0D0D14, #111118)
- Glass cards: rgba(255,255,255,0.03) with backdrop-blur(20px) and 1px border rgba(255,255,255,0.08)
- Primary accent: Electric violet (#7C3AED → #A855F7 gradient)
- Secondary accent: Cyan (#06B6D4 → #22D3EE gradient)
- Warm accent: Amber (#F59E0B)
- Text: White (#FAFAFA) and muted gray (#94A3B8)
- Aurora glow effects: Radial gradients with purple/cyan/pink at 10-15% opacity

Screens to design:

1. HERO SECTION (Full viewport)
   - Massive 3D model viewer area (center, 60% of viewport)
   - Title: "Oikantik Basu" in an ultra-bold display font (200px+)
   - Subtitle text that types out character by character
   - Floating glassmorphism nav bar at top
   - Scroll indicator at bottom with pulse animation
   - Background: Animated particle mesh / aurora gradient

2. ABOUT SECTION
   - Split layout: Left = AI-generated video background, Right = Glass card with bio
   - Floating stats cards (Projects, Experience, Tech Stack count)
   - LinkedIn-sourced profile data

3. SKILLS SECTION
   - Interactive 3D radar/sphere of skill nodes
   - Glassmorphism skill cards that expand on hover
   - Category tabs: Frontend, Backend, DevOps, AI/ML
   - Animated progress indicators

4. PROJECTS SECTION
   - Horizontal scroll carousel with perspective tilt
   - Each project card: Glass card with screenshot, GitHub README excerpt
   - 3D model preview for featured projects
   - Filter pills at top
   - Detail modal with full description

5. EXPERIENCE TIMELINE
   - Vertical timeline with alternating glass cards
   - Animated connection lines
   - Company logos and role badges
   - Date range with duration calculation

6. CONTACT SECTION
   - Glassmorphism form with glowing input borders
   - 3D floating envelope/message model
   - Social links with hover 3D transforms
   - Background: Subtle particle effect

7. NAVIGATION
   - Floating glassmorphism navbar
   - Progress indicator showing scroll position
   - Hamburger menu for mobile with slide-out panel
   - Active section highlighting

Design requirements:
- All cards use glassmorphism: frosted glass with subtle borders
- Generous whitespace between sections
- Smooth scroll-triggered reveal animations
- Typography: Use a combination of display serif + clean sans-serif
- Every section transition has a gradient divider or wave SVG
- Responsive: Desktop-first, mobile-optimized
- Dark mode only
```

**After Stitch generates the design**:
```
Use the Stitch MCP to:
1. Fetch the 'Oikantik Portfolio 3D' project
2. Extract the color palette, typography, spacing tokens, and component styles
3. Generate a DESIGN_TOKENS.ts file with all CSS variables and theme constants
4. Download each screen's HTML/CSS for reference
5. Create a DESIGN.md documenting the complete design system
```

### PHASE 2: DATA COLLECTION (LinkedIn + GitHub MCPs)

#### 2A: LinkedIn MCP — Profile Data
```
Use the LinkedIn MCP to:
1. Fetch Oikantik Basu's profile information
2. Extract: Name, headline, summary/about, current position, education, skills list, certifications
3. Save as src/data/profile.json with this structure:
{
  "name": "...",
  "headline": "...",
  "about": "...",
  "experience": [{ "company": "...", "role": "...", "duration": "...", "description": "..." }],
  "education": [{ "institution": "...", "degree": "...", "year": "..." }],
  "skills": ["..."],
  "certifications": ["..."]
}
```

#### 2B: GitHub MCP — Project Data
```
Use the GitHub MCP to:
1. List all public repositories for user 'Golden007'
2. For EACH repository:
   a. Read the README.md file
   b. Extract: repo name, description, language, stars, forks, topics/tags
   c. Generate a SHORT 2-3 sentence description from the README content
   d. Get the repo's primary language and tech stack from package.json/requirements.txt if available
3. Save as src/data/projects.json with this structure:
[{
  "name": "...",
  "shortDescription": "...(generated from README)...",
  "fullDescription": "...(first 500 chars of README)...",
  "language": "...",
  "techStack": ["..."],
  "stars": 0,
  "forks": 0,
  "topics": ["..."],
  "githubUrl": "...",
  "liveUrl": "...(if found in README)..."
}]
```

### PHASE 3: 3D ASSET GENERATION (Meshy MCP)

Generate these 3D models using the Meshy MCP. For each, create a text-to-3D task, wait for completion, then download the `.glb` file to `public/models/`.

```
Use the Meshy MCP to generate the following 3D models:

MODEL 1 — Hero Avatar/Character
Prompt: "Stylized low-poly developer character, sitting at a futuristic holographic workstation, cyberpunk style, glowing purple and cyan accents, dark background optimized, clean topology"
Format: GLB
Style: Low poly / Stylized
Save to: public/models/hero-character.glb

MODEL 2 — Floating Laptop
Prompt: "Modern ultrabook laptop, slightly open at 120 degrees, holographic screen glow, minimal design, dark matte finish with subtle purple LED accents, floating in space"
Format: GLB
Style: Realistic
Save to: public/models/floating-laptop.glb

MODEL 3 — Abstract Tech Sphere
Prompt: "Abstract geometric sphere made of interconnected wireframe nodes and edges, neural network visualization, glowing cyan and purple nodes, dark background, particle effects"
Format: GLB
Style: Abstract
Save to: public/models/tech-sphere.glb

MODEL 4 — Contact Envelope
Prompt: "3D envelope icon, slightly open with glowing letter inside, holographic glassmorphism material, transparent with purple glow edges, floating"
Format: GLB
Style: Stylized
Save to: public/models/envelope.glb

MODEL 5 — Code Brackets
Prompt: "3D typography of curly braces { } code brackets, metallic chrome finish with neon purple inner glow, developer symbol, floating in space"
Format: GLB
Style: Stylized
Save to: public/models/code-brackets.glb

For each model:
1. Use create_text_to_3d_task with mode "preview" first
2. Wait for task completion (poll every 10 seconds)
3. If preview looks good, refine with mode "refine" for higher quality
4. Download the GLB file from the model_urls
5. Save to the specified path
```

### PHASE 4: AI MEDIA GENERATION (Google Gemini API)

Create a utility script `scripts/generate-media.ts` that uses the Gemini API directly.

#### 4A: Video Generation (Veo 3.1)
```typescript
// scripts/generate-media.ts
// Generate hero background video using Veo 3.1

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// VIDEO 1: Hero Section Background
async function generateHeroVideo() {
  const response = await fetch(
    `${BASE_URL}/models/veo-3.1-generate-preview:generateVideos`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY!
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Abstract dark cosmic environment with slowly moving aurora borealis in purple, cyan, and deep blue colors. Floating geometric particles and light streaks. Subtle depth of field. Cinematic, moody, perfect for a dark website background. No text, no people. 8 seconds, seamless loop potential."
          }]
        }],
        parameters: {
          aspectRatio: "16:9",
          resolution: "1080p"
        }
      })
    }
  );
  
  const operation = await response.json();
  // Poll operation.name until done, then download video
  // Save to: public/videos/hero-bg.mp4
}

// VIDEO 2: About Section Background
async function generateAboutVideo() {
  // Prompt: "Close-up of holographic code scrolling on a transparent glass display, purple and cyan syntax highlighting, shallow depth of field, dark ambient lighting, futuristic developer workspace. No faces. 8 seconds."
  // Save to: public/videos/about-bg.mp4
}
```

#### 4B: Image Generation (Imagen 4.0)
```typescript
// Generate section backgrounds and decorative images

// IMAGE 1: Skills Section Background
// Model: imagen-4.0-generate-001
// Prompt: "Abstract neural network visualization, dark background, glowing nodes connected by thin luminous lines in purple and cyan, depth of field, 16:9 aspect ratio, dark theme, no text"
// Save to: public/images/skills-bg.webp

// IMAGE 2: Experience Section Decoration  
// Model: imagen-4.0-ultra-generate-001
// Prompt: "Futuristic timeline visualization, vertical glowing line with holographic data points, dark cosmic background, purple and cyan accents, abstract, no text, 9:16 aspect ratio"
// Save to: public/images/timeline-decoration.webp

// IMAGE 3: Project Card Fallback Thumbnails (generate 4)
// Model: imagen-4.0-fast-generate-001
// Prompts: Generate abstract tech-themed thumbnails for project cards
// Save to: public/images/project-thumb-{1-4}.webp

// IMAGE 4: Contact Section Background
// Model: imagen-4.0-generate-001
// Prompt: "Abstract communication concept, glowing message bubbles and envelope shapes floating in dark space, purple and teal gradients, minimal, no text"
// Save to: public/images/contact-bg.webp
```

### PHASE 5: WEBSITE IMPLEMENTATION

Now build the actual website. Follow these architectural patterns:

#### 5A: Project Structure
```
src/
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx              # Floating glass navbar
│   │   ├── Footer.tsx              # Minimal footer
│   │   └── SectionWrapper.tsx      # Scroll animation wrapper
│   ├── hero/
│   │   ├── HeroSection.tsx         # Main hero with 3D scene
│   │   ├── HeroCanvas.tsx          # R3F canvas for 3D models
│   │   ├── HeroText.tsx            # Animated title + subtitle
│   │   └── ParticleField.tsx       # Background particles
│   ├── about/
│   │   ├── AboutSection.tsx        # About with video bg
│   │   └── StatCard.tsx            # Animated stat counters
│   ├── skills/
│   │   ├── SkillsSection.tsx       # Skills container
│   │   ├── SkillSphere.tsx         # 3D skill sphere (R3F)
│   │   └── SkillCard.tsx           # Individual skill cards
│   ├── projects/
│   │   ├── ProjectsSection.tsx     # Projects carousel
│   │   ├── ProjectCard.tsx         # Glass project card
│   │   └── ProjectModal.tsx        # Detail modal
│   ├── experience/
│   │   ├── ExperienceSection.tsx   # Timeline section
│   │   └── TimelineCard.tsx        # Individual timeline entry
│   ├── contact/
│   │   ├── ContactSection.tsx      # Contact form
│   │   └── ContactCanvas.tsx       # 3D envelope scene
│   └── shared/
│       ├── GlassCard.tsx           # Reusable glass card component
│       ├── GradientText.tsx        # Animated gradient text
│       ├── ScrollReveal.tsx        # Scroll-triggered animation wrapper
│       ├── MagneticButton.tsx      # Magnetic hover effect button
│       └── CustomCursor.tsx        # Custom cursor component
├── hooks/
│   ├── useScrollProgress.ts       # Scroll percentage tracker
│   ├── useInView.ts               # Intersection observer hook
│   └── useMousePosition.ts        # Mouse parallax hook
├── data/
│   ├── profile.json               # LinkedIn data (Phase 2)
│   └── projects.json              # GitHub data (Phase 2)
├── styles/
│   └── design-tokens.ts           # Stitch design tokens
├── utils/
│   └── animations.ts              # GSAP/Framer presets
├── App.tsx
├── main.tsx
└── index.css
```

#### 5B: Key Implementation Guidelines

**Glassmorphism System:**
```css
/* Base glass card */
.glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* Aurora glow background effect */
.aurora {
  background: 
    radial-gradient(ellipse at 20% 50%, rgba(124, 58, 237, 0.15), transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(6, 182, 212, 0.1), transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(236, 72, 153, 0.08), transparent 50%);
}
```

**3D Scene Pattern (React Three Fiber):**
```tsx
import { Canvas } from '@react-three/fiber'
import { useGLTF, Float, Environment, PresentationControls } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'

function HeroModel() {
  const { scene } = useGLTF('/models/hero-character.glb')
  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
      <primitive object={scene} scale={1.5} />
    </Float>
  )
}

function HeroCanvas() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} color="#7C3AED" intensity={1} />
      <pointLight position={[-10, -10, -10]} color="#06B6D4" intensity={0.5} />
      <PresentationControls
        global speed={1.5} zoom={0.7}
        polar={[-0.1, Math.PI / 4]}
      >
        <HeroModel />
      </PresentationControls>
      <Environment preset="night" />
      <EffectComposer>
        <Bloom luminanceThreshold={0.2} intensity={1.5} />
        <ChromaticAberration offset={[0.0005, 0.0005]} />
      </EffectComposer>
    </Canvas>
  )
}
```

**Scroll Animation Pattern (GSAP):**
```tsx
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

function SectionWrapper({ children, id }: { children: React.ReactNode; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  
  useGSAP(() => {
    gsap.from(ref.current, {
      y: 80,
      opacity: 0,
      duration: 1.2,
      ease: "power3.out",
      scrollTrigger: {
        trigger: ref.current,
        start: "top 80%",
        end: "top 20%",
        toggleActions: "play none none reverse"
      }
    })
  }, { scope: ref })

  return <section ref={ref} id={id}>{children}</section>
}
```

**Video Background Pattern:**
```tsx
function VideoBackground({ src }: { src: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        autoPlay muted loop playsInline
        className="w-full h-full object-cover opacity-30"
      >
        <source src={src} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F] via-transparent to-[#0A0A0F]" />
    </div>
  )
}
```

### PHASE 6: DOCUMENTATION (Notion MCP)

```
Use the Notion MCP to create a documentation page:

Title: "Oikantik Basu Portfolio — Technical Documentation"

Structure:
1. Overview — Project description, tech stack, architecture diagram
2. Design System — Colors, typography, spacing, component library
3. 3D Assets — List of Meshy-generated models with prompts used
4. AI Media — List of Gemini-generated videos and images with prompts
5. Data Sources — LinkedIn and GitHub integration details
6. Deployment — Build and deploy instructions
7. Performance — Lighthouse metrics targets (90+ on all)
8. Future Enhancements — Planned features and improvements

Include:
- The Stitch design reference screenshots
- Code snippets for key patterns
- Environment variable reference
- MCP server configuration for maintenance
```

---

## 🔧 MCP SERVER REFERENCE

| MCP Server | Purpose | Key Tools |
|---|---|---|
| **Stitch** | UI/UX design generation | `create_screen`, `get_screen_code`, `build_site` |
| **Meshy** | 3D model generation (.glb) | `create_text_to_3d_task`, `retrieve_text_to_3d_task`, `stream_text_to_3d_task` |
| **LinkedIn** | Profile & experience data | Profile fetch, skills, experience |
| **GitHub** | Project repos & READMEs | Repo list, file read, README parse |
| **Notion** | Documentation | `create-pages`, `update-page` |

## 📐 DESIGN REFERENCE SITES

Study these for motion and layout patterns:
- **worldquantfoundry.com**: Dark luxury, team carousels, smooth scroll reveals, editorial typography
- **wam.global**: Video backgrounds, case study sliders, brand logo marquees, bold typography
- **scalify.ai**: Interactive wizard UI, glass cards, step animations, 3D robot mascot, currency bill animation

## ⚡ PERFORMANCE TARGETS

- Lighthouse: 90+ all categories
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- 3D models: Lazy load, use `Suspense` + `useGLTF.preload()`
- Videos: Lazy load with IntersectionObserver, poster images
- Images: WebP format, responsive srcsets
- Code split: Dynamic imports for heavy sections

## 🚫 ANTI-PATTERNS TO AVOID

- Generic Inter/Roboto fonts — use distinctive display fonts from Google Fonts (e.g., Cabinet Grotesk, Clash Display, Satoshi, Space Mono for code)
- Purple gradient on white background — we're dark theme ONLY
- Static layouts — everything should have scroll-triggered animation
- Placeholder content — all data comes from LinkedIn/GitHub MCPs
- Unoptimized 3D — always use `<Suspense>` with loading fallbacks, draco compression
- Browser-blocking video — always use lazy loading + poster images
