'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { AboutSection } from './components/about/AboutSection';
import { HeroSection } from './components/hero/HeroSection';
import { Footer } from './components/layout/Footer';
import { Navbar } from './components/layout/Navbar';
import { SectionRail } from './components/layout/SectionRail';
import { SectionTransition } from './components/layout/SectionTransition';
import LoadingScreen from './components/loading/LoadingScreen';
import { BackToTop } from './components/shared/BackToTop';
import { LazyMount } from './components/shared/LazyMount';
import type { SectionToolsRequest } from './components/ai/discovery/SectionTools';
import type { CoreforgeNewsItem } from './components/coreforge/NewsList';
import { KaggleDataContext } from './components/kaggle/KaggleDataContext';
import { ServerInterestsContext } from './components/projects/projectsAi';
import { LensChipsContext, type LensChip } from './components/recruiter/FitCheckTrigger';
import { useIntro } from './contexts/IntroContext';
import { smoothScrollTo, useLenis } from './contexts/LenisContext';
import { useSectionHashSync } from './hooks/useActiveSection';
import { useHotkeys } from './hooks/useHotkeys';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useMotionPrefs } from './hooks/useMotionPrefs';
import { openAssistant } from './lib/ai/bus';
import type { InterestView } from './lib/ai/prompts/projects';
import type { KaggleData } from './lib/kaggle/types';
import { SECTIONS } from './lib/site';
import { findTarget } from './lib/urlState';

// Below the fold, so each section is its own chunk. They still render on the server
// (the page reads the same with no JavaScript) and next/dynamic preloads their
// chunks alongside the first one, so the page still hydrates in one pass: nothing
// on it is live before everything is. (A Suspense boundary here would let the hero
// go first, but then 'hydrated' would no longer mean the whole page is.)
const SkillsSection = dynamic(() => import('./components/skills/SkillsSection').then((m) => m.SkillsSection));
const ToolsStrip = dynamic(() => import('./components/shared/ToolsStrip').then((m) => m.ToolsStrip));
const ProjectsSection = dynamic(() => import('./components/projects/ProjectsSection').then((m) => m.ProjectsSection));
const CoreforgeSection = dynamic(() => import('./components/coreforge/CoreforgeSection').then((m) => m.CoreforgeSection));
const ExperienceSection = dynamic(() => import('./components/experience/ExperienceSection').then((m) => m.ExperienceSection));
const CertificationsSection = dynamic(() =>
  import('./components/certifications/CertificationsSection').then((m) => m.CertificationsSection),
);
const KaggleSection = dynamic(() => import('./components/kaggle/KaggleSection').then((m) => m.KaggleSection));
const PhilosophySection = dynamic(() => import('./components/shared/PhilosophySection').then((m) => m.PhilosophySection));
const ContactSection = dynamic(() => import('./components/contact/ContactSection').then((m) => m.ContactSection));
// A ?project or ?skill link opens its dialog on arrival. The dialogs load on demand, so
// start that fetch with the first chunk rather than after the section's own chunk runs.
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  if (params.has('project')) import('./components/projects/ProjectModal').catch(() => {});
  if (params.has('skill')) import('./components/skills/SkillModal').catch(() => {});
}

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
// AI discovery surfaces load only when first asked for, never at idle: most visits never open them.
const GuidedTour = dynamic(
  () => import('./components/ai/discovery/GuidedTour').then((m) => m.GuidedTour, () => renderNothing),
  { ssr: false },
);
const SectionTools = dynamic(
  () => import('./components/ai/discovery/SectionTools').then((m) => m.SectionTools, () => renderNothing),
  { ssr: false },
);

const SHEET = 'relative z-20 bg-bg-base';

/* ---- palette, shortcuts, tour and section tools: a store, so opening them never re-renders the page ---- */

type DialogState = {
  palette: boolean;
  shortcuts: boolean;
  wanted: boolean;
  /** The tour's goal picker is open; tourWanted keeps the tour (and its pill) mounted once asked for. */
  tour: boolean;
  tourWanted: boolean;
  tools: boolean;
  toolsRequest: SectionToolsRequest;
  toolsWanted: boolean;
};
const CLOSED: DialogState = {
  palette: false,
  shortcuts: false,
  wanted: false,
  tour: false,
  tourWanted: false,
  tools: false,
  toolsRequest: 'simple',
  toolsWanted: false,
};
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
const openTour = () => setDialogs({ palette: false, shortcuts: false, tour: true, tourWanted: true });
const closeTour = () => setDialogs({ tour: false });
const openTools = (request: SectionToolsRequest) => setDialogs({ palette: false, shortcuts: false, tools: true, toolsRequest: request, toolsWanted: true });
const closeTools = () => setDialogs({ tools: false });

/** 'a' and mod+j. Not over another dialog: the assistant would open behind it, inert. */
function askFromKeyboard() {
  if (document.querySelector('[data-dialog-root]')) return;
  openAssistant();
}

