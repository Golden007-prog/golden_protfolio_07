'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { useIntro } from '@/contexts/IntroContext';
import { useHydrated } from '@/hooks/useHydrated';
import { getMotionPrefs } from '@/hooks/useMotionPrefs';
import { useScrollLock } from '@/hooks/useScrollLock';

/** The curtain stays at least this long after navigation start... */
const MIN_MS = 600;
/** ...and never longer, whatever the fonts and the hero are doing. */
const CAP_MS = 1400;
const EXIT_MS = 750;

const FIRST = 'Oikantik’s';
const SECOND = 'Portfolio';

// Mirrors ease.curtain / ease.out / ease.in from lib/motion for WAAPI.
const CURTAIN = 'cubic-bezier(0.87, 0, 0.13, 1)';
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN = 'cubic-bezier(0.7, 0, 0.84, 0)';

function navStart(): number {
  return typeof window.__navStart === 'number' ? window.__navStart : Date.now() - performance.now();
}

function Letters({ word, offset }: { word: string; offset: number }) {
  return (
    <>
      {Array.from(word).map((ch, i) => (
        <span key={i} className="intro-letter" style={{ '--i': offset + i } as CSSProperties}>
          {ch}
        </span>
      ))}
    </>
  );
}

type Props = {
  /** The page behind the curtain: made inert while it shows, and settled from 1.04 to 1 as it leaves. */
  pageRef?: RefObject<HTMLElement | null>;
};

/**
 * First-visit intro curtain. It is always server-rendered, and CSS shows it only
 * under html.js[data-intro=pending], so it covers the page from the first paint
 * (no flash) and never appears without JS. After hydration it waits for the web
 * fonts and the hero, bounded to 600-1400ms from navigation start, then splits
 * open and calls markDone(). Skip, any key, a click or a wheel ends it early.
 */
export default function LoadingScreen({ pageRef }: Props) {
  const hydrated = useHydrated();
  const { phase, heroReady, markDone } = useIntro();
  const active = hydrated && phase === 'pending';
  const [fontsReady, setFontsReady] = useState(false);
  const [exiting, setExiting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useScrollLock(active);

  useEffect(() => {
    const page = pageRef?.current;
    if (!active || !page) return;
    page.inert = true;
    return () => {
      page.inert = false;
    };
  }, [active, pageRef]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    (document.fonts?.ready ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (alive) setFontsReady(true);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  // Leave when ready, but not before MIN_MS, and at CAP_MS regardless.
  useEffect(() => {
    if (!active || exiting) return;
    const start = navStart();
    const at = fontsReady && heroReady ? Math.max(start + MIN_MS, Date.now()) : start + CAP_MS;
    const timer = window.setTimeout(() => setExiting(true), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(timer);
  }, [active, exiting, fontsReady, heroReady]);

  // Any key, click, tap or wheel skips. Tab and bare modifiers do not, so the Skip button stays reachable.
  useEffect(() => {
    if (!active || exiting) return;
    const skip = () => setExiting(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      skip();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('wheel', skip);
    };
  }, [active, exiting]);

  // Nothing scrolls while the curtain is up, including during the exit.
  useEffect(() => {
    if (!active) return;
    const block = (e: Event) => e.preventDefault();
    const blockKeys = (e: KeyboardEvent) => {
      if ([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) e.preventDefault();
    };
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('keydown', blockKeys);
    return () => {
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('keydown', blockKeys);
    };
  }, [active]);

  // The exit: text lifts away, the two panels split, the page settles from 1.04.
  useEffect(() => {
    if (!exiting) return;
    const root = rootRef.current;
    const page = pageRef?.current ?? null;
    if (!root || getMotionPrefs().reduce || typeof root.animate !== 'function') {
      markDone();
      return;
    }

    const content = root.querySelector<HTMLElement>('.intro-content');
    const top = root.querySelector<HTMLElement>('[data-side="top"]');
    const bottom = root.querySelector<HTMLElement>('[data-side="bottom"]');
    const anims: Animation[] = [];
    const run = (el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      if (el) anims.push(el.animate(frames, { fill: 'both', ...opts }));
    };

    run(content, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px)' }], {
      duration: 240,
      easing: IN,
    });
    run(top, [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], {
      duration: EXIT_MS,
      delay: 100,
      easing: CURTAIN,
    });
    run(bottom, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], {
      duration: EXIT_MS,
      delay: 100,
      easing: CURTAIN,
    });
    // The content settles, not the whole wrapper: a transform there would re-anchor
    // every fixed descendant (nav, dock) to the page for the length of the exit.
    const stage = page?.querySelector<HTMLElement>('#main') ?? page;
    if (stage) {
      // Scale about the middle of what is on screen, not the middle of the whole page.
      stage.style.transformOrigin = `50% ${Math.round(window.scrollY + window.innerHeight / 2)}px`;
      run(stage, [{ transform: 'scale(1.04)' }, { transform: 'none' }], { duration: EXIT_MS, delay: 100, easing: OUT });
    }

    let alive = true;
    Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (!alive) return;
        markDone();
        // Drop the finished transforms entirely rather than leaving scale(1) behind.
        anims.forEach((a) => a.cancel());
        if (stage) stage.style.transformOrigin = '';
        // Positions measured while the page was scaled are stale.
        import('gsap/ScrollTrigger')
          .then(({ ScrollTrigger }) => ScrollTrigger.refresh())
          .catch(() => {});
      },
      () => {},
    );
    return () => {
      alive = false;
      anims.forEach((a) => a.cancel());
      if (stage) stage.style.transformOrigin = '';
    };
  }, [exiting, markDone, pageRef]);

  // Once the intro is over (or was never due) the curtain leaves the DOM.
  if (hydrated && phase === 'done') return null;

  return (
    <div ref={rootRef} className="intro-curtain" data-intro-curtain="" data-state={exiting ? 'exit' : 'idle'}>
      <div className="intro-panel" data-side="top" />
      <div className="intro-panel" data-side="bottom" />
      <div className="intro-content">
        <div role="status" className="flex flex-col items-center gap-6">
          <p className="intro-title">
            <span className="sr-only">
              {FIRST} {SECOND}. Loading.
            </span>
            <span aria-hidden="true" data-word="first">
              <Letters word={FIRST} offset={0} />
            </span>
            <span aria-hidden="true" data-word="second">
              <Letters word={SECOND} offset={FIRST.length} />
            </span>
          </p>
          <span className="intro-bar" aria-hidden="true">
            <span />
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExiting(true)}
          className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 text-text-secondary"
        >
          Skip intro
        </Button>
      </div>
    </div>
  );
}
