import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SkillModal } from './SkillModal';
import type { SkillDetail } from '../../types/skills';

type Props = {
  name: string;
  detail?: SkillDetail;
  accent: 'violet' | 'cyan' | 'amber' | 'pink';
  delay?: number;
};

const ACCENT_BORDER: Record<Props['accent'], string> = {
  violet: 'border-violet-bright/40 hover:border-violet-bright hover:bg-violet/10',
  cyan: 'border-cyan-bright/40 hover:border-cyan-bright hover:bg-cyan/10',
  amber: 'border-amber/40 hover:border-amber hover:bg-amber/10',
  pink: 'border-pink/40 hover:border-pink hover:bg-pink/10',
};

export function SkillPill({ name, detail, accent, delay = 0 }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pillRef = useRef<HTMLButtonElement>(null);

  const hasDetail = !!detail && !!detail.shortDef;

  useLayoutEffect(() => {
    if (!showTooltip || !pillRef.current) return;
    const update = () => {
      if (!pillRef.current) return;
      const rect = pillRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showTooltip]);

  return (
    <>
      <motion.button
        ref={pillRef}
        type="button"
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        viewport={{ once: true }}
        onClick={() => hasDetail && setShowModal(true)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className={`relative inline-flex items-center px-3 py-1 rounded-full text-xs text-text-secondary border bg-white/5 transition-all duration-300 ${ACCENT_BORDER[accent]} ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {name}
      </motion.button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showTooltip && hasDetail && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="fixed z-[9999] pointer-events-none"
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                transform: 'translate(-50%, calc(-100% - 12px))',
              }}
            >
              <div className="w-72 bg-bg-surface/95 border border-glass-border-strong rounded-xl px-4 py-3 shadow-2xl backdrop-blur-xl">
                <p
                  className="text-xs text-text-secondary leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: detail!.shortDef }}
                />
                <p className="text-[10px] text-violet-bright mt-2 font-mono uppercase tracking-wider">
                  Click to learn more →
                </p>
              </div>
              <div className="absolute left-1/2 top-full w-2 h-2 bg-bg-surface border-r border-b border-glass-border-strong -translate-x-1/2 -translate-y-1/2 rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <AnimatePresence>
        {showModal && detail && <SkillModal skill={detail} onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </>
  );
}
