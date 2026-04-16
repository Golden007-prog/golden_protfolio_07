# Oikantik Basu — Portfolio

A personal portfolio website built with React, TypeScript, and Vite. Features interactive animations, a projects showcase, skills radar, and an AI assistant.

## Tech Stack

- **React 19** + **TypeScript 5**
- **Vite 7** — build tool and dev server
- **Tailwind CSS 4** — styling
- **Framer Motion** — animations and transitions
- **Lucide React** — icons

## Features

- Animated hero section with custom character cursor
- Anti-gravity background effect
- Projects slider with detail modals
- Interactive skills radar
- Experience timeline
- AI assistant component
- Lab mode toggle for experimental UI
- Downloadable CV (PDF)

## Getting Started

### Prerequisites

- Node.js 20+
- npm or pnpm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
```

Outputs to the `dist/` directory.

### Preview production build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
├── components/         # React components
│   ├── Hero.tsx
│   ├── Navbar.tsx
│   ├── Projects.tsx
│   ├── ProjectSlider.tsx
│   ├── ProjectModal.tsx
│   ├── Experience.tsx
│   ├── SkillsRadar.tsx
│   ├── Contact.tsx
│   ├── AIAssistant.tsx
│   ├── CharacterCursor.tsx
│   ├── AntiGravityBackground.tsx
│   ├── LoadingScreen.tsx
│   └── LabModeContext.tsx
├── assets/             # Images and static assets
├── App.tsx             # Root component
├── main.tsx            # Entry point
├── constants.ts        # Shared constants
└── index.css           # Global styles
public/                 # Static files (CV PDF, icons)
```

## Deployment

The project is configured for GitHub Pages with a base path of `/golden_protfolio_07/` (see [vite.config.ts](vite.config.ts)). Update `base` in `vite.config.ts` if deploying elsewhere.

## License

Personal project — all rights reserved.
