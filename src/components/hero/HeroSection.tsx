'use client';

import { lazy, useEffect, useLayoutEffect, useRef } from 'react';
import { preload } from 'react-dom';
import Image, { getImageProps } from 'next/image';
import { ChevronDown, Hand } from 'lucide-react';
import { FounderBadge } from '@/components/coreforge/FounderBadge';
import { BackgroundVideo } from '@/components/shared/BackgroundVideo';
import { Deferred3D } from '@/components/shared/Deferred3D';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { LocalTime } from '@/components/ui/LocalTime';
import { SocialLinks } from '@/components/ui/SocialLinks';
import { useIntro } from '@/contexts/IntroContext';
import { useSmoothScrollTo } from '@/contexts/LenisContext';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useRenderCount } from '@/lib/devRenderCount';
import { heroScroll, resetHeroScroll } from '@/lib/heroScrollStore';
import { pointer, subscribePointer, subscribeScroll, usePointerTracking } from '@/lib/pointerStore';
import { SITE } from '@/lib/site';
import { RoleTicker } from './RoleTicker';

type Gsap = typeof import('gsap').default;
type ScrollTriggerStatic = typeof import('gsap/ScrollTrigger').ScrollTrigger;

type GsapModules = { gsap: Gsap; ScrollTrigger: ScrollTriggerStatic };

// GSAP loads beside the page rather than in its first chunk: Lenis and the intro
// curtain fetch the same chunk, and the hero is readable before it arrives.
let gsapLoaded: GsapModules | null = null;
let gsapLoad: Promise<GsapModules> | null = null;
function loadGsap() {
  gsapLoad ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
    ([{ default: gsap }, { ScrollTrigger }]) => {
      gsap.registerPlugin(ScrollTrigger);
      gsapLoaded = { gsap, ScrollTrigger };
      return gsapLoaded;
    },
    (err: unknown) => {
      gsapLoad = null;
      throw err;
    },
  );
  return gsapLoad;
}

const HeroCanvas = lazy(() => import('./HeroCanvas'));

const FIRST_NAME = SITE.shortName;
const LAST_NAME = SITE.name.slice(SITE.shortName.length).trim();

// Matches IntroContext's failsafe: a hydration later than this has already shown the
// name through the index.css failsafe, so it must not be hidden again and replayed.
const INTRO_FAILSAFE_MS = 4000;
// heroReady for the curtain even if neither the model nor a fallback reports in.
const HERO_READY_CAP_MS = 2500;
const CUE_HIDE_Y = 100;

const WAVE_SEGMENT = [0, 31] as const;
// scroll.json's near-white stroke disappears on cream; light uses text-muted.
const CUE_COLORS = { light: { '#E2F6FD': '#55555F' } };

// The model still: Deferred3D's server and fallback render, shown by hero.css on
// phones, under reduced motion and on lite devices (and lazy, so never fetched when hidden).
const HERO_STILL_SRC = '/images/hero-still.webp';
const HERO_STILL_SIZES = '(max-width: 767px) 82vw, (max-width: 1023px) 45vw, 58vw';
const HERO_STILL = (
  <div data-depth="12" className="absolute inset-0">
    <Image
      src={HERO_STILL_SRC}
      alt=""
      fill
      sizes={HERO_STILL_SIZES}
      fetchPriority="high"
      className="hero-still object-contain object-center"
    />
  </div>
);

// On phones the still is the LCP element, but a lazy image is only requested after
// CSS and layout. A preload in <head> starts it with the HTML, scoped by media to
// where hero.css shows it (below 1024px, on coarse pointers, which mark the page
// lite, and under reduced motion), so a desktop that never shows it never fetches it.
const STILL_PRELOAD_MEDIA = '(max-width: 1023.98px), (pointer: coarse), (prefers-reduced-motion: reduce)';
const { props: STILL_PROPS } = getImageProps({ src: HERO_STILL_SRC, alt: '', fill: true, sizes: HERO_STILL_SIZES });

function WaveHello({ play }: { play: boolean }) {
  const hand = <Hand aria-hidden="true" className="size-4 text-text-secondary" />;
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center">
      {play ? (
        <LottieIcon name="wave" play="once" lazy="idle" segment={WAVE_SEGMENT} className="block size-6" fallback={hand} />
      ) : (
        hand
      )}
    </span>
  );
}

