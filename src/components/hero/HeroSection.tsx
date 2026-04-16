import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import profile from '../../data/profile.json';
import { Magnetic } from '../shared/Magnetic';

const ROLES = [
  'Gen AI & Data Science Engineer',
  'LLM Agent Architect',
  'Production ML Engineer',
  'Data Pipeline Builder',
];

function useTypewriterCycle(words: string[], typeMs = 60, holdMs = 2200, eraseMs = 30) {
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const run = async () => {
      while (!cancelled) {
        const word = words[i % words.length];
        for (let c = 0; c <= word.length && !cancelled; c++) {
          setText(word.slice(0, c));
          await new Promise((r) => setTimeout(r, typeMs));
        }
        await new Promise((r) => setTimeout(r, holdMs));
        for (let c = word.length; c >= 0 && !cancelled; c--) {
          setText(word.slice(0, c));
          await new Promise((r) => setTimeout(r, eraseMs));
        }
        i++;
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [words, typeMs, holdMs, eraseMs]);
  return text;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Burning the midnight oil?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Late-night browsing?';
}

const HeroCanvas = lazy(() => import('./HeroCanvas').then((m) => ({ default: m.HeroCanvas })));

gsap.registerPlugin(ScrollTrigger);

function splitChars(text: string) {
  return text.split('').map((char, i) => (
    <span key={i} className="char inline-block" style={{ perspective: '1000px' }}>
      {char === ' ' ? '\u00A0' : char}
    </span>
  ));
}

export function HeroSection() {
  const base = import.meta.env.BASE_URL;
  const sectionRef = useRef<HTMLElement>(null);
  const firstNameRef = useRef<HTMLSpanElement>(null);
  const lastNameRef = useRef<HTMLSpanElement>(null);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const role = useTypewriterCycle(ROLES);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const chars = sectionRef.current?.querySelectorAll('.char');
      if (chars && chars.length) {
        gsap.fromTo(
          chars,
          { y: 120, opacity: 0, rotateX: -80 },
          {
            y: 0,
            opacity: 1,
            rotateX: 0,
            stagger: 0.035,
            duration: 1.1,
            ease: 'power3.out',
            delay: 0.4,
          },
        );
      }
      if (lastNameRef.current) {
        gsap.fromTo(
          lastNameRef.current,
          { y: 120, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 1.1,
            ease: 'power3.out',
            delay: 0.4 + 0.035 * (chars?.length ?? 0),
          },
        );
      }

      gsap.to([firstNameRef.current, lastNameRef.current], {
        y: -60,
        opacity: 0.15,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: '40% top',
          end: 'bottom top',
          scrub: true,
        },
      });

      gsap.to(scrollIndicatorRef.current, {
        opacity: 0,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: '10% top',
          end: '20% top',
          scrub: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} id="hero" className="relative h-screen">
      <div className="relative h-screen overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none dark-only">
          <video
            autoPlay muted loop playsInline preload="auto"
            poster={`${base}images/skills-bg.webp`}
            aria-hidden="true"
            className="w-full h-full object-cover opacity-20"
          >
            <source src={`${base}videos/hero-bg.mp4`} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-r from-bg-base via-bg-base/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg-base/90" />
        </div>

        <div className="absolute inset-0 z-0 pointer-events-none light-only">
          <video
            autoPlay muted loop playsInline preload="auto"
            aria-hidden="true"
            className="w-full h-full object-cover opacity-55"
          >
            <source src={`${base}videos/hero-bg-light.mp4`} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-r from-bg-base via-bg-base/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg-base/80" />
        </div>

        <div className="absolute right-0 top-0 w-full lg:w-[58%] h-full">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden dark-only"
          >
            <div
              className="absolute top-[18%] right-[10%] w-[420px] h-[420px] rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(168,85,247,0.35), transparent 70%)',
                filter: 'blur(120px)',
              }}
            />
            <div
              className="absolute bottom-[10%] right-[28%] w-[360px] h-[360px] rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(6,182,212,0.22), transparent 70%)',
                filter: 'blur(110px)',
              }}
            />
            <div
              className="absolute top-[35%] right-[5%] w-[260px] h-[260px] rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(236,72,153,0.18), transparent 70%)',
                filter: 'blur(100px)',
              }}
            />
          </div>
          <Suspense fallback={<div className="w-full h-full animate-pulse" />}>
            <HeroCanvas />
          </Suspense>
        </div>

        <div className="absolute inset-0 bg-gradient-to-r from-bg-base via-bg-base/70 to-transparent lg:via-bg-base/40 z-10 pointer-events-none" />

        <div className="relative z-20 h-full container-padding mx-auto max-w-[1440px] flex flex-col justify-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-text-dim mb-8">
            <span className="text-cyan-bright">{greeting()}</span> · {profile.location} · Available for hire
          </p>

          <h1 className="font-display font-bold leading-[0.85] tracking-[-0.035em]">
            <span
              ref={firstNameRef}
              className="block text-[clamp(3rem,7.5vw,7rem)] text-text-primary"
            >
              {splitChars('Oikantik')}
            </span>
            <span
              ref={lastNameRef}
              className="block text-[clamp(3rem,7.5vw,7rem)]"
              style={{
                backgroundImage: 'linear-gradient(90deg, #A855F7 0%, #EC4899 50%, #22D3EE 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              Basu.
            </span>
          </h1>

          <div className="mt-8 max-w-md min-h-[80px]">
            <p className="font-mono text-sm text-violet-bright/80">
              <span className="text-text-dim">&gt;_</span> {role}
              <span className="typing-cursor" />
            </p>
            <p className="mt-3 text-text-muted text-sm leading-relaxed">
              LLM fine-tuning · RAG · Multi-agent systems. Shipping production
              ML &amp; agentic AI from Bengaluru.
            </p>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4">
            <Magnetic strength={0.3}>
              <a
                href="#projects"
                className="group relative inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 bg-text-primary text-bg-base text-sm font-medium rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_40px_rgba(168,85,247,0.35)] w-full sm:w-auto"
              >
                View Projects
                <span className="inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </Magnetic>
            <Magnetic strength={0.3}>
              <a
                href="#contact"
                className="group inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 text-text-secondary text-sm font-medium border border-glass-border-strong rounded-full backdrop-blur-sm hover:border-violet-bright/60 hover:text-text-primary hover:bg-violet-bright/5 transition-all duration-300 w-full sm:w-auto"
              >
                Get in touch
                <span className="inline-block ml-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
              </a>
            </Magnetic>
            <Magnetic strength={0.45}>
              <a
                href={`${base}oikantik_basu_u.pdf`}
                download
                className="inline-flex items-center justify-center sm:justify-start px-4 sm:px-5 py-3 sm:py-3.5 text-xs font-mono uppercase tracking-wider text-violet-bright/90 hover:text-cyan-bright transition-colors"
              >
                Download CV ↓
              </a>
            </Magnetic>
          </div>
        </div>

        <div
          ref={scrollIndicatorRef}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-text-dim">Scroll</span>
          <div className="relative w-px h-10 overflow-hidden bg-white/5">
            <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-violet-bright to-transparent scroll-indicator" />
          </div>
        </div>
      </div>
    </section>
  );
}
