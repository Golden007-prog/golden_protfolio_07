# Oikantik Basu — portfolio

The personal site of Oikantik Basu, live at **[www.basuoikantik.in](https://www.basuoikantik.in)**. It is a single scrolling page (hero, about, skills, projects, experience, principles, contact) with static case-study pages for the projects that have one. It runs on Next.js 16 (App Router, Turbopack) on Vercel, with React 19, Tailwind CSS 4, framer-motion and GSAP for motion, and React Three Fiber for the 3D scenes.

All copy comes from the data files in `src/data/` (the profile, projects and skills), so changing a fact there changes it everywhere it appears, including the page title, the social cards, the JSON-LD and the vCard.

## Stack

| Layer | What is used |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack), React 19.2, TypeScript 5.9 |
| Styling | Tailwind CSS 4 with design tokens in `src/index.css`; one stylesheet per feature in `src/styles/features/` |
| Motion | framer-motion 12, GSAP 3 (ScrollTrigger), Lenis smooth scroll, Lottie via lottie-react's light build |
| 3D | three 0.183, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing 3 |
| Fonts | Self-hosted with `next/font`: Clash Display and Satoshi (local files), JetBrains Mono and Cormorant Garamond (Google Fonts, downloaded at build time) |
| Hosting | Vercel, with Vercel Analytics and Speed Insights |
| Tests | Node's built-in test runner for pure modules, Playwright for the browser, Lighthouse in CI |

## Getting started

You need Node.js 20.9 or newer (CI uses Node 24).

```bash
git clone https://github.com/Golden007-prog/golden_protfolio_07.git
cd golden_protfolio_07
npm ci
npm run dev          # http://localhost:3000
```

No environment variables are needed to run the site locally.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000. |
| `npm run build` | Production build into `.next/`. |
| `npm start` | Serves the production build (run `npm run build` first). |
| `npm run lint` | ESLint (Next core-web-vitals and TypeScript rules, plus a guard against theme-breaking `bg-white/…` and `border-black/…` utilities). |
| `npm run typecheck` | `next typegen` then `tsc --noEmit`. |
| `npm run test:unit` | `node --test` over `src/**/*.test.ts`, the pure modules such as the slug, tech-family and vCard builders. |
| `npm run test:e2e` | Playwright against `next start` on port 3100. Build first. |
| `npm run budget` | Fails if a route's first-load JavaScript is over its budget in `scripts/check-bundle-budget.mjs`. Build first. |
| `npm run contrast` | Checks that every text token reaches 4.5:1 (and the focus ring 3:1) against each page surface, in both themes. |
| `npm run github:facts` | Refreshes `src/data/github-facts.json` (stars, forks, last push, licence) from the GitHub API; keeps the committed file if anything fails. |
| `npm run live:snapshot` | Refreshes `src/data/live-snapshot.json`, the fallback that `/api/github` and `/api/leetcode` serve when the upstream APIs fail. |
| `npm run skills:index` | Splits `src/data/skills-detailed.json` into the small eager index and one lazily fetched file per skill under `public/data/skills/`. |
| `npm run skills:links` | Requests every citation link the skill pages ship and reports dead ones. |
| `npm run media:projects` | Rebuilds the self-hosted project stills and loops under `public/images/projects/` and `public/videos/projects/` (needs `ffmpeg` and `ffprobe`). |
| `npm run lottie:fetch` / `npm run lottie:recolor` | Downloads, validates and recolours the Lottie files in `public/lottie/`. See [LOTTIE_CREDITS.md](LOTTIE_CREDITS.md). |
| `npm run glb:envelope` | Simplifies and compresses the contact section's envelope model. |

`npm run budget -- --budget /=900000` overrides one route's budget for a single run, which is handy when checking a change locally.

## Environment variables

Only names are listed here; values live in the Vercel project settings or a local `.env.local`, never in the repository.