function ScrollCue() {
  const scrollTo = useSmoothScrollTo();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A DOM attribute, not state: crossing the threshold never re-renders the hero.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const sync = () => el.toggleAttribute('data-hidden', window.scrollY > CUE_HIDE_Y);
    sync();
    return subscribeScroll(sync);
  }, []);

  return (
    <div data-hero-cue="" data-reveal="" className="hero-cue hero-intro">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Scroll to About"
        onClick={() => scrollTo('about')}
        className="hero-cue-button tap-safe ring-focus rounded-full text-text-muted hover:text-text-primary"
      >
        <LottieIcon
          name="scroll"
          play="hover"
          lazy="idle"
          hoverTargetRef={buttonRef}
          colors={CUE_COLORS}
          className="block size-8"
          fallback={<ChevronDown aria-hidden="true" className="size-5" />}
        />
      </button>
    </div>
  );
}

export function HeroSection() {
  useRenderCount('HeroSection');
  usePointerTracking();
  preload(STILL_PROPS.src, {
    as: 'image',
    imageSrcSet: STILL_PROPS.srcSet,
    imageSizes: STILL_PROPS.sizes,
    fetchPriority: 'high',
    media: STILL_PRELOAD_MEDIA,
  });
  const { reduce, lite, scale, finePointer, hover } = useMotionPrefs();
  const { isTouch } = useDeviceCapability();
  const { done, heroReady, setHeroReady } = useIntro();
  const sectionRef = useRef<HTMLElement>(null);
  const introPending = useRef(false);

  // Decided once, at hydration: only a first visit on '/' (bootstrap data-intro=pending)
  // plays the full reveal. It runs before IntroProvider's effects can end the intro.
  useLayoutEffect(() => {
    const attr = document.documentElement.getAttribute('data-intro');
    const start = window.__navStart;
    const late = typeof start === 'number' && Date.now() - start > INTRO_FAILSAFE_MS;
    if ((attr === 'pending' || attr === 'playing') && !late && !getMotionPrefs().reduce) {
      introPending.current = true;
      heroScroll.bloom = 0;
      sectionRef.current?.setAttribute('data-intro', 'play');
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(setHeroReady, HERO_READY_CAP_MS);
    return () => {
      window.clearTimeout(t);
      resetHeroScroll();
    };
  }, [setHeroReady]);

  // Fetch GSAP at hydration, so the intro never waits on it once the curtain lifts.
  useEffect(() => {
    if (!getMotionPrefs().reduce) loadGsap().catch(() => {});
  }, []);

  // Intro timeline (first visit, after the curtain) and the scroll exit scrub. Every
  // tween and trigger lives in one gsap.context, reverted whenever an input changes.
  // A layout effect, so with GSAP already loaded the intro's first frame is set before paint.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || !done) return;
    if (reduce) {
      // Motion was reduced before the reveal could run: nothing hides or dims the hero.
      introPending.current = false;
      heroScroll.bloom = 1;
      return;
    }
    let cancelled = false;
    let ctx: ReturnType<Gsap['context']> | null = null;
    let removeSkip = () => {};

    const run = ({ gsap, ScrollTrigger }: GsapModules) => {
      const q = gsap.utils.selector(section);

      // Inner wrappers only: the intro never animates these, so the two can't fight over y/opacity.
      const buildExit = () => {
        const travel = (vh: number) => () => -window.innerHeight * vh * scale;
        const video = q('[data-hero-video]');
        gsap
          .timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: 'bottom top',
              scrub: 0.6,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                heroScroll.progress = self.progress;
              },
            },
          })
          .fromTo(q('[data-hero-exit="kicker"]'), { y: 0 }, { y: travel(0.3) }, 0)
          .fromTo(q('[data-hero-exit="first"]'), { y: 0 }, { y: travel(0.12) }, 0)
          .fromTo(q('[data-hero-exit="last"]'), { y: 0, opacity: 1 }, { y: travel(0.2), opacity: 0.15 }, 0)
          .fromTo(
            video,
            lite ? { scale: 1 } : { scale: 1, filter: 'blur(0px)' },
            lite ? { scale: 1.08 } : { scale: 1.08, filter: 'blur(6px)' },
            0,
          );
      };

      if (introPending.current) {
        introPending.current = false;
        // A proxy, so reverting the timeline never drops the live bloom back to 0.
        const bloom = { v: 0 };
        const tl = gsap.timeline({
          defaults: { ease: 'expo.out' },
          onComplete: () => {
            removeSkip();
            // Created after the context function returned, so added to the context explicitly.
            ctx?.add(() => buildExit());
            ScrollTrigger.refresh();
          },
        });
        tl.fromTo(q('[data-hero-hairline]'), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power3.inOut', clearProps: 'transform' }, 0)
          .fromTo(
            q('[data-hero-kicker-item]'),
            { opacity: 0, x: -8 },
            { opacity: 1, x: 0, duration: 0.6, stagger: 0.06, clearProps: 'transform,opacity' },
            0.05,
          )
          .fromTo(
            q('.hero-first .hero-char'),
            { yPercent: 110, rotateX: -70, opacity: 0, transformPerspective: 800, transformOrigin: '50% 100%' },
            { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.9, stagger: 0.03, clearProps: 'transform,opacity' },
            0.1,
          )
          .fromTo(
            q('.hero-last'),
            { clipPath: 'inset(-20% 100% -20% -8%)', opacity: 1, backgroundPosition: '100% 50%' },
            {
              clipPath: 'inset(-20% -8% -20% -8%)',
              backgroundPosition: '0% 50%',
              duration: 1.1,
              ease: 'power3.inOut',
              clearProps: 'clipPath,opacity,backgroundPosition',
            },
            0.35,
          )
          .fromTo(
            bloom,
            { v: 0 },
            {
              v: 1,
              duration: 1.2,
              ease: 'power2.out',
              onUpdate: () => {
                heroScroll.bloom = bloom.v;
              },
            },
            0.6,
          )
          .fromTo(
            q('[data-hero-rise]'),
            { y: 16 * scale, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, clearProps: 'transform,opacity' },
            0.75,
          )
          .fromTo(
            q('[data-hero-cue]'),
            { y: -6, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.6, clearProps: 'transform,opacity' },
            1.1,
          );

        // Any scroll during the reveal jumps it to the end, then the scrub takes over.
        const skip = () => {
          if (tl.progress() < 1) tl.progress(1);
        };
        const onScroll = () => {
          if (window.scrollY > 4) skip();
        };
        window.addEventListener('wheel', skip, { passive: true });
        window.addEventListener('touchmove', skip, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        removeSkip = () => {
          window.removeEventListener('wheel', skip);
          window.removeEventListener('touchmove', skip);
          window.removeEventListener('scroll', onScroll);
        };
      } else {
        buildExit();
      }
    };

    const start = (mods: GsapModules) => {
      ctx = mods.gsap.context(() => run(mods), section);
    };
    if (gsapLoaded) start(gsapLoaded);
    else
      loadGsap().then(
        (mods) => {
          if (!cancelled) start(mods);
        },
        () => {
          // No GSAP (a failed chunk): the hero simply stays in its final, readable state.
          if (cancelled) return;
          introPending.current = false;
          heroScroll.bloom = 1;
        },
      );

    return () => {
      cancelled = true;
      removeSkip();
      ctx?.revert();
      ctx = null;
      heroScroll.progress = 0;
      heroScroll.bloom = 1;
    };
  }, [done, reduce, lite, scale]);

  // Pointer parallax: three depths from one rAF loop that sleeps when the pointer rests.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || reduce || !finePointer || !hover) return;
    let raf = 0;
    let last = 0;
    let x = 0;
    let y = 0;
    let inView = true;
    const layers = () => section.querySelectorAll<HTMLElement>('[data-depth]');

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      const k = 1 - Math.pow(0.9, dt / 16.7);
      const tx = pointer.active ? pointer.nx : 0;
      const ty = pointer.active ? pointer.ny : 0;
      x += (tx - x) * k;
      y += (ty - y) * k;
      layers().forEach((el) => {
        const d = Number(el.dataset.depth) || 0;
        el.style.transform = `translate3d(${(x * d).toFixed(2)}px, ${(-y * d).toFixed(2)}px, 0)`;
      });
      if (Math.abs(tx - x) > 0.0005 || Math.abs(ty - y) > 0.0005) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const kick = () => {
      if (!raf && inView) raf = requestAnimationFrame(frame);
    };

    const unsubscribe = subscribePointer(kick);
    const io = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      if (inView) kick();
    });
    io.observe(section);
    return () => {
      unsubscribe();
      io.disconnect();
      cancelAnimationFrame(raf);
      layers().forEach((el) => el.style.removeProperty('transform'));
    };
  }, [reduce, finePointer, hover]);

  return (
    <section
      ref={sectionRef}
      id="hero"
      aria-labelledby="hero-title"
      data-hero-ready={heroReady ? '' : undefined}
      className="hero relative isolate flex min-h-[100svh] flex-col"
    >
      {/* Backdrop. overflow-clip (not hidden) keeps it sticky-safe while the scrub scales the video. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-clip">
        <div data-hero-video="" className="absolute inset-0">
          <div className="dark-only absolute inset-0">
            <BackgroundVideo
              variant="dark"
              src="/videos/hero-bg.mp4"
              poster="/images/hero-poster.webp"
              className="h-full w-full object-cover opacity-20"
            />
          </div>
          <div className="light-only absolute inset-0">
            <BackgroundVideo
              variant="light"
              src="/videos/hero-bg-light.mp4"
              className="h-full w-full object-cover opacity-55"
            />
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg-base/90" />
      </div>

      <div aria-hidden="true" className="hero-visual">
        <div data-depth="-22" className="dark-only absolute inset-0">
          <span className="hero-glow hero-glow-a" />
          <span className="hero-glow hero-glow-b" />
          <span className="hero-glow hero-glow-c" />
        </div>
        <div data-depth="12" className="hero-halo absolute inset-0" />
        <Deferred3D id="hero" className="absolute inset-0" fallback={HERO_STILL} onFallback={setHeroReady}>
          <HeroCanvas onReady={setHeroReady} />
        </Deferred3D>
      </div>

      <div aria-hidden="true" className="hero-scrim" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center">
        <div className="hero-col">
          <div data-hero-exit="kicker" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span data-hero-hairline="" data-reveal="" className="hero-intro hero-hairline" aria-hidden="true" />
            <span data-hero-kicker-item="" data-reveal="" className="hero-intro inline-flex items-center gap-2">
              <WaveHello play={done} />
              <span aria-hidden="true" className="hero-status-dot" />
              <span className="font-mono text-xs text-text-secondary">{SITE.availability.status}</span>
            </span>
            <span data-hero-kicker-item="" data-reveal="" className="hero-intro inline-flex">
              <LocalTime showOffset city={SITE.location} />
            </span>
            <span data-hero-kicker-item="" data-reveal="" className="hero-intro inline-flex">
              <FounderBadge variant="nav" placement="hero-kicker" />
            </span>
          </div>

          <div data-depth="-6" className="hero-name-layer">
            <h1 id="hero-title" aria-label={SITE.name} className="hero-name font-display font-bold text-text-primary">
              <span data-hero-exit="first" className="block">
                <span aria-hidden="true" className="hero-first">
                  {Array.from(FIRST_NAME).map((char, i) => (
                    <span key={i} className="hero-char">
                      {char}
                    </span>
                  ))}
                </span>
              </span>
              <span data-hero-exit="last" className="block">
                <span aria-hidden="true" className="hero-char hero-last">
                  {LAST_NAME}.
                </span>
              </span>
            </h1>
          </div>

          <div data-hero-rise="" data-reveal="" className="hero-intro hero-copy">
            <RoleTicker active={done} />
            <p className="hero-tagline text-sm leading-relaxed text-text-muted">
              LLM fine-tuning · RAG · Multi-agent systems. Shipping production ML &amp; agentic AI from Bengaluru.
            </p>
          </div>

          {/* data-dock-avoid: the floating dock tucks away rather than cover these on short phones. */}
          <div data-dock-avoid="" className="hero-ctas">
            <span data-hero-rise="" data-reveal="" className="hero-intro flex">
              <Button
                href="#projects"
                variant="primary"
                size="lg"
                shine
                magnetic
                cursor="view"
                className="w-full px-4 text-sm sm:w-auto sm:px-7 sm:text-[15px]"
              >
                View projects
              </Button>
            </span>
            <span data-hero-rise="" data-reveal="" className="hero-intro flex">
              {/* On a phone, copying an address is awkward: open the mail app with the subject filled in. */}
              <Button
                href={isTouch ? SITE.mailtoHref : '#contact'}
                variant="secondary"
                size="lg"
                cursor={isTouch ? 'open' : undefined}
                data-hero-contact=""
                className="hero-beam w-full px-4 text-sm sm:w-auto sm:px-7 sm:text-[15px]"
              >
                Get in touch
              </Button>
            </span>
            <span data-hero-rise="" data-reveal="" className="hero-intro hero-cta-cv flex">
              <DownloadCvButton
                variant="outline"
                size="md"
                showMeta
                showView
                className="flex w-full sm:inline-flex sm:w-auto [&>a]:whitespace-nowrap [&>a]:px-4 sm:[&>a]:px-5 [&>[data-cv-download]]:flex-1 sm:[&>[data-cv-download]]:flex-none"
              />
            </span>
          </div>

          <div data-hero-rise="" data-reveal="" data-dock-avoid="" className="hero-intro hero-meta flex flex-wrap items-center gap-2">
            <CopyButton value={SITE.email} label={SITE.email} variant="ghost" size="md" className="-ml-2" />
            <SocialLinks size="md" />
          </div>
        </div>
      </div>

      <ScrollCue />
    </section>
  );
}

export default HeroSection;
