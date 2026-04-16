import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Terminal, X } from 'lucide-react';

const SEQUENCE = [
  'ArrowUp', 'ArrowUp',
  'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'ArrowLeft', 'ArrowRight',
  'KeyB', 'KeyA',
];

const EASTER_EGGS = [
  'Built this portfolio one Sunday afternoon while tuning a LoRA adapter in the other tab.',
  'The cyborg\'s helmet is a Meshy render, not a real photo. (Yet.)',
  'You unlocked developer commentary. Thanks for being curious.',
  'If you\'re a recruiter reading this — hi. I also debug in my dreams.',
  'The glitch effect on headings fires every 12–16s. You probably noticed.',
];

export function KonamiCode() {
  const [unlocked, setUnlocked] = useState(false);
  const [buffer, setBuffer] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setBuffer((prev) => {
        const next = [...prev, e.code].slice(-SEQUENCE.length);
        if (next.length === SEQUENCE.length && next.every((k, i) => k === SEQUENCE[i])) {
          setUnlocked(true);
          return [];
        }
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const msg = EASTER_EGGS[Math.floor(Math.random() * EASTER_EGGS.length)];

  return (
    <AnimatePresence>
      {unlocked && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-6 z-[90] max-w-sm glass-strong rounded-2xl p-5 pr-10"
        >
          <button
            type="button"
            onClick={() => setUnlocked(false)}
            aria-label="Close"
            className="absolute top-3 right-3 w-7 h-7 rounded-full hover:bg-white/5 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-center gap-2 mb-3">
            <Terminal size={14} className="text-emerald-400" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-300">
              Dev mode unlocked
            </span>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">{msg}</p>
          <p className="mt-3 font-mono text-[10px] text-text-dim">
            ↑ ↑ ↓ ↓ ← → ← → B A
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