// The Konami code (KonamiCode.tsx) ends in B, A: that A belongs to the easter egg.
const KONAMI_LEAD = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB'];
let keyTrail: string[] = [];
function trailKey(e: KeyboardEvent) {
  keyTrail = [...keyTrail, e.code].slice(-(KONAMI_LEAD.length + 1));
}
function askFromSingleKey() {
  const konami = keyTrail.length > KONAMI_LEAD.length && KONAMI_LEAD.every((k, i) => keyTrail[i] === k);
  if (!konami) askFromKeyboard();
}

/** Idle-mounted until someone asks for it first; then it mounts at once. */
function IdleOr({ now, children }: { now: boolean; children: ReactNode }) {
  return now ? <>{children}</> : <LazyMount when="idle">{children}</LazyMount>;
}

function ShellDialogs() {
  const state = useSyncExternalStore(subscribeDialogs, getDialogs, getServerDialogs);
  const { done } = useIntro();

  // Capture phase: the trail includes this key before the hotkey handler reads it.
  useEffect(() => {
    window.addEventListener('keydown', trailKey, true);
    return () => window.removeEventListener('keydown', trailKey, true);
  }, []);

  useHotkeys(
    {
      'mod+k': () => (getDialogs().palette ? closePalette() : openPalette()),
      '/': openPalette,
      '?': openShortcuts,
      'mod+j': askFromKeyboard,
      // A single key, so the WCAG 2.1.4 switch in ShortcutsDialog turns it off with the others.
      a: askFromSingleKey,
    },
    { enabled: done },
  );

  return (
    <>
      <IdleOr now={state.wanted}>
        <CommandPalette
          open={state.palette}
          onClose={closePalette}
          onShowShortcuts={openShortcuts}
          onStartTour={openTour}
          onSectionTools={openTools}
        />
        <ShortcutsDialog open={state.shortcuts} onClose={closeShortcuts} />
      </IdleOr>
      {state.tourWanted ? <GuidedTour pickerOpen={state.tour} onClosePicker={closeTour} /> : null}
      {state.toolsWanted ? <SectionTools open={state.tools} request={state.toolsRequest} onClose={closeTools} /> : null}
    </>
  );
}

/** Fine hover pointers only, never under reduced motion or forced colours. */
function Cursor() {
  const prefs = useMotionPrefs();
  const forcedColors = useMediaQuery('(forced-colors: active)');
  return prefs.finePointer && prefs.hover && !prefs.reduce && !forcedColors ? <CometCursor /> : null;
}

const SECTION_IDS: ReadonlySet<string> = new Set(SECTIONS.map((s) => s.id));

/**
 * Makes sure '/#projects' lands on its section once the split sections are in the
 * page. The router's own hash scroll after a client navigation (a case study's 'All
 * projects') can run against a page Lenis measured before they laid out; on a fresh
 * load the browser has already jumped there and this does nothing. `id` is the
 * hash seen at the first render (the scroll-driven hash sync may rewrite it); after
 * a client navigation it can predate the new URL, so the current hash stands in.
 * Lenis re-measures first: its resize check is debounced, and a stale page height
 * would clamp the jump short of the section.
 */
function HashArrival({ id }: { id: string }) {
  const lenis = useLenis();
  useEffect(() => {
    const target = SECTION_IDS.has(id) ? id : window.location.hash.slice(1);
    if (!SECTION_IDS.has(target)) return;
    const raf = requestAnimationFrame(() => {
      const el = findTarget(target);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top > 0 && top < 160) return;
      lenis?.resize();
      smoothScrollTo(el, { immediate: true });
    });
    return () => cancelAnimationFrame(raf);
    // Once, when the sections arrive; a Lenis created later is not a new arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}

function HashSync() {
  useSectionHashSync();
  return null;
}

type AppProps = {
  /** Worked out on the server (app/page.tsx), so these chips are in the first paint. */
  lensChips?: readonly LensChip[];
  interests?: readonly InterestView[];
  /** Read on the server (live or the committed snapshot); the section is left out without it. */
  kaggle?: KaggleData | null;
  /** goldensdmat.in news for the CoreForge section; the slot is left out when empty. */
  coreforgeNews?: readonly CoreforgeNewsItem[];
};

function App({ lensChips = [], interests = [], kaggle = null, coreforgeNews = [] }: AppProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  // Read during the first render, before any effect can rewrite the hash; never rendered.
  const [arrivalHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash.slice(1)));

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
            <LensChipsContext.Provider value={lensChips}>
              <KaggleDataContext.Provider value={kaggle}>
                <AboutSection />
              </KaggleDataContext.Provider>
            </LensChipsContext.Provider>
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <SkillsSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ToolsStrip />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ServerInterestsContext.Provider value={interests}>
              <ProjectsSection />
            </ServerInterestsContext.Provider>
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <CoreforgeSection newsItems={coreforgeNews} />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <ExperienceSection />
          </SectionTransition>
          <SectionTransition className={SHEET}>
            <CertificationsSection />
          </SectionTransition>
          {kaggle ? (
            <SectionTransition className={SHEET}>
              <KaggleSection data={kaggle} />
            </SectionTransition>
          ) : null}
          <SectionTransition className={SHEET}>
            <PhilosophySection />
          </SectionTransition>
          <div className="relative z-30 bg-bg-base">
            <ContactSection />
          </div>
          <HashArrival id={arrivalHash} />
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
