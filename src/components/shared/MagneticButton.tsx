import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useRef, type ReactNode, type MouseEvent } from 'react';
import { cn } from '../../utils/cn';

type Props = {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  strength?: number;
};

export function MagneticButton({ children, href, onClick, className, strength = 0.3 }: Props) {
  const ref = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const y = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });

  const handleMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const handleLeave = () => { x.set(0); y.set(0); };

  const style = { x, y } as const;
  const cls = cn(
    'glass inline-flex items-center gap-2 px-6 py-3 text-sm font-medium tracking-wide text-text-primary hover:border-violet-bright/60 transition-colors',
    className,
  );

  if (href) {
    return (
      <motion.a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel="noreferrer"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={style}
        className={cls}
      >
        {children}
      </motion.a>
    );
  }
  return (
    <motion.button
      ref={ref as React.RefObject<HTMLButtonElement>}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
      style={style}
      className={cls}
    >
      {children}
    </motion.button>
  );
}
