'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { duration as dur, ease } from '@/lib/motion';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it dismisses itself (default 4000). 0 or Infinity keeps it until closed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastOptions & { id: string };

type ToastApi = {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
};

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4000;

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />,
  error: <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />,
  info: <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cyan-text" />,
};

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const { paused: motionPaused } = useMotionPrefs();
  const barRef = useRef<HTMLSpanElement>(null);
  const holds = useRef(new Set<string>());
  const timed = Number.isFinite(item.duration ?? DEFAULT_DURATION) && (item.duration ?? DEFAULT_DURATION) > 0;
  const total = item.duration ?? DEFAULT_DURATION;

  // One WAAPI animation is both the progress bar and the timer, so pausing it
  // on hover or focus pauses the countdown with no drift between the two.
  const animRef = useRef<Animation | null>(null);
  const hold = (reason: string) => {
    holds.current.add(reason);
    animRef.current?.pause();
  };
  const release = (reason: string) => {
    holds.current.delete(reason);
    const anim = animRef.current;
    if (holds.current.size === 0 && anim && anim.playState === 'paused') anim.play();
  };

  useEffect(() => {
    const bar = barRef.current;
    if (!timed || !bar || typeof bar.animate !== 'function') {
      if (!timed) return;
      const t = window.setTimeout(() => onDismiss(item.id), total);
      return () => window.clearTimeout(t);
    }
    const anim = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: total,
      easing: 'linear',
      fill: 'forwards',
    });
    animRef.current = anim;
    anim.onfinish = () => onDismiss(item.id);
    const onVisibility = () => (document.hidden ? hold('hidden') : release('hidden'));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      anim.onfinish = null;
      anim.cancel();
      animRef.current = null;
    };
  }, [item.id, timed, total, onDismiss]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onDismiss(item.id);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500) onDismiss(item.id);
  };

  const tone = item.tone ?? 'info';

  return (
    <motion.div
      layout
      role="group"
      aria-label={item.title}
      data-toast=""
      data-tone={tone}
      className="glass-strong glass-keep pointer-events-auto relative flex w-full max-w-sm touch-pan-y items-start gap-3 overflow-clip py-3 pl-4 pr-2 text-left"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: dur.base, ease: ease.out } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18, ease: ease.in } }}
      drag="x"
      dragSnapToOrigin
      dragElastic={0.6}
      onDragEnd={onDragEnd}
      onPointerEnter={(e) => e.pointerType === 'mouse' && hold('hover')}
      onPointerLeave={() => release('hover')}
      onFocus={() => hold('focus')}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release('focus');
      }}
      onKeyDown={onKeyDown}
    >
      {TONE_ICON[tone]}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-medium leading-snug text-text-primary">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-[13px] leading-snug text-text-muted">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss(item.id);
            }}
            className="tap-safe-sm -ml-2 mt-1 rounded-full px-2 text-[13px] font-medium text-cyan-text underline-offset-4 ring-focus hover:underline"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
        className="tap-safe -my-1.5 shrink-0 rounded-full text-text-muted ring-focus transition-colors hover:bg-surface-tint hover:text-text-primary"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
      {timed ? (
        <span
          ref={barRef}
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-violet-bright"
          style={{ opacity: motionPaused ? 0 : 0.6 }}
        />
      ) : null}
    </motion.div>
  );
}

/**
 * Glass toasts in one polite live region, stacked above the floating dock:
 * bottom-centre below 640px, bottom-right above. At most three at once (the oldest
 * gives way). Each dismisses itself after 4s; hover or focus pauses the countdown;
 * Escape or a horizontal swipe closes it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    counter += 1;
    const id = `toast-${counter}`;
    setItems((list) => [...list, { ...opts, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {hydrated
        ? createPortal(
            <div
              data-toast-region=""
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 z-toast flex flex-col items-center gap-2 px-4 transition-[bottom] duration-[var(--dur-base)] ease-[var(--ease-out-expo)] sm:left-auto sm:right-6 sm:w-96 sm:items-end sm:px-0"
              // --ai-lift: set on <html> by the guided-tour pill so toasts clear it; unset, it adds nothing.
              style={{ bottom: 'calc(var(--dock-clearance) + var(--dock-height) + 0.75rem + var(--ai-lift, 0px))' }}
            >
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <ToastCard key={item.id} item={item} onDismiss={dismiss} />
                ))}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

const NOOP_API: ToastApi = { toast: () => '', dismiss: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_API;
}
