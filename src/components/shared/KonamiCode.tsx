'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Terminal, X } from 'lucide-react';
import projects from '@/data/projects.json';
import { Button } from '@/components/ui/Button';
import { useHotkeys, useSingleKeyShortcuts } from '@/hooks/useHotkeys';
import { useRenderCount } from '@/lib/devRenderCount';
import { duration, ease } from '@/lib/motion';
import { SITE } from '@/lib/site';

const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

const COMMIT = process.env.NEXT_PUBLIC_COMMIT || 'local';

// Every line traces to package.json, next.config.ts (the commit) or src/data.
const FACTS: readonly string[] = [
  'This page is Next.js 16 on React 19, styled with Tailwind CSS 4.',
  'The motion here comes from Framer Motion 12 and GSAP 3, with Lenis smoothing the scroll.',
  'The 3D scenes are React Three Fiber 9 drawing with three.js.',
  'The small looping icons are Lottie files played by lottie-react.',
  `There are ${projects.length} projects in this build's data, and you are looking at commit ${COMMIT}.`,
];

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'));
}

/**
 * Konami code easter egg. The key buffer lives in a ref, so typing anywhere on
 * the site never re-renders this; the fact is chosen once per unlock.
 */
export function KonamiCode() {
  useRenderCount('Konami');
  const [fact, setFact] = useState<string | null>(null);
  const buffer = useRef<string[]>([]);
  const [singleKeys] = useSingleKeyShortcuts();

  // A letter sequence counts as character-key shortcuts (WCAG 2.1.4), so it follows that switch.
  useEffect(() => {
    if (!singleKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || isEditable(e.target)) return;
      const next = [...buffer.current, e.code].slice(-SEQUENCE.length);
      buffer.current = next;
      if (next.length === SEQUENCE.length && next.every((k, i) => k === SEQUENCE[i])) {
        buffer.current = [];
        setFact(FACTS[Math.floor(Math.random() * FACTS.length)]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [singleKeys]);

  useHotkeys({ escape: () => setFact(null) }, { enabled: fact !== null });

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 z-toast sm:right-auto sm:w-96"
      style={{
        left: 'calc(1rem + env(safe-area-inset-left))',
        bottom: 'calc(var(--dock-clearance) + var(--dock-height) + 0.75rem)',
      }}
    >
      <AnimatePresence>
        {fact ? (
          <motion.div
            key="konami"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: ease.out } }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.2, ease: ease.in } }}
            className="glass-strong glass-keep pointer-events-auto relative p-5 pr-14"
            data-konami=""
          >
            <Button
              variant="icon"
              aria-label="Close developer note"
              onClick={() => setFact(null)}
              className="absolute right-2 top-2 size-11"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
            <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-success">
              <Terminal aria-hidden="true" className="size-3.5" />
              Dev mode unlocked
            </p>
            <p className="text-sm leading-relaxed text-text-secondary">{fact}</p>
            <p className="mt-3 font-mono text-[11px] text-text-muted">
              <a
                href={`${SITE.repoUrl}${COMMIT === 'local' ? '' : `/commit/${COMMIT}`}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-hairline underline-offset-4 ring-focus hover:text-text-primary"
              >
                Source on GitHub<span className="sr-only"> (opens in new tab)</span>
              </a>
              <span aria-hidden="true"> · ↑ ↑ ↓ ↓ ← → ← → B A</span>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
