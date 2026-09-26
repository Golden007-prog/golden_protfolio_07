# Oikantik Basu — portfolio

The personal site of Oikantik Basu, live at **[www.basuoikantik.in](https://www.basuoikantik.in)**. It is a single scrolling page (hero, about, skills, projects, experience, principles, contact) with static case-study pages for the projects that have one. It runs on Next.js 16 (App Router, Turbopack) on Vercel, with React 19, Tailwind CSS 4, framer-motion and GSAP for motion, and React Three Fiber for the 3D scenes.

All copy comes from the data files in `src/data/` (the profile, projects, skills, credentials and achievements), so changing a fact there changes it everywhere it appears, including the page title, the social cards, the JSON-LD and the vCard.

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

You need Node.js 22.18 or newer (CI and Vercel use Node 24); the unit tests and the AI scripts rely on Node's built-in TypeScript type stripping.

```bash
git clone https://github.com/Golden007-prog/golden_protfolio_07.git
cd golden_protfolio_07
npm ci
npm run dev          # http://localhost:3000
```

No environment variables are needed to run the site locally. Without `GOOGLE_AI_API_KEY` the AI features answer through their non-AI paths: the rule-based assistant and lexical search.

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
| `npm run ai:corpus` | Rebuilds `src/data/ai-corpus.json`, the citable grounding corpus, from `src/data` and `src/data/site-copy.ts`. `-- --check` exits 1 when the data changed without a rebuild (CI runs it). |
| `npm run ai:embed` | Embeds new or changed corpus chunks into `src/data/ai-vectors.json` (needs the key; without one it prints `skipped: no key` and exits 0). |
| `npm run ai:recall` | Keyless retrieval check: lexical recall@5 over `evals/retrieval.jsonl` must stay above its floor (CI runs it); it also reports hybrid recall when vectors exist. |
| `npm run ai:generate` | Runs every `scripts/ai/gen-*.mjs` generator to refresh the precomputed AI content in `src/data/ai-generated/` (hash-gated; exits 0 without a key or on a 429). |
| `npm run ai:review` | Owner review of precomputed AI content: interactive, or `-- --list`, `-- --approve store:key`, `-- --reject store:key`. |
| `npm run ai:scan` | After a build: fails if a Google API key pattern appears in `.next/static`, the prerendered pages, `public/` or this README, if `@google/genai` or the key's variable name reaches client code, or if `next.config.ts`'s `env` block holds anything but its four allowed keys (CI runs it). |
| `npm run credentials:verify` | Opens every credential in `src/data/certifications.json` in a logged-out browser and fails unless the issuer's public page shows his name and the title. Pass ids to check a few (`npm run credentials:verify -- claude-101`). Needs `npx playwright install chromium` once. |

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
| `GOOGLE_AI_API_KEY` | Vercel (a sensitive variable, all environments) or a local `.env` | The Gemini API key. The site reads it on the server only, in `src/lib/ai/config.server.ts`, and passes it explicitly to `@google/genai`; the `ai:*` scripts read it through `node --env-file-if-exists=.env`, as do the older one-off media scripts (`scripts/generate-media*.mjs`, `generate-skill-data.mjs`). There is no `NEXT_PUBLIC_` variant, and there must never be one: anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle. Without the key every AI route answers the `no-key` fallback. |
| `AI_ENABLED` | Optional, `0` to switch off | The AI kill switch. `0` makes every AI route answer the `disabled` fallback without touching the key; retrieval keeps working lexically. |
| `AI_FEATURES_OFF` | Optional | A comma list of features to switch off one by one: `ask`, `retrieve`, `tour`, `project-filters`, `sentiment`, `draft`, `jd-extract`, `jd-fit`, `jd-questions`, `brief`, plus `retrieve-embed` to keep retrieval on BM25 only. |
| `AI_MODEL_PRIMARY`, `AI_MODEL_FALLBACK` | Optional | Override the chat model (`gemini-3.8-flash`) and the cheap and fallback model (`gemini-3.5-flash-lite`). Only pinned ids are accepted: `-latest` aliases, and anything that looks like a key, are ignored with a warning. |
| `AI_TIER` | Optional, `free` or `paid` | Which Gemini API terms the data notice quotes. Unset reads as `unknown` and shows the stricter free-tier wording. |
| `AI_DAILY_BUDGET` | Optional, default `2000` | Per-instance ceiling on AI cost units per UTC day, behind the per-IP token bucket. |
| `NEXT_PUBLIC_AI_SHOW_UNREVIEWED` | Set by `next.config.ts` | `1` on preview and local builds, empty in production, where unreviewed claim-bearing AI content stays hidden. Do not set it yourself. |
| `AI_FAKE_MODEL` | Tests only, `1` to enable | Replaces Gemini with a deterministic fake, so tests drive the real routes with no key and no network. Ignored on Vercel. |
| `AI_EVAL` | Local only, `1` to enable | Raises the rate limit five-fold for a local evaluation run. Ignored on Vercel. |
| `PW_REAL_AI` | Optional, `1` to enable | Lets the Playwright server keep the real key instead of the fake model. The AI specs still refuse to run against it (`assertSafeServer`). |

## How it is put together

**Routes.** `app/layout.tsx` is the single root layout: it loads the fonts, inlines the head bootstrap script, wraps every route in the providers, renders the site's JSON-LD and, on Vercel only, the analytics components. `app/page.tsx` renders the one-page app from `src/App.tsx`. `app/projects/[slug]` statically generates a case study for each project with case-study content. `app/api/github` and `app/api/leetcode` proxy and cache the live activity widgets. The metadata routes (`sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.tsx`, `twitter-image.tsx`, `icon.svg`, `apple-icon.tsx`) are generated from the same data, and `/contact.vcf` serves a vCard built by `src/lib/vcard.ts`. `not-found.tsx`, `error.tsx` and `global-error.tsx` cover missing pages and runtime failures.

**Before first paint.** `src/lib/bootstrap-script.ts` runs inline in `<head>` and sets `html.js`, `data-theme`, `data-motion`, `data-lite` and `data-intro` from stored preferences and media queries, so CSS never flashes the wrong theme and the intro curtain only plays on a first visit to `/`.

**Providers** (`app/providers.tsx`) nest framer-motion's `MotionConfig`, Lenis, the intro phase, the theme and toasts, and add `html.hydrated` once React has taken over. If hydration never happens, CSS reveals every animated element after four seconds, and without JavaScript nothing starts hidden.

**One motion signal.** `useMotionPrefs()` (`src/hooks/useMotionPrefs.ts`) combines the OS reduced-motion setting, the in-page motion toggle and a "lite" tier for coarse pointers and low-power devices, and mirrors them to `html[data-motion]` and `html[data-lite]`. framer-motion, GSAP, canvas, R3F, Lottie, videos and CSS all read that one signal. The shared easing, duration and spring values live in `src/lib/motion.ts`, and `src/components/motion/` holds the reusable Reveal, Stagger, SplitText, Parallax, Marquee and CountUp components.

**Shared building blocks.** `src/components/ui/` is the UI kit (Button, Dialog, Toast, Tooltip, CopyButton, DownloadCvButton, SocialLinks, LocalTime, Skeleton). `src/components/shared/` holds GlassCard, LottieIcon, Deferred3D (mounts a WebGL scene only near the viewport and keeps at most one live WebGL context), LazyMount, CanvasBoundary and BackgroundVideo. URL state (`?project=`, `?skill=`, the filters and the section hash) goes only through `src/lib/urlState.ts`, keyboard shortcuts only through `src/hooks/useHotkeys.ts`, and site facts only through `src/lib/site.ts`.

**Styling rules.** Colours are tokens with dark and light values in `src/index.css`; the lint guard rejects raw white/black alpha utilities because they vanish in the light theme. Touch targets are at least 44px, the z-index scale is fixed (`z-nav`, `z-dock`, `z-overlay`, `z-toast`, `z-cursor`), and each feature's global CSS sits in its own file inside `@layer components`. `src/styles/features/platform.css` also holds the print stylesheet, which prints a light single-column page with link targets spelled out.

## Profile data sync

The five newer experience roles in `src/data/profile.json`, the credentials in `src/data/certifications.json` and the hackathon and launch entries in `src/data/achievements.json` were captured on 2026-09-26 from Oikantik's own accounts: his LinkedIn profile and posts, the Claude Academy dashboard, the Coursera certificates tab, and the Programiz PRO certificates that LinkedIn links to. The newer entries in `src/data/projects.json` come from the READMEs of his public GitHub repositories. Where two sources disagree, the issuer's site wins over LinkedIn, so titles and dates are the ones Claude Academy, Coursera or Programiz show (the University of Michigan credential, for example, is the single course *Understanding and Visualizing Data with Python*).

Only verified credentials ship. Every entry's `url` is the issuer's public verification page, and it went into the file only after that page, opened in a logged-out browser, showed his name and the credential's title. `parseCertifications` (`src/lib/certifications.ts`) fails the build on a malformed entry or on any link that is not https on `academy.claude.com`, `www.coursera.org` or `programiz.pro`, and the kind stays visible: the 20 Claude Academy items are course completion badges, not certifications. The achievements hold only what he said in his own posts, with no added ranks, prizes or numbers and no teammates named (`parseAchievements` enforces what it can). Private repositories, personal documents, other people's profiles and LinkedIn audience analytics are never published, and no years-of-experience total is computed from the roles.

To re-verify, install the browser once with `npx playwright install chromium`, then run `npm run credentials:verify` (the same as `node scripts/verify-credentials.mjs`). It opens every credential in a fresh logged-out context, requires his name, most of the title's words, a status below 400 and a final URL still on the issuer's host (a login wall fails), retries once, and exits 1 if anything fails. Pass ids to check a few (`node scripts/verify-credentials.mjs claude-101 ai-fundamentals`) or `--json <path>` to keep the results. `npm run test:unit` covers the data offline: unique ids, valid dates, allowed hosts, certificate and course links that resolve both ways, and every achievement's project on the site. When a credential stops verifying, remove it from `certifications.json` rather than keep a link that no longer proves anything.

The same data feeds the site's JSON-LD (`src/lib/structured-data.ts`): each credential is a `hasCredential` entry on the Person (an `EducationalOccupationalCredential` recognised by its issuer, with the verification page as its `url`), the finalist placing is the Person's only `award`, in the words of his post, and GOLDEN's Coreforge is an `Organization` with him as `founder`.

## AI features (Gemini)

The site uses Google's Gemini API for a grounded assistant and a handful of smaller features. The rule is that the AI answers only from what this site already says, cites where it found it, says so when the site doesn't cover a question, and is never the only way to get an answer.

**Server only.** `@google/genai` runs in route handlers under `app/api/ai/<feature>/route.ts` (Node runtime, POST only, `maxDuration` 30) and in the `scripts/ai/` scripts; `next.config.ts` keeps it out of the bundles with `serverExternalPackages`. The browser loads no AI library: `src/components/ai/useAiStream.ts` reads the routes' NDJSON stream with `fetch`. Model ids live only in `src/lib/ai/config.server.ts`: `gemini-3.8-flash` for answers, `gemini-3.5-flash-lite` for extraction, drafting and as the fallback, and `gemini-embedding-2` at 768 dimensions for retrieval. `GET /api/ai/health` reports what the server actually runs (enabled, configured, tier, active models, models cooling down) and never calls Gemini.

**Grounding.** `npm run ai:corpus` turns the profile, projects, reading list, tools, skills index, live snapshot and site copy into citable chunks (`src/data/ai-corpus.json`). The profile's stats and the phone number are left out, the generic skill encyclopedia is tagged `reference` and never counts as evidence of his own use, and live data carries its capture date. Retrieval is BM25 plus embeddings (`src/lib/ai/retrieval.ts`) fused by reciprocal rank, and a relevance gate refuses to call the model when nothing about Oikantik matches. Answers stream one verified sentence at a time (`src/lib/ai/streamFilter.ts`): each sentence is stripped of markup, scrubbed of URLs, emails and phone numbers that are not on the site, checked for a prompt-leak canary, limited to citations from its own context, and checked against the cited text for numbers, employers, certifications and degrees that text does not state. Structured routes verify every quoted claim verbatim.

**Fallbacks.** Every failure answers HTTP 200 `{mode: 'fallback', reason}`: no key, AI switched off, quota, a timeout, a blocked prompt, a refused request or an off-topic question. The client then shows the rule-based answer from `src/utils/askme.ts`, or lexical search results, with calm copy instead of an error. A request has one 25-second deadline shared by every model attempt. The fallback model is tried only after a 429 or 503 with at least 8 seconds left, a timeout is never retried (an aborted call is still billed), and a model that returned 429 is skipped by every later request on that instance for the delay Google asked for. After two hard failures in a row the browser session stops calling the AI, and a soft cap of 20 answers per session applies.

**Abuse and cost controls.** `src/lib/ai/guard.server.ts` runs the cheapest checks first: POST, JSON only, a strict same-origin check (the site never sends `Access-Control-Allow-Origin`), a streamed byte cap, schema validation, the kill switches, BotID on Vercel, and a per-IP token bucket whose cost grows with input size. The bucket and the daily budget are per instance and reset on deploy, so nothing in the code limits traffic across instances. That job falls to two settings made by hand outside the repository, the per-model quotas on a dedicated Google key and a Vercel WAF rate-limit rule on `/api/ai`, and the site cannot tell whether either is in place: see [Before going live](#before-going-live). `robots.txt` keeps crawlers out of `/api/`.

**Precomputed content and review.** Content that is the same for every visitor (summaries, lenses, alt text, starter questions) is generated ahead of time with `npm run ai:generate` into `src/data/ai-generated/*.json`, and each entry is checked for faithfulness to its source and for inflated wording ('expert', 'led', 'senior' and similar, unless the source says it). Entries that make claims about Oikantik stay hidden in production until he approves them with `npm run ai:review`; preview and local builds show them marked 'Draft · not yet reviewed' so they can be read in place. The `/ai` lab adds three scripts that run directly rather than through npm, each as `node --env-file-if-exists=.env scripts/ai/<name>.mjs`: `eval` (it talks to a local `AI_EVAL=1 npx next start` in another terminal, never CI), `refresh-all` and `project-embeddings` (after `ai:embed`, it redraws the explorer map in `public/ai/projection.json`).

**Privacy.** Text a visitor types into an AI feature is sent to Google's Gemini API to produce the answer; the site stores none of it, and pasted job descriptions and notes have emails, phone numbers and token-bearing links removed first. Server logs record only the feature, model, timings, token counts, the top retrieval score, dropped sentences and the fallback reason, never the question, a job description, a draft or an IP address. On the free tier Google may use submitted text to improve its products, which the in-page notice says before anyone types; its wording follows `AI_TIER`.

### AI incident runbook

Use this when a key may have leaked (an `ai:scan` failure or a secret-scanning alert), when spend or quota runs away, or when the features are being abused.

1. **Switch AI off.** Set `AI_ENABLED=0` in the Vercel project's environment variables and redeploy: environment changes only apply to new deployments. The site keeps working with rule-based answers and lexical search.
2. **Revoke and rotate the key.** Delete the key in Google AI Studio (or the Cloud console), create a new one, store it in Vercel as the sensitive variable `GOOGLE_AI_API_KEY` and in your local `.env`, and paste it nowhere else. Redeploy once the new key is in place.
3. **Confirm.** `curl https://www.basuoikantik.in/api/ai/health` reports `"enabled": false` while AI is off, and `"configured": true` with the expected models once it is back on. The response never contains the key.
4. **Emergency brake.** If the traffic itself is the problem, turn on Vercel's Attack Challenge Mode in the project's Firewall settings. It challenges every visitor until you switch it off, which keeps most automated clients out.

## Testing

`npm run test:unit` covers the pure modules, including every AI module in `src/lib/ai/` that has a matching `*.test.ts`. The Playwright suites in `tests/e2e/` run every spec in 28 projects: seven viewports (320×568 to 1440×900, including a 1024×768 touch tablet), each in the dark and light themes, with and without reduced motion. `smoke.spec.ts` checks the platform: no console errors or hydration warnings, no horizontal overflow, 44px targets, the skip link, reveals, the CV download, the case-study and 404 pages, the no-JavaScript fallback, the fonts, the metadata routes, the JSON-LD and the security headers.

No test ever calls the real Gemini API. `playwright.config.ts` starts `next start` with `AI_FAKE_MODEL=1` and a blank key (an empty value beats `.env`), so `ai-server.spec.ts` drives the real guard, retrieval, sentence filter and NDJSON path against a deterministic fake whose marker questions replay attacks and failures: a canary split across chunks, a split markdown link, a foreign email, an uncited certification claim, a 429, a 503, a hang and a slow stream. Browser specs mock the routes with the helpers in `tests/e2e/ai-mocks.ts`. Every AI spec first calls `assertSafeServer`, which fails unless `/api/ai/health` reports the fake model or AI switched off, so a reused local server that loaded the real key cannot spend quota.

```bash
npm run build
npm run test:e2e                     # starts next start on port 3100 by itself
PW_BASE_URL=https://<preview>.vercel.app npx playwright test --project=1440x900-dark-motion
```

CI (`.github/workflows/ci.yml`) runs on pushes to `main`, on pull requests and on demand, all on Node 24 and all without the Gemini key: `npm ci`, the type check, lint, unit tests, the AI corpus freshness check and retrieval recall floor, the build, the AI secret scan, the bundle budget, the Playwright suites in Chromium, and three mobile Lighthouse runs whose medians are checked against LCP 2.5 s, CLS 0.1 and TBT 300 ms (CLS blocks; LCP and TBT are report-only warnings until the home page is within budget, see `LIGHTHOUSE_ENFORCE` in `ci.yml`).

## Deployment

Vercel builds every push: `main` goes to production and other branches get preview URLs.

The Vercel project was created while the site was a Vite app, so its framework preset still says Vite. `vercel.json` sets `"framework": "nextjs"`, which overrides the preset on every build without a dashboard change; the project's Build Command and Output Directory must stay unset (not pinned to Vite's `dist`) for that to work.

The canonical address is `https://www.basuoikantik.in`. The apex `basuoikantik.in` answers with a 308 redirect to `www`, which Vercel handles as a domain redirect. DNS is hosted at Hostinger: an `A` record on the apex pointing at Vercel (`216.198.79.1`) and a `CNAME` on `www` pointing at the Vercel DNS target shown in the project's Domains settings. Every page, the sitemap, the JSON-LD and the social cards use the `www` origin from `SITE.url` in `src/lib/site.ts`.

Security headers come from `next.config.ts`: `Strict-Transport-Security: max-age=63072000` (two years, deliberately without `includeSubDomains` or `preload`), `nosniff`, a strict referrer policy, a restrictive permissions policy (the microphone is allowed for this origin only, for the click-to-start voice input) and `X-Frame-Options: SAMEORIGIN`. `/cv` and `/resume` redirect to the PDF.

`vercel.json` also turns on `supportsCancellation` for `app/api/ai/**`, so a visitor who closes the tab stops the model call instead of leaving it streaming into nothing. BotID guards the AI routes on Vercel only; if its check itself fails, the cheap features stay available and the heavy ones (the job-description fit and the role brief) fall back.

Vercel Analytics and Speed Insights render only on Vercel builds; they also have to be enabled once in the project's Analytics and Speed Insights tabs before data arrives.

To check a production build locally:

```bash
npm run build
npm start            # http://localhost:3000
```

### Before going live

The AI routes have two cost ceilings that hold across instances, and neither lives in this repository: each is a setting the owner makes by hand. Until both exist, the only limits are the per-instance token bucket and daily budget, and those multiply with every instance Vercel runs.

1. **A Vercel WAF rate-limit rule.** In the project's Firewall settings, add a rate-limit rule for requests whose path starts with `/api/ai`: 20 requests per 60 seconds per IP, fixed window, answering 429. Hobby allows one rate-limit rule per project. It runs before the function, so a blocked request never starts one, and it counts per region. The browser already treats a non-JSON 429 as the calm rate-limited state. To confirm the rule is live, check that it is listed on the Firewall page, then send a burst the app refuses before any model call (no JSON content type, so it costs nothing): `for i in $(seq 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://www.basuoikantik.in/api/ai/ask; done` should print a run of `200` and then `429` once the window's 20 requests are used. The AI routes themselves never answer 429 (every refusal is HTTP 200 with a reason), so a 429 there can only come from the rule.
2. **Quotas on a dedicated Google key.** Use a production key from its own Google Cloud project, restricted to the Generative Language API, with per-model requests-per-day quota overrides for the two chat models and the embedding model, and Veo and Imagen quota set to 0. Budget alerts only warn; quotas are what stop spend. Set `AI_TIER` to match the project's tier so the privacy notice quotes the right terms.

## Credits and licences

- **Lottie animations** in `public/lottie/` are from LottieFiles under the Lottie Simple License; sources, authors and changes are listed in [LOTTIE_CREDITS.md](LOTTIE_CREDITS.md).
- **Clash Display** and **Satoshi** are by the Indian Type Foundry, from [Fontshare](https://www.fontshare.com), under the ITF Free Font License. The files in `app/fonts/` are the unmodified originals, self-hosted for this site only; they are not covered by this repository's terms, so download your own copy from Fontshare to use them elsewhere.
- **JetBrains Mono** and **Cormorant Garamond** are under the SIL Open Font License and are fetched from Google Fonts at build time.
- The background videos, section images and skill illustrations were generated with Google Veo and Imagen, and the 3D models with Meshy.

Personal project, all rights reserved.
