import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface NarrativeWord {
  text: string;
  accent?: boolean;
  break?: boolean;
}

const NARRATIVE: NarrativeWord[] = [
  { text: 'Building' },
  { text: 'the' },
  { text: 'future', accent: true },
  { text: 'with', break: true },
  { text: 'Data', accent: true },
  { text: '&' },
  { text: 'Intelligence', accent: true, break: true },
  { text: 'Machine' },
  { text: 'Learning', accent: true },
  { text: 'is', break: true },
  { text: 'an' },
  { text: 'Art', accent: true, break: true },
  { text: 'requiring', break: true },
  { text: 'fluency', accent: true },
  { text: 'with', break: true },
  { text: 'Models' },
  { text: '&' },
  { text: 'Data', accent: true },
];

export function ScrollNarrative() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const words = wordsRef.current.filter(Boolean) as HTMLSpanElement[];
    if (!words.length || !containerRef.current) return;

    // Simple staggered reveal on scroll — NO pinning
    const anim = gsap.from(words, {
      opacity: 0,
      y: 50,
      filter: 'blur(6px)',
      stagger: 0.08,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: containerRef.current,
        start: 'top 70%',
        end: 'bottom 30%',
        toggleActions: 'play none none reverse',
        // NO pin, NO scrub — just trigger-based
      },
    });

    return () => {
      anim.scrollTrigger?.kill();
      anim.kill();
    };
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative py-32 md:py-48 container-padding overflow-hidden"
      style={{ zIndex: 5, backgroundColor: 'var(--app-bg-base)' }}
    >
      <div className="max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-text-dim mb-10">
          What I do
        </p>
        <p className="font-display font-semibold leading-[1.05] tracking-[-0.03em] text-[clamp(2rem,5vw,5rem)]">
          {NARRATIVE.map((word, i) => (
            <span key={i}>
              <span
                ref={(el) => {
                  wordsRef.current[i] = el;
                }}
                className={
                  word.accent
                    ? 'inline-block mr-[0.25em] italic bg-gradient-to-r from-violet-bright via-pink to-cyan-bright bg-clip-text text-transparent'
                    : 'inline-block mr-[0.25em] text-text-primary/90'
                }
              >
                {word.text}
              </span>
              {word.break && <br />}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
