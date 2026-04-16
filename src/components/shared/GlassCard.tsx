import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../utils/cn';

type Props = HTMLMotionProps<'div'> & { strong?: boolean; glow?: 'violet' | 'cyan' | 'none' };

export function GlassCard({ strong, glow = 'none', className, children, ...rest }: Props) {
  return (
    <motion.div
      className={cn(
        strong ? 'glass-strong' : 'glass',
        glow === 'violet' && 'glow-violet',
        glow === 'cyan' && 'glow-cyan',
        'relative overflow-hidden',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
