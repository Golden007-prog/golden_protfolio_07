import { useEffect, useState } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HeroSection } from './components/hero/HeroSection';
import { AboutSection } from './components/about/AboutSection';
import { SkillsSection } from './components/skills/SkillsSection';
import { ProjectsSection } from './components/projects/ProjectsSection';
import { ExperienceSection } from './components/experience/ExperienceSection';
import { PhilosophySection } from './components/shared/PhilosophySection';
import { ContactSection } from './components/contact/ContactSection';
import { LiveStatusBar } from './components/shared/LiveStatusBar';
import { AskMeBot } from './components/shared/AskMeBot';
import LoadingScreen from './components/loading/LoadingScreen';
import CometCursor from './components/shared/CometCursor';
import { AmbientSoundToggle } from './components/shared/AmbientSoundToggle';
import { KonamiCode } from './components/shared/KonamiCode';
import { BokehParticles } from './components/shared/BokehParticles';
import { ToolsStrip } from './components/shared/ToolsStrip';

const SESSION_KEY = 'ob-seen-loader-v2';

function App() {
  const [loaded, setLoaded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem(SESSION_KEY) === '1';
  });

  useEffect(() => {
    if (!loaded) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [loaded]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;
    const onMove = (e: MouseEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--mouse-x', `${pendingX}px`);
        document.documentElement.style.setProperty('--mouse-y', `${pendingY}px`);
        rafId = 0;
      });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (reduce) return;
      const r = document.createElement('div');
      r.className = 'click-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerdown', onPointerDown);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    const original = document.title;
    let awayTimer = 0;
    const onVis = () => {
      if (document.hidden) {
        awayTimer = window.setTimeout(() => {
          document.title = '👋 Come back! — Oikantik';
        }, 3000);
      } else {
        window.clearTimeout(awayTimer);
        document.title = original;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(awayTimer);
      document.title = original;
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      '%c👋 Hey, developer.',
      'color:#A855F7; font-size:18px; font-weight:700;',
    );
    // eslint-disable-next-line no-console
    console.log(
      '%cBuilt with React 19 · R3F · Framer Motion · GSAP · Tailwind 4.\nSource: https://github.com/Golden007-prog/golden_protfolio_07\nSay hi: basuoikantik@gmail.com',
      'color:#22D3EE; font-family:monospace; font-size:12px;',
    );
  }, []);

  const handleLoaderComplete = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setLoaded(true);
  };

  return (
    <>
      <CometCursor />

      {!loaded && <LoadingScreen onComplete={handleLoaderComplete} />}

      <div
        className={`relative min-h-screen bg-bg-base text-text-primary overflow-x-hidden aurora-bg transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-violet focus:text-white focus:outline-none focus:ring-2 focus:ring-cyan"
        >
          Skip to main content
        </a>
        <Navbar />
        <main id="main" className="relative z-10">
          <div className="relative z-[1]">
            <HeroSection />
          </div>
          <div className="relative z-20 bg-bg-base">
            <AboutSection />
          </div>
          <div className="relative z-20 bg-bg-base">
            <SkillsSection />
          </div>
          <div className="relative z-20 bg-bg-base">
            <ToolsStrip />
          </div>
          <div className="relative z-20 bg-bg-base">
            <ProjectsSection />
          </div>
          <div className="relative z-20 bg-bg-base">
            <ExperienceSection />
          </div>
          <div className="relative z-20 bg-bg-base">
            <PhilosophySection />
          </div>
          <div className="relative z-30 bg-bg-base">
            <ContactSection />
          </div>
        </main>
        <BokehParticles />
        <LiveStatusBar />
        <AmbientSoundToggle />
        <AskMeBot />
        <KonamiCode />
        <Footer />
        <div className="noise-overlay" aria-hidden="true" />
      </div>
    </>
  );
}

export default App;
