'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme, type ThemeOrigin } from '@/contexts/ThemeContext';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { Button } from '@/components/ui/Button';
import { track } from '@/lib/analytics';
import { ease } from '@/lib/motion';
import { cn } from '@/utils/cn';

type Props = {
  className?: string;
  /** The caret that opens the Dark/Light/System choice. Touch can long-press the toggle instead. */
  showCaret?: boolean;
  /** Registers the T shortcut. Duplicates are harmless (the first handler wins). */
  hotkey?: boolean;
  /** Which way the choice opens. */
  menuPlacement?: 'bottom' | 'top';
};

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
];

const LONG_PRESS_MS = 480;

function centreOf(el: Element | null): ThemeOrigin | undefined {
  const r = el?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return undefined;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function ThemeToggle({ className, showCaret = true, hotkey = true, menuPlacement = 'bottom' }: Props) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const { reduce } = useMotionPrefs();
  const isDark = resolvedTheme === 'dark';
  // useId can contain characters that break url(#...) references.
  const maskId = `tt-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const menuId = `${maskId}-menu`;

  const toggleRef = useRef<HTMLButtonElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const pressTimer = useRef<number | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef<string>('mouse');

  const flip = (origin?: ThemeOrigin) => {
    track('theme_toggle', { to: isDark ? 'light' : 'dark' });
    toggleTheme(origin);
  };

  useHotkeys({ t: () => flip(centreOf(toggleRef.current)) }, { enabled: hotkey });

  // Close on outside press or focus leaving the choice.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || caretRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // Focus the checked option when the choice opens.
  useEffect(() => {
    if (!open) return;
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    checked?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  const choose = (value: Theme, el: Element | null) => {
    track('theme_toggle', { to: value });
    setTheme(value, centreOf(el));
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) (caretRef.current ?? toggleRef.current)?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const radios = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      const next = radios[(to + radios.length) % radios.length];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      choose(next.dataset.value as Theme, next);
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(index + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(radios.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') setOpen(false);
  };

  /* Long-press on touch opens the choice; a mouse right-click keeps the native menu. */
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== 'touch') return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    window.clearTimeout(pressTimer.current);
    pressStart.current = null;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
  };

  const iconTransition = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 180, damping: 22 };

  return (
    <span className={cn('relative inline-flex items-center', className)} data-theme-toggle="">
      <Button
        ref={toggleRef}
        variant="icon"
        aria-label="Dark theme"
        aria-pressed={isDark}
        data-theme-button=""
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerMove={onPointerMove}
        onContextMenu={(e) => {
          if (lastPointer.current === 'touch') e.preventDefault();
        }}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          flip(centreOf(e.currentTarget));
        }}
        className={cn('size-11', showCaret && 'pointer-fine:rounded-r-md')}
      >
        <motion.svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="relative size-5"
          initial={false}
          animate={{ rotate: isDark ? 0 : 180 }}
          transition={iconTransition}
        >
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width="24" height="24" fill="white" />
              <motion.circle
                r="9"
                fill="black"
                initial={false}
                animate={{ cx: isDark ? 16 : 30, cy: isDark ? 8 : -6 }}
                transition={iconTransition}
              />
            </mask>
          </defs>
          <motion.g
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="text-amber-text"
            initial={false}
            animate={{ opacity: isDark ? 0 : 1, scale: isDark ? 0.4 : 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.35, ease: ease.out }}
            style={{ transformOrigin: '12px 12px' }}
          >
            <line x1="12" y1="2.2" x2="12" y2="4.6" />
            <line x1="12" y1="19.4" x2="12" y2="21.8" />
            <line x1="2.2" y1="12" x2="4.6" y2="12" />
            <line x1="19.4" y1="12" x2="21.8" y2="12" />
            <line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
            <line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
            <line x1="4.9" y1="19.1" x2="6.6" y2="17.4" />
            <line x1="17.4" y1="6.6" x2="19.1" y2="4.9" />
          </motion.g>
          <circle
            cx="12"
            cy="12"
            r="5"
            mask={`url(#${maskId})`}
            className={cn('transition-[fill] duration-300', isDark ? 'fill-violet-bright' : 'fill-amber')}
          />
        </motion.svg>
      </Button>

      {showCaret ? (
        // Fine pointers only: touch opens the same choice with a long-press, and a
        // 28px caret would fall short of the 44px touch target.
        <span className="hidden pointer-fine:inline-flex">
          <Button
            ref={caretRef}
            variant="icon"
            aria-label="Theme options"
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className="h-11 w-7 min-w-7 rounded-l-md border-l-0 px-0"
          >
            <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
          </Button>
        </span>
      ) : null}

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="radiogroup"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'glass-strong glass-keep absolute right-0 z-10 flex w-40 flex-col gap-1 p-1.5',
            menuPlacement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
          style={{ borderRadius: '1rem' }}
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const checked = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                data-value={value}
                onClick={(e) => {
                  choose(value, e.currentTarget);
                  close(true);
                }}
                className={cn(
                  'tap-safe w-full justify-start gap-3 rounded-xl px-3 text-sm ring-focus transition-colors',
                  checked ? 'bg-surface-tint text-text-primary' : 'text-text-secondary hover:bg-surface-tint hover:text-text-primary',
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 rounded-full bg-violet-bright transition-opacity', checked ? 'opacity-100' : 'opacity-0')}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
