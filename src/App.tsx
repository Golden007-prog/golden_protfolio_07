'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { AboutSection } from './components/about/AboutSection';
import { ContactSection } from './components/contact/ContactSection';
import { ExperienceSection } from './components/experience/ExperienceSection';
import { HeroSection } from './components/hero/HeroSection';
import { Footer } from './components/layout/Footer';
import { Navbar } from './components/layout/Navbar';
import { SectionRail } from './components/layout/SectionRail';
import { SectionTransition } from './components/layout/SectionTransition';
import LoadingScreen from './components/loading/LoadingScreen';
import { ProjectsSection } from './components/projects/ProjectsSection';
import { BackToTop } from './components/shared/BackToTop';
import { LazyMount } from './components/shared/LazyMount';
import { PhilosophySection } from './components/shared/PhilosophySection';
import { ToolsStrip } from './components/shared/ToolsStrip';
import { SkillsSection } from './components/skills/SkillsSection';
import { useIntro } from './contexts/IntroContext';
import { useSectionHashSync } from './hooks/useActiveSection';
import { useHotkeys } from './hooks/useHotkeys';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useMotionPrefs } from './hooks/useMotionPrefs';

// Client-only and code-split: none of these are in the first chunk for '/'.
// They are extras, so a chunk that fails to load (a dropped connection, a deploy
// mid-visit) leaves that one widget out instead of throwing into the page's
// error boundary and replacing the whole site.
const renderNothing = () => null;
const CometCursor = dynamic(() => import('./components/shared/CometCursor').catch(() => renderNothing), { ssr: false });
const BokehParticles = dynamic(
  () => import('./components/shared/BokehParticles').then((m) => m.BokehParticles, () => renderNothing),
  { ssr: false },
);
const KonamiCode = dynamic(
  () => import('./components/shared/KonamiCode').then((m) => m.KonamiCode, () => renderNothing),
  { ssr: false },
);
const FloatingDock = dynamic(
  () => import('@/components/shared/FloatingDock').then((m) => m.FloatingDock, () => renderNothing),
  { ssr: false },
);
const CommandPalette = dynamic(
  () => import('./components/layout/CommandPalette').then((m) => m.CommandPalette, () => renderNothing),
  { ssr: false },
);
const ShortcutsDialog = dynamic(
  () => import('./components/layout/ShortcutsDialog').then((m) => m.ShortcutsDialog, () => renderNothing),
  { ssr: false },
);

const SHEET = 'relative z-20 bg-bg-base';

/* ---- palette and shortcuts state: a store, so opening them never re-renders the page ---- */

type DialogState = { palette: boolean; shortcuts: boolean; wanted: boolean };
const CLOSED: DialogState = { palette: false, shortcuts: false, wanted: false };
let dialogs = CLOSED;
const dialogListeners = new Set<() => void>();

function setDialogs(patch: Partial<DialogState>) {
  dialogs = { ...dialogs, ...patch };
  dialogListeners.forEach((fn) => fn());
}
function subscribeDialogs(fn: () => void) {
  dialogListeners.add(fn);
  return () => {
    dialogListeners.delete(fn);
  };
}
const getDialogs = () => dialogs;
const getServerDialogs = () => CLOSED;

const openPalette = () => setDialogs({ wanted: true, shortcuts: false, palette: true });
const openShortcuts = () => setDialogs({ wanted: true, palette: false, shortcuts: true });
const closePalette = () => setDialogs({ palette: false });
const closeShortcuts = () => setDialogs({ shortcuts: false });

/** Idle-mounted until someone asks for it first; then it mounts at once. */
function IdleOr({ now, children }: { now: boolean; children: ReactNode }) {
  return now ? <>{children}</> : <LazyMount when="idle">{children}</LazyMount>;
}

function ShellDialogs() {
  const state = useSyncExternalStore(subscribeDialogs, getDialogs, getServerDialogs);
  const { done } = useIntro();

  useHotkeys(
    {
      'mod+k': () => (getDialogs().palette ? closePalette() : openPalette()),
      '/': openPalette,
      '?': openShortcuts,
    },
    { enabled: done },
  );

  return (
    <IdleOr now={state.wanted}>
      <CommandPalette open={state.palette} onClose={closePalette} onShowShortcuts={openShortcuts} />
      <ShortcutsDialog open={state.shortcuts} onClose={closeShortcuts} />
    </IdleOr>
  );
}

/** Fine hover pointers only, never under reduced motion or forced colours. */
function Cursor() {
  const prefs = useMotionPrefs();
  const forcedColors = useMediaQuery('(forced-colors: active)');
  return prefs.finePointer && prefs.hover && !prefs.reduce && !forcedColors ? <CometCursor /> : null;
}

function HashSync() {
  useSectionHashSync();
  return null;
}

function App() {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('%c👋 Hey, developer.', 'color:#A855F7; font-size:18px; font-weight:700;');
    console.log(
      '%cBuilt with Next.js 16 · React 19 · R3F · Framer Motion · GSAP · Tailwind 4.\nSource: https://github.com/Golden007-prog/golden_protfolio_07\nSay hi: basuoikantik@gmail.com',
      'color:#22D3EE; font-family:monospace; font-size:12px;',
    );
  }, []);

  return (
    <>
      <LoadingScreen pageRef={pageRef} />
      <Cursor />
      <HashSync />

      {/* overflow-x-clip, not hidden: hidden would make this a scroll container and unstick every sticky child. */}
      <div ref={pageRef} data-page="" className="aurora-bg relative min-h-screen overflow-x-clip bg-bg-base text-text-primary">
        <a
          href="#main"
          className="sr-only rounded-lg bg-violet px-4 py-2 font-medium text-white ring-focus focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-overlay"
        >
          Skip to main content
        </a>
        <Navbar onOpenPalette={openPalette} />
        <SectionRail />

        {/* A focus target for the skip link and back-to-top, never a tab stop, so it draws no ring. */}
        <main id="main" tabIndex={-1} className="relative z-10 outline-none">
          <div className="relative z-[1]">
            <HeroSection />
          </div>
          <SectionTransition className={SHEET}>
            <AboutSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <SkillsSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ToolsStrip />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ProjectsSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ExperienceSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <PhilosophySection />
          </SectionTransition>
          <div className="relative z-30 bg-bg-base">
            <ContactSection />
          </div>
        </main>

        <Footer />
        <BackToTop />

        <LazyMount when="idle">
          <BokehParticles />
          <KonamiCode />
          <FloatingDock />
        </LazyMount>

        <ShellDialogs />

        <div className="noise-overlay" aria-hidden="true" />
      </div>
    </>
  );
}

export default App;
