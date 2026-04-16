import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useRef, type ReactNode, type MouseEvent } from 'react';

type Props = {
  children: ReactNode;
  strength?: number;
  className?: string;
};

export function Magnetic({ children, strength = 0.35, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 20 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 20 });

  const handleMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ x, y, display: 'inline-block' }}
      className={className}
    >
      {children}
    </motion.span>
  );
}