| Name | Where it comes from | Effect |
|---|---|---|
| `NEXT_PUBLIC_VERCEL_ENV` | Set by Vercel (a system environment variable, exposed to Next.js by default) | Turns on Vercel Analytics, Speed Insights and custom events. Without it (locally, `next start`, CI) none of their scripts load. |
| `VERCEL_GIT_COMMIT_SHA` | Set by Vercel | `next.config.ts` exposes its first seven characters as `NEXT_PUBLIC_COMMIT`. |
| `NEXT_PUBLIC_BUILD_TIME`, `NEXT_PUBLIC_COMMIT` | Set by `next.config.ts` at build time | Build date for the sitemap and footer, and the commit id. Do not set them yourself. |
| `NEXT_PUBLIC_FORMSUBMIT_ID` | Optional | The FormSubmit alias the contact form posts to. Without it the form posts to the profile email address, which FormSubmit asks to confirm once. |
| `GITHUB_TOKEN` | Optional | Raises the GitHub API rate limit for `/api/github`, `npm run github:facts` and `npm run live:snapshot`. Anonymous access works. |
| `NEXT_PUBLIC_RENDER_COUNT` | Optional, `1` to enable | Builds with render counters (`window.__renders`) for performance tests. |
| `PW_BASE_URL`, `PW_PORT` | Optional | Point Playwright at an already running server or a preview deployment, or change the port it starts `next start` on. |
| `GOOGLE_AI_API_KEY` | Optional | Only for the one-off media generation scripts (`scripts/generate-media*.mjs`, `generate-skill-data.mjs`). The site never reads it. |

## How it is put together

**Routes.** `app/layout.tsx` is the single root layout: it loads the fonts, inlines the head bootstrap script, wraps every route in the providers, renders the site's JSON-LD and, on Vercel only, the analytics components. `app/page.tsx` renders the one-page app from `src/App.tsx`. `app/projects/[slug]` statically generates a case study for each project with case-study content. `app/api/github` and `app/api/leetcode` proxy and cache the live activity widgets. The metadata routes (`sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.tsx`, `twitter-image.tsx`, `icon.svg`, `apple-icon.tsx`) are generated from the same data, and `/contact.vcf` serves a vCard built by `src/lib/vcard.ts`. `not-found.tsx`, `error.tsx` and `global-error.tsx` cover missing pages and runtime failures.

**Before first paint.** `src/lib/bootstrap-script.ts` runs inline in `<head>` and sets `html.js`, `data-theme`, `data-motion`, `data-lite` and `data-intro` from stored preferences and media queries, so CSS never flashes the wrong theme and the intro curtain only plays on a first visit to `/`.

**Providers** (`app/providers.tsx`) nest framer-motion's `MotionConfig`, Lenis, the intro phase, the theme and toasts, and add `html.hydrated` once React has taken over. If hydration never happens, CSS reveals every animated element after four seconds, and without JavaScript nothing starts hidden.

**One motion signal.** `useMotionPrefs()` (`src/hooks/useMotionPrefs.ts`) combines the OS reduced-motion setting, the in-page motion toggle and a "lite" tier for coarse pointers and low-power devices, and mirrors them to `html[data-motion]` and `html[data-lite]`. framer-motion, GSAP, canvas, R3F, Lottie, videos and CSS all read that one signal. The shared easing, duration and spring values live in `src/lib/motion.ts`, and `src/components/motion/` holds the reusable Reveal, Stagger, SplitText, Parallax, Marquee and CountUp components.

**Shared building blocks.** `src/components/ui/` is the UI kit (Button, Dialog, Toast, Tooltip, CopyButton, DownloadCvButton, SocialLinks, LocalTime, Skeleton). `src/components/shared/` holds GlassCard, LottieIcon, Deferred3D (mounts a WebGL scene only near the viewport and keeps at most one live WebGL context), LazyMount, CanvasBoundary and BackgroundVideo. URL state (`?project=`, `?skill=`, the filters and the section hash) goes only through `src/lib/urlState.ts`, keyboard shortcuts only through `src/hooks/useHotkeys.ts`, and site facts only through `src/lib/site.ts`.

