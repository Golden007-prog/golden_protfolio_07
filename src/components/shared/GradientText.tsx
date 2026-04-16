import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function GradientText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('gradient-text', className)}>{children}</span>;
}
