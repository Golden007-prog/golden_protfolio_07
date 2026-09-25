'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useScrambleText } from '@/hooks/useScrambleText';

export const ROLES = [
  'Gen AI & Data Science Engineer',
  'LLM Agent Architect',
  'Production ML Engineer',
  'Data Pipeline Builder',
] as const;

const DECODE_MS = 600;
const CYCLE_MS = 3200;

type Props = {
  /** False holds the first role, e.g. while the intro curtain is up. */
  active?: boolean;
  className?: string;
};

/**
 * The hero's rotating role line. Each change decodes in place through
 * useScrambleText, which writes textContent in rAF, so the only React work is
 * one render of this leaf per 3.2s cycle; the hero and its canvas never see it.
 * The cycle stops offscreen, in a hidden tab and while motion is paused; under
 * reduced motion the line is static. Screen readers get the full list instead
 * of the churning text.
 */
export function RoleTicker({ active = true, className }: Props) {
  const { paused } = useMotionPrefs();
  const hostRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);

  // The first role is server-rendered, so only later steps decode.
  useScrambleText(textRef, ROLES[step % ROLES.length], { duration: DECODE_MS, trigger: step > 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!active || paused || !host) return;
    let inView = false;
    let timer = 0;

    const tick = () => {
      setStep((s) => s + 1);
      timer = window.setTimeout(tick, CYCLE_MS);
    };
    const sync = () => {
      const run = inView && document.visibilityState === 'visible';
      if (run && !timer) {
        timer = window.setTimeout(tick, CYCLE_MS);
      } else if (!run && timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            inView = Boolean(entry?.isIntersecting);
            sync();
          });
    if (io) io.observe(host);
    else inView = true;
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.clearTimeout(timer);
    };
  }, [active, paused]);

  return (
    <div ref={hostRef} className={className} data-role-ticker="">
      <p aria-hidden="true" className="font-mono text-sm leading-relaxed text-violet-bright">
        <span className="text-text-muted">&gt;_</span>{' '}
        {/* React only ever renders the first role here; later roles are written by the decode. */}
        <span ref={textRef} data-role-text="">
          {ROLES[0]}
        </span>
        <span className="typing-cursor" />
      </p>
      <ul className="sr-only">
        {ROLES.map((role) => (
          <li key={role}>{role}</li>
        ))}
      </ul>
    </div>
  );
}

export default RoleTicker;
