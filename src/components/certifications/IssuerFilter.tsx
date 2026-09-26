'use client';

import { useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { spring } from '@/lib/motion';
import { cn } from '@/utils/cn';
import { ISSUER_OPTIONS, type IssuerFilter as Filter } from './data';

type Props = { value: Filter; onChange: (next: Filter) => void; className?: string };

/**
 * Issuer chips as a radiogroup: one tab stop, arrows (and Home/End) move and
 * select, the counts are real. Local state only: the urlState contract has no
 * namespace for this section, so a filtered view is not a link.
 */
export function IssuerFilter({ value, onChange, className }: Props) {
  const { reduce } = useMotionPrefs();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ISSUER_OPTIONS.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next === -1) return;
    e.preventDefault();
    onChange(ISSUER_OPTIONS[next].value);
    radios.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Filter credentials by issuer" data-cert-filter="" className={cn('flex flex-wrap gap-2', className)}>
      {ISSUER_OPTIONS.map((opt, i) => {
        const checked = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-issuer-chip={opt.value}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'tap-safe relative isolate gap-2 whitespace-nowrap rounded-full px-4 font-mono text-xs uppercase tracking-wider ring-focus transition-colors duration-200',
              checked ? 'text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {checked ? (
              <motion.span
                aria-hidden="true"
                layoutId={reduce ? undefined : 'cert-issuer-pill'}
                transition={spring.ui}
                className="absolute inset-0 -z-[1] rounded-full bg-violet"
              />
            ) : (
              <span aria-hidden="true" className="absolute inset-0 -z-[1] rounded-full border border-glass-border-strong bg-glass-fill" />
            )}
            <span>{opt.label}</span>
            <span className={cn('tabular-nums', checked ? 'text-white' : 'text-text-dim')}>
              <span className="sr-only">, </span>
              {opt.count}
              <span className="sr-only"> {opt.count === 1 ? 'credential' : 'credentials'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