**Styling rules.** Colours are tokens with dark and light values in `src/index.css`; the lint guard rejects raw white/black alpha utilities because they vanish in the light theme. Touch targets are at least 44px, the z-index scale is fixed (`z-nav`, `z-dock`, `z-overlay`, `z-toast`, `z-cursor`), and each feature's global CSS sits in its own file inside `@layer components`. `src/styles/features/platform.css` also holds the print stylesheet, which prints a light single-column page with link targets spelled out.

## Testing

`npm run test:unit` covers the pure modules. The Playwright suites in `tests/e2e/` run every spec in 28 projects: seven viewports (320×568 to 1440×900, including a 1024×768 touch tablet), each in the dark and light themes, with and without reduced motion. `smoke.spec.ts` checks the platform: no console errors or hydration warnings, no horizontal overflow, 44px targets, the skip link, reveals, the CV download, the case-study and 404 pages, the no-JavaScript fallback, the fonts, the metadata routes, the JSON-LD and the security headers.

```bash
npm run build
npm run test:e2e                     # starts next start on port 3100 by itself
PW_BASE_URL=https://<preview>.vercel.app npx playwright test --project=1440x900-dark-motion
```

CI (`.github/workflows/ci.yml`) runs on pushes to `main`, on pull requests and on demand, all on Node 24: `npm ci`, the type check, lint, unit tests, the build, the bundle budget, the Playwright suites in Chromium, and three mobile Lighthouse runs whose medians must stay within LCP 2.5 s, CLS 0.1 and TBT 300 ms.

## Deployment

Vercel builds every push: `main` goes to production and other branches get preview URLs.

The Vercel project was created while the site was a Vite app, so its framework preset still says Vite. `vercel.json` sets `"framework": "nextjs"`, which overrides the preset on every build without a dashboard change; the project's Build Command and Output Directory must stay unset (not pinned to Vite's `dist`) for that to work.

The canonical address is `https://www.basuoikantik.in`. The apex `basuoikantik.in` answers with a 308 redirect to `www`, which Vercel handles as a domain redirect. DNS is hosted at Hostinger: an `A` record on the apex pointing at Vercel (`216.198.79.1`) and a `CNAME` on `www` pointing at the Vercel DNS target shown in the project's Domains settings. Every page, the sitemap, the JSON-LD and the social cards use the `www` origin from `SITE.url` in `src/lib/site.ts`.

Security headers come from `next.config.ts`: `Strict-Transport-Security: max-age=63072000` (two years, deliberately without `includeSubDomains` or `preload`), `nosniff`, a strict referrer policy, a restrictive permissions policy and `X-Frame-Options: SAMEORIGIN`. `/cv` and `/resume` redirect to the PDF.

Vercel Analytics and Speed Insights render only on Vercel builds; they also have to be enabled once in the project's Analytics and Speed Insights tabs before data arrives.

To check a production build locally:

```bash
npm run build
npm start            # http://localhost:3000
```

## Credits and licences

- **Lottie animations** in `public/lottie/` are from LottieFiles under the Lottie Simple License; sources, authors and changes are listed in [LOTTIE_CREDITS.md](LOTTIE_CREDITS.md).
- **Clash Display** and **Satoshi** are by the Indian Type Foundry, from [Fontshare](https://www.fontshare.com), under the ITF Free Font License. The files in `app/fonts/` are the unmodified originals, self-hosted for this site only; they are not covered by this repository's terms, so download your own copy from Fontshare to use them elsewhere.
- **JetBrains Mono** and **Cormorant Garamond** are under the SIL Open Font License and are fetched from Google Fonts at build time.
- The background videos, section images and skill illustrations were generated with Google Veo and Imagen, and the 3D models with Meshy.

Personal project, all rights reserved.
