import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useInView } from '../../hooks/useInView';
import { GlassCard } from '../shared/GlassCard';

type Props = { value: number; suffix?: string; label: string };

export function StatCard({ value, suffix = '', label }: Props) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setN(value);
      return;
    }
    const start = performance.now();
    const duration = 1600;
    const isFloat = value % 1 !== 0;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(isFloat ? Number((eased * value).toFixed(2)) : Math.floor(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduce]);

  return (
    <GlassCard
      strong
      className="p-6 md:p-8 relative overflow-hidden group transition-all duration-500 hover:border-violet-bright/30"
      ref={ref}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-violet-bright/0 via-transparent to-cyan-bright/0 group-hover:from-violet-bright/10 group-hover:to-cyan-bright/10 transition-all duration-700 pointer-events-none" />
      <motion.div
        className="relative font-display font-black text-5xl md:text-6xl leading-none"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="bg-gradient-to-r from-violet-bright to-cyan-bright bg-clip-text text-transparent">
          {n}
        </span>
        <span className="text-text-muted text-3xl ml-1">{suffix}</span>
      </motion.div>
      <p className="relative mt-4 font-mono text-[13px] md:text-sm tracking-[0.18em] uppercase text-text-secondary font-medium">{label}</p>
    </GlassCard>
  );
}
